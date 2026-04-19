/**
 * One-time migration script: assigns bookingNumber (BK-00001, BK-00002, ...)
 * to all existing bookings that don't have one yet.
 *
 * Usage:  npx tsx src/scripts/backfill-booking-numbers.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Booking } from '../models/Booking';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const bookings = await Booking.find({ $or: [{ bookingNumber: null }, { bookingNumber: { $exists: false } }] })
    .sort({ createdAt: 1 });

  console.log(`Found ${bookings.length} bookings without a bookingNumber`);

  // Find the highest existing booking number to continue from
  const lastNumbered = await Booking.findOne({ bookingNumber: { $exists: true, $ne: null } })
    .sort({ bookingNumber: -1 });

  let counter = 0;
  if (lastNumbered?.bookingNumber) {
    const match = lastNumbered.bookingNumber.match(/BK-(\d+)/);
    if (match) counter = parseInt(match[1], 10);
  }

  for (const booking of bookings) {
    counter++;
    const bookingNumber = `BK-${counter.toString().padStart(5, '0')}`;
    booking.bookingNumber = bookingNumber;
    await booking.save();
    console.log(`  ${booking._id} → ${bookingNumber}`);
  }

  console.log(`\nDone! Assigned ${bookings.length} booking numbers.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
