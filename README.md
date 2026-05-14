# Klyent

Klyent is a client management SaaS platform for managing clients, tracking payments, collaborating on documents, and viewing business analytics. It uses a React + Vite frontend, a Fastify + TypeScript backend, PostgreSQL, Prisma, and S3-compatible file storage.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, TailwindCSS |
| UI | shadcn/ui, Radix UI primitives |
| State | Zustand, React Query |
| Backend | Node.js, Fastify, TypeScript |
| Database | PostgreSQL, Prisma ORM |
| File Storage | MinIO (local), AWS S3-compatible APIs |
| Auth | JWT with email/password |
| Charts | Recharts |

## Project Structure

```
klyent/
├── apps/
│   ├── backend/          # Fastify API server
│   │   ├── prisma/       # Prisma schema, migrations, seed script
│   │   └── src/          # Backend source code
│   │       ├── routes/   # auth, clients, payments, files, dashboard, activity
│   │       ├── lib/      # Prisma client, S3 client
│   │       ├── plugins/  # CORS, JWT
│   │       └── middleware/
│   └── frontend/         # React app
│       ├── public/      # Static assets
│       └── src/          # Frontend source code
│           ├── api/      # Axios API functions
│           ├── components/
│           │   ├── dashboard/
│           │   ├── files/
│           │   ├── layout/
│           │   ├── payments/
│           │   ├── clients/
│           │   └── ui/
│           ├── hooks/    # React Query hooks
│           ├── pages/    # Route pages
│           ├── store/    # Zustand stores
│           └── types/    # Shared TypeScript types
├── docker-compose.yml    # PostgreSQL + MinIO local infrastructure
└── package.json          # Workspace scripts and shared config
```

## What This Project Includes

- Client CRUD and status tracking
- Payment capture, balance tracking, and history
- File uploads with versioning and S3-compatible storage
- File comments and activity log
- Shareable public file links
- Dashboard analytics and client growth charts
- Full-stack development setup with Docker

## Docker Setup

The repo includes `docker-compose.yml` to start local infrastructure for development.

Services:
- `postgres` — PostgreSQL database on port `5432`
- `minio` — MinIO S3-compatible storage on ports `9000` (API) and `9001` (console)
- `minio-init` — creates the required `klyent-files` bucket and configures public downloads

Start the stack:

```bash
docker-compose up -d
```

Stop the stack:

```bash
docker-compose down
```

## How to Run the Project

### 1. Install dependencies

From the repository root:

```bash
npm install
```

### 2. Start infrastructure

```bash
docker-compose up -d
```

### 3. Configure backend environment

From `apps/backend`:

```bash
cd apps/backend
cp .env.example .env
```

Update `apps/backend/.env` if needed.

### 4. Run database migrations and seed data

```bash
npm run db:migrate
npm run db:seed
```

### 5. Start the application

From the root:

```bash
npm run dev
```

Visit:

```text
http://localhost:5173
```

## Available Scripts

From the repository root:

- `npm install` — install workspace dependencies
- `npm run dev` — start backend and frontend concurrently
- `npm run build` — build backend and frontend
- `npm run db:migrate` — run Prisma migrations
- `npm run db:seed` — seed the database
- `npm run db:studio` — start Prisma Studio

Backend scripts (`apps/backend`):

- `npm run dev` — start backend in watch mode
- `npm run build` — compile TypeScript
- `npm run start` — run compiled backend
- `npm run db:generate` — generate Prisma client
- `npm run db:migrate` — apply migrations
- `npm run db:seed` — seed data
- `npm run db:studio` — open Prisma Studio

Frontend scripts (`apps/frontend`):

- `npm run dev` — start Vite development server
- `npm run build` — build frontend
- `npm run preview` — preview production build
- `npm run lint` — run ESLint

## Key Functionality

### Client Management
- Add, edit, and remove clients
- Search by name or email
- Track client status and progress

### Payments
- Record client payments
- Support multiple payment methods
- Auto-calculate totals and remaining balance
- Show payment history timeline

### File Management
- Upload PDF, JPG, PNG files
- Store files in S3-compatible storage
- Version uploaded files
- Preview files in-browser
- Share files publicly with token links

### Collaboration
- File comment threads
- Client activity logs for payments, uploads, and status changes

### Dashboard
- Revenue summaries
- Client growth charts
- Pending payment totals
- Recent activity feed

## API Overview

Base API URL: `http://localhost:3001/api`

### Auth
- `POST /auth/register` — Register a new user
- `POST /auth/login` — Login and receive JWT
- `GET /auth/me` — Get current user information

### Clients
- `GET /clients` — List clients
- `POST /clients` — Create a client
- `GET /clients/:id` — Get a client
- `PATCH /clients/:id` — Update a client
- `DELETE /clients/:id` — Remove a client
- `GET /clients/:id/stats` — Get client payment stats

### Payments
- `GET /payments` — List payments
- `POST /payments` — Create a payment
- `PATCH /payments/:id` — Update a payment
- `DELETE /payments/:id` — Delete a payment

### Files
- `GET /files?clientId=X` — List client files
- `POST /files/upload` — Upload a file
- `GET /files/:id/versions` — File version history
- `GET /files/:id/download` — Download file
- `GET /files/:id/preview` — Get preview URL
- `DELETE /files/:id` — Delete file
- `GET /files/share/:token` — Shared public file access
- `GET /files/:id/comments` — List comments
- `POST /files/:id/comments` — Create comment

### Dashboard
- `GET /dashboard/stats` — Summary analytics data

### Activity
- `GET /activity` — Activity log

## Environment Variables

Typical backend environment variables for `apps/backend/.env`:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/klyent?schema=public"
JWT_SECRET="your_jwt_secret"
JWT_EXPIRY="7d"
PORT=3001
CORS_ORIGIN="http://localhost:5173"

S3_ENDPOINT="http://localhost:9000"
S3_REGION="us-east-1"
S3_ACCESS_KEY_ID="minioadmin"
S3_SECRET_ACCESS_KEY="minioadmin"
S3_BUCKET="klyent-files"
```

## Notes

- The frontend talks to the backend on `http://localhost:3001`.
- Local file storage uses MinIO and the `klyent-files` bucket.
- Public share links allow read-only access without authentication.
- Use `npm run build` before deploying to production.

## License

Private repository.


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