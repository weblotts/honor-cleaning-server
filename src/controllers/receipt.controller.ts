import { Request, Response, NextFunction } from 'express';
import { Receipt } from '../models/Receipt';
import { UserRole } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import { decryptField } from '../utils/encryption';

function decryptPopulatedUser(user: any): any {
  if (!user || typeof user !== 'object' || !user.name) return user;
  try {
    return {
      ...(user.toJSON ? user.toJSON() : user),
      name: decryptField(user.name),
      phone: user.phone ? decryptField(user.phone) : undefined,
    };
  } catch {
    return user.toJSON ? user.toJSON() : user;
  }
}

// ────────────────────────────────────────────────────────────────
// GET /api/receipts
// ────────────────────────────────────────────────────────────────
export async function listReceipts(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    let filter: any = {};
    if (req.user.role === UserRole.Customer) {
      filter.customerId = req.user.userId;
    }

    const [receipts, total] = await Promise.all([
      Receipt.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('customerId', 'name email')
        .populate('invoiceId', 'invoiceNumber')
        .populate('quotationId', 'quotationNumber')
        .populate('bookingId', 'serviceType scheduledDate'),
      Receipt.countDocuments(filter),
    ]);

    const decrypted = receipts.map((r) => {
      const obj = r.toJSON();
      if (obj.customerId && typeof obj.customerId === 'object') {
        obj.customerId = decryptPopulatedUser(obj.customerId);
      }
      return obj;
    });

    res.json({ receipts: decrypted, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// GET /api/receipts/:id
// ────────────────────────────────────────────────────────────────
export async function getReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const receipt = await Receipt.findById(req.params.id)
      .populate('customerId', 'name email phone')
      .populate('invoiceId', 'invoiceNumber')
      .populate('quotationId', 'quotationNumber')
      .populate('bookingId', 'serviceType scheduledDate scheduledTime address');

    if (!receipt) throw new AppError(404, 'Receipt not found');

    if (
      req.user.role === UserRole.Customer &&
      receipt.customerId._id.toString() !== req.user.userId
    ) {
      throw new AppError(403, 'Access denied');
    }

    const obj = receipt.toJSON();
    if (obj.customerId && typeof obj.customerId === 'object') {
      obj.customerId = decryptPopulatedUser(obj.customerId);
    }
    res.json(obj);
  } catch (err) {
    next(err);
  }
}
