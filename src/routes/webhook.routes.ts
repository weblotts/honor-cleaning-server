import { Router } from 'express';
import express from 'express';
import { handleStripeWebhook } from '../controllers/webhook.controller';

const router = Router();

// Stripe requires the raw body for signature verification.
// This route uses express.raw() instead of express.json().
router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  handleStripeWebhook,
);

export default router;
