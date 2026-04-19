import { Request, Response, NextFunction } from 'express';
import { Quotation, QuotationStatus } from '../models/Quotation';
import { Invoice, InvoiceStatus } from '../models/Invoice';
import { Booking, BookingStatus } from '../models/Booking';
import { User, UserRole } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import { sendQuotationEmail } from '../services/email';
import { decryptField } from '../utils/encryption';

function decryptPopulatedUser(user: any): any {
  if (!user || typeof user !== 'object' || !user.name) return user;
  try {
    return {
      ...(user.toJSON ? user.toJSON() : user),
      name: decryptField(user.name),
      phone: user.phone ? decryptField(user.phone) : undefined,
    };
  } catch {
    return user.toJSON ? user.toJSON() : user;
  }
}

function decryptQuotation(quotation: any): any {
  const obj = quotation.toJSON ? quotation.toJSON() : { ...quotation };
  if (obj.customerId && typeof obj.customerId === 'object') {
    obj.customerId = decryptPopulatedUser(obj.customerId);
  }
  if (obj.createdBy && typeof obj.createdBy === 'object') {
    obj.createdBy = decryptPopulatedUser(obj.createdBy);
  }
  return obj;
}

async function generateQuotationNumber(): Promise<string> {
  const count = await Quotation.countDocuments();
  const num = (count + 1).toString().padStart(5, '0');
  return `QT-${num}`;
}

