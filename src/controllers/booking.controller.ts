import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { Booking, BookingStatus } from '../models/Booking';
import { Job } from '../models/Job';
import { User, UserRole } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import { createPaymentIntent } from '../services/stripe';
import {
  sendBookingConfirmation,
  sendQuoteReady,
  sendQuoteApprovedEmail,
  sendBookingConfirmedEmail,
  sendBookingCancelledEmail,
} from '../services/email';
import { decryptField } from '../utils/encryption';
import { buildBookingCalendarEvent, buildIcsContent } from '../utils/calendar';

/**
 * Decrypt populated user PII fields (name, phone) on a booking document.
 * Populated refs come back as objects with encrypted name/phone.
 */
function decryptPopulatedUser(user: any): any {
  if (!user || typeof user !== 'object' || !user.name) return user;
  try {
    return {
      ...user.toJSON ? user.toJSON() : user,
      name: decryptField(user.name),
      phone: user.phone ? decryptField(user.phone) : undefined,
    };
  } catch {
    return user.toJSON ? user.toJSON() : user;
  }
}

function decryptBooking(booking: any): any {
  const obj = booking.toJSON ? booking.toJSON() : { ...booking };
  if (obj.customerId && typeof obj.customerId === 'object') {
    obj.customerId = decryptPopulatedUser(obj.customerId);
  }
  if (obj.staffId && typeof obj.staffId === 'object') {
    obj.staffId = decryptPopulatedUser(obj.staffId);
  }
  return obj;
}

// Service pricing in cents (residential fixed; commercial requires a custom quote)
const PRICING: Record<string, number> = {
  standard: 15000,        // $150
  deep: 25000,            // $250
  moveIn: 30000,          // $300
  moveOut: 30000,         // $300
  recurring: 12000,       // $120
  office: 0,              // quoted
  retail: 0,              // quoted
  medical: 0,             // quoted
  industrial: 0,          // quoted
  postConstruction: 0,    // quoted
};


// Default checklists by service type
const CHECKLISTS: Record<string, string[]> = {
  // ── Residential ──
  standard: [
    'Vacuum all floors & rugs',
    'Mop hard floors',
    'Clean & sanitize bathrooms',
    'Wipe kitchen counters & exterior appliances',
    'Dust all surfaces & furniture',
    'Empty all trash bins',
    'Clean mirrors & glass',
  ],
  deep: [
    'Vacuum all floors & rugs',
    'Mop hard floors',
    'Deep clean bathrooms (scrub grout, toilet base)',
    'Deep clean kitchen (inside oven, fridge & microwave)',
    'Clean inside cabinets & drawers',
    'Wash interior windows & window sills',
    'Dust blinds, fans & light fixtures',
    'Wipe baseboards & door frames',
    'Sanitize light switches & door handles',
    'Clean mirrors & glass',
  ],
  moveIn: [
    'Full deep clean all rooms',
    'Clean inside all cabinets & closets',
    'Clean inside all appliances',
    'Wash all interior windows',
    'Wipe walls & baseboards',
    'Sanitize all surfaces & fixtures',
    'Vacuum & mop all floors',
  ],
  moveOut: [
    'Full deep clean all rooms',
    'Clean inside all cabinets & closets',
    'Clean inside all appliances',
    'Wash all interior windows',
    'Wipe walls & baseboards',
    'Remove all debris & trash',
    'Vacuum & mop all floors',
    'Final walkthrough inspection',
  ],
  // ── Commercial ──
  office: [
    'Vacuum all floors & carpets',
    'Mop hard floors',
    'Clean & sanitize restrooms',
    'Wipe desks, tables & workstations',
    'Clean break room & kitchen area',
    'Empty all trash & recycling bins',
    'Dust surfaces, vents & blinds',
    'Clean glass doors & partitions',
    'Sanitize high-touch areas (handles, switches)',
  ],
  retail: [
    'Sweep & mop sales floor',
    'Vacuum carpeted areas',
    'Clean & polish front entrance & glass doors',
    'Dust display fixtures & shelving',
    'Clean fitting rooms',
    'Sanitize checkout counters & payment terminals',
    'Clean & sanitize restrooms',
    'Empty all trash bins',
    'Clean back-of-house / stockroom floors',
  ],
  medical: [
    'Clean & disinfect exam rooms (EPA-approved products)',
    'Sanitize high-touch surfaces (handles, switches, rails)',
    'Clean & disinfect restrooms',
    'Vacuum & mop all floors',
    'Wipe waiting area chairs & tables',
    'Clean reception desk & counters',
    'Empty & sanitize all trash receptacles',
    'Clean interior glass & mirrors',
  ],
  industrial: [
    'Sweep & scrub warehouse floor',
    'Clean loading dock areas',
    'Remove dust & debris from equipment areas',
    'Empty all industrial waste bins',
    'Clean staff restrooms & break rooms',
    'Wipe down workbenches & surfaces',
    'Clean interior windows & skylights (if accessible)',
  ],
  postConstruction: [
    'Remove all construction debris & dust',
    'Deep clean all floors (scrub & mop)',
    'Wipe all surfaces, ledges & windowsills',
    'Clean interior glass & windows',
    'Clean & sanitize restrooms',
    'Vacuum all vents & air returns',
    'Final detail wipe of all fixtures',
  ],
  recurring: [
    'Vacuum all floors',
    'Mop hard floors',
    'Clean bathrooms',
    'Clean kitchen surfaces',
    'Dust all surfaces',
    'Empty trash',
  ],
};

