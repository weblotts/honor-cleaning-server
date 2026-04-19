import cron from 'node-cron';
import { Booking, BookingStatus } from '../models/Booking';
import { User } from '../models/User';
import {
  sendBookingReminderToCustomer,
  sendBookingReminderToStaff,
} from '../services/email';
import { buildBookingCalendarEvent } from './calendar';
import { decryptField } from './encryption';

// ────────────────────────────────────────────────────────────────
// Booking Reminder Cron Job
// Sends reminder emails to both the customer and assigned staff
// 24 hours before a confirmed booking's scheduled date/time.
// Runs every hour at :00 to catch bookings in the next 24h window.
// ────────────────────────────────────────────────────────────────

const CLIENT_URL = () => process.env.CLIENT_URL || 'http://localhost:3000';

export function startBookingReminderCron() {
  // Run every hour at :00
  cron.schedule('0 * * * *', async () => {
    console.log('[BOOKING REMINDER] Running booking reminder check...');
    try {
      await sendBookingReminders();
    } catch (err) {
      console.error('[BOOKING REMINDER] Cron job failed:', err);
    }
  });

  console.log('[BOOKING REMINDER] Cron job scheduled (hourly at :00)');
}

export async function sendBookingReminders() {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Find confirmed bookings scheduled within the next 24 hours
  // that haven't had a reminder sent yet
  const bookings = await Booking.find({
    status: { $in: [BookingStatus.Confirmed, BookingStatus.Pending] },
    staffId: { $ne: null },
    scheduledDate: { $gte: now, $lte: in24h },
    reminderSentAt: { $eq: null },
  })
    .populate('customerId', 'name email phone')
    .populate('staffId', 'name email phone')
    .lean();

  let customerSent = 0;
  let staffSent = 0;
  let errors = 0;

  for (const booking of bookings) {
    try {
      const customer = booking.customerId as any;
      const staff = booking.staffId as any;

      if (!customer || !staff) continue;

      // Decrypt PII
      let customerName: string;
      let customerEmail: string;
      let staffName: string;
      let staffEmail: string;

      try {
        customerName = decryptField(customer.name);
      } catch {
        customerName = customer.email?.split('@')[0] || 'Customer';
      }
      try {
        customerEmail = customer.email.includes(':') ? decryptField(customer.email) : customer.email;
      } catch {
        customerEmail = customer.email;
      }
      try {
        staffName = decryptField(staff.name);
      } catch {
        staffName = staff.email?.split('@')[0] || 'Staff';
      }
      try {
        staffEmail = staff.email.includes(':') ? decryptField(staff.email) : staff.email;
      } catch {
        staffEmail = staff.email;
      }

      const address = booking.address;
      const addressStr = `${address.street}, ${address.city}, ${address.state} ${address.zip}`;

      const scheduledDateStr = new Date(booking.scheduledDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      // Build Google Calendar links
      const { googleCalendarUrl } = buildBookingCalendarEvent({
        serviceType: booking.serviceType,
        scheduledDate: booking.scheduledDate,
        scheduledTime: booking.scheduledTime,
        durationEstimate: booking.durationEstimate,
        address: booking.address,
        customerName,
        staffName,
        bookingNumber: booking.bookingNumber,
      });

      const icsDownloadUrl = `${CLIENT_URL()}/api/bookings/${booking._id}/calendar.ics`;

      // Send reminder to customer
      try {
        await sendBookingReminderToCustomer(customerEmail, {
          customerName,
          serviceType: booking.serviceType,
          scheduledDate: scheduledDateStr,
          scheduledTime: booking.scheduledTime,
          staffName,
          address: addressStr,
          googleCalendarUrl,
          icsDownloadUrl,
        });
        customerSent++;
      } catch (err) {
        console.error(`[BOOKING REMINDER] Failed to send customer reminder for ${booking.bookingNumber}:`, err);
        errors++;
      }

      // Send reminder to staff
      try {
        await sendBookingReminderToStaff(staffEmail, {
          staffName,
          serviceType: booking.serviceType,
          scheduledDate: scheduledDateStr,
          scheduledTime: booking.scheduledTime,
          customerName,
          address: addressStr,
          durationEstimate: booking.durationEstimate,
          notes: booking.notes,
          googleCalendarUrl,
          icsDownloadUrl,
        });
        staffSent++;
      } catch (err) {
        console.error(`[BOOKING REMINDER] Failed to send staff reminder for ${booking.bookingNumber}:`, err);
        errors++;
      }

      // Mark reminder as sent to prevent duplicates
      await Booking.updateOne(
        { _id: booking._id },
        { $set: { reminderSentAt: new Date() } },
      );
    } catch (err) {
      console.error(`[BOOKING REMINDER] Error processing booking ${booking.bookingNumber}:`, err);
      errors++;
    }
  }

  console.log(
    `[BOOKING REMINDER] Done. Customer emails: ${customerSent}, Staff emails: ${staffSent}, Errors: ${errors}`,
  );
}
