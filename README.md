# Klyent

Production-ready SaaS for client management, payment tracking, and document collaboration.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, TailwindCSS, shadcn/ui |
| State | Zustand (auth), React Query (server state) |
| Backend | Node.js, Fastify, TypeScript |
| Database | PostgreSQL, Prisma ORM |
| File Storage | S3-compatible (MinIO for local dev, AWS S3 for prod) |
| Auth | JWT (email/password) |
| Charts | Recharts |

## Project Structure

```
klyent/
├── apps/
│   ├── backend/          # Fastify API server
│   │   ├── prisma/       # Schema + seed script
│   │   └── src/
│   │       ├── routes/   # auth, clients, payments, files, dashboard, activity
│   │       ├── lib/      # Prisma client, S3 client
│   │       ├── plugins/  # CORS, JWT
│   │       └── middleware/
│   └── frontend/         # React app
│       └── src/
│           ├── pages/    # All route pages
│           ├── components/
│           │   ├── ui/   # shadcn/ui components
│           │   ├── layout/
│           │   ├── clients/
│           │   ├── payments/
│           │   ├── files/
│           │   └── dashboard/
│           ├── hooks/    # React Query hooks
│           ├── api/      # Axios API functions
│           ├── store/    # Zustand stores
│           └── types/    # Shared TypeScript types
├── docker-compose.yml    # PostgreSQL + MinIO
└── package.json          # Workspace root
```

## Quick Start

### 1. Start infrastructure

```bash
docker-compose up -d
```

This starts:
- PostgreSQL on port 5432
- MinIO (S3-compatible) on port 9000 (API) + 9001 (console)

### 2. Backend setup

```bash
cd apps/backend
cp .env.example .env      # edit DATABASE_URL, JWT_SECRET if needed
npm install
npm run db:migrate        # run Prisma migrations
npm run db:seed           # seed demo data
npm run dev               # start on http://localhost:3001
```

### 3. Frontend setup

```bash
cd apps/frontend
npm install
npm run dev               # start on http://localhost:5173
```

### 4. Open the app

Visit [http://localhost:5173](http://localhost:5173)

**Demo accounts:**
| Role | Email | Password |
|---|---|---|
| Admin | admin@klyent.com | Admin123! |
| Member | member@klyent.com | Member123! |

---

## Features

### Client Management
- Create, read, update, delete clients
- Status tracking: Active, Completed, On Hold
- Full-text search by name and email
- Per-client payment summary and progress

### Payment Tracking
- Multiple payments per client
- Methods: Cash, Online, Cheque
- Auto-calculated: total paid, remaining balance
- Payment timeline UI
- Mark client as fully paid

### Document Management
- Upload PDF / JPG / PNG files per client
- Automatic versioning (each upload creates a new version)
- Presigned S3 URLs for secure access
- In-browser preview (images + PDFs)
- Shareable read-only links (no auth required)

### Collaboration
- Comment threads on files
- Per-client activity log (payments, uploads, status changes)

### Dashboard & Analytics
- Revenue totals and monthly trends
- Client growth over time
- Pending payments summary
- Recent activity feed

---

## API Reference

Base URL: `http://localhost:3001/api`

### Auth
| Method | Path | Description |
|---|---|---|
| POST | /auth/register | Create account |
| POST | /auth/login | Login, get JWT |
| GET | /auth/me | Get current user |

### Clients
| Method | Path | Description |
|---|---|---|
| GET | /clients | List (search, filter, paginate) |
| POST | /clients | Create client |
| GET | /clients/:id | Get client detail |
| PATCH | /clients/:id | Update client |
| DELETE | /clients/:id | Delete client |
| GET | /clients/:id/stats | Payment stats |

### Payments
| Method | Path | Description |
|---|---|---|
| GET | /payments | List (filter by client, date, method) |
| POST | /payments | Create payment |
| PATCH | /payments/:id | Update payment |
| DELETE | /payments/:id | Delete payment |

### Files
| Method | Path | Description |
|---|---|---|
| GET | /files?clientId=X | List files |
| POST | /files/upload | Upload file (multipart) |
| GET | /files/:id/versions | File versions |
| GET | /files/:id/download | Download (presigned redirect) |
| GET | /files/:id/preview | Preview URL (JSON) |
| DELETE | /files/:id | Delete file |
| GET | /files/share/:token | **Public** — shared file preview |
| GET | /files/:id/comments | List comments |
| POST | /files/:id/comments | Add comment |

### Dashboard
| Method | Path | Description |
|---|---|---|
| GET | /dashboard/stats | Aggregated analytics |

### Activity
| Method | Path | Description |
|---|---|---|
| GET | /activity | Activity log (filter by clientId) |

---

## Database Schema

```
User ──< Client ──< Payment
              ├──< File ──< FileVersion
              │         └──< Comment
              └──< ActivityLog
```

---

## Environment Variables

### Backend (`apps/backend/.env`)

```env
DATABASE_URL="postgresql://..."
JWT_SECRET="..."
JWT_EXPIRY="7d"
PORT=3001
CORS_ORIGIN="http://localhost:5173"

# S3 / MinIO
S3_REGION="us-east-1"
S3_BUCKET="klyent-files"
S3_ENDPOINT="http://localhost:9000"   # omit for AWS S3
S3_ACCESS_KEY_ID="..."
S3_SECRET_ACCESS_KEY="..."
S3_FORCE_PATH_STYLE="true"           # set false for AWS S3
```

---

## Production Deployment

1. Set `NODE_ENV=production`
2. Use a strong random `JWT_SECRET` (32+ chars)
3. Replace MinIO with AWS S3 (remove `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE`)
4. Run `npm run db:migrate` against production DB before deploy
5. Build frontend: `npm run build --workspace=apps/frontend`
6. Serve the `dist/` folder via nginx or a CDN