// ────────────────────────────────────────────────────────────────
// GET /api/quotations
// ────────────────────────────────────────────────────────────────
export async function listQuotations(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    let filter: any = {};
    if (req.user.role === UserRole.Customer) {
      filter.customerId = req.user.userId;
      // Customers shouldn't see drafts
      filter.status = { $ne: QuotationStatus.Draft };
    }
    if (req.query.status) filter.status = req.query.status;

    const [quotations, total] = await Promise.all([
      Quotation.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('customerId', 'name email')
        .populate('bookingId', 'serviceType scheduledDate')
        .populate('createdBy', 'name email'),
      Quotation.countDocuments(filter),
    ]);

    res.json({
      quotations: quotations.map(decryptQuotation),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// GET /api/quotations/:id
// ────────────────────────────────────────────────────────────────
export async function getQuotation(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const quotation = await Quotation.findById(req.params.id)
      .populate('customerId', 'name email phone')
      .populate('bookingId', 'serviceType scheduledDate scheduledTime address')
      .populate('createdBy', 'name email');

    if (!quotation) throw new AppError(404, 'Quotation not found');

    if (
      req.user.role === UserRole.Customer &&
      quotation.customerId._id.toString() !== req.user.userId
    ) {
      throw new AppError(403, 'Access denied');
    }

    res.json(decryptQuotation(quotation));
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/quotations (admin only)
// ────────────────────────────────────────────────────────────────
export async function createQuotation(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const { customerId, bookingId, lineItems, taxRate = 6.25, notes, validUntil } = req.body;

    // Verify customer exists
    const customer = await User.findById(customerId);
    if (!customer) throw new AppError(404, 'No user found with that ID');
    if (customer.isDeleted) throw new AppError(400, 'This customer account has been deleted');
    if (customer.role !== UserRole.Customer) {
      throw new AppError(400, `Cannot create a quotation for a ${customer.role} account — only customer accounts are allowed`);
    }

    // Verify booking exists and belongs to this customer
    const booking = await Booking.findById(bookingId);
    if (!booking) throw new AppError(404, 'Booking not found');
    if (booking.customerId.toString() !== customerId) {
      throw new AppError(400, 'This booking does not belong to the selected customer');
    }

    // Calculate totals
    const computedItems = lineItems.map((item: any) => ({
      description: item.description,
      quantity: item.quantity || 1,
      unitPriceCents: item.unitPriceCents,
      amountCents: (item.quantity || 1) * item.unitPriceCents,
    }));

    const subtotalCents = computedItems.reduce((sum: number, item: any) => sum + item.amountCents, 0);
    const taxAmountCents = Math.round(subtotalCents * (taxRate / 100));
    const totalAmountCents = subtotalCents + taxAmountCents;

    const quotationNumber = await generateQuotationNumber();

    const quotation = await Quotation.create({
      quotationNumber,
      bookingId,
      customerId,
      lineItems: computedItems,
      subtotalCents,
      taxRate,
      taxAmountCents,
      totalAmountCents,
      notes,
      validUntil: new Date(validUntil),
      createdBy: req.user.userId,
    });

    await req.audit('quotation.create', 'Quotation', quotation._id.toString());

    const populated = await Quotation.findById(quotation._id)
      .populate('customerId', 'name email')
      .populate('createdBy', 'name email');

    res.status(201).json(decryptQuotation(populated));
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/quotations/:id/send (admin only)
// ────────────────────────────────────────────────────────────────
export async function sendQuotation(req: Request, res: Response, next: NextFunction) {
  try {
    const quotation = await Quotation.findById(req.params.id).populate('customerId', 'email name');
    if (!quotation) throw new AppError(404, 'Quotation not found');

    if (quotation.status !== QuotationStatus.Draft) {
      throw new AppError(400, 'Only draft quotations can be sent');
    }

    quotation.status = QuotationStatus.Sent;
    quotation.sentAt = new Date();
    await quotation.save();

    // Auto-update booking to "quoted" if still pending
    if (quotation.bookingId) {
      await Booking.findOneAndUpdate(
        { _id: quotation.bookingId, status: BookingStatus.PendingQuote },
        { status: BookingStatus.Quoted },
      );
    }

    // Send email — don't block the status update if email fails
    const customer = quotation.customerId as any;
    try {
      const email = customer.email?.includes(':') ? decryptField(customer.email) : customer.email;
      await sendQuotationEmail(email, {
        quotationNumber: quotation.quotationNumber,
        totalAmountCents: quotation.totalAmountCents,
        subtotalCents: quotation.subtotalCents,
        taxAmountCents: quotation.taxAmountCents,
        validUntil: quotation.validUntil,
      });
    } catch (emailErr) {
      console.error('[EMAIL] Failed to send quotation email:', emailErr);
    }

    await req.audit('quotation.send', 'Quotation', quotation._id.toString());

    res.json(quotation);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH /api/quotations/:id/respond (customer)
// ────────────────────────────────────────────────────────────────
export async function respondToQuotation(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const { accepted, declineReason } = req.body;
    const quotation = await Quotation.findById(req.params.id);
    if (!quotation) throw new AppError(404, 'Quotation not found');

    if (quotation.customerId.toString() !== req.user.userId) {
      throw new AppError(403, 'Access denied');
    }

    if (quotation.status !== QuotationStatus.Sent) {
      throw new AppError(400, 'Quotation is not awaiting a response');
    }

    // Check expiry
    if (new Date() > quotation.validUntil) {
      quotation.status = QuotationStatus.Expired;
      await quotation.save();
      throw new AppError(400, 'This quotation has expired');
    }

    if (accepted) {
      quotation.status = QuotationStatus.Accepted;
      quotation.acceptedAt = new Date();
      await quotation.save();

      // Auto-update booking to "approved"
      if (quotation.bookingId) {
        await Booking.findOneAndUpdate(
          { _id: quotation.bookingId, status: { $in: [BookingStatus.PendingQuote, BookingStatus.Quoted] } },
          { status: BookingStatus.Approved, customerApprovedAt: new Date(), amountCents: quotation.totalAmountCents },
        );
      }

      // Auto-create and send Invoice from this quotation
      const invoiceCount = await Invoice.countDocuments();
      const invoiceNumber = `INV-${(invoiceCount + 1).toString().padStart(5, '0')}`;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30);

      await Invoice.create({
        invoiceNumber,
        bookingId: quotation.bookingId,
        quotationId: quotation._id,
        customerId: quotation.customerId,
        lineItems: quotation.lineItems,
        subtotalCents: quotation.subtotalCents,
        taxRate: quotation.taxRate,
        taxAmountCents: quotation.taxAmountCents,
        totalAmountCents: quotation.totalAmountCents,
        dueDate,
        status: InvoiceStatus.Sent,
        sentAt: new Date(),
      });
    } else {
      quotation.status = QuotationStatus.Declined;
      quotation.declinedAt = new Date();
      quotation.declineReason = declineReason;
      await quotation.save();

      // Auto-cancel the booking
      if (quotation.bookingId) {
        await Booking.findOneAndUpdate(
          { _id: quotation.bookingId, status: { $nin: [BookingStatus.Completed, BookingStatus.Cancelled] } },
          { status: BookingStatus.Cancelled, cancellationReason: `Quotation declined: ${declineReason || 'No reason given'}` },
        );
      }
    }

    await req.audit('quotation.respond', 'Quotation', quotation._id.toString(), {
      accepted,
      declineReason,
    });

    res.json(quotation);
  } catch (err) {
    next(err);
  }
}
