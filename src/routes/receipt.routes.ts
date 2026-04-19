import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listReceipts, getReceipt } from '../controllers/receipt.controller';

const router = Router();

router.get('/', requireAuth, listReceipts);
router.get('/:id', requireAuth, getReceipt);

export default router;
