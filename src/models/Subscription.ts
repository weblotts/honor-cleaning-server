import mongoose, { Document, Schema, Types } from 'mongoose';

// ────────────────────────────────────────────────────────────────
// Enums & Interface
// ────────────────────────────────────────────────────────────────
export enum SubscriptionFrequency {
  Weekly = 'weekly',
  Biweekly = 'biweekly',
  Monthly = 'monthly',
}

export enum SubscriptionStatus {
  Active = 'active',
  Paused = 'paused',
  Cancelled = 'cancelled',
}

export interface ISubscription {
  customerId: Types.ObjectId;
  frequency: SubscriptionFrequency;
  serviceType: string;
  preferredDay: string; // e.g. "monday"
  preferredTime: string; // e.g. "09:00"
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  amountCents: number;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  status: SubscriptionStatus;
  nextScheduledDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISubscriptionDocument extends ISubscription, Document {
  _id: Types.ObjectId;
}

// ────────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────────
const subscriptionSchema = new Schema<ISubscriptionDocument>(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    frequency: {
      type: String,
      enum: Object.values(SubscriptionFrequency),
      required: true,
    },
    serviceType: { type: String, required: true },
    preferredDay: { type: String, required: true },
    preferredTime: { type: String, required: true },
    address: {
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true, default: 'MA' },
      zip: { type: String, required: true },
    },
    amountCents: { type: Number, required: true },
    // Stripe references – we only store IDs, never raw card data
    stripeSubscriptionId: { type: String },
    stripePriceId: { type: String },
    status: {
      type: String,
      enum: Object.values(SubscriptionStatus),
      default: SubscriptionStatus.Active,
      index: true,
    },
    nextScheduledDate: { type: Date },
  },
  { timestamps: true },
);

export const Subscription = mongoose.model<ISubscriptionDocument>(
  'Subscription',
  subscriptionSchema,
);
