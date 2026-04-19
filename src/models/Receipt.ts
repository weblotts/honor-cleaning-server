import mongoose, { Document, Schema, Types } from 'mongoose';

// ────────────────────────────────────────────────────────────────
// Receipt — auto-generated when an Invoice is paid.
// Chain: Booking → Quotation → Invoice → Receipt
// ────────────────────────────────────────────────────────────────

export interface IReceiptLineItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
}

export interface IReceipt {
  receiptNumber: string;
  invoiceId: Types.ObjectId;
  quotationId?: Types.ObjectId;
  bookingId?: Types.ObjectId;
  customerId: Types.ObjectId;
  lineItems: IReceiptLineItem[];
  subtotalCents: number;
  taxRate: number;
  taxAmountCents: number;
  totalAmountCents: number;
  tipAmountCents: number;
  paymentMethod: string;
  stripePaymentIntentId?: string;
  chequePaymentId?: Types.ObjectId;
  pdfUrl?: string;
  paidAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IReceiptDocument extends IReceipt, Document {
  _id: Types.ObjectId;
}

// ────────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────────
const receiptLineItemSchema = new Schema<IReceiptLineItem>(
  {
    description: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1, min: 1 },
    unitPriceCents: { type: Number, required: true },
    amountCents: { type: Number, required: true },
  },
  { _id: false },
);

const receiptSchema = new Schema<IReceiptDocument>(
  {
    receiptNumber: { type: String, required: true, unique: true },
    invoiceId: {
      type: Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
      index: true,
    },
    quotationId: {
      type: Schema.Types.ObjectId,
      ref: 'Quotation',
      index: true,
    },
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      index: true,
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    lineItems: { type: [receiptLineItemSchema], required: true },
    subtotalCents: { type: Number, required: true },
    taxRate: { type: Number, required: true },
    taxAmountCents: { type: Number, required: true },
    totalAmountCents: { type: Number, required: true },
    tipAmountCents: { type: Number, default: 0 },
    paymentMethod: { type: String, required: true, default: 'card' },
    // Stripe reference only – never raw card data (PCI / MA 201 CMR 17)
    stripePaymentIntentId: { type: String },
    chequePaymentId: { type: Schema.Types.ObjectId, ref: 'ChequePayment' },
    pdfUrl: { type: String },
    paidAt: { type: Date, required: true },
  },
  { timestamps: true },
);

receiptSchema.index({ customerId: 1, createdAt: -1 });

export const Receipt = mongoose.model<IReceiptDocument>('Receipt', receiptSchema);
