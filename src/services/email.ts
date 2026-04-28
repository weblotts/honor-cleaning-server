import { Resend } from 'resend';

// ────────────────────────────────────────────────────────────────
// Email service using Resend (https://resend.com)
// Replaces SendGrid — simpler API, better DX, generous free tier
// ────────────────────────────────────────────────────────────────

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key || key === 're_...') {
      return null;
    }
    resend = new Resend(key);
  }
  return resend;
}

const FROM = () => process.env.RESEND_FROM_EMAIL || 'Honor Cleaning <noreply@honorcleaners.com>';
const BRAND_COLOR = '#059669';
const CLIENT_URL = () => process.env.CLIENT_URL || 'http://localhost:3000';

// ── Shared email wrapper with branded template ──────────────────

function brandedHtml(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,${BRAND_COLOR},#047857);padding:32px 40px;text-align:center;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Honor Cleaning</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:11px;text-transform:uppercase;letter-spacing:2px;">Professional Cleaning Services</p>
    </div>
    <!-- Content -->
    <div style="padding:36px 40px;color:#1f2937;font-size:15px;line-height:1.7;">
      ${content}
    </div>
    <!-- Footer -->
    <div style="padding:24px 40px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="margin:0;color:#9ca3af;font-size:12px;">Honor Cleaning Co. &bull; 738 Main St, Waltham, MA 02451</p>
      <p style="margin:4px 0 0;color:#d1d5db;font-size:11px;">&copy; ${new Date().getFullYear()} All rights reserved</p>
    </div>
  </div>
</body>
</html>`;
}

function button(href: string, label: string, color = BRAND_COLOR): string {
  return `<a href="${href}" style="display:inline-block;background:${color};color:#ffffff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px;margin:8px 0;">${label}</a>`;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const r = getResend();
  if (!r) {
    console.warn('[EMAIL] Resend not configured — skipping email to', params.to);
    console.log('[EMAIL] Subject:', params.subject);
    return;
  }

  // Warn if still using sandbox sender — only delivers to account owner's email
  if (FROM().includes('onboarding@resend.dev')) {
    console.warn(
      '[EMAIL] Using Resend sandbox sender (onboarding@resend.dev). ' +
      'Emails will ONLY be delivered to your Resend account email. ' +
      'Verify a domain at https://resend.com/domains to send to all recipients.',
    );
  }

  try {
    const { data, error } = await r.emails.send({
      from: FROM(),
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
    if (error) {
      console.error('[EMAIL] Resend error:', JSON.stringify(error));
      throw new Error(`Resend rejected email: ${error.message}`);
    }
    console.log(`[EMAIL] Sent to ${params.to} — id: ${data?.id}`);
  } catch (err) {
    console.error('[EMAIL] Failed to send to', params.to, ':', err);
    throw err;
  }
}

// ── Auth Emails ─────────────────────────────────────────────────

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const resetUrl = `${CLIENT_URL()}/reset-password?token=${token}`;
  await sendEmail({
    to: email,
    subject: 'Reset Your Password — Honor Cleaning',
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Password Reset Request</h2>
      <p>We received a request to reset your password. Click the button below to create a new one.</p>
      <p style="text-align:center;margin:24px 0;">
        ${button(resetUrl, 'Reset My Password')}
      </p>
      <p style="color:#6b7280;font-size:13px;">This link expires in <strong>1 hour</strong>. If you didn't request this, you can safely ignore this email — your password will remain unchanged.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="color:#9ca3af;font-size:12px;">If the button doesn't work, copy and paste this URL into your browser:<br/><a href="${resetUrl}" style="color:${BRAND_COLOR};word-break:break-all;">${resetUrl}</a></p>
    `),
  });
}

