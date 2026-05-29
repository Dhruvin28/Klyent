# Klyent

Klyent is a client management SaaS platform for freelancers and small businesses. It lets you manage clients, track payments, upload and share documents, send payment reminders via WhatsApp, and view business analytics from a single dashboard.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, TailwindCSS |
| UI Components | shadcn/ui, Radix UI primitives, Lucide icons |
| State Management | Zustand (auth), TanStack React Query (server state) |
| Charts | Recharts |
| Backend | Node.js, Fastify v4, TypeScript |
| ORM | Drizzle ORM (MySQL dialect) |
| Database | MySQL (Azure Database for MySQL / any MySQL 8+) |
| File Storage | Cloudflare R2 (S3-compatible, public bucket) |
| Auth | JWT — email + password, bcrypt hashing |
| Deployment | Azure App Service (Windows), GitHub Actions CI/CD |

## Features

- **Client management** — Add, edit, delete clients with status tracking (Active / Completed / On Hold)
- **Payment tracking** — Record payments (Cash / Online / Cheque), auto-calculate totals and remaining balances
- **Payment reminders** — Generate a pre-filled WhatsApp message with outstanding balance details
- **Company profile** — Upload company logo (stored on Cloudflare R2), set company name, phone, address, website, GSTIN
- **Company banner** — Dashboard shows company name and logo when set
- **File management** — Upload PDF, Word, Excel, image files per client; automatic versioning when re-uploading the same filename
- **File sharing** — Generate a permanent public share link per file (served from R2 public URL)
- **Dashboard analytics** — Revenue summary, client growth, pending payments, active clients; all tiles are clickable and show detailed breakdowns
- **Activity log** — Per-client log of payments, uploads, status changes, and comments
- **File comments** — Threaded comments on individual files
- **Dark mode** — Full light/dark theme support

## Project Structure

```
klyent/
├── apps/
│   ├── backend/                  # Fastify API server
│   │   ├── src/
│   │   │   ├── db/               # Drizzle schema and db client
│   │   │   ├── lib/              # S3/R2 client (upload, delete)
│   │   │   ├── middleware/       # JWT authenticate middleware
│   │   │   ├── plugins/          # CORS, JWT Fastify plugins
│   │   │   ├── routes/           # auth, clients, payments, files, dashboard, activity
│   │   │   ├── app.ts            # Fastify app factory
│   │   │   ├── config.ts         # Environment config
│   │   │   ├── index.ts          # Entry point (runs migrations then starts server)
│   │   │   └── migrate.ts        # Inline DB migration runner
│   │   ├── .env.example
│   │   └── package.json
│   └── frontend/                 # React SPA
│       └── src/
│           ├── api/              # Axios API functions
│           ├── components/
│           │   ├── clients/      # ClientTable, ClientForm, PaymentReminderDialog, etc.
│           │   ├── dashboard/    # StatsCard, DashboardDetailModal, charts
│           │   ├── files/        # FileUpload, FileList, FilePreview, CommentSection
│           │   ├── payments/     # PaymentForm, PaymentTimeline, PaymentSummary
│           │   ├── layout/       # AppLayout, Sidebar, Header
│           │   ├── common/       # EmptyState, ConfirmDialog, SearchInput
│           │   └── ui/           # shadcn/ui primitives
│           ├── hooks/            # React Query hooks (useClients, usePayments, useFiles, etc.)
│           ├── pages/            # Route-level pages
│           ├── store/            # Zustand auth store (persisted to localStorage)
│           └── types/            # Shared TypeScript interfaces
├── .github/
│   └── workflows/
│       └── azure-deploy.yml      # GitHub Actions — build and deploy to Azure
└── package.json                  # npm workspaces root
```

## Database Schema

```
users ──< clients ──< payments
                 ├──< files ──< file_versions
                 │          └──< comments
                 └──< activity_logs
```

