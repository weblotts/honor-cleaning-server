import { Request, Response, NextFunction } from 'express';
import { Booking, BookingStatus } from '../models/Booking';
import { Invoice, InvoiceStatus } from '../models/Invoice';
import { Subscription, SubscriptionStatus } from '../models/Subscription';
import { Receipt } from '../models/Receipt';
import { User, UserRole } from '../models/User';
import { Job } from '../models/Job';
import { AuditLog } from '../models/AuditLog';
import { AppError } from '../middleware/errorHandler';
import { decryptField } from '../utils/encryption';

function parseDateRange(query: any) {
  const startDate = query.startDate
    ? new Date(query.startDate as string)
    : new Date(new Date().setMonth(new Date().getMonth() - 1));
  const endDate = query.endDate ? new Date(query.endDate as string) : new Date();
  // Ensure endDate covers the full day
  endDate.setHours(23, 59, 59, 999);
  return { startDate, endDate };
}

/** Compute the previous period of equal length for comparison */
function previousPeriod(startDate: Date, endDate: Date) {
  const durationMs = endDate.getTime() - startDate.getTime();
  const prevEnd = new Date(startDate.getTime() - 1);
  prevEnd.setHours(23, 59, 59, 999);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { prevStart, prevEnd };
}

// ────────────────────────────────────────────────────────────────
// GET /api/admin/reports/revenue
// ────────────────────────────────────────────────────────────────
export async function revenueReport(req: Request, res: Response, next: NextFunction) {
  try {
    const { startDate, endDate } = parseDateRange(req.query);
    const paidFilter = { status: InvoiceStatus.Paid, paidAt: { $gte: startDate, $lte: endDate } };

    const [daily, totals, byService, refundStats, recentPayments] = await Promise.all([
      // Daily revenue
      Invoice.aggregate([
        { $match: paidFilter },
        {
          $group: {
            _id: {
              year: { $year: '$paidAt' },
              month: { $month: '$paidAt' },
              day: { $dayOfMonth: '$paidAt' },
            },
            totalRevenue: { $sum: '$totalAmountCents' },
            totalTips: { $sum: '$tipAmountCents' },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
      ]),
      // Summary totals
      Invoice.aggregate([
        { $match: paidFilter },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$totalAmountCents' },
            totalTips: { $sum: '$tipAmountCents' },
            totalTax: { $sum: '$taxAmountCents' },
            count: { $sum: 1 },
            avgInvoice: { $avg: '$totalAmountCents' },
          },
        },
      ]),
      // Revenue by service type (join with booking)
      Invoice.aggregate([
        { $match: paidFilter },
        {
          $lookup: {
            from: 'bookings',
            localField: 'bookingId',
            foreignField: '_id',
            as: 'booking',
          },
        },
        { $unwind: { path: '$booking', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $ifNull: ['$booking.serviceType', 'other'] },
            revenue: { $sum: '$totalAmountCents' },
            count: { $sum: 1 },
          },
        },
        { $sort: { revenue: -1 } },
      ]),
      // Refund stats
      Invoice.aggregate([
        {
          $match: {
            status: { $in: [InvoiceStatus.Refunded, InvoiceStatus.PartiallyRefunded] },
            'refundDetails.refundedAt': { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: null,
            totalRefunded: { $sum: '$refundDetails.refundAmountCents' },
            count: { $sum: 1 },
          },
        },
      ]),
      // Recent payments (last 10)
      Receipt.find({ paidAt: { $gte: startDate, $lte: endDate } })
        .sort({ paidAt: -1 })
        .limit(10)
        .populate('customerId', 'name email')
        .lean(),
    ]);

    // Decrypt customer names in recent payments
    const decryptedPayments = recentPayments.map((p: any) => {
      if (p.customerId && typeof p.customerId === 'object' && p.customerId.name) {
        try {
          p.customerId.name = decryptField(p.customerId.name);
        } catch { /* keep encrypted value */ }
      }
      return p;
    });

    // Previous period comparison + top customers
    const { prevStart, prevEnd } = previousPeriod(startDate, endDate);
    const prevPaidFilter = { status: InvoiceStatus.Paid, paidAt: { $gte: prevStart, $lte: prevEnd } };

    const [prevTotals, topCustomers] = await Promise.all([
      Invoice.aggregate([
        { $match: prevPaidFilter },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$totalAmountCents' },
            totalTips: { $sum: '$tipAmountCents' },
            count: { $sum: 1 },
            avgInvoice: { $avg: '$totalAmountCents' },
          },
        },
      ]),
      // Top 5 customers by revenue in this period
      Invoice.aggregate([
        { $match: paidFilter },
        {
          $group: {
            _id: '$customerId',
            totalSpent: { $sum: '$totalAmountCents' },
            invoiceCount: { $sum: 1 },
          },
        },
        { $sort: { totalSpent: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'customer',
          },
        },
        { $unwind: '$customer' },
        {
          $project: {
            _id: 1,
            totalSpent: 1,
            invoiceCount: 1,
            name: '$customer.name',
            email: '$customer.email',
          },
        },
      ]),
    ]);

    // Decrypt top customer names
    const decryptedTopCustomers = topCustomers.map((c: any) => {
      if (c.name) {
        try { c.name = decryptField(c.name); } catch { /* keep encrypted */ }
      }
      return c;
    });

    const currentSummary = totals[0] || { totalRevenue: 0, totalTips: 0, totalTax: 0, count: 0, avgInvoice: 0 };
    const prevSummary = prevTotals[0] || { totalRevenue: 0, totalTips: 0, count: 0, avgInvoice: 0 };

    res.json({
      daily,
      summary: currentSummary,
      previousSummary: prevSummary,
      byService,
      refundStats: refundStats[0] || { totalRefunded: 0, count: 0 },
      recentPayments: decryptedPayments,
      topCustomers: decryptedTopCustomers,
      dateRange: { startDate, endDate },
    });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// GET /api/admin/reports/jobs