export async function sendWelcomeEmail(email: string, name: string): Promise<void> {
  const dashboardUrl = `${CLIENT_URL()}/dashboard`;
  await sendEmail({
    to: email,
    subject: 'Welcome to Honor Cleaning! 🏠',
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Welcome, ${name}!</h2>
      <p>Thanks for joining Honor Cleaning. We're excited to help keep your home sparkling clean.</p>
      <p><strong>Here's what you can do next:</strong></p>
      <ul style="padding-left:20px;color:#374151;">
        <li>Book your first cleaning in under 2 minutes</li>
        <li>Choose from standard, deep, or move-in/out cleans</li>
        <li>Save 20% with a recurring plan</li>
      </ul>
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/booking`, 'Book Your First Cleaning')}
      </p>
      <p style="color:#6b7280;font-size:13px;">Questions? Reply to this email or call us at (508) 333-1838.</p>
    `),
  });
}

// ── Booking Emails ──────────────────────────────────────────────

export async function sendBookingConfirmation(
  email: string,
  booking: { serviceType: string; scheduledDate: string; scheduledTime: string; googleCalendarUrl?: string; icsDownloadUrl?: string },
): Promise<void> {
  const calendarLinks = booking.googleCalendarUrl
    ? `<div style="text-align:center;margin:16px 0;">
        <a href="${booking.googleCalendarUrl}" target="_blank" style="display:inline-block;background:#4285f4;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;margin:0 4px;">&#128197; Add to Google Calendar</a>
        ${booking.icsDownloadUrl ? `<a href="${booking.icsDownloadUrl}" style="display:inline-block;background:#6b7280;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;margin:0 4px;">&#128228; Download .ics</a>` : ''}
      </div>`
    : '';

  await sendEmail({
    to: email,
    subject: 'Booking Confirmed — Honor Cleaning',
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Your Booking is Confirmed!</h2>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Service</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#111827;text-transform:capitalize;">${booking.serviceType}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Date</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#111827;">${booking.scheduledDate}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Time</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#111827;">${booking.scheduledTime}</td></tr>
        </table>
      </div>
      ${calendarLinks}
      <p>Our team will arrive within a 30-minute window of your scheduled time with all supplies and equipment.</p>
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/dashboard`, 'View Booking Details')}
      </p>
    `),
  });
}

export async function sendQuoteReady(
  email: string,
  quote: { serviceType: string; quotedAmountCents: number; quoteNotes?: string },
): Promise<void> {
  const total = (quote.quotedAmountCents / 100).toFixed(2);
  await sendEmail({
    to: email,
    subject: 'Your Cleaning Quote is Ready — Honor Cleaning',
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Your Custom Quote is Ready!</h2>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Service</td><td style="padding:6px 0;text-align:right;font-weight:600;text-transform:capitalize;">${quote.serviceType}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Total</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:18px;color:#111827;">$${total}</td></tr>
        </table>
      </div>
      ${quote.quoteNotes ? `<p style="color:#6b7280;font-style:italic;">"${quote.quoteNotes}"</p>` : ''}
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/dashboard`, 'Review & Approve Quote')}
      </p>
    `),
  });
}

// ── Booking Status Emails ────────────────────────────────────────

export async function sendQuoteApprovedEmail(
  email: string,
  booking: { serviceType: string; amountCents: number; scheduledDate: string; scheduledTime: string },
): Promise<void> {
  const total = (booking.amountCents / 100).toFixed(2);
  await sendEmail({
    to: email,
    subject: 'Quote Approved — Honor Cleaning',
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Quote Approved!</h2>
      <p>Thank you for approving the quote. We're now scheduling your cleaning team.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Service</td><td style="padding:6px 0;text-align:right;font-weight:600;text-transform:capitalize;">${booking.serviceType}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Date</td><td style="padding:6px 0;text-align:right;font-weight:600;">${booking.scheduledDate}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Time</td><td style="padding:6px 0;text-align:right;font-weight:600;">${booking.scheduledTime}</td></tr>
          <tr style="border-top:2px solid #d1d5db;"><td style="padding:10px 0 4px;font-weight:700;">Total</td><td style="padding:10px 0 4px;text-align:right;font-weight:700;font-size:18px;">$${total}</td></tr>
        </table>
      </div>
      <p style="color:#6b7280;font-size:13px;">We'll notify you as soon as a team member is assigned to your booking.</p>
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/dashboard`, 'View Booking')}
      </p>
    `),
  });
}

export async function sendBookingConfirmedEmail(
  email: string,
  booking: { serviceType: string; scheduledDate: string; scheduledTime: string; staffName: string; googleCalendarUrl?: string; icsDownloadUrl?: string },
): Promise<void> {
  const calendarLinks = booking.googleCalendarUrl
    ? `<div style="text-align:center;margin:16px 0;">
        <a href="${booking.googleCalendarUrl}" target="_blank" style="display:inline-block;background:#4285f4;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;margin:0 4px;">&#128197; Add to Google Calendar</a>
        ${booking.icsDownloadUrl ? `<a href="${booking.icsDownloadUrl}" style="display:inline-block;background:#6b7280;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;margin:0 4px;">&#128228; Download .ics</a>` : ''}
      </div>`
    : '';

  await sendEmail({
    to: email,
    subject: 'Staff Assigned — Your Cleaning is Confirmed! — Honor Cleaning',
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Your Cleaning Team is Confirmed!</h2>
      <p>Great news — a team member has been assigned to your booking.</p>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:20px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Service</td><td style="padding:6px 0;text-align:right;font-weight:600;text-transform:capitalize;">${booking.serviceType}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Date</td><td style="padding:6px 0;text-align:right;font-weight:600;">${booking.scheduledDate}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Time</td><td style="padding:6px 0;text-align:right;font-weight:600;">${booking.scheduledTime}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Assigned To</td><td style="padding:6px 0;text-align:right;font-weight:600;color:${BRAND_COLOR};">${booking.staffName}</td></tr>
        </table>
      </div>
      ${calendarLinks}
      <p>Our team will arrive within a 30-minute window of your scheduled time with all supplies and equipment.</p>
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/dashboard`, 'View Booking Details')}
      </p>
    `),
  });
}

export async function sendCleaningInProgressEmail(
  email: string,
  booking: { serviceType: string; staffName: string },
): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'Cleaning In Progress — Honor Cleaning',
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Your Cleaning Has Started!</h2>
      <p>Our team member <strong>${booking.staffName}</strong> has checked in and begun your <strong style="text-transform:capitalize;">${booking.serviceType}</strong> cleaning.</p>
      <p style="color:#6b7280;font-size:13px;">You'll receive another notification when the job is complete.</p>
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/dashboard`, 'Track Progress')}
      </p>
    `),
  });
}

export async function sendJobCompletedEmail(
  email: string,
  booking: { serviceType: string; scheduledDate: string },
): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'Cleaning Complete — Honor Cleaning',
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Your Cleaning is Complete!</h2>
      <p>Your <strong style="text-transform:capitalize;">${booking.serviceType}</strong> cleaning has been finished. We hope everything looks spotless!</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:16px 0;text-align:center;">
        <p style="margin:0;font-size:32px;">&#10024;</p>
        <p style="margin:8px 0 0;font-weight:700;color:#111827;">All done!</p>
        <p style="margin:4px 0 0;color:#6b7280;font-size:13px;">An invoice will be sent shortly.</p>
      </div>
      <p>If anything doesn't meet your expectations, contact us within 24 hours and we'll send a team back at no extra cost.</p>
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/dashboard`, 'View Details')}
      </p>
    `),
  });
}

export async function sendBookingCancelledEmail(
  email: string,
  booking: { serviceType: string; scheduledDate: string; reason?: string },
): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'Booking Cancelled — Honor Cleaning',
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Booking Cancelled</h2>
      <p>Your <strong style="text-transform:capitalize;">${booking.serviceType}</strong> cleaning scheduled for <strong>${booking.scheduledDate}</strong> has been cancelled.</p>
      ${booking.reason ? `<p style="color:#6b7280;font-style:italic;">Reason: ${booking.reason}</p>` : ''}
      <p>If this was a mistake or you'd like to rebook, you can schedule a new cleaning anytime.</p>
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/booking`, 'Book Again')}
      </p>
      <p style="color:#6b7280;font-size:13px;">Questions? Call us at (508) 333-1838 or email hello@honorcleaning.com.</p>
    `),
  });
}

// ── Invoice & Receipt Emails ────────────────────────────────────

export async function sendInvoiceEmail(
  email: string,
  invoice: {
    invoiceNumber: string;
    subtotalCents: number;
    taxRate: number;
    taxAmountCents: number;
    totalAmountCents: number;
    dueDate: Date;
    pdfUrl?: string;
  },
): Promise<void> {
  const subtotal = (invoice.subtotalCents / 100).toFixed(2);
  const tax = (invoice.taxAmountCents / 100).toFixed(2);
  const total = (invoice.totalAmountCents / 100).toFixed(2);
  const due = new Date(invoice.dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  await sendEmail({
    to: email,
    subject: `Invoice ${invoice.invoiceNumber} — Honor Cleaning`,
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Invoice ${invoice.invoiceNumber}</h2>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Subtotal</td><td style="padding:6px 0;text-align:right;">$${subtotal}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">MA Sales Tax (${invoice.taxRate}%)</td><td style="padding:6px 0;text-align:right;">$${tax}</td></tr>
          <tr style="border-top:2px solid #374151;"><td style="padding:10px 0 4px;font-weight:700;font-size:16px;">Total Due</td><td style="padding:10px 0 4px;text-align:right;font-weight:700;font-size:18px;">$${total}</td></tr>
        </table>
      </div>
      <p><strong>Due Date:</strong> ${due}</p>
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/dashboard/invoices`, 'View & Pay Invoice')}
      </p>
      ${invoice.pdfUrl ? `<p style="text-align:center;"><a href="${invoice.pdfUrl}" style="color:${BRAND_COLOR};">Download PDF</a></p>` : ''}
    `),
  });
}

export async function sendReceiptEmail(
  email: string,
  receipt: { receiptNumber: string; invoiceNumber: string; totalAmountCents: number; paidAt: Date },
): Promise<void> {
  const total = (receipt.totalAmountCents / 100).toFixed(2);
  const paidDate = new Date(receipt.paidAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  await sendEmail({
    to: email,
    subject: `Payment Receipt ${receipt.receiptNumber} — Honor Cleaning`,
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Payment Received!</h2>
      <p>Thank you for your payment. Here's your receipt.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Receipt #</td><td style="padding:6px 0;text-align:right;font-weight:600;">${receipt.receiptNumber}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Invoice #</td><td style="padding:6px 0;text-align:right;">${receipt.invoiceNumber}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Amount</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:18px;color:#059669;">$${total}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Date</td><td style="padding:6px 0;text-align:right;">${paidDate}</td></tr>
        </table>
      </div>
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/dashboard/receipts`, 'View Receipt')}
      </p>
    `),
  });
}

// ── Quotation Email ─────────────────────────────────────────────

export async function sendQuotationEmail(
  email: string,
  quotation: { quotationNumber: string; subtotalCents: number; taxAmountCents: number; totalAmountCents: number; validUntil: Date },
): Promise<void> {
  const subtotal = (quotation.subtotalCents / 100).toFixed(2);
  const tax = (quotation.taxAmountCents / 100).toFixed(2);
  const total = (quotation.totalAmountCents / 100).toFixed(2);
  const validUntil = new Date(quotation.validUntil).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  await sendEmail({
    to: email,
    subject: `Quotation ${quotation.quotationNumber} — Honor Cleaning`,
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Quotation ${quotation.quotationNumber}</h2>
      <p>We've prepared a custom quotation for your cleaning service.</p>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Subtotal</td><td style="padding:6px 0;text-align:right;">$${subtotal}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">MA Sales Tax</td><td style="padding:6px 0;text-align:right;">$${tax}</td></tr>
          <tr style="border-top:2px solid #374151;"><td style="padding:10px 0 4px;font-weight:700;font-size:16px;">Total</td><td style="padding:10px 0 4px;text-align:right;font-weight:700;font-size:18px;">$${total}</td></tr>
        </table>
      </div>
      <p><strong>Valid Until:</strong> ${validUntil}</p>
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/dashboard/quotations`, 'View & Accept Quotation')}
      </p>
    `),
  });
}

// ── Subscription Payment Reminder ───────────────────────────────

export async function sendPaymentReminderEmail(
  email: string,
  reminder: {
    serviceType: string;
    frequency: string;
    amountCents: number;
    nextPaymentDate: Date;
    daysUntil: number;
  },
): Promise<void> {
  const total = (reminder.amountCents / 100).toFixed(2);
  const paymentDate = new Date(reminder.nextPaymentDate).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const dayLabel = reminder.daysUntil === 1 ? 'tomorrow' : `in ${reminder.daysUntil} days`;

  await sendEmail({
    to: email,
    subject: `Upcoming Payment ${dayLabel} — Honor Cleaning`,
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Payment Reminder</h2>
      <p>This is a friendly reminder that your recurring cleaning payment will be automatically charged <strong>${dayLabel}</strong>.</p>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:20px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Service</td><td style="padding:6px 0;text-align:right;font-weight:600;text-transform:capitalize;">${reminder.serviceType}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Plan</td><td style="padding:6px 0;text-align:right;font-weight:600;text-transform:capitalize;">${reminder.frequency}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Payment Date</td><td style="padding:6px 0;text-align:right;font-weight:600;">${paymentDate}</td></tr>
          <tr style="border-top:2px solid #374151;"><td style="padding:10px 0 4px;font-weight:700;font-size:16px;">Amount</td><td style="padding:10px 0 4px;text-align:right;font-weight:700;font-size:18px;">$${total}</td></tr>
        </table>
      </div>
      <p style="color:#6b7280;font-size:13px;">Your card on file will be charged automatically. If you need to update your payment method or pause/cancel your subscription, you can do so from your dashboard.</p>
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/dashboard/subscriptions`, 'Manage Subscription')}
      </p>
      <p style="color:#9ca3af;font-size:12px;">If you have any questions, contact us at (508) 333-1838 or reply to this email.</p>
    `),
  });
}

// ── Cheque Payment Emails ───────────────────────────────────────

export async function sendChequeReceivedEmail(
  email: string,
  data: { invoiceNumber: string; chequeNumber: string; amountCents: number },
): Promise<void> {
  const total = (data.amountCents / 100).toFixed(2);
  await sendEmail({
    to: email,
    subject: `Cheque Received for ${data.invoiceNumber} — Honor Cleaning`,
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Cheque Received</h2>
      <p>We have received your cheque payment. Thank you!</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Invoice</td><td style="padding:6px 0;text-align:right;font-weight:600;">${data.invoiceNumber}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Cheque #</td><td style="padding:6px 0;text-align:right;font-weight:600;">${data.chequeNumber}</td></tr>
          <tr style="border-top:2px solid #374151;"><td style="padding:10px 0 4px;font-weight:700;">Amount</td><td style="padding:10px 0 4px;text-align:right;font-weight:700;font-size:18px;">$${total}</td></tr>
        </table>
      </div>
      <p style="color:#6b7280;font-size:13px;">We will deposit the cheque and notify you once it has cleared. This typically takes 3–5 business days.</p>
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/dashboard/invoices`, 'View Invoice')}
      </p>
    `),
  });
}

export async function sendChequeDepositedEmail(
  email: string,
  data: { invoiceNumber: string; chequeNumber: string; amountCents: number },
): Promise<void> {
  const total = (data.amountCents / 100).toFixed(2);
  await sendEmail({
    to: email,
    subject: `Cheque Deposited — ${data.invoiceNumber} — Honor Cleaning`,
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Cheque Deposited</h2>
      <p>Your cheque for invoice <strong>${data.invoiceNumber}</strong> has been deposited.</p>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:20px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Cheque #</td><td style="padding:6px 0;text-align:right;font-weight:600;">${data.chequeNumber}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Amount</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:18px;">$${total}</td></tr>
        </table>
      </div>
      <p style="color:#6b7280;font-size:13px;">Please allow 3–5 business days for the cheque to clear. You will receive a receipt once the payment is confirmed.</p>
    `),
  });
}

