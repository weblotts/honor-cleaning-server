import { Request, Response, NextFunction } from 'express';
import { ChequePayment, ChequeStatus } from '../models/ChequePayment';
import { Invoice, InvoiceStatus } from '../models/Invoice';
import { Receipt } from '../models/Receipt';
import { Booking, BookingStatus } from '../models/Booking';
import { User } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import { decryptField } from '../utils/encryption';
import {
  sendChequeReceivedEmail,
  sendChequeDepositedEmail,
  sendChequeClearedEmail,
  sendChequeBouncedEmail,
} from '../services/email';

// ────────────────────────────────────────────────────────────────
// POST /api/invoices/:id/cheque-payment (admin)
// Record a cheque received against an invoice
// ────────────────────────────────────────────────────────────────
export async function recordChequePayment(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) throw new AppError(404, 'Invoice not found');

    if ((invoice.paymentMethod || 'stripe') !== 'cheque') {
      throw new AppError(400, 'This invoice is not set up for cheque payment');
    }

    if (invoice.status === InvoiceStatus.Paid) {
      throw new AppError(400, 'Invoice is already paid');
    }

    // Check for existing active cheque (only allow new if previous bounced)
    const existingCheque = await ChequePayment.findOne({
      invoiceId: invoice._id,
      status: { $in: [ChequeStatus.Received, ChequeStatus.Deposited, ChequeStatus.Cleared] },
    });
    if (existingCheque) {
      throw new AppError(400, `A cheque is already recorded for this invoice (status: ${existingCheque.status})`);
    }

    const { chequeNumber, bankName, drawerName, dateOnCheque, notes } = req.body;

    if (!chequeNumber || !bankName || !drawerName || !dateOnCheque) {
      throw new AppError(400, 'Cheque number, bank name, drawer name, and date on cheque are required');
    }

    const cheque = await ChequePayment.create({
      invoiceId: invoice._id,
      chequeNumber,
      bankName,
      drawerName,
      amountCents: invoice.totalAmountCents,
      dateOnCheque: new Date(dateOnCheque),
      dateReceived: new Date(),
      status: ChequeStatus.Received,
      notes,
      recordedBy: req.user.userId,
    });

    invoice.chequePaymentId = cheque._id;
    await invoice.save();

    await req.audit('cheque.received', 'ChequePayment', cheque._id.toString());

    // Email customer
    try {
      const customer = await User.findById(invoice.customerId);
      if (customer?.email) {
        const email = customer.email.includes(':') ? decryptField(customer.email) : customer.email;
        await sendChequeReceivedEmail(email, {
          invoiceNumber: invoice.invoiceNumber,
          chequeNumber,
          amountCents: invoice.totalAmountCents,
        });
      }
    } catch (err) {
      console.error('[EMAIL] Failed to send cheque received email:', err);
    }

    res.status(201).json(cheque);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH /api/cheque-payments/:id/deposit (admin)
