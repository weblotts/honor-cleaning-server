import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { UserRole } from '../models/User';
import {
  listCustomers,
  getCustomer,
  updateCustomer,
  deleteCustomer,
} from '../controllers/customer.controller';

const router = Router();

// All customer management routes are admin-only
router.get('/', requireAuth, requireRole(UserRole.Admin), listCustomers);
router.get('/:id', requireAuth, requireRole(UserRole.Admin), getCustomer);
router.patch('/:id', requireAuth, requireRole(UserRole.Admin), updateCustomer);
router.delete('/:id', requireAuth, requireRole(UserRole.Admin), deleteCustomer);

export default router;
