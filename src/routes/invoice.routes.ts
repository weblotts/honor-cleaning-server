import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { UserRole } from '../models/User';
import { createInvoiceSchema } from '../utils/validators';
import {
  listInvoices,
  getInvoice,
  createInvoice,
  sendInvoice,
  payInvoice,
  confirmInvoicePayment,
  getRefundEligibility,
  requestRefund,
  refundInvoice,
} from '../controllers/invoice.controller';
import { recordChequePayment } from '../controllers/cheque.controller';

const router = Router();

const paymentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10,
  message: 'Too many payment requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/', requireAuth, listInvoices);
router.get('/:id', requireAuth, getInvoice);
router.post('/', requireAuth, requireRole(UserRole.Admin), validate(createInvoiceSchema), createInvoice);
router.post('/:id/send', requireAuth, requireRole(UserRole.Admin), sendInvoice);
router.post('/:id/pay', paymentLimiter, requireAuth, payInvoice);
router.post('/:id/confirm-payment', paymentLimiter, requireAuth, confirmInvoicePayment);
// Cheque payment (admin records a cheque against an invoice)
router.post('/:id/cheque-payment', requireAuth, requireRole(UserRole.Admin), recordChequePayment);
// Refund policy endpoints
router.get('/:id/refund-eligibility', requireAuth, getRefundEligibility);
router.post('/:id/request-refund', requireAuth, requestRefund);
router.post('/:id/refund', requireAuth, requireRole(UserRole.Admin), refundInvoice);

export default router;
