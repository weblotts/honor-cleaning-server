import mongoose from 'mongoose';
import { Request, Response, NextFunction } from 'express';
import { Invoice, InvoiceStatus, RefundType } from '../models/Invoice';
import { Receipt } from '../models/Receipt';
import { Booking, BookingStatus } from '../models/Booking';
import { User, UserRole } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import { getStripe, createPaymentIntent, retrievePaymentIntent, refundPayment, createStripeCustomer } from '../services/stripe';
import { sendInvoiceEmail, sendReceiptEmail } from '../services/email';
import { decryptField } from '../utils/encryption';

const MA_TAX_RATE = 6.25; // Massachusetts sales tax

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

async function generateInvoiceNumber(): Promise<string> {
  const count = await Invoice.countDocuments();
  const num = (count + 1).toString().padStart(5, '0');
  return `INV-${num}`;
}

// ────────────────────────────────────────────────────────────────
// GET /api/invoices
// ────────────────────────────────────────────────────────────────
export async function listInvoices(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    let filter: any = {};
    // COMPLIANCE: Customers can only see their own invoices
    if (req.user.role === UserRole.Customer) {
      filter.customerId = req.user.userId;
    }
    if (req.query.status) filter.status = req.query.status;

    const [invoices, total] = await Promise.all([
      Invoice.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('customerId', 'name email')
        .populate('bookingId', 'serviceType scheduledDate')
        .populate('quotationId', 'quotationNumber'),
      Invoice.countDocuments(filter),
    ]);

    const decrypted = invoices.map((inv) => {
      const obj = inv.toJSON();
      if (obj.customerId && typeof obj.customerId === 'object') {
        obj.customerId = decryptPopulatedUser(obj.customerId);
      }
      return obj;
    });
    res.json({ invoices: decrypted, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// GET /api/invoices/:id
// ────────────────────────────────────────────────────────────────
export async function getInvoice(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const invoice = await Invoice.findById(req.params.id)
      .populate('customerId', 'name email phone')
      .populate('bookingId')
      .populate('quotationId', 'quotationNumber status')
      .populate('chequePaymentId');

    if (!invoice) throw new AppError(404, 'Invoice not found');

    if (
      req.user.role === UserRole.Customer &&
      invoice.customerId._id.toString() !== req.user.userId
    ) {
      throw new AppError(403, 'Access denied');
    }

    const obj = invoice.toJSON();
    if (obj.customerId && typeof obj.customerId === 'object') {
      obj.customerId = decryptPopulatedUser(obj.customerId);
    }
    res.json(obj);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/invoices (admin only) — create manual invoice
// ────────────────────────────────────────────────────────────────
export async function createInvoice(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const { customerId, bookingId, quotationId, lineItems, taxRate = MA_TAX_RATE, notes, dueDate, paymentMethod = 'stripe' } = req.body;

    // Verify customer exists
    const customer = await User.findOne({ _id: customerId, role: UserRole.Customer, isDeleted: false });
    if (!customer) throw new AppError(404, 'Customer not found');

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

    const invoiceNumber = await generateInvoiceNumber();

    const invoice = await Invoice.create({
      invoiceNumber,
      bookingId: bookingId || undefined,
      quotationId: quotationId || undefined,
      customerId,
      lineItems: computedItems,
      subtotalCents,
      taxRate,
      taxAmountCents,
      totalAmountCents,
      paymentMethod: paymentMethod === 'cheque' ? 'cheque' : 'stripe',
      notes,
      dueDate: new Date(dueDate),
    });

    await req.audit('invoice.create', 'Invoice', invoice._id.toString());

    const populated = await Invoice.findById(invoice._id)
      .populate('customerId', 'name email')
      .populate('bookingId', 'serviceType scheduledDate');

    const obj = populated!.toJSON();
    if (obj.customerId && typeof obj.customerId === 'object') {
      obj.customerId = decryptPopulatedUser(obj.customerId);
    }

    res.status(201).json(obj);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/invoices/:id/send
// ────────────────────────────────────────────────────────────────
export async function sendInvoice(req: Request, res: Response, next: NextFunction) {
  try {
    const invoice = await Invoice.findById(req.params.id).populate('customerId', 'email');
    if (!invoice) throw new AppError(404, 'Invoice not found');

    invoice.status = InvoiceStatus.Sent;
    invoice.sentAt = new Date();
    await invoice.save();

    // Send email — don't block the status update if email fails
    const customer = invoice.customerId as any;
    try {
      const email = customer.email?.includes(':') ? decryptField(customer.email) : customer.email;
      await sendInvoiceEmail(email, {
        invoiceNumber: invoice.invoiceNumber,
        subtotalCents: invoice.subtotalCents,
        taxRate: invoice.taxRate,
        taxAmountCents: invoice.taxAmountCents,
        totalAmountCents: invoice.totalAmountCents,
        dueDate: invoice.dueDate,
        pdfUrl: invoice.pdfUrl,
      });
    } catch (emailErr) {
      console.error('[EMAIL] Failed to send invoice email:', emailErr);
    }

    await req.audit('invoice.send', 'Invoice', invoice._id.toString());

    res.json(invoice);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/invoices/:id/pay (customer)
// Creates a Stripe PaymentIntent for the invoice amount
// ────────────────────────────────────────────────────────────────
export async function payInvoice(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) throw new AppError(404, 'Invoice not found');

    if (invoice.customerId.toString() !== req.user.userId) {
      throw new AppError(403, 'Access denied');
    }

    if ((invoice.paymentMethod || 'stripe') === 'cheque') {
      throw new AppError(400, 'This invoice requires cheque payment. Online payment is not available.');
    }

    if (invoice.status === InvoiceStatus.Paid) {
      throw new AppError(400, 'Invoice already paid');
    }

    if (invoice.status === InvoiceStatus.Refunded) {
      throw new AppError(400, 'Invoice has been refunded');
    }

    // If a PaymentIntent already exists, reuse it instead of creating a new one
    if (invoice.stripePaymentIntentId) {
      const existingPi = await retrievePaymentIntent(invoice.stripePaymentIntentId);
      if (existingPi) {
        // Already succeeded — don't charge again
        if (existingPi.status === 'succeeded') {
          throw new AppError(400, 'Payment has already been processed for this invoice');
        }
        // Still pending — return existing client secret so the customer can complete it
        if (['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(existingPi.status)) {
          return res.json({ clientSecret: existingPi.client_secret, invoiceId: invoice._id });
        }
        // Cancelled or failed — allow creating a new one below
      }
    }

    // Look up customer for Stripe customer ID — create one on-demand if missing
    const customer = await User.findById(req.user.userId);
    if (!customer) throw new AppError(404, 'Customer not found');

    if (!customer.stripeCustomerId) {
      const stripeId = await createStripeCustomer(customer.email, customer.name);
      if (!stripeId) {
        throw new AppError(500, 'Payment service unavailable. Please try again later.');
      }
      customer.stripeCustomerId = stripeId;
      await customer.save();
    }

    const { clientSecret, paymentIntentId } = await createPaymentIntent({
      amountCents: invoice.totalAmountCents,
      customerId: customer.stripeCustomerId!,
      metadata: {
        invoiceId: invoice._id.toString(),
        invoiceNumber: invoice.invoiceNumber,
        type: 'invoice_payment',
      },
      idempotencyKey: `invoice_pay_${invoice._id}`,
    });

    // Store the PaymentIntent ID on the invoice for refund support
    invoice.stripePaymentIntentId = paymentIntentId ?? undefined;
    await invoice.save();

    res.json({ clientSecret, invoiceId: invoice._id });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/invoices/:id/confirm-payment (customer)
// Called after Stripe confirms payment on the client side
// ────────────────────────────────────────────────────────────────
export async function confirmInvoicePayment(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) throw new AppError(404, 'Invoice not found');

    // Allow customer (own invoice) or admin
    const isOwner = invoice.customerId.toString() === req.user.userId;
    const isAdmin = req.user.role === UserRole.Admin;
    if (!isOwner && !isAdmin) {
      throw new AppError(403, 'Access denied');
    }

    // Already paid — return idempotent response instead of error
    if (invoice.status === InvoiceStatus.Paid) {
      const existingReceipt = await Receipt.findOne({ invoiceId: invoice._id });
      return res.json({ invoice, receipt: existingReceipt });
    }

    // Atomic update: only mark as paid if status is still 'sent' or 'draft'
    // This prevents a race condition where two concurrent requests both try to mark it paid
    const updated = await Invoice.findOneAndUpdate(
      { _id: invoice._id, status: { $in: [InvoiceStatus.Sent, InvoiceStatus.Draft] } },
      { status: InvoiceStatus.Paid, paidAt: new Date() },
      { new: true },
    );

    if (!updated) {
      // Another request already changed the status — re-fetch and return
      const current = await Invoice.findById(invoice._id);
      if (current?.status === InvoiceStatus.Paid) {
        const existingReceipt = await Receipt.findOne({ invoiceId: invoice._id });
        return res.json({ invoice: current, receipt: existingReceipt });
      }
      throw new AppError(400, 'Invoice cannot be marked as paid in its current state');
    }

    const paidAt = updated.paidAt!;

    // Detect the actual payment method used (card, affirm, etc.)
    let paymentMethod = 'card';
    if (updated.stripePaymentIntentId) {
      try {
        const pi = await retrievePaymentIntent(updated.stripePaymentIntentId);
        if (pi?.payment_method) {
          const stripe = getStripe();
          if (stripe) {
            const pm = await stripe.paymentMethods.retrieve(pi.payment_method as string);
            paymentMethod = pm.type || 'card';
          }
        }
      } catch {
        // Fall back to 'card' if retrieval fails
      }
    }

    // Auto-create Receipt from the paid invoice
    const receiptCount = await Receipt.countDocuments();
    const receiptNumber = `RCT-${(receiptCount + 1).toString().padStart(5, '0')}`;

    const receipt = await Receipt.create({
      receiptNumber,
      invoiceId: updated._id,
      quotationId: updated.quotationId || undefined,
      bookingId: updated.bookingId || undefined,
      customerId: updated.customerId,
      lineItems: updated.lineItems,
      subtotalCents: updated.subtotalCents,
      taxRate: updated.taxRate,
      taxAmountCents: updated.taxAmountCents,
      totalAmountCents: updated.totalAmountCents,
      tipAmountCents: updated.tipAmountCents,
      paymentMethod,
      stripePaymentIntentId: updated.stripePaymentIntentId,
      paidAt,
    });

    // Send receipt email
    try {
      const customer = await User.findById(updated.customerId);
      if (customer?.email) {
        const email = customer.email.includes(':') ? decryptField(customer.email) : customer.email;
        await sendReceiptEmail(email, {
          receiptNumber,
          invoiceNumber: updated.invoiceNumber,
          totalAmountCents: updated.totalAmountCents,
          paidAt,
        });
      }
    } catch (emailErr) {
      console.error('[EMAIL] Failed to send receipt:', emailErr);
    }

    // Auto-confirm booking if it's still in approved/pending state
    if (updated.bookingId) {
      await Booking.findOneAndUpdate(
        { _id: updated.bookingId, status: { $in: [BookingStatus.Approved, BookingStatus.Pending] } },
        { status: BookingStatus.Confirmed },
      );
    }

    await req.audit('invoice.paid', 'Invoice', updated._id.toString());

    res.json({ invoice: updated, receipt });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// Refund policy configuration
// ────────────────────────────────────────────────────────────────
const REFUND_POLICY = {
  // Full refund if cancelled 48+ hours before scheduled service
  fullRefundHours: 48,
  // 50% refund if cancelled 24–48 hours before scheduled service
  partialRefundHours: 24,
  partialRefundPercent: 50,
  // No refund if < 24 hours or service already completed
};

/**
 * Determines refund eligibility based on the booking's scheduled date.
 * Returns the refund type and percentage of the original amount to refund.
 */
function calculateRefundEligibility(scheduledDate: Date | undefined): {
  type: RefundType;
  percent: number;
  policyApplied: string;
} {
  // No booking attached — treat as admin-created invoice, allow full refund
  if (!scheduledDate) {
    return { type: RefundType.Full, percent: 100, policyApplied: 'no_booking_full' };
  }

  const now = new Date();
  const hoursUntilService = (scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  // Service already happened
  if (hoursUntilService <= 0) {
    return { type: RefundType.None, percent: 0, policyApplied: 'service_completed' };
  }

  // 48+ hours out → full refund
  if (hoursUntilService >= REFUND_POLICY.fullRefundHours) {
    return { type: RefundType.Full, percent: 100, policyApplied: '48h_full' };
  }

  // 24–48 hours out → 50% refund
  if (hoursUntilService >= REFUND_POLICY.partialRefundHours) {
    return {
      type: RefundType.Partial,
      percent: REFUND_POLICY.partialRefundPercent,
      policyApplied: '24h_partial',
    };
  }

  // < 24 hours → no refund
  return { type: RefundType.None, percent: 0, policyApplied: 'under_24h_none' };
}

// ────────────────────────────────────────────────────────────────
// GET /api/invoices/:id/refund-eligibility
// Returns what the customer would receive if they requested a refund
// ────────────────────────────────────────────────────────────────
export async function getRefundEligibility(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) throw new AppError(404, 'Invoice not found');

    if (
      req.user.role === UserRole.Customer &&
      invoice.customerId.toString() !== req.user.userId
    ) {
      throw new AppError(403, 'Access denied');
    }

    if (invoice.status !== InvoiceStatus.Paid) {
      throw new AppError(400, 'Only paid invoices can be refunded');
    }

    const booking = invoice.bookingId
      ? await Booking.findById(invoice.bookingId)
      : null;

    const eligibility = calculateRefundEligibility(booking?.scheduledDate);
    const refundAmountCents = Math.round(invoice.totalAmountCents * (eligibility.percent / 100));

    res.json({
      eligible: eligibility.type !== RefundType.None,
      type: eligibility.type,
      refundAmountCents,
      originalAmountCents: invoice.totalAmountCents,
      percentRefunded: eligibility.percent,
      policyApplied: eligibility.policyApplied,
      policy: {
        fullRefundCutoffHours: REFUND_POLICY.fullRefundHours,
        partialRefundCutoffHours: REFUND_POLICY.partialRefundHours,
        partialRefundPercent: REFUND_POLICY.partialRefundPercent,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/invoices/:id/request-refund (customer)
// Customer-initiated refund — subject to refund policy
// ────────────────────────────────────────────────────────────────
export async function requestRefund(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) throw new AppError(404, 'Invoice not found');

    if (invoice.customerId.toString() !== req.user.userId) {
      throw new AppError(403, 'Access denied');
    }

    if ((invoice.paymentMethod || 'stripe') === 'cheque') {
      throw new AppError(400, 'Cheque-paid invoices must be refunded manually. Please contact us at (508) 333-1838.');
    }

    if (invoice.status === InvoiceStatus.Refunded || invoice.status === InvoiceStatus.PartiallyRefunded) {
      throw new AppError(400, 'Invoice has already been refunded');
    }

    if (invoice.status !== InvoiceStatus.Paid) {
      throw new AppError(400, 'Only paid invoices can be refunded');
    }

    const { reason } = req.body;
    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      throw new AppError(400, 'A refund reason is required (minimum 3 characters)');
    }

    // Look up booking to determine policy
    const booking = invoice.bookingId
      ? await Booking.findById(invoice.bookingId)
      : null;

    const eligibility = calculateRefundEligibility(booking?.scheduledDate);

    if (eligibility.type === RefundType.None) {
      throw new AppError(400,
        'This invoice is not eligible for a refund. Refunds must be requested at least 24 hours before the scheduled service.',
      );
    }

    // Find the PaymentIntent
    let paymentIntentId = invoice.stripePaymentIntentId;
    if (!paymentIntentId) {
      paymentIntentId = booking?.stripePaymentIntentId;
    }
    if (!paymentIntentId) {
      throw new AppError(400, 'No payment found to refund');
    }

    const refundAmountCents = Math.round(invoice.totalAmountCents * (eligibility.percent / 100));

    // Issue refund via Stripe (partial or full)
    if (eligibility.type === RefundType.Full) {
      await refundPayment(paymentIntentId);
    } else {
      await refundPayment(paymentIntentId, refundAmountCents);
    }

    // Update invoice
    invoice.status = eligibility.type === RefundType.Full
      ? InvoiceStatus.Refunded
      : InvoiceStatus.PartiallyRefunded;
    invoice.refundDetails = {
      type: eligibility.type,
      refundAmountCents,
      reason: reason.trim(),
      policyApplied: eligibility.policyApplied,
      refundedAt: new Date(),
      refundedBy: invoice.customerId,
    };
    await invoice.save();

    await req.audit('invoice.refund.customer', 'Invoice', invoice._id.toString());

    res.json({
      message: eligibility.type === RefundType.Full
        ? 'Full refund processed successfully'
        : `Partial refund of ${eligibility.percent}% processed successfully`,
      invoice,
    });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/invoices/:id/refund (admin)
// Admin-initiated refund — can override policy
// ────────────────────────────────────────────────────────────────
export async function refundInvoice(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) throw new AppError(404, 'Invoice not found');

    if (invoice.status === InvoiceStatus.Refunded) {
      throw new AppError(400, 'Invoice has already been fully refunded');
    }

    if (invoice.status !== InvoiceStatus.Paid && invoice.status !== InvoiceStatus.PartiallyRefunded) {
      throw new AppError(400, 'Only paid or partially refunded invoices can be refunded');
    }

    const { reason, overridePolicy, refundPercent } = req.body;
    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      throw new AppError(400, 'A refund reason is required (minimum 3 characters)');
    }

    // Find the PaymentIntent
    let paymentIntentId = invoice.stripePaymentIntentId;
    if (!paymentIntentId) {
      const booking = await Booking.findById(invoice.bookingId);
      paymentIntentId = booking?.stripePaymentIntentId;
    }
    if (!paymentIntentId) {
      throw new AppError(400, 'No payment found to refund');
    }

    let refundAmountCents: number;
    let refundType: RefundType;
    let policyApplied: string;

    if (overridePolicy) {
      // Admin override — custom refund percentage (1–100)
      const pct = Math.min(100, Math.max(1, parseInt(refundPercent) || 100));
      refundAmountCents = Math.round(invoice.totalAmountCents * (pct / 100));
      refundType = pct === 100 ? RefundType.Full : RefundType.Partial;
      policyApplied = `admin_override_${pct}pct`;
    } else {
      // Standard policy
      const booking = invoice.bookingId
        ? await Booking.findById(invoice.bookingId)
        : null;
      const eligibility = calculateRefundEligibility(booking?.scheduledDate);
      refundAmountCents = Math.round(invoice.totalAmountCents * (eligibility.percent / 100));
      refundType = eligibility.type;
      policyApplied = eligibility.policyApplied;

      if (refundType === RefundType.None) {
        throw new AppError(400,
          'Policy does not allow a refund. Use overridePolicy: true to override.',
        );
      }
    }

    // Account for any previous partial refund
    const previousRefundCents = invoice.refundDetails?.refundAmountCents || 0;
    const remainingRefundable = invoice.totalAmountCents - previousRefundCents;
    refundAmountCents = Math.min(refundAmountCents, remainingRefundable);

    if (refundAmountCents <= 0) {
      throw new AppError(400, 'No remaining amount to refund');
    }

    // Issue refund via Stripe
    await refundPayment(paymentIntentId, refundAmountCents);

    const totalRefunded = previousRefundCents + refundAmountCents;
    invoice.status = totalRefunded >= invoice.totalAmountCents
      ? InvoiceStatus.Refunded
      : InvoiceStatus.PartiallyRefunded;
    invoice.refundDetails = {
      type: refundType,
      refundAmountCents: totalRefunded,
      reason: reason.trim(),
      policyApplied,
      refundedAt: new Date(),
      refundedBy: new mongoose.Types.ObjectId(req.user.userId),
    };
    await invoice.save();

    await req.audit('invoice.refund.admin', 'Invoice', invoice._id.toString());

    res.json({ message: 'Refund processed', invoice });
  } catch (err) {
    next(err);
  }
}
