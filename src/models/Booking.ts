import mongoose, { Document, Schema, Types } from 'mongoose';

// ────────────────────────────────────────────────────────────────
// Enums & Interface
// ────────────────────────────────────────────────────────────────
export enum ServiceType {
  Standard = 'standard',
  Deep = 'deep',
  MoveIn = 'moveIn',
  MoveOut = 'moveOut',
  Office = 'office',
  Recurring = 'recurring',
  Medical = 'medical',
  Retail = 'retail',
  Industrial = 'industrial',
  PostConstruction = 'postConstruction',
}

export enum BookingStatus {
  PendingQuote = 'pending_quote',
  Quoted = 'quoted',
  Approved = 'approved',
  Pending = 'pending',
  Confirmed = 'confirmed',
  InProgress = 'inProgress',
  Completed = 'completed',
  Cancelled = 'cancelled',
}

export interface IBookingAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface IBooking {
  bookingNumber: string;
  customerId: Types.ObjectId;
  staffId?: Types.ObjectId;
  serviceType: ServiceType;
  scheduledDate: Date;
  scheduledTime: string; // e.g. "09:00"
  durationEstimate: number; // minutes
  address: IBookingAddress;
  status: BookingStatus;
  // Stripe – we NEVER store raw card data (MA 201 CMR 17 / PCI compliance)
  stripePaymentIntentId?: string;
  amountCents: number;
  tipAmountCents: number;
  notes?: string;
  cancellationReason?: string;
  propertyDetails?: {
    bedrooms?: number;
    bathrooms?: number;
    floors?: number;
    workstations?: number;
    restrooms?: number;
    squareFootage?: number;
    condition: 'normal' | 'heavy' | 'extreme';
  };
  subscriptionId?: Types.ObjectId;
  quotedAmountCents?: number;
  quotedAt?: Date;
  quotedBy?: Types.ObjectId;
  quoteNotes?: string;
  customerApprovedAt?: Date;
  customerDeclinedAt?: Date;
  declineReason?: string;
  reminderSentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IBookingDocument extends IBooking, Document {
  _id: Types.ObjectId;
}

// ────────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────────
const bookingAddressSchema = new Schema<IBookingAddress>(
  {
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true, default: 'MA' },
    zip: { type: String, required: true },
  },
  { _id: false },
);

const propertyDetailsSchema = new Schema(
  {
    // Residential
    bedrooms: { type: Number, min: 0 },
    bathrooms: { type: Number, min: 0 },
    // Office
    floors: { type: Number, min: 1 },
    workstations: { type: Number, min: 1 },
    restrooms: { type: Number, min: 0 },
    // Shared
    squareFootage: { type: Number, min: 0 },
    condition: { type: String, enum: ['normal', 'heavy', 'extreme'], default: 'normal' },
  },
  { _id: false },
);

const bookingSchema = new Schema<IBookingDocument>(
  {
    bookingNumber: { type: String, unique: true },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    staffId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    serviceType: {
      type: String,
      enum: Object.values(ServiceType),
      required: true,
    },
    scheduledDate: { type: Date, required: true, index: true },
    scheduledTime: { type: String, required: true },
    durationEstimate: { type: Number, required: true, default: 120 },
    address: { type: bookingAddressSchema, required: true },
    status: {
      type: String,
      enum: Object.values(BookingStatus),
      default: BookingStatus.Pending,
      index: true,
    },
    // PaymentIntent ID only – never raw card numbers
    stripePaymentIntentId: { type: String },
    amountCents: { type: Number, required: true },
    tipAmountCents: { type: Number, default: 0 },
    notes: { type: String },
    cancellationReason: { type: String },
    propertyDetails: { type: propertyDetailsSchema },
    subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription', default: null, index: true },
    quotedAmountCents: { type: Number },
    quotedAt: { type: Date },
    quotedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    quoteNotes: { type: String },
    customerApprovedAt: { type: Date },
    customerDeclinedAt: { type: Date },
    declineReason: { type: String },
    reminderSentAt: { type: Date },
  },
  { timestamps: true },
);

// Compound index for staff schedule queries
bookingSchema.index({ staffId: 1, scheduledDate: 1 });
// Compound index for customer booking history
bookingSchema.index({ customerId: 1, status: 1 });

export const Booking = mongoose.model<IBookingDocument>('Booking', bookingSchema);
