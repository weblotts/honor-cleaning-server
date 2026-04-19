import { Request, Response, NextFunction } from 'express';
import { AuditLog } from '../models/AuditLog';

// ────────────────────────────────────────────────────────────────
// COMPLIANCE: MA 201 CMR 17.00 – Audit Logging Middleware
// Automatically logs all mutating requests (POST, PATCH, PUT, DELETE).
// Captures actor identity, action, target, IP, and user agent.
// ────────────────────────────────────────────────────────────────

/**
 * Create an audit log entry. Call this from controllers after
 * a successful mutation to capture what changed.
 */
export async function createAuditEntry(params: {
  actorId: string;
  actorRole: string;
  action: string;
  targetCollection: string;
  targetId?: string;
  changedFields?: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
}): Promise<void> {
  try {
    await AuditLog.create({
      ...params,
      timestamp: new Date(),
    });
  } catch (err) {
    // Log audit failures but don't block the request.
    // In production, this should also alert ops via monitoring.
    console.error('[AUDIT] Failed to write audit log:', err);
  }
}

/**
 * Express middleware that attaches an audit helper to the request.
 * Controllers can call req.audit(action, targetCollection, targetId, changedFields)
 */
declare global {
  namespace Express {
    interface Request {
      audit: (
        action: string,
        targetCollection: string,
        targetId?: string,
        changedFields?: Record<string, unknown>,
      ) => Promise<void>;
    }
  }
}

export function auditMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.audit = async (action, targetCollection, targetId?, changedFields?) => {
    if (!req.user) return;
    await createAuditEntry({
      actorId: req.user.userId,
      actorRole: req.user.role,
      action,
      targetCollection,
      targetId,
      changedFields,
      ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
      userAgent: req.get('user-agent') || '',
    });
  };
  next();
}
