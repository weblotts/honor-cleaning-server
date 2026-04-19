import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { UserRole } from '../models/User';
import {
  revenueReport,
  jobsReport,
  getAuditLogs,
  getIncidentResponse,
} from '../controllers/admin.controller';

const router = Router();

// All admin routes require admin role
router.use(requireAuth, requireRole(UserRole.Admin));

router.get('/reports/revenue', revenueReport);
router.get('/reports/jobs', jobsReport);
router.get('/audit-logs', getAuditLogs);
router.get('/incident-response', getIncidentResponse);

export default router;
