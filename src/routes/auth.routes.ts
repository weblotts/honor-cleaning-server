import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  registerSchema,
  loginSchema,
  mfaVerifySchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../utils/validators';
import {
  register,
  login,
  verifyMfa,
  refreshTokenHandler,
  logout,
  forgotPassword,
  resetPassword,
  setupMfa,
  enableMfa,
  googleAuth,
  changePassword,
  logoutAll,
} from '../controllers/auth.controller';

const router = Router();

// COMPLIANCE: Rate limiting on auth endpoints (10 req/15min per IP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/register', authLimiter, validate(registerSchema), register);
router.post('/login', authLimiter, validate(loginSchema), login);
router.post('/login/mfa', authLimiter, validate(mfaVerifySchema), verifyMfa);
router.post('/google', authLimiter, googleAuth);
router.post('/refresh', refreshTokenHandler);
router.post('/logout', logout);
router.post('/logout-all', requireAuth, logoutAll);
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), resetPassword);

// MFA setup routes (authenticated)
router.post('/mfa/setup', requireAuth, setupMfa);
router.post('/mfa/enable', requireAuth, enableMfa);

// Password change (authenticated)
router.post('/change-password', requireAuth, changePassword);

export default router;
