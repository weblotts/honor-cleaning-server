import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import app from './app';
import { startDataRetentionCron } from './utils/dataRetention';
import { startPaymentReminderCron } from './utils/paymentReminders';
import { startBookingReminderCron } from './utils/bookingReminders';

const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/honor-cleaning';

async function start() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('[DB] Connected to MongoDB');

    // Start data retention cron job (MA 201 CMR 17 compliance)
    startDataRetentionCron();

    // Start payment reminder cron job (3-day advance notice for recurring payments)
    startPaymentReminderCron();

    // Start booking reminder cron job (24h advance notice for upcoming jobs)
    startBookingReminderCron();

    // Start Express server
    app.listen(PORT, () => {
      console.log(`[SERVER] Running on port ${PORT}`);
      console.log(`[SERVER] Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('[SERVER] Failed to start:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[SERVER] SIGTERM received, shutting down...');
  await mongoose.disconnect();
  process.exit(0);
});

start();
