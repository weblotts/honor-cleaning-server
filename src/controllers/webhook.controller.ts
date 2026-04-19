import { Request, Response } from 'express';
import Stripe from 'stripe';
import { getStripe } from '../services/stripe';
import { Invoice, InvoiceStatus } from '../models/Invoice';
import { Booking, BookingStatus } from '../models/Booking';
import { Subscription, SubscriptionStatus } from '../models/Subscription';
import { Receipt } from '../models/Receipt';
import { User } from '../models/User';
import { sendReceiptEmail, sendPaymentReminderEmail } from '../services/email';
import { decryptField } from '../utils/encryption';

// ────────────────────────────────────────────────────────────────
// POST /api/webhooks/stripe
// Stripe sends raw body — parsed with express.raw() on this route
// ────────────────────────────────────────────────────────────────
export async function handleStripeWebhook(req: Request, res: Response) {
  const stripe = getStripe();
  if (!stripe) {
    console.warn('[WEBHOOK] Stripe not configured');
    return res.status(400).send('Stripe not configured');
  }

  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret || !webhookSecret.startsWith('whsec_') || webhookSecret.length < 10) {
    console.warn('[WEBHOOK] Webhook secret not configured');
    return res.status(400).send('Webhook secret not configured');
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    console.error('[WEBHOOK] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      case 'invoice.upcoming':
        await handleInvoiceUpcoming(event.data.object as Stripe.Invoice);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      default:
        // Unhandled event type — log and acknowledge
        console.log(`[WEBHOOK] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`[WEBHOOK] Error processing ${event.type}:`, err);
    // Return 200 to prevent Stripe retries for application errors
    // Stripe will keep retrying on 5xx responses
  }

  res.json({ received: true });
}

// ────────────────────────────────────────────────────────────────
// Handlers
// ────────────────────────────────────────────────────────────────

async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
  const { invoiceId, type } = pi.metadata;

  if (type === 'invoice_payment' && invoiceId) {
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice || invoice.status === InvoiceStatus.Paid) return;

    const paidAt = new Date();
    invoice.status = InvoiceStatus.Paid;
    invoice.paidAt = paidAt;
    invoice.stripePaymentIntentId = pi.id;
    await invoice.save();

    // Detect the actual payment method used (card, affirm, etc.)
    let paymentMethod = 'card';
    if (pi.payment_method) {
      try {
        const stripe = getStripe();
        if (stripe) {
          const pm = await stripe.paymentMethods.retrieve(pi.payment_method as string);
          paymentMethod = pm.type || 'card';
        }
      } catch {
        // Fall back to 'card' if retrieval fails
      }
    }

    // Auto-create receipt
    const receiptCount = await Receipt.countDocuments();
    const receiptNumber = `RCT-${(receiptCount + 1).toString().padStart(5, '0')}`;

    await Receipt.create({
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
      paymentMethod,
      stripePaymentIntentId: pi.id,
      paidAt,
    });

    // Send receipt email
    try {
      const customer = await User.findById(invoice.customerId);
      if (customer?.email) {
        const email = customer.email.includes(':') ? decryptField(customer.email) : customer.email;
        await sendReceiptEmail(email, {
          receiptNumber,
          invoiceNumber: invoice.invoiceNumber,
          totalAmountCents: invoice.totalAmountCents,
          paidAt,
        });
      }
    } catch (emailErr) {
      console.error('[WEBHOOK] Failed to send receipt email:', emailErr);
    }

    // Auto-confirm booking if it's still in approved/pending state
    if (invoice.bookingId) {
      await Booking.findOneAndUpdate(
        { _id: invoice.bookingId, status: { $in: [BookingStatus.Approved, BookingStatus.Pending] } },
        { status: BookingStatus.Confirmed },
      );
    }

    console.log(`[WEBHOOK] Invoice ${invoice.invoiceNumber} marked as paid via webhook`);
  }

  if (type === 'booking_payment') {
    const booking = await Booking.findOne({ stripePaymentIntentId: pi.id });
    if (booking && booking.status === BookingStatus.Pending) {
      booking.status = BookingStatus.Confirmed;
      await booking.save();
      console.log(`[WEBHOOK] Booking ${booking._id} confirmed via webhook`);
    }
  }
}

async function handlePaymentIntentFailed(pi: Stripe.PaymentIntent) {
  const { invoiceId } = pi.metadata;
  if (invoiceId) {
    console.warn(`[WEBHOOK] Payment failed for invoice ${invoiceId}: ${pi.last_payment_error?.message}`);
  }
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription) {
  const subscription = await Subscription.findOne({ stripeSubscriptionId: sub.id });
  if (!subscription) return;

  if (sub.status === 'active' && subscription.status !== SubscriptionStatus.Active) {
    subscription.status = SubscriptionStatus.Active;
    await subscription.save();
    console.log(`[WEBHOOK] Subscription ${sub.id} activated`);
  } else if (sub.status === 'paused') {
    subscription.status = SubscriptionStatus.Paused;
    await subscription.save();
    console.log(`[WEBHOOK] Subscription ${sub.id} paused`);
  }
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const subscription = await Subscription.findOne({ stripeSubscriptionId: sub.id });
  if (!subscription) return;

  subscription.status = SubscriptionStatus.Cancelled;
  await subscription.save();
  console.log(`[WEBHOOK] Subscription ${sub.id} cancelled`);
}

// Stripe fires invoice.upcoming ~3 days before charging a subscription
async function handleInvoiceUpcoming(invoice: Stripe.Invoice) {
  if (!invoice.subscription) return;

  const subId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription.id;

  const subscription = await Subscription.findOne({ stripeSubscriptionId: subId });
  if (!subscription || subscription.status !== SubscriptionStatus.Active) return;

  // Update next scheduled date
  if (invoice.next_payment_attempt) {
    subscription.nextScheduledDate = new Date(invoice.next_payment_attempt * 1000);
    await subscription.save();
  }

  // Send reminder email to customer
  try {
    const customer = await User.findById(subscription.customerId);
    if (!customer?.email) return;

    const email = customer.email.includes(':') ? decryptField(customer.email) : customer.email;

    const nextPaymentDate = invoice.next_payment_attempt
      ? new Date(invoice.next_payment_attempt * 1000)
      : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    const daysUntil = Math.ceil(
      (nextPaymentDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );

    await sendPaymentReminderEmail(email, {
      serviceType: subscription.serviceType,
      frequency: subscription.frequency,
      amountCents: invoice.amount_due,
      nextPaymentDate,
      daysUntil,
    });

    console.log(`[WEBHOOK] Payment reminder sent for subscription ${subId}`);
  } catch (err) {
    console.error(`[WEBHOOK] Failed to send payment reminder for ${subId}:`, err);
  }
}
