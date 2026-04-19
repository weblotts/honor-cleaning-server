import mongoose, { Document, Schema, Types } from 'mongoose';

// ────────────────────────────────────────────────────────────────
// Interface
// ────────────────────────────────────────────────────────────────
export interface IGeoLocation {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

export interface IChecklistItem {
  item: string;
  completed: boolean;
}

export interface IJob {
  bookingId: Types.ObjectId;
  staffId: Types.ObjectId;
  checkInTime?: Date;
  checkOutTime?: Date;
  checkInLocation?: IGeoLocation;
  checkOutLocation?: IGeoLocation;
  checklist: IChecklistItem[];
  photosBefore: string[]; // S3/Cloudinary URLs
  photosAfter: string[];
  staffNotes?: string;
  customerSignOff: boolean;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IJobDocument extends IJob, Document {
  _id: Types.ObjectId;
}

// ────────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────────
const geoLocationSchema = new Schema<IGeoLocation>(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);

const checklistItemSchema = new Schema<IChecklistItem>(
  {
    item: { type: String, required: true },
    completed: { type: Boolean, default: false },
  },
  { _id: false },
);

const jobSchema = new Schema<IJobDocument>(
  {
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      unique: true, // 1:1 relationship with booking
    },
    staffId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    checkInTime: { type: Date },
    checkOutTime: { type: Date },
    checkInLocation: { type: geoLocationSchema },
    checkOutLocation: { type: geoLocationSchema },
    checklist: { type: [checklistItemSchema], default: [] },
    // Photo URLs stored as S3 presigned URL references – actual files in S3
    photosBefore: { type: [String], default: [] },
    photosAfter: { type: [String], default: [] },
    staffNotes: { type: String },
    customerSignOff: { type: Boolean, default: false },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

// Index for staff daily job queue
jobSchema.index({ staffId: 1, createdAt: -1 });
// 2dsphere index for geo queries if needed
jobSchema.index({ 'checkInLocation': '2dsphere' });

export const Job = mongoose.model<IJobDocument>('Job', jobSchema);
