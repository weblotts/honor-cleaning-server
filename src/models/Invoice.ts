import mongoose, { Document, Schema, Types } from 'mongoose';

// ────────────────────────────────────────────────────────────────
// Enums & Interface
// ────────────────────────────────────────────────────────────────
export enum InvoiceStatus {
  Draft = 'draft',
  Sent = 'sent',
  Paid = 'paid',
  PartiallyRefunded = 'partially_refunded',
  Refunded = 'refunded',
}

export enum RefundType {
  Full = 'full',
  Partial = 'partial',
  None = 'none',
}

export interface IRefundDetails {
  type: RefundType;
  refundAmountCents: number;
  reason: string;
  policyApplied: string; // e.g. '48h_full', '24h_partial', 'admin_override'
  refundedAt: Date;
  refundedBy: Types.ObjectId;
}

export interface ILineItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
}

export interface IInvoice {
  invoiceNumber: string;
  bookingId?: Types.ObjectId;
  quotationId?: Types.ObjectId;
  customerId: Types.ObjectId;
  lineItems: ILineItem[];
  subtotalCents: number;
  taxRate: number; // e.g. 6.25 for Massachusetts
  taxAmountCents: number;
  totalAmountCents: number;
  tipAmountCents: number;
  status: InvoiceStatus;
  paymentMethod: 'stripe' | 'cheque';
  notes?: string;
  dueDate: Date;
  // Stripe – we NEVER store raw card data (PCI / MA 201 CMR 17)
  stripeInvoiceId?: string;
  stripePaymentIntentId?: string;
  chequePaymentId?: Types.ObjectId;
  pdfUrl?: string;
  sentAt?: Date;
  paidAt?: Date;
  refundDetails?: IRefundDetails;
  createdAt: Date;
  updatedAt: Date;
}

export interface IInvoiceDocument extends IInvoice, Document {
  _id: Types.ObjectId;
}

// ────────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────────
const lineItemSchema = new Schema<ILineItem>(
  {
    description: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1, min: 1 },
    unitPriceCents: { type: Number, required: true },
    amountCents: { type: Number, required: true },
  },
  { _id: false },
);

const invoiceSchema = new Schema<IInvoiceDocument>(
  {
    invoiceNumber: { type: String, required: true, unique: true },
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      index: true,
    },
    quotationId: {
      type: Schema.Types.ObjectId,
      ref: 'Quotation',
      index: true,
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    lineItems: { type: [lineItemSchema], required: true },
    subtotalCents: { type: Number, required: true },
    taxRate: { type: Number, required: true, default: 6.25 },
    taxAmountCents: { type: Number, required: true },
    totalAmountCents: { type: Number, required: true },
    tipAmountCents: { type: Number, default: 0 },
    status: {
      type: String,
      enum: Object.values(InvoiceStatus),
      default: InvoiceStatus.Draft,
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ['stripe', 'cheque'],
      default: 'stripe',
    },
    notes: { type: String },
    dueDate: { type: Date, required: true },
    // Stripe Invoice ID – we never store raw card data (PCI / MA 201 CMR 17)
    stripeInvoiceId: { type: String },
    stripePaymentIntentId: { type: String },
    chequePaymentId: {
      type: Schema.Types.ObjectId,
      ref: 'ChequePayment',
    },
    pdfUrl: { type: String },
    sentAt: { type: Date },
    paidAt: { type: Date },
    refundDetails: {
      type: new Schema(
        {
          type: { type: String, enum: Object.values(RefundType), required: true },
          refundAmountCents: { type: Number, required: true },
          reason: { type: String, required: true },
          policyApplied: { type: String, required: true },
          refundedAt: { type: Date, required: true },
          refundedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        },
        { _id: false },
      ),
    },
  },
  { timestamps: true },
);

invoiceSchema.index({ customerId: 1, status: 1 });

export const Invoice = mongoose.model<IInvoiceDocument>('Invoice', invoiceSchema);