Migrations run automatically on server startup via `runMigrations()` in `src/migrate.ts`. Tables are created with `CREATE TABLE IF NOT EXISTS` so it is safe to run on every deploy.

## Local Development

### Prerequisites

- Node.js 20+
- MySQL 8+ (local or remote)
- Cloudflare R2 bucket with public access enabled

### 1. Install dependencies

```bash
npm install
```

### 2. Configure backend environment

```bash
cp apps/backend/.env.example apps/backend/.env
```

Fill in `apps/backend/.env`:

```env
# MySQL
DATABASE_URL="mysql://user:password@localhost:3306/klyentdb"
DB_HOST="localhost"
DB_PORT="3306"
DB_USER="user"
DB_PASSWORD="password"
DB_NAME="klyentdb"

# Auth
JWT_SECRET="change-this-to-a-secure-random-string-32-chars-min"
JWT_EXPIRY="7d"

# Server
PORT=3001
HOST="0.0.0.0"
CORS_ORIGIN="http://localhost:5173"

# Cloudflare R2
R2_ACCOUNT_ID="your_account_id"
R2_ACCESS_KEY_ID="your_access_key"
R2_SECRET_ACCESS_KEY="your_secret_key"
R2_BUCKET_NAME="your_bucket_name"
R2_PUBLIC_URL="https://pub-xxxx.r2.dev"
```

### 3. Start the dev servers

```bash
npm run dev
```

This starts the backend (port `3001`) and frontend (port `5173`) concurrently.

Visit `http://localhost:5173`

## Cloudflare R2 Setup

1. Create an R2 bucket in the Cloudflare dashboard
2. Go to the bucket → **Settings** → **Public Access** → **Allow Access**
3. Copy the public URL (e.g. `https://pub-xxxx.r2.dev`) — set this as `R2_PUBLIC_URL`
4. Create an API token under **R2 → Manage R2 API Tokens** with Read/Write access
5. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` from the token details

All uploaded files (company logos and documents) are stored in R2 and served via the public URL directly. No presigned URLs are used.

## Production Build

```bash
npm run build
npm start
```

The backend compiles TypeScript to `apps/backend/dist/`. The frontend builds to `apps/frontend/dist/`. In production mode, the backend serves the frontend's static files automatically.

## Deployment — Azure App Service

The repo includes a GitHub Actions workflow at `.github/workflows/azure-deploy.yml`.

### How it works

1. Triggered on push to `main` or manually via **Actions → Run workflow** (with branch selection)
2. Installs dependencies, builds frontend and backend
3. Prunes dev dependencies
4. Packages `dist/` files and `node_modules` into a `deploy/` folder
5. Deploys to Azure App Service using a publish profile secret

### Required GitHub Secret

| Secret | Description |
|---|---|
| `AZURE_WEBAPP_PUBLISH_PROFILE` | Download from Azure Portal → App Service → **Get publish profile** |

### Required Azure App Service Settings

Set these under **App Service → Configuration → Application settings**:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `WEBSITES_PORT` | `3001` |
| `DATABASE_URL` | MySQL connection string |
| `DB_HOST` | MySQL host |
| `DB_PORT` | `3306` |
| `DB_USER` | MySQL user |
| `DB_PASSWORD` | MySQL password |
| `DB_NAME` | Database name |
| `JWT_SECRET` | Random 32+ char string |
| `JWT_EXPIRY` | `7d` |
| `CORS_ORIGIN` | Your frontend URL |
| `R2_ACCOUNT_ID` | Cloudflare R2 account ID |
| `R2_ACCESS_KEY_ID` | R2 API token key ID |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET_NAME` | R2 bucket name |
| `R2_PUBLIC_URL` | R2 public URL (e.g. `https://pub-xxxx.r2.dev`) |

The app's **Startup Command** in Azure should be:

```
node apps/backend/dist/index.js
```

## Available Scripts

### Root (runs across workspaces)

