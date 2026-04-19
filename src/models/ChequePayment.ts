import mongoose, { Document, Schema, Types } from 'mongoose';

// ────────────────────────────────────────────────────────────────
// Cheque Payment — tracks the lifecycle of a physical cheque
// received → deposited → cleared | bounced
// ────────────────────────────────────────────────────────────────

export enum ChequeStatus {
  Received = 'received',
  Deposited = 'deposited',
  Cleared = 'cleared',
  Bounced = 'bounced',
}

export interface IChequePayment {
  invoiceId: Types.ObjectId;
  chequeNumber: string;
  bankName: string;
  drawerName: string; // name printed on the cheque
  amountCents: number;
  dateOnCheque: Date;
  dateReceived: Date;
  dateDeposited?: Date;
  dateCleared?: Date;
  dateBounced?: Date;
  status: ChequeStatus;
  bounceReason?: string;
  notes?: string;
  recordedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IChequePaymentDocument extends IChequePayment, Document {
  _id: Types.ObjectId;
}

const chequePaymentSchema = new Schema<IChequePaymentDocument>(
  {
    invoiceId: {
      type: Schema.Types.ObjectId,
      ref: 'Invoice',
      required: true,
      index: true,
    },
    chequeNumber: { type: String, required: true },
    bankName: { type: String, required: true },
    drawerName: { type: String, required: true },
    amountCents: { type: Number, required: true },
    dateOnCheque: { type: Date, required: true },
    dateReceived: { type: Date, required: true },
    dateDeposited: { type: Date },
    dateCleared: { type: Date },
    dateBounced: { type: Date },
    status: {
      type: String,
      enum: Object.values(ChequeStatus),
      default: ChequeStatus.Received,
      index: true,
    },
    bounceReason: { type: String },
    notes: { type: String },
    recordedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true },
);

chequePaymentSchema.index({ invoiceId: 1, status: 1 });

export const ChequePayment = mongoose.model<IChequePaymentDocument>(
  'ChequePayment',
  chequePaymentSchema,
);
