import mongoose, { Document, Schema, Types } from 'mongoose';

// ────────────────────────────────────────────────────────────────
// COMPLIANCE: MA 201 CMR 17.00 – Audit Logging
// This collection is append-only. No application-level delete
// operations are exposed. Records must be retained indefinitely
// for compliance and incident forensics.
// ────────────────────────────────────────────────────────────────

export interface IAuditLog {
  actorId: Types.ObjectId;
  actorRole: string;
  action: string; // e.g. "booking.create", "user.delete", "invoice.refund"
  targetCollection: string;
  targetId?: Types.ObjectId;
  changedFields?: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
}

export interface IAuditLogDocument extends IAuditLog, Document {
  _id: Types.ObjectId;
}

const auditLogSchema = new Schema<IAuditLogDocument>(
  {
    actorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    actorRole: { type: String, required: true },
    action: { type: String, required: true, index: true },
    targetCollection: { type: String, required: true },
    targetId: { type: Schema.Types.ObjectId },
    changedFields: { type: Schema.Types.Mixed },
    ipAddress: { type: String, required: true },
    userAgent: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  {
    // No updatedAt – audit logs are immutable
    timestamps: false,
    // Prevent accidental modifications
    strict: true,
  },
);

// Compound index for admin audit log queries (filter by date range + action)
auditLogSchema.index({ timestamp: -1, action: 1 });

// COMPLIANCE: Remove deleteOne/deleteMany at the model level to prevent
// accidental or malicious deletion of audit records.
auditLogSchema.pre('deleteOne', function () {
  throw new Error('Audit logs cannot be deleted (MA 201 CMR 17 compliance)');
});
auditLogSchema.pre('deleteMany', function () {
  throw new Error('Audit logs cannot be deleted (MA 201 CMR 17 compliance)');
});
auditLogSchema.pre('findOneAndDelete', function () {
  throw new Error('Audit logs cannot be deleted (MA 201 CMR 17 compliance)');
});

export const AuditLog = mongoose.model<IAuditLogDocument>('AuditLog', auditLogSchema);