| Script | Description |
|---|---|
| `npm install` | Install all workspace dependencies |
| `npm run dev` | Start backend and frontend in watch mode concurrently |
| `npm run build` | Build frontend then backend |
| `npm start` | Run the compiled production server |
| `npm run db:migrate` | Push Drizzle schema to the database |
| `npm run db:studio` | Open Drizzle Studio (DB browser) |

### Backend (`apps/backend`)

| Script | Description |
|---|---|
| `npm run dev` | Start with `tsx watch` (hot reload) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run compiled server |
| `npm run db:migrate` | Run `drizzle-kit push` |
| `npm run db:studio` | Open Drizzle Studio |

### Frontend (`apps/frontend`)

| Script | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run ESLint |

## API Overview

Base URL: `http://localhost:3001/api`

All routes except `/auth/register`, `/auth/login`, and `/files/share/:token` require a `Bearer` JWT token in the `Authorization` header.

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | No | Create account |
| POST | `/auth/login` | No | Login, receive JWT |
| GET | `/auth/me` | Yes | Get current user + company info |
| PATCH | `/auth/me` | Yes | Update profile and company details |
| POST | `/auth/me/logo` | Yes | Upload company logo (multipart) |
| PATCH | `/auth/me/password` | Yes | Change password |

### Clients

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/clients` | Yes | List with search, filter, sort, pagination |
| POST | `/clients` | Yes | Create client |
| GET | `/clients/:id` | Yes | Get client detail |
| PATCH | `/clients/:id` | Yes | Update client |
| DELETE | `/clients/:id` | Yes | Delete client and all related data |
| GET | `/clients/:id/stats` | Yes | Payment stats (paid, remaining, etc.) |

### Payments

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/payments` | Yes | List with filter by client, method, date range |
| POST | `/payments` | Yes | Record a payment |
| PATCH | `/payments/:id` | Yes | Update a payment |
| DELETE | `/payments/:id` | Yes | Delete a payment |

### Files

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/files?clientId=X` | Yes | List files for a client |
| POST | `/files/upload` | Yes | Upload file (multipart); auto-versions on same filename |
| GET | `/files/:id/versions` | Yes | List all versions |
| GET | `/files/:id/download` | Yes | Redirect to public R2 file URL |
| GET | `/files/:id/preview` | Yes | Return public R2 URL as JSON |
| DELETE | `/files/:id` | Yes | Soft or hard delete (`?hard=true`) |
| GET | `/files/share/:token` | **No** | Public shared file — returns permanent download URL |
| GET | `/files/:id/comments` | Yes | List comments (paginated) |
| POST | `/files/:id/comments` | Yes | Add a comment |

### Dashboard

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/dashboard/stats` | Yes | Revenue, client counts, pending balance, monthly breakdown |

### Activity

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/activity` | Yes | Activity log (filter by `clientId`) |

## Environment Variables Reference

### Backend (`apps/backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Full MySQL connection URI |
| `DB_HOST` | Yes | MySQL host |
| `DB_PORT` | Yes | MySQL port (default `3306`) |
| `DB_USER` | Yes | MySQL username |
| `DB_PASSWORD` | Yes | MySQL password |
| `DB_NAME` | Yes | Database name |
| `JWT_SECRET` | Yes | Secret for signing JWTs (32+ chars in production) |
| `JWT_EXPIRY` | No | Token expiry, default `7d` |
| `PORT` | No | Server port, default `3001` |
| `HOST` | No | Bind address, default `0.0.0.0` |
| `CORS_ORIGIN` | Yes | Comma-separated list of allowed frontend origins |
| `R2_ACCOUNT_ID` | Yes | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Yes | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | Yes | R2 API token secret |
| `R2_BUCKET_NAME` | Yes | R2 bucket name |
| `R2_PUBLIC_URL` | Yes | Public base URL for the R2 bucket (e.g. `https://pub-xxxx.r2.dev`) |
| `NODE_ENV` | No | Set to `production` to enable static file serving and minified logs |

## License

Private repository.