// ────────────────────────────────────────────────────────────────
export async function jobsReport(req: Request, res: Response, next: NextFunction) {
  try {
    const { startDate, endDate } = parseDateRange(req.query);

    const [statusBreakdown, serviceBreakdown, completionStats, customerCount, subscriptionStats] = await Promise.all([
      // Booking status breakdown
      Booking.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      // Bookings by service type
      Booking.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: '$serviceType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      // Job completion stats
      Job.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $ne: ['$completedAt', null] }, 1, 0] },
            },
            avgDurationMs: {
              $avg: {
                $cond: [
                  { $and: [{ $ne: ['$checkInTime', null] }, { $ne: ['$checkOutTime', null] }] },
                  { $subtract: ['$checkOutTime', '$checkInTime'] },
                  null,
                ],
              },
            },
          },
        },
      ]),
      // Customer count
      User.countDocuments({ role: UserRole.Customer, isDeleted: false }),
      // Subscription stats
      Subscription.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            mrr: {
              $sum: {
                $cond: [{ $eq: ['$status', SubscriptionStatus.Active] }, '$amountCents', 0],
              },
            },
          },
        },
      ]),
    ]);

    // Previous period comparison + staff performance
    const { prevStart, prevEnd } = previousPeriod(startDate, endDate);

    const [prevCompletionStats, staffPerformance] = await Promise.all([
      Job.aggregate([
        { $match: { createdAt: { $gte: prevStart, $lte: prevEnd } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $ne: ['$completedAt', null] }, 1, 0] } },
          },
        },
      ]),
      // Staff performance: jobs per staff member
      Job.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: '$staffId',
            totalJobs: { $sum: 1 },
            completed: { $sum: { $cond: [{ $ne: ['$completedAt', null] }, 1, 0] } },
            avgDurationMs: {
              $avg: {
                $cond: [
                  { $and: [{ $ne: ['$checkInTime', null] }, { $ne: ['$checkOutTime', null] }] },
                  { $subtract: ['$checkOutTime', '$checkInTime'] },
                  null,
                ],
              },
            },
          },
        },
        { $sort: { completed: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'staff',
          },
        },
        { $unwind: '$staff' },
        {
          $project: {
            _id: 1,
            totalJobs: 1,
            completed: 1,
            avgDurationMs: 1,
            name: '$staff.name',
            email: '$staff.email',
          },
        },
      ]),
    ]);

    // Decrypt staff names
    const decryptedStaff = staffPerformance.map((s: any) => {
      if (s.name) {
        try { s.name = decryptField(s.name); } catch { /* keep encrypted */ }
      }
      return s;
    });

    // Compute MRR from active subscriptions
    const activeSubStat = subscriptionStats.find((s: any) => s._id === 'active');
    const currentCompletion = completionStats[0] || { total: 0, completed: 0, avgDurationMs: 0 };
    const prevCompletion = prevCompletionStats[0] || { total: 0, completed: 0 };

    res.json({
      statusBreakdown,
      serviceBreakdown,
      completionStats: currentCompletion,
      previousCompletionStats: prevCompletion,
      customerCount,
      subscriptionStats: {
        breakdown: subscriptionStats,
        activeMrr: activeSubStat?.mrr || 0,
        activeCount: activeSubStat?.count || 0,
      },
      staffPerformance: decryptedStaff,
      dateRange: { startDate, endDate },
    });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// GET /api/admin/audit-logs
