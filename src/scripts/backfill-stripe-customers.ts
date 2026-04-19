/**
 * One-time migration script: creates Stripe Customer objects for existing
 * users who are missing a stripeCustomerId.
 *
 * Usage:  npx tsx src/scripts/backfill-stripe-customers.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { User, UserRole } from '../models/User';
import { createStripeCustomer } from '../services/stripe';
import { decryptField } from '../utils/encryption';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('[MONGO] Connected');

  const customers = await User.find({
    role: UserRole.Customer,
    isDeleted: false,
    $or: [{ stripeCustomerId: { $exists: false } }, { stripeCustomerId: null }, { stripeCustomerId: '' }],
  });

  console.log(`Found ${customers.length} customers without a Stripe ID`);

  let updated = 0;
  let failed = 0;

  for (const customer of customers) {
    try {
      // Name is encrypted at rest — decrypt for Stripe
      let name: string;
      try {
        name = decryptField(customer.name);
      } catch {
        name = customer.email.split('@')[0];
      }

      const stripeId = await createStripeCustomer(customer.email, name);
      if (!stripeId) {
        console.warn(`  [SKIP] Stripe not configured — cannot create customer for ${customer.email}`);
        failed++;
        continue;
      }

      customer.stripeCustomerId = stripeId;
      await customer.save();
      updated++;
      console.log(`  [OK] ${customer.email} → ${stripeId}`);
    } catch (err) {
      failed++;
      console.error(`  [FAIL] ${customer.email}:`, err);
    }
  }

  console.log(`\nDone. Updated: ${updated}, Failed: ${failed}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
