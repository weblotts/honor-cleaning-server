import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createSubscriptionSchema } from '../utils/validators';
import {
  createSubscription,
  getMySubscriptions,
  getUpcomingPayments,
  pauseSubscription,
  cancelSubscription,
} from '../controllers/subscription.controller';

const router = Router();

const subscriptionCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: 'Too many subscription requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/', subscriptionCreationLimiter, requireAuth, validate(createSubscriptionSchema), createSubscription);
router.get('/mine', requireAuth, getMySubscriptions);
router.get('/upcoming-payments', requireAuth, getUpcomingPayments);
router.patch('/:id/pause', requireAuth, pauseSubscription);
router.delete('/:id', requireAuth, cancelSubscription);

export default router;
