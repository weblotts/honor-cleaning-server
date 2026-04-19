import Stripe from 'stripe';

// ────────────────────────────────────────────────────────────────
// COMPLIANCE: We NEVER store raw card numbers. All card handling
// goes through Stripe's PCI-compliant APIs. We only store
// PaymentIntent IDs, Customer IDs, and Subscription IDs.
// ────────────────────────────────────────────────────────────────

let stripeInstance: Stripe | null = null;

function isStripeConfigured(): boolean {
  const key = process.env.STRIPE_SECRET_KEY;
  return !!key && key.startsWith('sk_') && key.length > 10;
}

export function getStripe(): Stripe | null {
  if (!isStripeConfigured()) return null;
  if (!stripeInstance) {
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2024-12-18.acacia',
    });
  }
  return stripeInstance;
}

export async function createStripeCustomer(email: string, name: string): Promise<string | undefined> {
  const stripe = getStripe();
  if (!stripe) {
    console.warn('[STRIPE] Not configured — skipping customer creation for', email);
    return undefined;
  }
  const customer = await stripe.customers.create({ email, name });
  return customer.id;
}

export async function retrievePaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent | null> {
  const stripe = getStripe();
  if (!stripe) return null;
  try {
    return await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch {
    return null;
  }
}

export async function createPaymentIntent(params: {
  amountCents: number;
  customerId: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}): Promise<{ clientSecret: string | null; paymentIntentId: string | null }> {
  const stripe = getStripe();
  if (!stripe) {
    console.warn('[STRIPE] Not configured — skipping PaymentIntent creation');
    return { clientSecret: null, paymentIntentId: null };
  }
  const pi = await stripe.paymentIntents.create({
    amount: params.amountCents,
    currency: 'usd',
    customer: params.customerId,
    metadata: params.metadata || {},
    automatic_payment_methods: { enabled: true },
  }, params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined);
  return {
    clientSecret: pi.client_secret!,
    paymentIntentId: pi.id,
  };
}

export async function createDynamicSubscription(params: {
  customerId: string;
  amountCents: number;
  interval: 'week' | 'month';
  intervalCount: number; // 1 for weekly/monthly, 2 for biweekly
  productName: string;
  metadata?: Record<string, string>;
}): Promise<{ subscriptionId: string; clientSecret: string | null; stripePriceId: string }> {
  const stripe = getStripe();
  if (!stripe) {
    console.warn('[STRIPE] Not configured — skipping subscription creation');
    return { subscriptionId: '', clientSecret: null, stripePriceId: '' };
  }

  // Create a price on-the-fly for this customer's quoted amount
  const price = await stripe.prices.create({
    unit_amount: params.amountCents,
    currency: 'usd',
    recurring: {
      interval: params.interval,
      interval_count: params.intervalCount,
    },
    product_data: {
      name: params.productName,
    },
  });

  const sub = await stripe.subscriptions.create({
    customer: params.customerId,
    items: [{ price: price.id }],
    payment_behavior: 'default_incomplete',
    expand: ['latest_invoice.payment_intent'],
    metadata: params.metadata || {},
  });

  const invoice = sub.latest_invoice as Stripe.Invoice;
  const pi = invoice.payment_intent as Stripe.PaymentIntent | null;

  return {
    subscriptionId: sub.id,
    clientSecret: pi?.client_secret || null,
    stripePriceId: price.id,
  };
}

export async function refundPayment(paymentIntentId: string, amountCents?: number) {
  const stripe = getStripe();
  if (!stripe) {
    console.warn('[STRIPE] Not configured — skipping refund');
    return null;
  }
  return stripe.refunds.create({
    payment_intent: paymentIntentId,
    ...(amountCents ? { amount: amountCents } : {}),
  });
}
