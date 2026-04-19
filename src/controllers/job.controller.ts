import { Request, Response, NextFunction } from "express";
import { Job } from "../models/Job";
import { Booking, BookingStatus } from "../models/Booking";
import { Quotation } from "../models/Quotation";
import { Invoice, InvoiceStatus } from "../models/Invoice";
import { User, UserRole } from "../models/User";
import { AppError } from "../middleware/errorHandler";
import { getUploadUrl } from "../services/s3";
import { decryptField } from "../utils/encryption";
import { sendCleaningInProgressEmail, sendJobCompletedEmail } from "../services/email";

function decryptPopulatedUser(user: any): any {
  if (!user || typeof user !== "object" || !user.name) return user;
  try {
    return {
      ...(user.toJSON ? user.toJSON() : user),
      name: decryptField(user.name),
      phone: user.phone ? decryptField(user.phone) : undefined,
    };
  } catch {
    return user.toJSON ? user.toJSON() : user;
  }
}

// ────────────────────────────────────────────────────────────────
// GET /api/jobs/mine — staff's daily job queue
// ────────────────────────────────────────────────────────────────
export async function getMyJobs(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError(401, "Auth required");

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const jobs = await Job.find({ staffId: req.user.userId })
      .populate({
        path: "bookingId",
        match: {
          scheduledDate: { $gte: today, $lt: tomorrow },
          status: { $in: [BookingStatus.Confirmed, BookingStatus.InProgress] },
        },
        populate: { path: "customerId", select: "name email phone" },
      })
      .sort({ createdAt: 1 });

    // Filter out jobs where booking didn't match (populate returns null)
    const todaysJobs = jobs
      .filter((j) => j.bookingId !== null)
      .map((j) => {
        const obj = j.toJSON();
        if (
          obj.bookingId &&
          typeof obj.bookingId === "object" &&
          obj.bookingId.customerId
        ) {
          obj.bookingId.customerId = decryptPopulatedUser(
            obj.bookingId.customerId,
          );
        }
        return obj;
      });

    res.json(todaysJobs);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/jobs/:id/checkin
// ────────────────────────────────────────────────────────────────
export async function checkIn(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, "Auth required");

    const job = await Job.findById(req.params.id);
    if (!job) throw new AppError(404, "Job not found");

    // COMPLIANCE: Staff can only check in to their own assigned jobs
    if (job.staffId.toString() !== req.user.userId) {
      throw new AppError(403, "Not your assigned job");
    }

    if (job.checkInTime) throw new AppError(400, "Already checked in");

    const { latitude, longitude } = req.body;

    job.checkInTime = new Date();
    job.checkInLocation = {
      type: "Point",
      coordinates: [longitude, latitude],
    };
    await job.save();

    // Update booking status
    const booking = await Booking.findByIdAndUpdate(job.bookingId, {
      status: BookingStatus.InProgress,
    }, { new: true }).populate('customerId', 'name email');

    await req.audit("job.checkin", "Job", job._id.toString(), {
      latitude,
      longitude,
    });

    // Notify customer that cleaning has started
    try {
      if (booking && booking.customerId && typeof booking.customerId === 'object') {
        const customer = booking.customerId as any;
        const staffUser = await User.findById(job.staffId);
        const staffName = staffUser ? decryptField(staffUser.name) : 'Your cleaner';
        await sendCleaningInProgressEmail(customer.email, {
          serviceType: booking.serviceType,
          staffName,
        });
      }
    } catch (emailErr) {
      console.error('[EMAIL] Failed to send cleaning in-progress email:', emailErr);
    }

    res.json(job);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/jobs/:id/checkout
// ────────────────────────────────────────────────────────────────
export async function checkOut(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError(401, "Auth required");

    const job = await Job.findById(req.params.id);
    if (!job) throw new AppError(404, "Job not found");

    if (job.staffId.toString() !== req.user.userId) {
      throw new AppError(403, "Not your assigned job");
    }

    if (!job.checkInTime) throw new AppError(400, "Must check in first");
    if (job.checkOutTime) throw new AppError(400, "Already checked out");

    const { latitude, longitude } = req.body;

    job.checkOutTime = new Date();
    job.checkOutLocation = {
      type: "Point",
      coordinates: [longitude, latitude],
    };
    await job.save();

    await req.audit("job.checkout", "Job", job._id.toString());

    res.json(job);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH /api/jobs/:id/checklist
// ────────────────────────────────────────────────────────────────
export async function updateChecklist(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError(401, "Auth required");

    const job = await Job.findById(req.params.id);
    if (!job) throw new AppError(404, "Job not found");

    if (job.staffId.toString() !== req.user.userId) {
      throw new AppError(403, "Not your assigned job");
    }

    const { index, completed } = req.body;
    if (index < 0 || index >= job.checklist.length) {
      throw new AppError(400, "Invalid checklist index");
    }

    job.checklist[index].completed = completed;
    await job.save();

    res.json(job);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// POST /api/jobs/:id/photos
// Returns presigned S3 upload URLs for the client to upload directly
// ────────────────────────────────────────────────────────────────
export async function getPhotoUploadUrls(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError(401, "Auth required");

    const job = await Job.findById(req.params.id);
    if (!job) throw new AppError(404, "Job not found");

    if (job.staffId.toString() !== req.user.userId) {
      throw new AppError(403, "Not your assigned job");
    }

    const { folder, contentType } = req.body as {
      folder: "before" | "after";
      contentType: string;
    };

    if (!["before", "after"].includes(folder)) {
      throw new AppError(400, 'folder must be "before" or "after"');
    }

    const { uploadUrl, key } = await getUploadUrl({
      folder,
      jobId: job._id.toString(),
      contentType: contentType || "image/jpeg",
    });

    // Store the key on the job
    if (folder === "before") {
      job.photosBefore.push(key);
    } else {
      job.photosAfter.push(key);
    }
    await job.save();

    res.json({ uploadUrl, key });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH /api/jobs/:id/complete
// Marks job complete and creates an invoice
// ────────────────────────────────────────────────────────────────
export async function completeJob(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError(401, "Auth required");

    const job = await Job.findById(req.params.id);
    if (!job) throw new AppError(404, "Job not found");

    if (
      job.staffId.toString() !== req.user.userId &&
      req.user.role !== UserRole.Admin
    ) {
      throw new AppError(403, "Not authorized");
    }

    if (job.completedAt) throw new AppError(400, "Job already completed");

    job.completedAt = new Date();
    job.staffNotes = req.body.staffNotes || job.staffNotes;
    job.customerSignOff = req.body.customerSignOff || false;
    await job.save();

    // Update booking status
    const booking = await Booking.findByIdAndUpdate(
      job.bookingId,
      { status: BookingStatus.Completed },
      { new: true },
    ).populate('customerId', 'name email');

    // Create invoice from booking with tax (if one doesn't already exist from a quotation)
    if (booking) {
      const existingInvoice = await Invoice.findOne({ bookingId: booking._id });
      if (!existingInvoice) {
        // Look for an accepted quotation linked to this booking
        const quotation = await Quotation.findOne({
          bookingId: booking._id,
          status: "accepted",
        });

        const serviceCents = booking.amountCents;
        const taxRate = 6.25; // Massachusetts sales tax
        const taxAmountCents = Math.round(serviceCents * (taxRate / 100));
        const subtotalCents = serviceCents;
        const totalAmountCents =
          subtotalCents + taxAmountCents + booking.tipAmountCents;

        const count = await Invoice.countDocuments();
        const invoiceNumber = `INV-${(count + 1).toString().padStart(5, "0")}`;

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 30);

        await Invoice.create({
          invoiceNumber,
          bookingId: booking._id,
          quotationId: quotation?._id || undefined,
          customerId: booking.customerId,
          lineItems: [
            {
              description: `${booking.serviceType} cleaning service`,
              quantity: 1,
              unitPriceCents: serviceCents,
              amountCents: serviceCents,
            },
          ],
          subtotalCents,
          taxRate,
          taxAmountCents,
          totalAmountCents,
          tipAmountCents: booking.tipAmountCents,
          dueDate,
          status: InvoiceStatus.Sent,
          sentAt: new Date(),
        });
      }
    }

    await req.audit("job.complete", "Job", job._id.toString());

    // Notify customer that job is complete
    try {
      if (booking && booking.customerId && typeof booking.customerId === 'object') {
        const customer = booking.customerId as any;
        await sendJobCompletedEmail(customer.email, {
          serviceType: booking.serviceType,
          scheduledDate: booking.scheduledDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        });
      }
    } catch (emailErr) {
      console.error('[EMAIL] Failed to send job completed email:', emailErr);
    }

    res.json(job);
  } catch (err) {
    next(err);
  }
}
