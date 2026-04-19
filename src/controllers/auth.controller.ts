import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { User, UserRole } from '../models/User';
import {
  generateAccessToken,
  generateRefreshToken,
  generatePasswordResetToken,
} from '../utils/tokens';
import { encryptField } from '../utils/encryption';
import { createStripeCustomer } from '../services/stripe';
import { sendPasswordResetEmail } from '../services/email';
import { AppError } from '../middleware/errorHandler';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const SALT_ROUNDS = 12;
const REFRESH_COOKIE = 'refreshToken';
const IS_PROD = process.env.NODE_ENV === 'production';

/** Cookie options for refresh token — lax in dev (cross-port), strict in prod (same origin) */
const COOKIE_OPTS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: (IS_PROD ? 'strict' : 'lax') as 'strict' | 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/api/auth',
};

// ────────────────────────────────────────────────────────────────
// POST /api/auth/register
// ────────────────────────────────────────────────────────────────
export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, email, password, phone, marketingConsent } = req.body;

    const existing = await User.findOne({ email });
    if (existing) throw new AppError(409, 'Email already registered');

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create Stripe customer for payment processing
    let stripeCustomerId: string | undefined;
    try {
      stripeCustomerId = await createStripeCustomer(email, name);
    } catch (err) {
      console.error('[STRIPE] Failed to create customer:', err);
    }

    const user = await User.create({
      // COMPLIANCE: PII fields encrypted at rest (MA 201 CMR 17)
      name: encryptField(name),
      email, // email kept in plaintext for lookup/index
      passwordHash,
      role: UserRole.Customer,
      phone: phone ? encryptField(phone) : undefined,
      stripeCustomerId,
      marketingConsent: marketingConsent || false,
    });

    const accessToken = generateAccessToken({
      userId: user._id.toString(),
      role: user.role,
      email: user.email,
    });
    const refresh = generateRefreshToken();

    // Store refresh token on user record
    await User.findByIdAndUpdate(user._id, {
      $push: { refreshTokens: refresh },
    });

    // COMPLIANCE: Refresh token in httpOnly cookie only (not localStorage)
    res.cookie(REFRESH_COOKIE, refresh.token, COOKIE_OPTS);

    res.status(201).json({
      user: { id: user._id, email: user.email, role: user.role },
      accessToken,
    });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/auth/login
// ────────────────────────────────────────────────────────────────
export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email, isDeleted: false }).select(
      '+passwordHash +mfaEnabled +mfaSecret',
    );
    if (!user) throw new AppError(401, 'Invalid credentials');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AppError(401, 'Invalid credentials');

    // If MFA is enabled, return a temporary token for step 2
    if (user.mfaEnabled) {
      const tempToken = jwt.sign(
        { userId: user._id.toString(), mfaPending: true },
        process.env.JWT_ACCESS_SECRET!,
        { expiresIn: '5m' },
      );
      res.json({ mfaRequired: true, tempToken });
      return;
    }

    // No MFA – issue tokens directly
    const accessToken = generateAccessToken({
      userId: user._id.toString(),
      role: user.role,
      email: user.email,
    });
    const refresh = generateRefreshToken();

    await User.findByIdAndUpdate(user._id, {
      $push: { refreshTokens: refresh },
    });

    res.cookie(REFRESH_COOKIE, refresh.token, COOKIE_OPTS);

    res.json({
      user: { id: user._id, email: user.email, role: user.role },
      accessToken,
    });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/auth/login/mfa
// COMPLIANCE: MFA required for staff/admin (MA 201 CMR 17)
// ────────────────────────────────────────────────────────────────
export async function verifyMfa(req: Request, res: Response, next: NextFunction) {
  try {
    const { tempToken, code } = req.body;

    let decoded: any;
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_ACCESS_SECRET!);
    } catch {
      throw new AppError(401, 'MFA session expired');
    }

    if (!decoded.mfaPending) throw new AppError(400, 'Invalid MFA token');

    const user = await User.findById(decoded.userId).select('+mfaSecret');
    if (!user || !user.mfaSecret) throw new AppError(400, 'MFA not configured');

    const verified = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token: code,
      window: 1,
    });

    if (!verified) throw new AppError(401, 'Invalid MFA code');

    const accessToken = generateAccessToken({
      userId: user._id.toString(),
      role: user.role,
      email: user.email,
    });
    const refresh = generateRefreshToken();

    await User.findByIdAndUpdate(user._id, {
      $push: { refreshTokens: refresh },
    });

    res.cookie(REFRESH_COOKIE, refresh.token, COOKIE_OPTS);

    res.json({
      user: { id: user._id, email: user.email, role: user.role },
      accessToken,
    });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/auth/refresh
// COMPLIANCE: Refresh token rotation – old token invalidated on use
// ────────────────────────────────────────────────────────────────
export async function refreshTokenHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new AppError(401, 'No refresh token');

    const user = await User.findOne({
      'refreshTokens.token': token,
      'refreshTokens.expiresAt': { $gt: new Date() },
      isDeleted: false,
    }).select('+refreshTokens');

    if (!user) throw new AppError(401, 'Invalid refresh token');

    // Rotate: remove old token, add new one
    const newRefresh = generateRefreshToken();
    user.refreshTokens = user.refreshTokens.filter((rt) => rt.token !== token);
    user.refreshTokens.push(newRefresh);
    await user.save();

    const accessToken = generateAccessToken({
      userId: user._id.toString(),
      role: user.role,
      email: user.email,
    });

    res.cookie(REFRESH_COOKIE, newRefresh.token, COOKIE_OPTS);

    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/auth/logout
