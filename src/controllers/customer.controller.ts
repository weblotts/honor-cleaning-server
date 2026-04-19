import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { Booking } from '../models/Booking';
import { AppError } from '../middleware/errorHandler';
import { decryptField, encryptField } from '../utils/encryption';

// ────────────────────────────────────────────────────────────────
// GET /api/customers (admin only, paginated with search)
// ────────────────────────────────────────────────────────────────
export async function listCustomers(req: Request, res: Response, next: NextFunction) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;
    const search = req.query.search as string;

    let filter: any = { role: 'customer', isDeleted: false };
    if (search) {
      // Search by email (plaintext) since name/phone are encrypted
      filter.email = { $regex: search, $options: 'i' };
    }

    const [customers, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    // Decrypt PII for display
    const decrypted = customers.map((c) => ({
      ...c.toJSON(),
      name: decryptField(c.name),
      phone: c.phone ? decryptField(c.phone) : undefined,
    }));

    res.json({ customers: decrypted, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// GET /api/customers/:id
// ────────────────────────────────────────────────────────────────
export async function getCustomer(req: Request, res: Response, next: NextFunction) {
  try {
    const customer = await User.findOne({
      _id: req.params.id,
      role: 'customer',
      isDeleted: false,
    });
    if (!customer) throw new AppError(404, 'Customer not found');

    const bookings = await Booking.find({ customerId: customer._id })
      .sort({ scheduledDate: -1 })
      .limit(50);

    res.json({
      customer: {
        ...customer.toJSON(),
        name: decryptField(customer.name),
        phone: customer.phone ? decryptField(customer.phone) : undefined,
      },
      bookings,
    });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH /api/customers/:id
// ────────────────────────────────────────────────────────────────
export async function updateCustomer(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, phone, email } = req.body;
    const update: any = {};

    if (name) update.name = encryptField(name);
    if (phone) update.phone = encryptField(phone);
    if (email) update.email = email;

    const customer = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'customer', isDeleted: false },
      update,
      { new: true },
    );
    if (!customer) throw new AppError(404, 'Customer not found');

    await req.audit('customer.update', 'User', customer._id.toString(), {
      fields: Object.keys(update),
    });

    res.json({
      ...customer.toJSON(),
      name: decryptField(customer.name),
      phone: customer.phone ? decryptField(customer.phone) : undefined,
    });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// DELETE /api/customers/:id (soft delete)
// COMPLIANCE: MA data retention – soft delete + schedule purge
// ────────────────────────────────────────────────────────────────
export async function deleteCustomer(req: Request, res: Response, next: NextFunction) {
  try {
    const customer = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'customer', isDeleted: false },
      { isDeleted: true, deletedAt: new Date() },
      { new: true },
    );
    if (!customer) throw new AppError(404, 'Customer not found');

    await req.audit('customer.delete', 'User', customer._id.toString());

    res.json({ message: 'Customer marked for deletion' });
  } catch (err) {
    next(err);
  }
}
