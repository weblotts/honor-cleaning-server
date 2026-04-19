import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { UserRole } from '../models/User';
import { validate } from '../middleware/validate';
import { staffTerritoriesSchema, staffAvailabilitySchema } from '../utils/validators';
import {
  listStaff,
  createStaff,
  updateTerritories,
  updateAvailability,
} from '../controllers/staff.controller';

const router = Router();

router.get('/', requireAuth, requireRole(UserRole.Admin), listStaff);
router.post('/', requireAuth, requireRole(UserRole.Admin), createStaff);
router.patch('/:id/territories', requireAuth, requireRole(UserRole.Admin), validate(staffTerritoriesSchema), updateTerritories);
router.patch('/:id/availability', requireAuth, requireRole(UserRole.Admin), validate(staffAvailabilitySchema), updateAvailability);

export default router;
