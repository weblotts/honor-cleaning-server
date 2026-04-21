import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { auditMiddleware } from "./middleware/auditLog";
import { errorHandler } from "./middleware/errorHandler";

// Route imports
import authRoutes from "./routes/auth.routes";
import bookingRoutes from "./routes/booking.routes";
import jobRoutes from "./routes/job.routes";
import invoiceRoutes from "./routes/invoice.routes";
import customerRoutes from "./routes/customer.routes";
import staffRoutes from "./routes/staff.routes";
import subscriptionRoutes from "./routes/subscription.routes";
import quotationRoutes from "./routes/quotation.routes";
import receiptRoutes from "./routes/receipt.routes";
import chequeRoutes from "./routes/cheque.routes";
import adminRoutes from "./routes/admin.routes";
import feedbackRoutes from "./routes/feedback.routes";
import webhookRoutes from "./routes/webhook.routes";

const app = express();

// ────────────────────────────────────────────────────────────────
// Security middleware
// ────────────────────────────────────────────────────────────────

// COMPLIANCE: Helmet.js for HTTP security headers
// crossOriginResourcePolicy set to 'cross-origin' so the frontend on a different port can reach the API
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// COMPLIANCE: CORS – allow only the Next.js frontend origin
const allowedOrigin =
  process.env.CLIENT_URL ||
  "http://localhost:3000" ||
  "https://honor-cleaning-client.vercel.app";
app.use(
  cors({
    origin: allowedOrigin,
    credentials: true, // Required for httpOnly cookie refresh tokens
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// COMPLIANCE: HTTPS redirect in production
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    if (req.headers["x-forwarded-proto"] !== "https") {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// Stripe webhook — must come BEFORE express.json() to receive raw body
app.use("/api/webhooks", webhookRoutes);

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Logging
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Audit logging middleware (attaches req.audit helper)
app.use(auditMiddleware);

// ────────────────────────────────────────────────────────────────
// API Routes
// ────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/quotations", quotationRoutes);
app.use("/api/receipts", receiptRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/cheque-payments", chequeRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/feedback", feedbackRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ────────────────────────────────────────────────────────────────
// Error handler (must be last)
// ────────────────────────────────────────────────────────────────
app.use(errorHandler);

export default app;
