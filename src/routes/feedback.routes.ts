import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { UserRole } from '../models/User';
import { validate } from '../middleware/validate';
import { requestFeedbackSchema, submitFeedbackSchema } from '../utils/validators';
import {
  requestFeedback,
  getFeedbackByToken,
  submitFeedback,
  listFeedback,
  toggleFeedbackPublic,
  resendFeedbackRequest,
  getTestimonials,
} from '../controllers/feedback.controller';

const router = Router();

// ── Public routes (no auth required) ────────────────────────────

// Get published testimonials for website
router.get('/testimonials', getTestimonials);

// Get feedback form data by token (customer clicking email link)
router.get('/token/:token', getFeedbackByToken);

// Submit feedback via token
router.post('/token/:token', validate(submitFeedbackSchema), submitFeedback);

// ── Admin routes ────────────────────────────────────────────────

// Request feedback from a customer (sends email)
router.post('/request', requireAuth, requireRole(UserRole.Admin), validate(requestFeedbackSchema), requestFeedback);

// List all feedback
router.get('/', requireAuth, requireRole(UserRole.Admin), listFeedback);

// Toggle feedback public visibility
router.patch('/:id/toggle-public', requireAuth, requireRole(UserRole.Admin), toggleFeedbackPublic);

// Resend feedback request email
router.post('/:id/resend', requireAuth, requireRole(UserRole.Admin), resendFeedbackRequest);

export default router;
