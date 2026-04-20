import { Request, Response } from 'express';
import crypto from 'crypto';
import { Feedback } from '../models/Feedback';
import { Booking, BookingStatus } from '../models/Booking';
import { User } from '../models/User';
import { sendFeedbackRequestEmail } from '../services/email';
import { decryptField } from '../utils/encryption';

// ────────────────────────────────────────────────────────────────
// Admin: Request feedback for a completed booking
// POST /api/feedback/request
// ────────────────────────────────────────────────────────────────
export async function requestFeedback(req: Request, res: Response): Promise<void> {
  const { bookingNumber } = req.body;

  const booking = await Booking.findOne({ bookingNumber });
  if (!booking) {
    res.status(404).json({ error: 'Booking not found' });
    return;
  }

  if (booking.status !== BookingStatus.Completed) {
    res.status(400).json({ error: 'Feedback can only be requested for completed bookings' });
    return;
  }

  // Check if feedback already requested for this booking
  const existing = await Feedback.findOne({ bookingId: booking._id });
  if (existing) {
    res.status(409).json({ error: 'Feedback has already been requested for this booking' });
    return;
  }

  const customer = await User.findById(booking.customerId);
  if (!customer) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const customerName = decryptField(customer.name);
  const customerEmail = customer.email.includes(':') ? decryptField(customer.email) : customer.email;

  const feedback = await Feedback.create({
    bookingId: booking._id,
    customerId: customer._id,
    token,
    customerName,
    serviceType: booking.serviceType,
    requestedBy: req.user!.userId,
  });

  // Send the feedback request email
  try {
    await sendFeedbackRequestEmail(customerEmail, {
      customerName,
      serviceType: booking.serviceType,
      scheduledDate: new Date(booking.scheduledDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      token,
    });
  } catch {
    res.status(502).json({ error: 'Feedback created but failed to send email. You can resend it later.' });
    return;
  }

  res.status(201).json({ message: 'Feedback request sent', feedbackId: feedback._id });
}

// ────────────────────────────────────────────────────────────────
// Public: Get feedback form data by token
// GET /api/feedback/token/:token
// ────────────────────────────────────────────────────────────────
export async function getFeedbackByToken(req: Request, res: Response): Promise<void> {
  const { token } = req.params;

  const feedback = await Feedback.findOne({ token });
  if (!feedback) {
    res.status(404).json({ error: 'Feedback request not found or invalid link' });
    return;
  }

  if (feedback.submittedAt) {
    res.status(400).json({ error: 'Feedback has already been submitted' });
    return;
  }

  // Decrypt customerName if stored encrypted
  const customerName = feedback.customerName.includes(':')
    ? decryptField(feedback.customerName)
    : feedback.customerName;

  // Prefill location from customer address if available
  let customerLocation = '';
  const customer = await User.findById(feedback.customerId);
  if (customer?.address) {
    const parts = [customer.address.city, customer.address.state].filter(Boolean);
    customerLocation = parts.join(', ');
  }

  res.json({
    customerName,
    serviceType: feedback.serviceType,
    requestedAt: feedback.requestedAt,
    customerLocation,
  });
}

// ────────────────────────────────────────────────────────────────
// Public: Submit feedback
// POST /api/feedback/token/:token
// ────────────────────────────────────────────────────────────────
export async function submitFeedback(req: Request, res: Response): Promise<void> {
  const { token } = req.params;
  const { rating, comment, customerRole, customerLocation } = req.body;

  const feedback = await Feedback.findOne({ token });
  if (!feedback) {
    res.status(404).json({ error: 'Feedback request not found or invalid link' });
    return;
  }

  if (feedback.submittedAt) {
    res.status(400).json({ error: 'Feedback has already been submitted' });
    return;
  }

  feedback.rating = rating;
  feedback.comment = comment;
  if (customerRole) feedback.customerRole = customerRole;
  if (customerLocation) feedback.customerLocation = customerLocation;
  feedback.submittedAt = new Date();
  await feedback.save();

  res.json({ message: 'Thank you for your feedback!' });
}

// ────────────────────────────────────────────────────────────────
// Admin: List all feedback
// GET /api/feedback
// ────────────────────────────────────────────────────────────────
export async function listFeedback(req: Request, res: Response): Promise<void> {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (req.query.status === 'submitted') filter.submittedAt = { $ne: null };
  if (req.query.status === 'pending') filter.submittedAt = null;
  if (req.query.isPublic === 'true') filter.isPublic = true;

  const [feedbackDocs, total] = await Promise.all([
    Feedback.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('bookingId', 'serviceType scheduledDate')
      .populate('customerId', 'name email'),
    Feedback.countDocuments(filter),
  ]);

  // Decrypt customerName for any existing records stored encrypted
  const feedback = feedbackDocs.map((f) => {
    const obj = f.toObject();
    if (obj.customerName?.includes(':')) {
      try { obj.customerName = decryptField(obj.customerName); } catch { /* keep as-is */ }
    }
    if (obj.customerId && typeof obj.customerId === 'object' && 'name' in obj.customerId) {
      try { (obj.customerId as any).name = decryptField((obj.customerId as any).name as string); } catch { /* keep */ }
    }
    return obj;
  });

  res.json({
    feedback,
    total,
    page,
    pages: Math.ceil(total / limit),
  });
}

// ────────────────────────────────────────────────────────────────
// Admin: Toggle public visibility
// PATCH /api/feedback/:id/toggle-public
// ────────────────────────────────────────────────────────────────
export async function toggleFeedbackPublic(req: Request, res: Response): Promise<void> {
  const feedback = await Feedback.findById(req.params.id);
  if (!feedback) {
    res.status(404).json({ error: 'Feedback not found' });
    return;
  }

  if (!feedback.submittedAt) {
    res.status(400).json({ error: 'Cannot publish feedback that has not been submitted yet' });
    return;
  }

  feedback.isPublic = !feedback.isPublic;
  await feedback.save();

  res.json({ message: `Feedback ${feedback.isPublic ? 'published' : 'unpublished'}`, isPublic: feedback.isPublic });
}

// ────────────────────────────────────────────────────────────────
// Admin: Resend feedback request email
// POST /api/feedback/:id/resend
// ────────────────────────────────────────────────────────────────
export async function resendFeedbackRequest(req: Request, res: Response): Promise<void> {
  const feedback = await Feedback.findById(req.params.id);
  if (!feedback) {
    res.status(404).json({ error: 'Feedback not found' });
    return;
  }

  if (feedback.submittedAt) {
    res.status(400).json({ error: 'Feedback has already been submitted' });
    return;
  }

  const customer = await User.findById(feedback.customerId);
  if (!customer) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }

  const customerEmail = customer.email.includes(':') ? decryptField(customer.email) : customer.email;
  const customerName = feedback.customerName.includes(':')
    ? decryptField(feedback.customerName)
    : feedback.customerName;

  const booking = await Booking.findById(feedback.bookingId);

  try {
    await sendFeedbackRequestEmail(customerEmail, {
      customerName,
      serviceType: feedback.serviceType,
      scheduledDate: booking
        ? new Date(booking.scheduledDate).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : 'your recent service',
      token: feedback.token,
    });
  } catch {
    res.status(502).json({ error: 'Failed to send email. Please check your Resend domain configuration.' });
    return;
  }

  res.json({ message: 'Feedback request resent' });
}

// ────────────────────────────────────────────────────────────────
// Public: Get published testimonials (for website)
// GET /api/feedback/testimonials
// ────────────────────────────────────────────────────────────────
export async function getTestimonials(_req: Request, res: Response): Promise<void> {
  const docs = await Feedback.find({
    isPublic: true,
    submittedAt: { $ne: null },
  })
    .sort({ submittedAt: -1 })
    .limit(12)
    .select('customerName customerRole customerLocation serviceType rating comment submittedAt');

  const testimonials = docs.map((d) => {
    const obj = d.toObject();
    if (obj.customerName?.includes(':')) {
      try { obj.customerName = decryptField(obj.customerName); } catch { /* keep */ }
    }
    return obj;
  });

  res.json(testimonials);
}
