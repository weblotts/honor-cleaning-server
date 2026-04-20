import mongoose, { Document, Schema, Types } from 'mongoose';

// ────────────────────────────────────────────────────────────────
// TypeScript Interface
// ────────────────────────────────────────────────────────────────
export enum UserRole {
  Customer = 'customer',
  Staff = 'staff',
  Admin = 'admin',
}

export interface IRefreshToken {
  token: string;
  expiresAt: Date;
}

export interface IAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface IUser {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  // Google OAuth
  googleId?: string;
  phone?: string;
  address?: IAddress;
  // Stripe – only for customers; holds Stripe Customer object ID
  stripeCustomerId?: string;
  // MFA – required for staff/admin, stored encrypted at rest
  mfaSecret?: string;
  mfaEnabled: boolean;
  // Refresh-token rotation list (MA 201 CMR 17 – session security)
  refreshTokens: IRefreshToken[];
  // Marketing consent – GDPR/MA compliance: explicit opt-in
  marketingConsent: boolean;
  // Soft-delete support for data retention policy (3-year inactive purge)
  isDeleted: boolean;
  deletedAt?: Date;
  // Password reset
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserDocument extends IUser, Document {
  _id: Types.ObjectId;
}

// ────────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────────
const addressSchema = new Schema<IAddress>(
  {
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true, default: 'MA' },
    zip: { type: String, required: true },
  },
  { _id: false },
);

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    token: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { _id: false },
);

const userSchema = new Schema<IUserDocument>(
  {
    name: { type: String, required: true },
    // Unique + indexed for fast lookups and to prevent duplicate accounts
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
    passwordHash: { type: String, select: false }, // Not required for Google OAuth users
    googleId: { type: String, sparse: true, index: true },
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.Customer,
      index: true,
    },
    phone: { type: String },
    address: { type: addressSchema },
    stripeCustomerId: { type: String },
    // MFA fields – select: false so they're never accidentally leaked in queries
    mfaSecret: { type: String, select: false },
    mfaEnabled: { type: Boolean, default: false },
    refreshTokens: { type: [refreshTokenSchema], default: [], select: false },
    marketingConsent: { type: Boolean, default: false },
    // Soft-delete (MA data retention: 3-year inactive purge)
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
  },
  {
    timestamps: true,
    // Strip internal fields from JSON responses
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret['passwordHash'];
        delete ret['mfaSecret'];
        delete ret['refreshTokens'];
        delete ret['__v'];
        return ret;
      },
    },
  },
);

// Compound index for soft-delete queries
userSchema.index({ isDeleted: 1, updatedAt: 1 });

export const User = mongoose.model<IUserDocument>('User', userSchema);
