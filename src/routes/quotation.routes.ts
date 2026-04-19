import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { UserRole } from '../models/User';
import {
  createQuotationSchema,
  respondToQuotationSchema,
} from '../utils/validators';
import {
  listQuotations,
  getQuotation,
  createQuotation,
  sendQuotation,
  respondToQuotation,
} from '../controllers/quotation.controller';

const router = Router();

router.get('/', requireAuth, listQuotations);
router.get('/:id', requireAuth, getQuotation);
router.post('/', requireAuth, requireRole(UserRole.Admin), validate(createQuotationSchema), createQuotation);
router.post('/:id/send', requireAuth, requireRole(UserRole.Admin), sendQuotation);
router.patch('/:id/respond', requireAuth, validate(respondToQuotationSchema), respondToQuotation);

export default router;
