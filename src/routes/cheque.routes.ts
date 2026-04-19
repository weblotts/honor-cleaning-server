import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { UserRole } from '../models/User';
import {
  recordChequePayment,
  depositCheque,
  clearCheque,
  bounceCheque,
  listChequePayments,
} from '../controllers/cheque.controller';

const router = Router();

// All cheque management is admin-only
router.use(requireAuth, requireRole(UserRole.Admin));

router.get('/', listChequePayments);
router.patch('/:id/deposit', depositCheque);
router.patch('/:id/clear', clearCheque);
router.patch('/:id/bounce', bounceCheque);

export default router;