async function generateBookingNumber(): Promise<string> {
  const count = await Booking.countDocuments();
  const num = (count + 1).toString().padStart(5, '0');
  return `BK-${num}`;
}

// ────────────────────────────────────────────────────────────────
// POST /api/bookings
// ────────────────────────────────────────────────────────────────
export async function createBooking(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const { serviceType, scheduledDate, scheduledTime, address, notes, durationEstimate, propertyDetails } =
      req.body;

    const bookingNumber = await generateBookingNumber();

    const booking = await Booking.create({
      bookingNumber,
      customerId: req.user.userId,
      serviceType,
      scheduledDate: new Date(scheduledDate),
      scheduledTime,
      durationEstimate: durationEstimate || 120,
      address,
      propertyDetails,
      amountCents: 0,
      status: BookingStatus.PendingQuote,
      notes,
    });

    await req.audit('booking.create', 'Booking', booking._id.toString());

    // Build calendar links for the confirmation email
    const { googleCalendarUrl } = buildBookingCalendarEvent({
      serviceType,
      scheduledDate: new Date(scheduledDate),
      scheduledTime,
      durationEstimate: durationEstimate || 120,
      address,
      bookingNumber,
    });
    const icsDownloadUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/api/bookings/${booking._id}/calendar.ics`;

    // Send booking confirmation email
    try {
      await sendBookingConfirmation(req.user.email, {
        serviceType,
        scheduledDate,
        scheduledTime,
        googleCalendarUrl,
        icsDownloadUrl,
      });
    } catch (emailErr) {
      console.error('[EMAIL] Failed to send booking confirmation:', emailErr);
    }

    res.status(201).json({ booking, message: 'Quote request received. We\'ll be in touch within 24 hours.' });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// GET /api/bookings
// ────────────────────────────────────────────────────────────────
export async function listBookings(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    let filter: any = {};

    // COMPLIANCE: Customers can only see their own bookings
    if (req.user.role === UserRole.Customer) {
      filter.customerId = req.user.userId;
    } else if (req.user.role === UserRole.Staff) {
      filter.staffId = req.user.userId;
    }
    // Admins see all

    if (req.query.status) filter.status = req.query.status;
    if (req.query.serviceType) filter.serviceType = req.query.serviceType;

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('customerId', 'name email')
        .populate('staffId', 'name email'),
      Booking.countDocuments(filter),
    ]);

    res.json({ bookings: bookings.map(decryptBooking), total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// GET /api/bookings/:id
// ────────────────────────────────────────────────────────────────
export async function getBooking(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const booking = await Booking.findById(req.params.id)
      .populate('customerId', 'name email phone')
      .populate('staffId', 'name email phone');

    if (!booking) throw new AppError(404, 'Booking not found');

    // COMPLIANCE: Access control – customers can only view their own
    if (
      req.user.role === UserRole.Customer &&
      booking.customerId._id.toString() !== req.user.userId
    ) {
      throw new AppError(403, 'Access denied');
    }

    res.json(decryptBooking(booking));
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH /api/bookings/:id/assign (admin only)
// ────────────────────────────────────────────────────────────────
export async function assignStaff(req: Request, res: Response, next: NextFunction) {
  try {
    const { staffId } = req.body;

    const staff = await User.findOne({ _id: staffId, role: UserRole.Staff, isDeleted: false });
    if (!staff) throw new AppError(404, 'Staff member not found');

    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { staffId, status: BookingStatus.Confirmed },
      { new: true },
    );
    if (!booking) throw new AppError(404, 'Booking not found');

    // Create a Job record when staff is assigned
    const checklist = (CHECKLISTS[booking.serviceType] || CHECKLISTS.standard).map((item) => ({
      item,
      completed: false,
    }));

    await Job.create({
      bookingId: booking._id,
      staffId,
      checklist,
    });

    await req.audit('booking.assignStaff', 'Booking', booking._id.toString(), { staffId });

    // Notify customer that staff has been assigned (with calendar links)
    try {
      const customer = await User.findById(booking.customerId);
      if (customer) {
        const staffName = decryptField(staff.name);
        const { googleCalendarUrl } = buildBookingCalendarEvent({
          serviceType: booking.serviceType,
          scheduledDate: booking.scheduledDate,
          scheduledTime: booking.scheduledTime,
          durationEstimate: booking.durationEstimate,
          address: booking.address,
          staffName,
          bookingNumber: booking.bookingNumber,
        });
        const icsDownloadUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/api/bookings/${booking._id}/calendar.ics`;

        await sendBookingConfirmedEmail(customer.email, {
          serviceType: booking.serviceType,
          scheduledDate: booking.scheduledDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
          scheduledTime: booking.scheduledTime,
          staffName,
          googleCalendarUrl,
          icsDownloadUrl,
        });
      }
    } catch (emailErr) {
      console.error('[EMAIL] Failed to send staff assignment email:', emailErr);
    }

    res.json(booking);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH /api/bookings/:id/cancel
