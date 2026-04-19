import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { UserRole } from '../models/User';
import { checkinSchema, checklistUpdateSchema } from '../utils/validators';
import {
  getMyJobs,
  checkIn,
  checkOut,
  updateChecklist,
  getPhotoUploadUrls,
  completeJob,
} from '../controllers/job.controller';

const router = Router();

router.get('/mine', requireAuth, requireRole(UserRole.Staff, UserRole.Admin), getMyJobs);
router.post('/:id/checkin', requireAuth, requireRole(UserRole.Staff), validate(checkinSchema), checkIn);
router.post('/:id/checkout', requireAuth, requireRole(UserRole.Staff), validate(checkinSchema), checkOut);
router.patch('/:id/checklist', requireAuth, requireRole(UserRole.Staff), validate(checklistUpdateSchema), updateChecklist);
router.post('/:id/photos', requireAuth, requireRole(UserRole.Staff), getPhotoUploadUrls);
router.patch('/:id/complete', requireAuth, requireRole(UserRole.Staff, UserRole.Admin), completeJob);

export default router;
