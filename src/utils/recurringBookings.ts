import cron from 'node-cron';
import { Booking, BookingStatus } from '../models/Booking';
import { Subscription, SubscriptionFrequency, SubscriptionStatus } from '../models/Subscription';
import { User } from '../models/User';
import { sendRecurringBookingScheduledEmail } from '../services/email';
import { decryptField } from './encryption';

// ────────────────────────────────────────────────────────────────
// Recurring Booking Generation
//
// Runs daily at 6 AM. For each active subscription, looks 7 days
// ahead and creates a PendingQuote booking if one doesn't already
// exist for that cycle. Advances nextScheduledDate after creation
// so the same slot is never double-booked.
// ────────────────────────────────────────────────────────────────

const LOOKAHEAD_DAYS = 7;

const DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

// Returns the next calendar date (starting tomorrow) that falls on preferredDay.
function nextOccurrence(preferredDay: string, from = new Date()): Date {
  const target = DAY_INDEX[preferredDay.toLowerCase()];
  if (target === undefined) throw new Error(`Unknown day: ${preferredDay}`);

  const date = new Date(from);
  date.setHours(0, 0, 0, 0);

  let ahead = target - date.getDay();
  if (ahead <= 0) ahead += 7; // never today, always a future date

  date.setDate(date.getDate() + ahead);
  return date;
}

function advanceByFrequency(date: Date, frequency: SubscriptionFrequency): Date {
  const next = new Date(date);
  switch (frequency) {
    case SubscriptionFrequency.Weekly:
      next.setDate(next.getDate() + 7);
      break;
    case SubscriptionFrequency.Biweekly:
      next.setDate(next.getDate() + 14);
      break;
    case SubscriptionFrequency.Monthly:
      next.setMonth(next.getMonth() + 1);
      break;
  }
  return next;
}

// Mirrors the number generation in booking.controller.ts.
// Race conditions are extremely unlikely for a nightly cron, but
// the unique index on bookingNumber will catch any collision.
async function generateBookingNumber(): Promise<string> {
  const count = await Booking.countDocuments();
  return `BK-${(count + 1).toString().padStart(5, '0')}`;
}

export async function generateRecurringBookings(): Promise<void> {
  const now = new Date();
  const lookaheadCutoff = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  const subscriptions = await Subscription.find({
    status: SubscriptionStatus.Active,
  }).lean();

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const sub of subscriptions) {
    try {
      // Determine the next booking date for this subscription.
      // Prefer the stored nextScheduledDate when it's still in the future;
      // otherwise compute the next occurrence from preferredDay.
      let nextDate: Date;

      if (sub.nextScheduledDate && sub.nextScheduledDate > now) {
        nextDate = new Date(sub.nextScheduledDate);
      } else {
        nextDate = nextOccurrence(sub.preferredDay);
        await Subscription.updateOne(
          { _id: sub._id },
          { $set: { nextScheduledDate: nextDate } },
        );
      }

      // Not yet within the lookahead window — nothing to do this cycle.
      if (nextDate > lookaheadCutoff) {
        skipped++;
        continue;
      }

      // Check for an existing booking on the same day for this subscription
      // so reruns of the cron don't create duplicates.
      const dayStart = new Date(nextDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(nextDate);
      dayEnd.setHours(23, 59, 59, 999);

      const exists = await Booking.exists({
        subscriptionId: sub._id,
        scheduledDate: { $gte: dayStart, $lte: dayEnd },
        status: { $ne: BookingStatus.Cancelled },
      });

      if (exists) {
        // Booking already exists for this cycle; advance to the next one.
        await Subscription.updateOne(
          { _id: sub._id },
          { $set: { nextScheduledDate: advanceByFrequency(nextDate, sub.frequency) } },
        );
        skipped++;
        continue;
      }

      // Create the booking in PendingQuote status so admin can review,
      // assign staff, and confirm before the scheduled date.
      const bookingNumber = await generateBookingNumber();

      const booking = await Booking.create({
        bookingNumber,
        customerId: sub.customerId,
        subscriptionId: sub._id,
        serviceType: sub.serviceType,
        scheduledDate: nextDate,
        scheduledTime: sub.preferredTime,
        durationEstimate: 120,
        address: sub.address,
        amountCents: sub.amountCents,
        status: BookingStatus.PendingQuote,
        notes: `Auto-generated from ${sub.frequency} subscription`,
      });

      // Advance nextScheduledDate to the following cycle.
      await Subscription.updateOne(
        { _id: sub._id },
        { $set: { nextScheduledDate: advanceByFrequency(nextDate, sub.frequency) } },
      );

      // Notify the customer.
      try {
        const customer = await User.findById(sub.customerId).lean();
        if (customer) {
          let customerEmail = customer.email;
          let customerName = 'Valued Customer';

          try { customerName = decryptField(customer.name); } catch { /* use default */ }
          try {
            if (customerEmail.includes(':')) customerEmail = decryptField(customerEmail);
          } catch { /* use raw */ }

          await sendRecurringBookingScheduledEmail(customerEmail, {
            customerName,
            serviceType: sub.serviceType,
            scheduledDate: nextDate.toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
            scheduledTime: sub.preferredTime,
            frequency: sub.frequency,
            bookingNumber,
          });
        }
      } catch (emailErr) {
        console.error(`[RECURRING] Email failed for ${booking.bookingNumber}:`, emailErr);
      }

      created++;
      console.log(`[RECURRING] Created ${booking.bookingNumber} for subscription ${sub._id}`);
    } catch (err) {
      console.error(`[RECURRING] Error processing subscription ${sub._id}:`, err);
      errors++;
    }
  }

  console.log(`[RECURRING] Done — created: ${created}, skipped: ${skipped}, errors: ${errors}`);
}

export function startRecurringBookingCron(): void {
  // Run every day at 6:00 AM — gives admin the full working day to assign staff.
  cron.schedule('0 6 * * *', async () => {
    console.log('[RECURRING] Running recurring booking generation…');
    try {
      await generateRecurringBookings();
    } catch (err) {
      console.error('[RECURRING] Cron job failed:', err);
    }
  });

  console.log('[RECURRING] Cron job scheduled (daily at 06:00)');
}
