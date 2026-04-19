import { Request, Response, NextFunction } from 'express';
import { Subscription, SubscriptionFrequency, SubscriptionStatus } from '../models/Subscription';
import { User } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import { createDynamicSubscription, getStripe } from '../services/stripe';
import { decryptField } from '../utils/encryption';

// Map frequency to Stripe recurring interval
const FREQUENCY_MAP: Record<string, { interval: 'week' | 'month'; intervalCount: number }> = {
  weekly: { interval: 'week', intervalCount: 1 },
  biweekly: { interval: 'week', intervalCount: 2 },
  monthly: { interval: 'month', intervalCount: 1 },
};

// ────────────────────────────────────────────────────────────────
// POST /api/subscriptions
// ────────────────────────────────────────────────────────────────
export async function createSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const { frequency, serviceType, amountCents, preferredDay, preferredTime, address } = req.body;

    if (!amountCents || amountCents < 100) {
      throw new AppError(400, 'A valid amount is required');
    }

    const freqConfig = FREQUENCY_MAP[frequency];
    if (!freqConfig) throw new AppError(400, 'Invalid frequency');

    const customer = await User.findById(req.user.userId);
    if (!customer?.stripeCustomerId) {
      throw new AppError(400, 'Payment setup required');
    }

    const { subscriptionId, clientSecret, stripePriceId } = await createDynamicSubscription({
      customerId: customer.stripeCustomerId,
      amountCents,
      interval: freqConfig.interval,
      intervalCount: freqConfig.intervalCount,
      productName: `Honor Cleaning — ${serviceType} (${frequency})`,
      metadata: { serviceType, frequency },
    });

    const subscription = await Subscription.create({
      customerId: req.user.userId,
      frequency,
      serviceType,
      amountCents,
      preferredDay,
      preferredTime,
      address,
      stripeSubscriptionId: subscriptionId,
      stripePriceId,
      status: SubscriptionStatus.Active,
    });

    await req.audit('subscription.create', 'Subscription', subscription._id.toString());

    res.status(201).json({ subscription, clientSecret });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// GET /api/subscriptions/mine
// ────────────────────────────────────────────────────────────────
export async function getMySubscriptions(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const subscriptions = await Subscription.find({
      customerId: req.user.userId,
      status: { $ne: SubscriptionStatus.Cancelled },
    }).sort({ createdAt: -1 });

    res.json(subscriptions);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH /api/subscriptions/:id/pause
// ────────────────────────────────────────────────────────────────
export async function pauseSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const sub = await Subscription.findOne({
      _id: req.params.id,
      customerId: req.user.userId,
    });
    if (!sub) throw new AppError(404, 'Subscription not found');

    if (sub.stripeSubscriptionId) {
      await getStripe().subscriptions.update(sub.stripeSubscriptionId, {
        pause_collection: { behavior: 'void' },
      });
    }

    sub.status = SubscriptionStatus.Paused;
    await sub.save();

    await req.audit('subscription.pause', 'Subscription', sub._id.toString());

    res.json(sub);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// DELETE /api/subscriptions/:id
// ────────────────────────────────────────────────────────────────
export async function cancelSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const sub = await Subscription.findOne({
      _id: req.params.id,
      customerId: req.user.userId,
    });
    if (!sub) throw new AppError(404, 'Subscription not found');

    if (sub.stripeSubscriptionId) {
      await getStripe().subscriptions.cancel(sub.stripeSubscriptionId);
    }

    sub.status = SubscriptionStatus.Cancelled;
    await sub.save();

    await req.audit('subscription.cancel', 'Subscription', sub._id.toString());

    res.json({ message: 'Subscription cancelled' });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────
// GET /api/subscriptions/upcoming-payments
// Returns upcoming payment dates and amounts for active subscriptions
// ────────────────────────────────────────────────────────────────
export async function getUpcomingPayments(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Auth required');

    const stripe = getStripe();

    const subscriptions = await Subscription.find({
      customerId: req.user.userId,
      status: SubscriptionStatus.Active,
    }).sort({ createdAt: -1 });

    const upcoming = [];

    for (const sub of subscriptions) {
      let nextPaymentDate: Date | null = sub.nextScheduledDate || null;
      let stripeStatus: string | null = null;

      // Fetch live data from Stripe if available
      if (stripe && sub.stripeSubscriptionId) {
        try {
          const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
          nextPaymentDate = new Date(stripeSub.current_period_end * 1000);
          stripeStatus = stripeSub.status;

          // Sync nextScheduledDate
          if (sub.nextScheduledDate?.getTime() !== nextPaymentDate.getTime()) {
            sub.nextScheduledDate = nextPaymentDate;
            await sub.save();
          }
        } catch (err) {
          console.error(`[SUBSCRIPTION] Failed to fetch Stripe sub ${sub.stripeSubscriptionId}:`, err);
        }
      }

      const now = new Date();
      const daysUntil = nextPaymentDate
        ? Math.ceil((nextPaymentDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      upcoming.push({
        subscriptionId: sub._id,
        serviceType: sub.serviceType,
        frequency: sub.frequency,
        amountCents: sub.amountCents,
        nextPaymentDate,
        daysUntilPayment: daysUntil,
        stripeStatus,
        preferredDay: sub.preferredDay,
        preferredTime: sub.preferredTime,
      });
    }

    res.json({ upcoming });
  } catch (err) {
    next(err);
  }
}