// ────────────────────────────────────────────────────────────────
export async function depositCheque(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const cheque = await ChequePayment.findById(req.params.id);
    if (!cheque) throw new AppError(404, 'Cheque payment not found');

    if (cheque.status !== ChequeStatus.Received) {
      throw new AppError(400, `Cannot deposit a cheque with status "${cheque.status}"`);
    }

    cheque.status = ChequeStatus.Deposited;
    cheque.dateDeposited = new Date();
    await cheque.save();

    await req.audit('cheque.deposited', 'ChequePayment', cheque._id.toString());

    // Email customer
    try {
      const invoice = await Invoice.findById(cheque.invoiceId);
      const customer = invoice ? await User.findById(invoice.customerId) : null;
      if (customer?.email && invoice) {
        const email = customer.email.includes(':') ? decryptField(customer.email) : customer.email;
        await sendChequeDepositedEmail(email, {
          invoiceNumber: invoice.invoiceNumber,
          chequeNumber: cheque.chequeNumber,
          amountCents: cheque.amountCents,
        });
      }
    } catch (err) {
      console.error('[EMAIL] Failed to send cheque deposited email:', err);
    }

    res.json(cheque);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH /api/cheque-payments/:id/clear (admin)
// Marks cheque as cleared, invoice as paid, creates receipt
// ────────────────────────────────────────────────────────────────
export async function clearCheque(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const cheque = await ChequePayment.findById(req.params.id);
    if (!cheque) throw new AppError(404, 'Cheque payment not found');

    if (cheque.status !== ChequeStatus.Deposited) {
      throw new AppError(400, `Cannot clear a cheque with status "${cheque.status}". It must be deposited first.`);
    }

    const invoice = await Invoice.findById(cheque.invoiceId);
    if (!invoice) throw new AppError(404, 'Associated invoice not found');

    const paidAt = new Date();

    // Update cheque
    cheque.status = ChequeStatus.Cleared;
    cheque.dateCleared = paidAt;
    await cheque.save();

    // Mark invoice as paid
    invoice.status = InvoiceStatus.Paid;
    invoice.paidAt = paidAt;
    await invoice.save();

    // Auto-create receipt
    const receiptCount = await Receipt.countDocuments();
    const receiptNumber = `RCT-${(receiptCount + 1).toString().padStart(5, '0')}`;

    const receipt = await Receipt.create({
      receiptNumber,
      invoiceId: invoice._id,
      quotationId: invoice.quotationId || undefined,
      bookingId: invoice.bookingId || undefined,
      customerId: invoice.customerId,
      lineItems: invoice.lineItems,
      subtotalCents: invoice.subtotalCents,
      taxRate: invoice.taxRate,
      taxAmountCents: invoice.taxAmountCents,
      totalAmountCents: invoice.totalAmountCents,
      tipAmountCents: invoice.tipAmountCents,
      paymentMethod: 'cheque',
      chequePaymentId: cheque._id,
      paidAt,
    });

    // Auto-confirm booking if applicable
    if (invoice.bookingId) {
      await Booking.findOneAndUpdate(
        { _id: invoice.bookingId, status: { $in: [BookingStatus.Approved, BookingStatus.Pending] } },
        { status: BookingStatus.Confirmed },
      );
    }

    await req.audit('cheque.cleared', 'ChequePayment', cheque._id.toString());

    // Email customer
    try {
      const customer = await User.findById(invoice.customerId);
      if (customer?.email) {
        const email = customer.email.includes(':') ? decryptField(customer.email) : customer.email;
        await sendChequeClearedEmail(email, {
          invoiceNumber: invoice.invoiceNumber,
          chequeNumber: cheque.chequeNumber,
          receiptNumber,
          amountCents: cheque.amountCents,
        });
      }
    } catch (err) {
      console.error('[EMAIL] Failed to send cheque cleared email:', err);
    }

    res.json({ cheque, invoice, receipt });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH /api/cheque-payments/:id/bounce (admin)
// ────────────────────────────────────────────────────────────────
export async function bounceCheque(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const cheque = await ChequePayment.findById(req.params.id);
    if (!cheque) throw new AppError(404, 'Cheque payment not found');

    if (cheque.status !== ChequeStatus.Deposited && cheque.status !== ChequeStatus.Received) {
      throw new AppError(400, `Cannot bounce a cheque with status "${cheque.status}"`);
    }

    const { bounceReason } = req.body;

    cheque.status = ChequeStatus.Bounced;
    cheque.dateBounced = new Date();
    cheque.bounceReason = bounceReason || 'Returned by bank';
    await cheque.save();

    // Revert invoice to Sent if it was somehow marked paid
    const invoice = await Invoice.findById(cheque.invoiceId);
    if (invoice && invoice.status === InvoiceStatus.Paid) {
      invoice.status = InvoiceStatus.Sent;
      invoice.paidAt = undefined;
      await invoice.save();
    }

    await req.audit('cheque.bounced', 'ChequePayment', cheque._id.toString());

    // Email customer
    try {
      const customer = invoice ? await User.findById(invoice.customerId) : null;
      if (customer?.email && invoice) {
        const email = customer.email.includes(':') ? decryptField(customer.email) : customer.email;
        await sendChequeBouncedEmail(email, {
          invoiceNumber: invoice.invoiceNumber,
          chequeNumber: cheque.chequeNumber,
          amountCents: cheque.amountCents,
          bounceReason: cheque.bounceReason,
        });
      }
    } catch (err) {
      console.error('[EMAIL] Failed to send cheque bounced email:', err);
    }

    res.json(cheque);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// GET /api/cheque-payments (admin)
// List all cheque payments with filters
// ────────────────────────────────────────────────────────────────
export async function listChequePayments(req: Request, res: Response, next: NextFunction) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (req.query.status) filter.status = req.query.status;

    const [cheques, total] = await Promise.all([
      ChequePayment.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'invoiceId',
          select: 'invoiceNumber customerId totalAmountCents status',
          populate: { path: 'customerId', select: 'name email' },
        })
        .populate('recordedBy', 'name email'),
      ChequePayment.countDocuments(filter),
    ]);

    // Decrypt customer names
    const decrypted = cheques.map((c) => {
      const obj = c.toJSON();
      const inv = obj.invoiceId as any;
      if (inv?.customerId && typeof inv.customerId === 'object' && inv.customerId.name) {
        try { inv.customerId.name = decryptField(inv.customerId.name); } catch { /* keep */ }
      }
      if (obj.recordedBy && typeof obj.recordedBy === 'object' && (obj.recordedBy as any).name) {
        try { (obj.recordedBy as any).name = decryptField((obj.recordedBy as any).name); } catch { /* keep */ }
      }
      return obj;
    });

    res.json({ cheques: decrypted, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
}
