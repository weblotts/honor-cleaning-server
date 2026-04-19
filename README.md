# Honor Cleaning — Professional Cleaning Services Platform

Full-stack web application for a residential and commercial cleaning company operating in Massachusetts (Boston metro area and suburbs).

## Tech Stack

| Layer        | Technology                                                    |
| ------------ | ------------------------------------------------------------- |
| Frontend     | Next.js 14 (App Router) + TypeScript + Tailwind CSS           |
| Backend      | Express.js + TypeScript                                       |
| Database     | MongoDB + Mongoose ODM                                        |
| Auth         | JWT (access + refresh tokens) + bcrypt + TOTP MFA (speakeasy) |
| Payments     | Stripe (PaymentIntent, Subscriptions)                         |
| Email        | SendGrid                                                      |
| SMS          | Twilio                                                        |
| File Storage | AWS S3 (presigned URLs)                                       |

## Project Structure

```
honor-cleaning/
├── client/                 # Next.js 14 frontend
│   ├── app/
│   │   ├── (auth)/         # Login, register, forgot-password
│   │   ├── (public)/       # Landing page
│   │   ├── admin/          # Admin dashboard, CRM, reports, audit logs
│   │   ├── booking/        # Multi-step booking flow
│   │   ├── dashboard/      # Customer dashboard
│   │   ├── staff/          # Staff portal (job queue, checklist)
│   │   └── privacy-policy/ # Legal compliance page
│   ├── components/         # Shared UI components
│   ├── hooks/              # useAuth, custom hooks
│   ├── lib/                # API client, auth store
│   ├── types/              # Shared TypeScript interfaces
│   └── middleware.ts       # Route protection
├── server/                 # Express.js backend
│   └── src/
│       ├── models/         # Mongoose schemas (User, Booking, Job, Invoice, AuditLog, Subscription)
│       ├── routes/         # Express routers
│       ├── controllers/    # Business logic
│       ├── middleware/     # Auth, audit, validation, error handling
│       ├── services/       # Stripe, SendGrid, Twilio, S3 integrations
│       ├── utils/          # Encryption, tokens, validators, data retention cron
│       ├── app.ts          # Express app setup
│       └── server.ts       # Entry point
└── README.md
```

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)
- Stripe account (test keys)

### 1. Clone and install

```bash
# Server
cd server
cp .env.example .env    # Fill in all values
npm install

# Client
cd ../client
npm install
```

### 2. Configure environment

Edit `server/.env` with your credentials. Required variables:

| Variable                | Description                                       |
| ----------------------- | ------------------------------------------------- |
| `MONGODB_URI`           | MongoDB connection string                         |
| `JWT_ACCESS_SECRET`     | Secret for signing access tokens (min 32 chars)   |
| `JWT_REFRESH_SECRET`    | Secret for signing refresh tokens (min 32 chars)  |
| `FIELD_ENCRYPTION_KEY`  | 64-char hex string for AES-256-CBC PII encryption |
| `STRIPE_SECRET_KEY`     | Stripe secret key (`sk_test_...`)                 |
| `SENDGRID_API_KEY`      | SendGrid API key                                  |
| `TWILIO_ACCOUNT_SID`    | Twilio SID                                        |
| `TWILIO_AUTH_TOKEN`     | Twilio auth token                                 |
| `AWS_ACCESS_KEY_ID`     | AWS credentials for S3                            |
| `AWS_SECRET_ACCESS_KEY` | AWS secret                                        |
| `S3_BUCKET_NAME`        | S3 bucket for job photos                          |
| `CLIENT_URL`            | Frontend URL (default: `http://localhost:3000`)   |

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Run

```bash
# Terminal 1 — Backend (port 5000)
cd server && npm run dev

# Terminal 2 — Frontend (port 3000)
cd client && npm run dev
```

## User Roles

| Role         | Access                                                                                |
| ------------ | ------------------------------------------------------------------------------------- |
| **Customer** | Book cleanings, manage subscriptions, view invoices, request data deletion            |
| **Staff**    | View daily job queue, check in/out with GPS, complete checklists, upload photos       |
| **Admin**    | Full CRM, job board, staff management, revenue reports, audit logs, incident response |

## API Endpoints

### Auth — `/api/auth`

- `POST /register` — Customer self-registration
- `POST /login` — Returns access token + refresh cookie
- `POST /login/mfa` — TOTP verification for staff/admin
- `POST /refresh` — Rotate refresh token
- `POST /logout` — Invalidate refresh token
- `POST /forgot-password` — Send reset link
- `POST /reset-password` — Consume reset token

### Bookings — `/api/bookings`