// COMPLIANCE: Paginated, read-only access to audit trail
// ────────────────────────────────────────────────────────────────
export async function getAuditLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const skip = (page - 1) * limit;

    let filter: any = {};
    if (req.query.action) filter.action = { $regex: req.query.action, $options: 'i' };
    if (req.query.actorId) filter.actorId = req.query.actorId;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .populate('actorId', 'email role'),
      AuditLog.countDocuments(filter),
    ]);

    res.json({ logs, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// GET /api/admin/incident-response
// COMPLIANCE: M.G.L. Chapter 93H breach response checklist
// ────────────────────────────────────────────────────────────────
export async function getIncidentResponse(_req: Request, res: Response) {
  res.json({
    title: 'Data Breach Incident Response – M.G.L. Chapter 93H',
    steps: [
      {
        order: 1,
        title: 'Identify & Scope',
        description: 'Determine what personal information was compromised, how many MA residents affected, and the attack vector.',
        actions: [
          'Document the type of data exposed (name, SSN, financial account, etc.)',
          'Identify affected systems and databases',
          'Determine the number of affected MA residents',
          'Preserve all evidence and logs',
        ],
      },
      {
        order: 2,
        title: 'Contain the Breach',
        description: 'Take immediate action to stop unauthorized access.',
        actions: [
          'Revoke compromised credentials',
          'Isolate affected systems',
          'Patch vulnerability if identified',
          'Enable additional monitoring',
        ],
      },
      {
        order: 3,
        title: 'Notify Affected MA Residents',
        description: 'Written notice to each affected resident as soon as practicable.',
        actions: [
          'Include: nature of breach, type of data, steps taken',
          'Include: contact info for consumer reporting agencies',
          'Provide notice in writing (mail or electronic if primary method)',
          'Offer identity theft monitoring if SSN/financial data exposed',
        ],
      },
      {
        order: 4,
        title: 'Notify MA Attorney General',
        description: 'File notice with the Office of the Attorney General within 30 days.',
        actions: [
          'Submit form to AG Data Breach Notification portal',
          'Include: nature of breach, number affected, steps taken',
          'Include: timeline of discovery and containment',
          'Retain copy of all filings',
        ],
      },
      {
        order: 5,
        title: 'Notify Director of Consumer Affairs',
        description: 'File concurrent notice with the Office of Consumer Affairs and Business Regulation.',
        actions: [
          'Submit notification concurrent with AG notice',
          'Include same information as AG filing',
        ],
      },
      {
        order: 6,
        title: 'Document Everything',
        description: 'Create comprehensive incident record for compliance review.',
        actions: [
          'Document timeline from discovery to resolution',
          'Record all notifications sent with dates',
          'Preserve all evidence and forensic reports',
          'Schedule post-incident review within 30 days',
          'Update WISP based on lessons learned',
        ],
      },
    ],
  });
}
