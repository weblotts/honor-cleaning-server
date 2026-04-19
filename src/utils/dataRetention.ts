import cron from 'node-cron';
import { User } from '../models/User';

// ────────────────────────────────────────────────────────────────
// COMPLIANCE: MA 201 CMR 17.00 – Data Retention Policy
// Soft-delete customer records inactive for 3+ years.
// Runs daily at 2:00 AM.
// ────────────────────────────────────────────────────────────────

export function startDataRetentionCron() {
  // Run daily at 2:00 AM
  cron.schedule('0 2 * * *', async () => {
    try {
      const threeYearsAgo = new Date();
      threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);

      const result = await User.updateMany(
        {
          role: 'customer',
          isDeleted: false,
          updatedAt: { $lt: threeYearsAgo },
        },
        {
          $set: { isDeleted: true, deletedAt: new Date() },
        },
      );

      if (result.modifiedCount > 0) {
        console.log(
          `[DATA RETENTION] Soft-deleted ${result.modifiedCount} inactive customer records (>3 years)`,
        );
      }
    } catch (err) {
      console.error('[DATA RETENTION] Cron job failed:', err);
    }
  });

  console.log('[DATA RETENTION] Cron job scheduled (daily 2:00 AM)');
}