// ────────────────────────────────────────────────────────────────
export async function cancelBooking(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');
    const { reason } = req.body;

    const booking = await Booking.findById(req.params.id);
    if (!booking) throw new AppError(404, 'Booking not found');

    // Customers can only cancel their own
    if (
      req.user.role === UserRole.Customer &&
      booking.customerId.toString() !== req.user.userId
    ) {
      throw new AppError(403, 'Access denied');
    }

    if (booking.status === BookingStatus.Completed) {
      throw new AppError(400, 'Cannot cancel a completed booking');
    }

    booking.status = BookingStatus.Cancelled;
    booking.cancellationReason = reason;
    await booking.save();

    await req.audit('booking.cancel', 'Booking', booking._id.toString(), { reason });

    // Notify customer of cancellation
    try {
      const customer = await User.findById(booking.customerId);
      if (customer) {
        await sendBookingCancelledEmail(customer.email, {
          serviceType: booking.serviceType,
          scheduledDate: booking.scheduledDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
          reason,
        });
      }
    } catch (emailErr) {
      console.error('[EMAIL] Failed to send cancellation email:', emailErr);
    }

    res.json(booking);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH /api/bookings/:id/reschedule
// ────────────────────────────────────────────────────────────────
export async function rescheduleBooking(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const booking = await Booking.findById(req.params.id);
    if (!booking) throw new AppError(404, 'Booking not found');

    if (
      req.user.role === UserRole.Customer &&
      booking.customerId.toString() !== req.user.userId
    ) {
      throw new AppError(403, 'Access denied');
    }

    if ([BookingStatus.Completed, BookingStatus.Cancelled].includes(booking.status)) {
      throw new AppError(400, 'Cannot reschedule this booking');
    }

    booking.scheduledDate = new Date(req.body.scheduledDate);
    booking.scheduledTime = req.body.scheduledTime;
    await booking.save();

    await req.audit('booking.reschedule', 'Booking', booking._id.toString(), {
      scheduledDate: req.body.scheduledDate,
      scheduledTime: req.body.scheduledTime,
    });

    res.json(booking);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH /api/bookings/:id/quote (admin only)
// ────────────────────────────────────────────────────────────────
export async function submitQuote(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const { quotedAmountCents, quoteNotes } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (!booking) throw new AppError(404, 'Booking not found');

    if (booking.status !== BookingStatus.PendingQuote) {
      throw new AppError(400, 'Booking is not awaiting a quote');
    }

    booking.quotedAmountCents = quotedAmountCents;
    booking.quoteNotes = quoteNotes;
    booking.quotedAt = new Date();
    booking.quotedBy = new Types.ObjectId(req.user.userId);
    booking.status = BookingStatus.Quoted;
    await booking.save();

    await req.audit('booking.submitQuote', 'Booking', booking._id.toString(), {
      quotedAmountCents,
    });

    // Notify customer
    try {
      const customer = await User.findById(booking.customerId);
      if (customer) {
        await sendQuoteReady(customer.email, {
          serviceType: booking.serviceType,
          quotedAmountCents,
          quoteNotes,
        });
      }
    } catch (emailErr) {
      console.error('[EMAIL] Failed to send quote notification:', emailErr);
    }

    res.json(booking);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH /api/bookings/:id/quote/respond (customer)
// ────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────
// PATCH /api/bookings/:id/status (admin only)
// ────────────────────────────────────────────────────────────────
export async function updateBookingStatus(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const { status } = req.body;

    const booking = await Booking.findById(req.params.id);
    if (!booking) throw new AppError(404, 'Booking not found');

    // Cannot change completed or cancelled bookings (except admin override back to another status)
    const validStatuses = Object.values(BookingStatus);
    if (!validStatuses.includes(status)) {
      throw new AppError(400, `Invalid status: ${status}`);
    }

    const previousStatus = booking.status;
    booking.status = status;

    // Clear cancellation reason when un-cancelling
    if (previousStatus === BookingStatus.Cancelled && status !== BookingStatus.Cancelled) {
      booking.cancellationReason = undefined;
    }

    await booking.save();

    await req.audit('booking.updateStatus', 'Booking', booking._id.toString(), {
      previousStatus,
      newStatus: status,
    });

    const populated = await Booking.findById(booking._id)
      .populate('customerId', 'name email')
      .populate('staffId', 'name email');

    res.json(decryptBooking(populated));
  } catch (err) {
    next(err);
  }
}

export async function respondToQuote(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const { approved, declineReason } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (!booking) throw new AppError(404, 'Booking not found');

    if (booking.customerId.toString() !== req.user.userId) {
      throw new AppError(403, 'Access denied');
    }

    if (booking.status !== BookingStatus.Quoted) {
      throw new AppError(400, 'Booking does not have a pending quote');
    }

    if (approved) {
      booking.status = BookingStatus.Approved;
      booking.customerApprovedAt = new Date();
      booking.amountCents = booking.quotedAmountCents!;
      await booking.save();

      // Notify customer of approval confirmation
      try {
        await sendQuoteApprovedEmail(req.user.email, {
          serviceType: booking.serviceType,
          amountCents: booking.amountCents,
          scheduledDate: booking.scheduledDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
          scheduledTime: booking.scheduledTime,
        });
      } catch (emailErr) {
        console.error('[EMAIL] Failed to send quote approved email:', emailErr);
      }
    } else {
      booking.status = BookingStatus.Cancelled;
      booking.customerDeclinedAt = new Date();
      booking.declineReason = declineReason;
      booking.cancellationReason = `Quote declined: ${declineReason}`;
      await booking.save();

      // Notify customer of cancellation
      try {
        await sendBookingCancelledEmail(req.user.email, {
          serviceType: booking.serviceType,
          scheduledDate: booking.scheduledDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
          reason: declineReason,
        });
      } catch (emailErr) {
        console.error('[EMAIL] Failed to send cancellation email:', emailErr);
      }
    }

    await req.audit('booking.respondToQuote', 'Booking', booking._id.toString(), {
      approved,
      declineReason,
    });

    res.json(booking);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// GET /api/bookings/:id/calendar.ics
// Download an .ics calendar file for the booking
// ────────────────────────────────────────────────────────────────
export async function downloadCalendarIcs(req: Request, res: Response, next: NextFunction) {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('customerId', 'name email')
      .populate('staffId', 'name email');

    if (!booking) {
      throw new AppError(404, 'Booking not found');
    }

    // Access control: customers see only their bookings, staff their assigned
    const userId = (req as any).user?._id?.toString();
    const role = (req as any).user?.role;
    if (role !== 'admin') {
      const custId = typeof booking.customerId === 'object' ? (booking.customerId as any)._id?.toString() : String(booking.customerId);
      const sId = typeof booking.staffId === 'object' ? (booking.staffId as any)?._id?.toString() : String(booking.staffId);
      if (custId !== userId && sId !== userId) {
        throw new AppError(403, 'Access denied');
      }
    }

    // Decrypt names for the calendar event
    let customerName = 'Customer';
    let staffName = 'Staff';
    try {
      if (typeof booking.customerId === 'object' && (booking.customerId as any).name) {
        customerName = decryptField((booking.customerId as any).name);
      }
    } catch { /* use default */ }
    try {
      if (typeof booking.staffId === 'object' && (booking.staffId as any)?.name) {
        staffName = decryptField((booking.staffId as any).name);
      }
    } catch { /* use default */ }

    const { event } = buildBookingCalendarEvent({
      serviceType: booking.serviceType,
      scheduledDate: booking.scheduledDate,
      scheduledTime: booking.scheduledTime,
      durationEstimate: booking.durationEstimate,
      address: booking.address,
      customerName,
      staffName,
      bookingNumber: booking.bookingNumber,
    });

    const icsContent = buildIcsContent(event);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${booking.bookingNumber || 'booking'}.ics"`);
    res.send(icsContent);
  } catch (err) {
    next(err);
  }
}