export async function sendChequeClearedEmail(
  email: string,
  data: { invoiceNumber: string; chequeNumber: string; receiptNumber: string; amountCents: number },
): Promise<void> {
  const total = (data.amountCents / 100).toFixed(2);
  await sendEmail({
    to: email,
    subject: `Payment Confirmed — ${data.invoiceNumber} — Honor Cleaning`,
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Payment Confirmed</h2>
      <p>Your cheque for invoice <strong>${data.invoiceNumber}</strong> has cleared successfully.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Invoice</td><td style="padding:6px 0;text-align:right;font-weight:600;">${data.invoiceNumber}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Cheque #</td><td style="padding:6px 0;text-align:right;font-weight:600;">${data.chequeNumber}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Receipt #</td><td style="padding:6px 0;text-align:right;font-weight:600;">${data.receiptNumber}</td></tr>
          <tr style="border-top:2px solid #374151;"><td style="padding:10px 0 4px;font-weight:700;">Amount</td><td style="padding:10px 0 4px;text-align:right;font-weight:700;font-size:18px;color:#059669;">$${total}</td></tr>
        </table>
      </div>
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/dashboard/receipts`, 'View Receipt')}
      </p>
    `),
  });
}

// ── Feedback Request Email ─────────────────────────────────────

export async function sendFeedbackRequestEmail(
  email: string,
  data: { customerName: string; serviceType: string; scheduledDate: string; token: string },
): Promise<void> {
  const feedbackUrl = `${CLIENT_URL()}/feedback?token=${data.token}`;
  await sendEmail({
    to: email,
    subject: 'How Did We Do? — Honor Cleaning',
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Hi ${data.customerName}!</h2>
      <p>Thank you for choosing Honor Cleaning for your recent <strong style="text-transform:capitalize;">${data.serviceType}</strong> cleaning on <strong>${data.scheduledDate}</strong>.</p>
      <p>We'd love to hear about your experience. Your feedback helps us improve and lets other businesses know what to expect.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:16px 0;text-align:center;">
        <p style="margin:0;font-size:32px;">&#11088;&#11088;&#11088;&#11088;&#11088;</p>
        <p style="margin:8px 0 0;color:#6b7280;font-size:13px;">Rate your experience</p>
      </div>
      <p style="text-align:center;margin:24px 0;">
        ${button(feedbackUrl, 'Leave Your Review')}
      </p>
      <p style="color:#6b7280;font-size:13px;">It only takes a minute and means a lot to our team. With your permission, we may share your review on our website.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="color:#9ca3af;font-size:12px;">If the button doesn't work, copy and paste this URL into your browser:<br/><a href="${feedbackUrl}" style="color:${BRAND_COLOR};word-break:break-all;">${feedbackUrl}</a></p>
    `),
  });
}

export async function sendChequeBouncedEmail(
  email: string,
  data: { invoiceNumber: string; chequeNumber: string; amountCents: number; bounceReason?: string },
): Promise<void> {
  const total = (data.amountCents / 100).toFixed(2);
  await sendEmail({
    to: email,
    subject: `Payment Issue — ${data.invoiceNumber} — Honor Cleaning`,
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#dc2626;font-size:20px;">Cheque Returned</h2>
      <p>Unfortunately, your cheque for invoice <strong>${data.invoiceNumber}</strong> was returned unpaid by the bank.</p>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:20px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Cheque #</td><td style="padding:6px 0;text-align:right;font-weight:600;">${data.chequeNumber}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Amount</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:18px;">$${total}</td></tr>
          ${data.bounceReason ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Reason</td><td style="padding:6px 0;text-align:right;color:#dc2626;font-weight:600;">${data.bounceReason}</td></tr>` : ''}
        </table>
      </div>
      <p>Please contact us to arrange an alternative payment method.</p>
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/dashboard/invoices`, 'View Invoice', '#dc2626')}
      </p>
      <p style="color:#6b7280;font-size:13px;">Questions? Call us at (508) 333-1838 or reply to this email.</p>
    `),
  });
}

