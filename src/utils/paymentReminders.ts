import cron from 'node-cron';
import { Subscription, SubscriptionStatus } from '../models/Subscription';
import { User } from '../models/User';
import { getStripe } from '../services/stripe';
import { sendPaymentReminderEmail } from '../services/email';
import { decryptField } from './encryption';

// ────────────────────────────────────────────────────────────────
// Payment Reminder Cron Job
// Sends reminder emails 3 days before a recurring subscription payment.
// Runs daily at 9:00 AM.
// ────────────────────────────────────────────────────────────────

const REMINDER_DAYS_BEFORE = 3;

export function startPaymentReminderCron() {
  // Run daily at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    console.log('[PAYMENT REMINDER] Running payment reminder check...');
    try {
      await sendUpcomingPaymentReminders();
    } catch (err) {
      console.error('[PAYMENT REMINDER] Cron job failed:', err);
    }
  });

  console.log('[PAYMENT REMINDER] Cron job scheduled (daily 9:00 AM)');
}

export async function sendUpcomingPaymentReminders() {
  const stripe = getStripe();
  if (!stripe) {
    console.warn('[PAYMENT REMINDER] Stripe not configured — skipping');
    return;
  }

  const activeSubscriptions = await Subscription.find({
    status: SubscriptionStatus.Active,
    stripeSubscriptionId: { $exists: true, $ne: '' },
  }).populate('customerId', 'email name');

  let sent = 0;
  let skipped = 0;

  for (const sub of activeSubscriptions) {
    try {
      // Fetch the next billing date from Stripe
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId!);

      if (stripeSub.status !== 'active') {
        skipped++;
        continue;
      }

      const nextPaymentDate = new Date(stripeSub.current_period_end * 1000);
      const now = new Date();
      const daysUntil = Math.ceil((nextPaymentDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // Update nextScheduledDate on our record
      sub.nextScheduledDate = nextPaymentDate;
      await sub.save();

      // Only send reminder if payment is exactly REMINDER_DAYS_BEFORE days away
      if (daysUntil !== REMINDER_DAYS_BEFORE) {
        skipped++;
        continue;
      }

      const customer = sub.customerId as any;
      if (!customer?.email) {
        skipped++;
        continue;
      }

      const email = customer.email.includes(':') ? decryptField(customer.email) : customer.email;

      let name: string;
      try {
        name = decryptField(customer.name);
      } catch {
        name = email.split('@')[0];
      }

      await sendPaymentReminderEmail(email, {
        serviceType: sub.serviceType,
        frequency: sub.frequency,
        amountCents: sub.amountCents,
        nextPaymentDate,
        daysUntil,
      });

      sent++;
      console.log(`[PAYMENT REMINDER] Sent to ${email} — next payment ${nextPaymentDate.toISOString()}`);
    } catch (err) {
      console.error(`[PAYMENT REMINDER] Failed for subscription ${sub._id}:`, err);
    }
  }

  console.log(`[PAYMENT REMINDER] Done. Sent: ${sent}, Skipped: ${skipped}`);
}