- `POST /` — Create booking + Stripe PaymentIntent
- `GET /` — List (filtered by role)
- `PATCH /:id/assign` — Assign staff (admin)
- `PATCH /:id/cancel` — Cancel with reason
- `PATCH /:id/reschedule` — Update date/time

### Jobs — `/api/jobs`

- `GET /mine` — Staff daily queue
- `POST /:id/checkin` — GPS check-in
- `POST /:id/checkout` — GPS check-out
- `PATCH /:id/checklist` — Toggle checklist item
- `POST /:id/photos` — Get S3 upload URL
- `PATCH /:id/complete` — Complete + create invoice

### Invoices — `/api/invoices`

- `GET /` — List invoices
- `POST /:id/send` — Email invoice (admin)
- `POST /:id/refund` — Stripe refund (admin)

### Subscriptions — `/api/subscriptions`

- `POST /` — Create Stripe subscription
- `GET /mine` — Customer's subscriptions
- `PATCH /:id/pause` — Pause
- `DELETE /:id` — Cancel

### Admin — `/api/admin`

- `GET /reports/revenue` — Revenue by date range
- `GET /reports/jobs` — Job completion stats
- `GET /audit-logs` — Paginated audit trail
- `GET /incident-response` — MA 93H breach checklist

---

## Written Information Security Program (WISP) — MA 201 CMR 17.00

This section fulfills the requirement for a Written Information Security Program under Massachusetts regulation 201 CMR 17.00.

### Data Flow

1. **Customer → Frontend**: Users enter name, email, phone, address, and payment info through the Next.js frontend over HTTPS/TLS.
2. **Frontend → Backend**: The frontend communicates with the Express backend via REST API. CORS restricts requests to the authorized frontend origin only.
3. **Backend → Database**: Personal data (name, phone, address) is encrypted with AES-256-CBC before storage in MongoDB. Encryption keys are environment variables, never in code.
4. **Backend → Stripe**: Payment card data is handled exclusively by Stripe's PCI-compliant APIs. Our backend never sees, logs, or stores raw card numbers — only PaymentIntent IDs and Customer IDs.
5. **Backend → SendGrid/Twilio**: Email addresses and phone numbers are passed to SendGrid and Twilio for transactional communications only.
6. **Backend → S3**: Job photos are uploaded directly from the client to S3 via presigned URLs. The backend stores only S3 object keys.

### Access Controls

- **Role-based access control (RBAC)**: Every API endpoint is guarded by authentication middleware and role checks. Customers can only access their own data. Staff can only access their assigned jobs.
- **MFA enforcement**: All admin and staff accounts require TOTP-based multi-factor authentication (via speakeasy). MFA cannot be disabled by the user.
- **JWT session management**: Access tokens expire in 15 minutes. Refresh tokens are stored in httpOnly cookies (not localStorage), rotate on each use, and expire after 7 days.
- **Rate limiting**: Authentication endpoints are rate-limited to 10 requests per 15-minute window per IP address.
- **Input validation**: All request bodies are validated using Zod schemas before processing.

### Encryption Strategy

- **In transit**: All communications are over HTTPS/TLS. In production, HTTP requests are redirected to HTTPS.
- **At rest**: PII fields (name, phone, address) are encrypted using AES-256-CBC with a 256-bit key stored in environment variables. Email is stored in plaintext for index/lookup purposes. Raw card data is never stored.
- **Database security**: MongoDB connections use authenticated credentials. Field-level encryption ensures PII is unreadable even if the database is compromised without the encryption key.

### Audit & Monitoring

- All mutating operations (create, update, delete) are automatically logged to an append-only AuditLog collection.
- Audit entries capture: actor ID, role, action, target collection, target ID, changed fields, IP address, user agent, and timestamp.
- The AuditLog collection has no application-level delete capability (enforced via Mongoose middleware).
- Audit logs are accessible to administrators through the admin dashboard.

### Data Retention & Disposal

- Customer records inactive for 3+ years are automatically soft-deleted by a daily cron job (2:00 AM).
- Customers can request immediate account deletion through the dashboard settings page.
- Soft-deleted records retain audit log references for compliance but PII is no longer accessible.

### Breach Response

- A dedicated incident response page (`/admin/incident-response`) provides a step-by-step checklist aligned to M.G.L. Chapter 93H.
- Response steps: Identify scope → Contain breach → Notify affected MA residents → Notify MA Attorney General within 30 days → Document everything.

### Annual Review

This WISP must be reviewed and updated at least annually, or whenever there is a material change to business practices that affect the security of personal information. The review should be documented and retained.

---

_Last WISP review: March 2026_
stripe listen --forward-to localhost:4000/api/webhooks/stripe