// ────────────────────────────────────────────────────────────────
export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) {
      await User.updateOne(
        { 'refreshTokens.token': token },
        { $pull: { refreshTokens: { token } } },
      );
    }
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/auth/forgot-password
// ────────────────────────────────────────────────────────────────
export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email, isDeleted: false });

    // Always return success to prevent email enumeration
    if (!user) {
      res.json({ message: 'If that email exists, a reset link has been sent' });
      return;
    }

    const { token, expires } = generatePasswordResetToken();
    user.passwordResetToken = token;
    user.passwordResetExpires = expires;
    await user.save();

    await sendPasswordResetEmail(email, token);
    res.json({ message: 'If that email exists, a reset link has been sent' });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/auth/reset-password
// ────────────────────────────────────────────────────────────────
export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, password } = req.body;

    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetExpires: { $gt: new Date() },
      isDeleted: false,
    }).select('+passwordResetToken +passwordResetExpires');

    if (!user) throw new AppError(400, 'Invalid or expired reset token');

    user.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    // Invalidate all refresh tokens on password change
    user.refreshTokens = [];
    await user.save();

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/auth/mfa/setup (staff/admin – called after first login)
// ────────────────────────────────────────────────────────────────
export async function setupMfa(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Authentication required');

    const secret = speakeasy.generateSecret({
      name: `HonorCleaning:${req.user.email}`,
      issuer: 'Honor Cleaning',
    });

    await User.findByIdAndUpdate(req.user.userId, {
      mfaSecret: secret.base32,
    });

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url!);

    res.json({
      secret: secret.base32,
      qrCode: qrCodeUrl,
    });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/auth/mfa/enable (confirm TOTP code to activate)
// ────────────────────────────────────────────────────────────────
export async function enableMfa(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Authentication required');
    const { code } = req.body;

    const user = await User.findById(req.user.userId).select('+mfaSecret');
    if (!user || !user.mfaSecret) throw new AppError(400, 'MFA not set up');

    const verified = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token: code,
      window: 1,
    });

    if (!verified) throw new AppError(400, 'Invalid code – try again');

    user.mfaEnabled = true;
    await user.save();

    res.json({ message: 'MFA enabled successfully' });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/auth/change-password
// ────────────────────────────────────────────────────────────────
export async function changePassword(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Authentication required');
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.userId).select('+passwordHash');
    if (!user) throw new AppError(404, 'User not found');

    // Google-only users can't change password
    if (!user.passwordHash) {
      throw new AppError(400, 'Account uses Google sign-in. Password cannot be changed.');
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AppError(401, 'Current password is incorrect');

    user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    // Invalidate all other sessions
    user.refreshTokens = [];
    await user.save();

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/auth/google — Sign in or register with Google ID token
// ────────────────────────────────────────────────────────────────
export async function googleAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const { credential } = req.body;
    if (!credential) throw new AppError(400, 'Google credential is required');

    // Verify the Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      throw new AppError(400, 'Invalid Google token');
    }

    const { sub: googleId, email, name, email_verified } = payload;

    if (!email_verified) {
      throw new AppError(400, 'Google email not verified');
    }

    // Check if user already exists (by googleId or email)
    let user = await User.findOne({
      $or: [{ googleId }, { email: email.toLowerCase() }],
      isDeleted: false,
    });

    if (user) {
      // Existing user — link Google account if not already linked
      if (!user.googleId) {
        user.googleId = googleId;
        await user.save();
      }
    } else {
      // New user — create account
      let stripeCustomerId: string | undefined;
      try {
        stripeCustomerId = await createStripeCustomer(email, name || email);
      } catch (err) {
        console.error('[STRIPE] Failed to create customer:', err);
      }

      user = await User.create({
        name: encryptField(name || email.split('@')[0]),
        email: email.toLowerCase(),
        googleId,
        role: UserRole.Customer,
        stripeCustomerId,
        marketingConsent: false,
      });
    }

    // MFA check for staff/admin
    if (user.mfaEnabled && (user.role === UserRole.Staff || user.role === UserRole.Admin)) {
      const tempToken = jwt.sign(
        { userId: user._id.toString(), mfaPending: true },
        process.env.JWT_ACCESS_SECRET!,
        { expiresIn: '5m' },
      );
      res.json({ mfaRequired: true, tempToken });
      return;
    }

    // Issue tokens
    const accessToken = generateAccessToken({
      userId: user._id.toString(),
      role: user.role,
      email: user.email,
    });
    const refresh = generateRefreshToken();

    await User.findByIdAndUpdate(user._id, {
      $push: { refreshTokens: refresh },
    });

    res.cookie(REFRESH_COOKIE, refresh.token, COOKIE_OPTS);

    res.json({
      user: { id: user._id, email: user.email, role: user.role },
      accessToken,
    });
  } catch (err: any) {
    // Handle Google verification errors gracefully
    if (err.message?.includes('Token used too late') || err.message?.includes('Invalid token')) {
      return next(new AppError(401, 'Google sign-in expired. Please try again.'));
    }
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/auth/logout-all — Invalidate all refresh tokens
// ────────────────────────────────────────────────────────────────
export async function logoutAll(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Authentication required');

    await User.findByIdAndUpdate(req.user.userId, {
      $set: { refreshTokens: [] },
    });

    res.clearCookie('refreshToken', { path: '/api/auth' });
    res.json({ message: 'Logged out from all devices' });
  } catch (err) {
    next(err);
  }
}
