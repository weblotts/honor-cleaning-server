import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Types } from 'mongoose';
import { UserRole } from '../models/User';

// ────────────────────────────────────────────────────────────────
// COMPLIANCE: MA 201 CMR 17.00 – Session Security
// Access tokens: 15-minute expiry, stored in memory (not localStorage)
// Refresh tokens: 7-day expiry, httpOnly cookie, rotated on each use
// ────────────────────────────────────────────────────────────────

export interface AccessTokenPayload {
  userId: string;
  role: UserRole;
  email: string;
}

export function generateAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, {
    expiresIn: '15m',
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as AccessTokenPayload;
}

export function generateRefreshToken(): { token: string; expiresAt: Date } {
  const token = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  return { token, expiresAt };
}

export function generatePasswordResetToken(): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  return { token, expires };
}
