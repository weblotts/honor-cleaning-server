import mongoose, { Document, Schema, Types } from 'mongoose';

// ────────────────────────────────────────────────────────────────
// Enums & Interface
// ────────────────────────────────────────────────────────────────

export interface IFeedback {
  bookingId: Types.ObjectId;
  customerId: Types.ObjectId;
  token: string;
  rating: number;
  comment: string;
  customerName: string;
  customerRole?: string;
  customerLocation?: string;
  serviceType: string;
  isPublic: boolean;
  submittedAt?: Date;
  requestedAt: Date;
  requestedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IFeedbackDocument extends IFeedback, Document {}

// ────────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────────

const feedbackSchema = new Schema<IFeedbackDocument>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    token: { type: String, required: true, unique: true, index: true },
    rating: { type: Number, min: 1, max: 5 },
    comment: { type: String, maxlength: 2000 },
    customerName: { type: String, required: true },
    customerRole: { type: String },
    customerLocation: { type: String },
    serviceType: { type: String, required: true },
    isPublic: { type: Boolean, default: false },
    submittedAt: { type: Date },
    requestedAt: { type: Date, default: Date.now },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

feedbackSchema.index({ customerId: 1, bookingId: 1 });
feedbackSchema.index({ isPublic: 1, submittedAt: -1 });

export const Feedback = mongoose.model<IFeedbackDocument>('Feedback', feedbackSchema);
