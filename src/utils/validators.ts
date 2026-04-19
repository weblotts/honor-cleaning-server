import { z } from 'zod';
import { ServiceType } from '../models/Booking';
import { SubscriptionFrequency } from '../models/Subscription';

// ────────────────────────────────────────────────────────────────
// Zod validation schemas for all request bodies
// ────────────────────────────────────────────────────────────────

export const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z
    .string()
    .min(8)
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain uppercase, lowercase, and a number',
    ),
  phone: z.string().optional(),
  marketingConsent: z.boolean().optional().default(false),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const mfaVerifySchema = z.object({
  tempToken: z.string(),
  code: z.string().length(6),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string(),
  password: z
    .string()
    .min(8)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
});

const addressSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().default('MA'),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/, 'Invalid zip code'),
});

const propertyDetailsSchema = z.object({
  // Residential fields
  bedrooms: z.number().min(0).max(20).optional(),
  bathrooms: z.number().min(0).max(15).optional(),
  // Office fields
  floors: z.number().min(1).max(50).optional(),
  workstations: z.number().min(1).max(500).optional(),
  restrooms: z.number().min(0).max(50).optional(),
  // Shared fields
  squareFootage: z.number().min(100).max(200000).optional(),
  condition: z.enum(['normal', 'heavy', 'extreme']).default('normal'),
});

export const createBookingSchema = z.object({
  serviceType: z.nativeEnum(ServiceType),
  scheduledDate: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid date'),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM'),
  address: addressSchema,
  propertyDetails: propertyDetailsSchema,
  notes: z.string().optional(),
  durationEstimate: z.number().min(30).max(480).optional(),
  marketingConsent: z.boolean().optional(),
});

export const rescheduleSchema = z.object({
  scheduledDate: z.string().refine((d) => !isNaN(Date.parse(d))),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/),
});

export const cancelBookingSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const assignStaffSchema = z.object({
  staffId: z.string().length(24),
});

export const updateBookingStatusSchema = z.object({
  status: z.enum([
    'pending_quote',
    'quoted',
    'approved',
    'pending',
    'confirmed',
    'inProgress',
    'completed',
    'cancelled',
  ]),
});

export const checkinSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const checklistUpdateSchema = z.object({
  index: z.number().min(0),
  completed: z.boolean(),
});

export const createSubscriptionSchema = z.object({
  frequency: z.nativeEnum(SubscriptionFrequency),
  serviceType: z.string().min(1),
  preferredDay: z.enum([
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ]),
  preferredTime: z.string().regex(/^\d{2}:\d{2}$/),
  address: addressSchema,
});

export const submitQuoteSchema = z.object({
  quotedAmountCents: z.number().min(1200),
  quoteNotes: z.string().max(1000).optional(),
});

export const respondToQuoteSchema = z.object({
  approved: z.boolean(),
  declineReason: z.string().min(1).max(500).optional(),
}).refine(
  (data) => data.approved || !!data.declineReason,
  { message: 'Decline reason is required when declining a quote' },
);

export const createInvoiceSchema = z.object({
  customerId: z.string().length(24),
  bookingId: z.string().length(24).optional(),
  quotationId: z.string().length(24).optional(),
  lineItems: z.array(z.object({
    description: z.string().min(1).max(200),
    quantity: z.number().min(1).max(1000).optional().default(1),
    unitPriceCents: z.number().min(1),
  })).min(1),
  taxRate: z.number().min(0).max(100).optional(),
  paymentMethod: z.enum(['stripe', 'cheque']).optional().default('stripe'),
  notes: z.string().max(1000).optional(),
  dueDate: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid date'),
});

export const createQuotationSchema = z.object({
  customerId: z.string().length(24),
  bookingId: z.string().length(24),
  lineItems: z.array(z.object({
    description: z.string().min(1).max(200),
    quantity: z.number().min(1).max(1000).optional().default(1),
    unitPriceCents: z.number().min(1),
  })).min(1),
  taxRate: z.number().min(0).max(100).optional(),
  notes: z.string().max(1000).optional(),
  validUntil: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid date'),
});

export const respondToQuotationSchema = z.object({
  accepted: z.boolean(),
  declineReason: z.string().min(1).max(500).optional(),
}).refine(
  (data) => data.accepted || !!data.declineReason,
  { message: 'Decline reason is required when declining' },
);

export const staffAvailabilitySchema = z.object({
  availability: z.record(
    z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
    z.object({
      available: z.boolean(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
    }),
  ),
});

export const staffTerritoriesSchema = z.object({
  zipCodes: z.array(z.string().regex(/^\d{5}$/)),
});

export const requestFeedbackSchema = z.object({
  bookingNumber: z.string().min(1).max(20),
});

export const submitFeedbackSchema = z.object({
  rating: z.number().min(1).max(5),
  comment: z.string().min(5).max(2000),
  customerRole: z.string().max(100).optional(),
  customerLocation: z.string().max(100).optional(),
});