// ── Booking Reminder Emails ───────────────────────────────────

export async function sendBookingReminderToCustomer(
  email: string,
  data: {
    customerName: string;
    serviceType: string;
    scheduledDate: string;
    scheduledTime: string;
    staffName: string;
    address: string;
    googleCalendarUrl?: string;
    icsDownloadUrl?: string;
  },
): Promise<void> {
  const calendarLinks = data.googleCalendarUrl
    ? `<div style="text-align:center;margin:16px 0;">
        <a href="${data.googleCalendarUrl}" target="_blank" style="display:inline-block;background:#4285f4;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;margin:0 4px;">&#128197; Add to Google Calendar</a>
        ${data.icsDownloadUrl ? `<a href="${data.icsDownloadUrl}" style="display:inline-block;background:#6b7280;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;margin:0 4px;">&#128228; Download .ics</a>` : ''}
      </div>`
    : '';

  await sendEmail({
    to: email,
    subject: `Reminder: Your Cleaning is Tomorrow — Honor Cleaning`,
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Hi ${data.customerName}!</h2>
      <p>This is a friendly reminder that your cleaning appointment is <strong>tomorrow</strong>.</p>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:20px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Service</td><td style="padding:6px 0;text-align:right;font-weight:600;text-transform:capitalize;">${data.serviceType}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Date</td><td style="padding:6px 0;text-align:right;font-weight:600;">${data.scheduledDate}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Time</td><td style="padding:6px 0;text-align:right;font-weight:600;">${data.scheduledTime}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Cleaner</td><td style="padding:6px 0;text-align:right;font-weight:600;color:${BRAND_COLOR};">${data.staffName}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Location</td><td style="padding:6px 0;text-align:right;font-weight:600;">${data.address}</td></tr>
        </table>
      </div>
      ${calendarLinks}
      <p><strong>To prepare:</strong></p>
      <ul style="padding-left:20px;color:#374151;font-size:14px;">
        <li>Ensure access to the property (leave keys, unlock doors, or provide entry codes)</li>
        <li>Secure pets in a safe area</li>
        <li>Clear countertops and surfaces for best results</li>
      </ul>
      <p>Our team will arrive within a 30-minute window of your scheduled time.</p>
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/dashboard`, 'View Booking Details')}
      </p>
      <p style="color:#6b7280;font-size:13px;">Need to reschedule? Contact us at (508) 333-1838 or reply to this email as soon as possible.</p>
    `),
  });
}

export async function sendBookingReminderToStaff(
  email: string,
  data: {
    staffName: string;
    serviceType: string;
    scheduledDate: string;
    scheduledTime: string;
    customerName: string;
    address: string;
    durationEstimate: number;
    notes?: string;
    googleCalendarUrl?: string;
    icsDownloadUrl?: string;
  },
): Promise<void> {
  const durationHours = Math.floor(data.durationEstimate / 60);
  const durationMins = data.durationEstimate % 60;
  const durationStr = durationHours > 0
    ? `${durationHours}h${durationMins > 0 ? ` ${durationMins}m` : ''}`
    : `${durationMins}m`;

  const calendarLinks = data.googleCalendarUrl
    ? `<div style="text-align:center;margin:16px 0;">
        <a href="${data.googleCalendarUrl}" target="_blank" style="display:inline-block;background:#4285f4;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;margin:0 4px;">&#128197; Add to Google Calendar</a>
        ${data.icsDownloadUrl ? `<a href="${data.icsDownloadUrl}" style="display:inline-block;background:#6b7280;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;margin:0 4px;">&#128228; Download .ics</a>` : ''}
      </div>`
    : '';

  await sendEmail({
    to: email,
    subject: `Job Reminder: ${data.serviceType} Cleaning Tomorrow — Honor Cleaning`,
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Hi ${data.staffName}!</h2>
      <p>You have a cleaning job scheduled for <strong>tomorrow</strong>. Here are the details:</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Service</td><td style="padding:6px 0;text-align:right;font-weight:600;text-transform:capitalize;">${data.serviceType}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Date</td><td style="padding:6px 0;text-align:right;font-weight:600;">${data.scheduledDate}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Time</td><td style="padding:6px 0;text-align:right;font-weight:600;">${data.scheduledTime}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Est. Duration</td><td style="padding:6px 0;text-align:right;font-weight:600;">${durationStr}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Customer</td><td style="padding:6px 0;text-align:right;font-weight:600;">${data.customerName}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Location</td><td style="padding:6px 0;text-align:right;font-weight:600;">${data.address}</td></tr>
        </table>
      </div>
      ${data.notes ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px;margin:16px 0;"><strong style="color:#92400e;">Notes:</strong> <span style="color:#78350f;">${data.notes}</span></div>` : ''}
      ${calendarLinks}
      <p><strong>Reminders:</strong></p>
      <ul style="padding-left:20px;color:#374151;font-size:14px;">
        <li>Arrive on time — check in via the app when you arrive</li>
        <li>Bring all required supplies and equipment</li>
        <li>Take before & after photos for documentation</li>
        <li>Follow the service checklist for this job type</li>
      </ul>
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/staff/jobs`, 'View Job Details')}
      </p>
      <p style="color:#6b7280;font-size:13px;">If you can't make this appointment, contact your supervisor immediately.</p>
    `),
  });
}

