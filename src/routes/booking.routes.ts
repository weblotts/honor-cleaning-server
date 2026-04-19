import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { UserRole } from '../models/User';
import {
  createBookingSchema,
  rescheduleSchema,
  cancelBookingSchema,
  assignStaffSchema,
  submitQuoteSchema,
  respondToQuoteSchema,
  updateBookingStatusSchema,
} from '../utils/validators';
import {
  createBooking,
  listBookings,
  getBooking,
  assignStaff,
  cancelBooking,
  rescheduleBooking,
  submitQuote,
  respondToQuote,
  updateBookingStatus,
  downloadCalendarIcs,
} from '../controllers/booking.controller';

const router = Router();

const bookingCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: 'Too many booking requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/', bookingCreationLimiter, requireAuth, validate(createBookingSchema), createBooking);
router.get('/', requireAuth, listBookings);
router.get('/:id', requireAuth, getBooking);
router.patch('/:id/assign', requireAuth, requireRole(UserRole.Admin), validate(assignStaffSchema), assignStaff);
router.patch('/:id/status', requireAuth, requireRole(UserRole.Admin), validate(updateBookingStatusSchema), updateBookingStatus);
router.patch('/:id/cancel', requireAuth, validate(cancelBookingSchema), cancelBooking);
router.patch('/:id/reschedule', requireAuth, validate(rescheduleSchema), rescheduleBooking);
router.patch('/:id/quote', requireAuth, requireRole(UserRole.Admin), validate(submitQuoteSchema), submitQuote);
router.patch('/:id/quote/respond', requireAuth, validate(respondToQuoteSchema), respondToQuote);
router.get('/:id/calendar.ics', requireAuth, downloadCalendarIcs);

export default router;
