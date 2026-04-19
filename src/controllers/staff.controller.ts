import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { User, UserRole } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import { encryptField, decryptField } from '../utils/encryption';

// ────────────────────────────────────────────────────────────────
// GET /api/staff (admin only)
// ────────────────────────────────────────────────────────────────
export async function listStaff(req: Request, res: Response, next: NextFunction) {
  try {
    const staff = await User.find({ role: UserRole.Staff, isDeleted: false }).sort({
      createdAt: -1,
    });

    const decrypted = staff.map((s) => ({
      ...s.toJSON(),
      name: decryptField(s.name),
      phone: s.phone ? decryptField(s.phone) : undefined,
    }));

    res.json(decrypted);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/staff (admin only – create staff account)
// ────────────────────────────────────────────────────────────────
export async function createStaff(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, email, password, phone } = req.body;

    const existing = await User.findOne({ email });
    if (existing) throw new AppError(409, 'Email already registered');

    const passwordHash = await bcrypt.hash(password, 12);

    const staff = await User.create({
      name: encryptField(name),
      email,
      passwordHash,
      role: UserRole.Staff,
      phone: phone ? encryptField(phone) : undefined,
      // MFA must be set up on first login (compliance)
      mfaEnabled: false,
    });

    await req.audit('staff.create', 'User', staff._id.toString());

    res.status(201).json({
      ...staff.toJSON(),
      name: decryptField(staff.name),
    });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH /api/staff/:id/territories
// ────────────────────────────────────────────────────────────────
export async function updateTerritories(req: Request, res: Response, next: NextFunction) {
  try {
    // Territories stored as a simple array on the user document
    const staff = await User.findOneAndUpdate(
      { _id: req.params.id, role: UserRole.Staff, isDeleted: false },
      { $set: { 'address.zip': req.body.zipCodes.join(',') } },
      { new: true },
    );
    if (!staff) throw new AppError(404, 'Staff not found');

    await req.audit('staff.updateTerritories', 'User', staff._id.toString(), {
      zipCodes: req.body.zipCodes,
    });

    res.json(staff);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH /api/staff/:id/availability
// ────────────────────────────────────────────────────────────────
export async function updateAvailability(req: Request, res: Response, next: NextFunction) {
  try {
    // Store availability as JSON in a metadata-like field
    const staff = await User.findOneAndUpdate(
      { _id: req.params.id, role: UserRole.Staff, isDeleted: false },
      { $set: { availability: req.body.availability } },
      { new: true },
    );
    if (!staff) throw new AppError(404, 'Staff not found');

    await req.audit('staff.updateAvailability', 'User', staff._id.toString());

    res.json(staff);
  } catch (err) {
    next(err);
  }
}