// ── Recurring Booking Scheduled Email ─────────────────────────

export async function sendRecurringBookingScheduledEmail(
  email: string,
  data: {
    customerName: string;
    serviceType: string;
    scheduledDate: string;
    scheduledTime: string;
    frequency: string;
    bookingNumber: string;
  },
): Promise<void> {
  const frequencyLabel: Record<string, string> = {
    weekly: 'weekly',
    biweekly: 'bi-weekly',
    monthly: 'monthly',
  };

  await sendEmail({
    to: email,
    subject: `Your ${frequencyLabel[data.frequency] || data.frequency} cleaning is scheduled — ${data.bookingNumber}`,
    html: brandedHtml(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Hi ${data.customerName}!</h2>
      <p>Your next <strong>${frequencyLabel[data.frequency] || data.frequency} cleaning</strong> has been automatically scheduled based on your maintenance plan.</p>
      <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:20px;margin:16px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Booking</td><td style="padding:6px 0;text-align:right;font-weight:600;color:${BRAND_COLOR};">${data.bookingNumber}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Service</td><td style="padding:6px 0;text-align:right;font-weight:600;text-transform:capitalize;">${data.serviceType}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Date</td><td style="padding:6px 0;text-align:right;font-weight:600;">${data.scheduledDate}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Time</td><td style="padding:6px 0;text-align:right;font-weight:600;">${data.scheduledTime}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Plan</td><td style="padding:6px 0;text-align:right;font-weight:600;text-transform:capitalize;">${frequencyLabel[data.frequency] || data.frequency}</td></tr>
        </table>
      </div>
      <p style="color:#374151;font-size:14px;">We are reviewing your booking and will confirm your assigned cleaner shortly. You can track everything from your dashboard.</p>
      <p style="text-align:center;margin:24px 0;">
        ${button(`${CLIENT_URL()}/dashboard`, 'View in Dashboard')}
      </p>
      <p style="color:#6b7280;font-size:13px;">Need to reschedule or cancel? You can manage your plan anytime from your dashboard or contact us at (508) 333-1838.</p>
    `),
  });
}
