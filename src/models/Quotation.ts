import mongoose, { Document, Schema, Types } from 'mongoose';

// ────────────────────────────────────────────────────────────────
// Enums & Interface
// ────────────────────────────────────────────────────────────────
export enum QuotationStatus {
  Draft = 'draft',
  Sent = 'sent',
  Accepted = 'accepted',
  Declined = 'declined',
  Expired = 'expired',
}

export interface IQuotationLineItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
}

export interface IQuotation {
  quotationNumber: string;
  bookingId: Types.ObjectId;
  customerId: Types.ObjectId;
  lineItems: IQuotationLineItem[];
  subtotalCents: number;
  taxRate: number; // e.g. 6.25
  taxAmountCents: number;
  totalAmountCents: number;
  status: QuotationStatus;
  notes?: string;
  validUntil: Date;
  sentAt?: Date;
  acceptedAt?: Date;
  declinedAt?: Date;
  declineReason?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IQuotationDocument extends IQuotation, Document {
  _id: Types.ObjectId;
}

// ────────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────────
const quotationLineItemSchema = new Schema<IQuotationLineItem>(
  {
    description: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1, min: 1 },
    unitPriceCents: { type: Number, required: true },
    amountCents: { type: Number, required: true },
  },
  { _id: false },
);

const quotationSchema = new Schema<IQuotationDocument>(
  {
    quotationNumber: { type: String, required: true, unique: true },
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    lineItems: { type: [quotationLineItemSchema], required: true },
    subtotalCents: { type: Number, required: true },
    taxRate: { type: Number, required: true, default: 6.25 },
    taxAmountCents: { type: Number, required: true },
    totalAmountCents: { type: Number, required: true },
    status: {
      type: String,
      enum: Object.values(QuotationStatus),
      default: QuotationStatus.Draft,
      index: true,
    },
    notes: { type: String },
    validUntil: { type: Date, required: true },
    sentAt: { type: Date },
    acceptedAt: { type: Date },
    declinedAt: { type: Date },
    declineReason: { type: String },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true },
);

quotationSchema.index({ customerId: 1, status: 1 });

export const Quotation = mongoose.model<IQuotationDocument>('Quotation', quotationSchema);
