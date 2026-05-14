# CAD - Computer-Aided Dispatch System

A full-stack Computer-Aided Dispatch (CAD) system for managing incidents, responders, and real-time communication. Built with Node.js, React, PostgreSQL, Socket.IO, and ArcGIS maps.

## Architecture

| App | Purpose | Tech |
|-----|---------|------|
| **backend** | API, real-time, auth | Node.js, Express, PostgreSQL, Socket.IO |
| **dispatcher** | Dispatcher console (assign responders, manage incidents) | React, Vite, ArcGIS JS, Shadcn UI |
| **responder-mobile** | Field responder app (incidents, map, chat, video) | Expo, React Native |
| **admin-portal** | Executive dashboard, users, settings | React, Vite, Shadcn UI |

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- (Optional) ArcGIS credentials for routing: `ARCGIS_CLIENT_ID`, `ARCGIS_CLIENT_SECRET`

## Quick Start

### 1. Database

Create a PostgreSQL database and set `DATABASE_URL`:

```bash
# Example: postgres://user:password@localhost:5432/cad
export DATABASE_URL=postgres://postgres:postgres@localhost:5433/cad
```

Run migrations:

```bash
cd backend
npm install
npm run migrate
```

### 2. Backend

```bash
cd backend
npm install
npm run dev
```

Backend runs at `http://localhost:3001`. Create dispatcher/responder accounts via **Register** in the dispatcher or responder mobile login flow (or your own provisioning). Demo users are not seeded automatically.

### Real data for the admin dashboard and database

The executive dashboard and all incident APIs read **only** what is stored in PostgreSQL. There is no bundled fake dataset.

1. **Schema** — `cd backend && npm run migrate` on your database.
2. **Admin portal** — Sign in (`admin` / `Admin@12345` by default locally). Under **Settings**, enable **dispatcher** and/or **responder** incident creation if those roles should open cases from their apps.
3. **People** — Under **Users**, add dispatchers and responders (or leave **user registration** on so they self-register from the dispatcher/responder login screens).
4. **Operations** — Use the **dispatcher** app to create incidents, assign units, and drive status to completed/closed. Use **responder-mobile** to accept and complete work in the field. Every save goes to the DB; the admin dashboard picks it up on the next load or auto-refresh.
5. **Avoid wiping production** — `npm run cleanup:demo-data` is for removing **test/demo** rows only. Do not run it on a database you want to keep entirely.

### 3. Frontend Apps

Run each app in a separate terminal:

**Dispatcher** (port 8080):

```bash
cd dispatcher
npm install
npm run dev
```

**Admin portal** (example port 8087):

```bash
cd admin-portal
npm install
npm run dev -- --port 8087
```

**Responder mobile** (Expo):

```bash
cd responder-mobile
npm install
npm start
# Then press a for Android, i for iOS, or w for web preview
```

## Environment Variables

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API server port |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5433/cad` | PostgreSQL connection string |
| `ARCGIS_CLIENT_ID` | - | ArcGIS routing; omit for straight-line fallback |
| `ARCGIS_CLIENT_SECRET` | - | ArcGIS routing; omit for straight-line fallback |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | - | Email; omit to use Ethereal test account |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE` | `http://localhost:3001/api` | Backend API base URL |
| `VITE_RWANDA_VILLAGE_BOUNDARIES_URL` | ArcGIS FeatureServer default | Override for Rwanda address lookup. See [Rwanda Geocoding](#rwanda-geocoding) below. |

To remove leftover demo or e2e rows from PostgreSQL, run `cd backend && npm run cleanup:demo-data` (review the script predicates first).

Feature areas (chat attachments, POIs, geofences, unit filters) are implemented in the backend routes and the dispatcher / responder-mobile clients; see source under `backend/src/routes` and each app’s `src` tree.

## Rwanda Geocoding

The dispatcher app and responder mobile map use the **Rwanda Village Boundaries** ArcGIS FeatureServer to reverse-geocode coordinates to administrative addresses (province, district, sector, cell, village).

- **Env var**: `VITE_RWANDA_VILLAGE_BOUNDARIES_URL` – optional override for the FeatureServer query URL
- **Default**: `https://esrirw.rw/server/rest/services/Hosted/Rwanda_Administrative_Boundaries1/FeatureServer/5/query`
- **Limits**: Public API may have rate limits. Coordinates should be within Rwanda for best results.
- **Fallback**: On network or parse errors, the lookup returns an empty object; the UI falls back to stored address or raw coordinates.

## Departments and Assignment

### Units (Departments)

Responders belong to one of three units:

| Unit | Purpose |
|------|---------|
| **EMS** | Emergency Medical Services |
| **TRAFFIC_POLICE** | Traffic enforcement and incidents |
| **CRIME_POLICE** | Crime and general law enforcement |

### Registration Flow

- New responders register with a **unit** via `POST /api/auth/register` (`unit` in body).
- Dispatchers do not have a unit.
- Responders can view and respond only to incidents assigned to them.
- Responders can **report incidents** from the field; these are sent to dispatch for accept/reject and assignment.

### Assignment Logic

- Incidents have a **category** (e.g. MEDICAL, TRAFFIC, CRIME). The system maps category → preferred unit.
- When assigning, the dispatcher sees responders filtered by the incident’s preferred unit.
- **Unit override**: If the dispatcher assigns a responder from a different unit (e.g. EMS to a TRAFFIC incident), a confirmation dialog appears. Choosing “Assign anyway” sends `unitOverride: true` to the API and is recorded in the audit log.
- **Reassignment**: Dispatchers can reassign an already-assigned incident (ASSIGNED, IN_PROGRESS) to a different responder via “Reassign to another responder” in the incident panel.
- **Responder-reported incidents**: Responders can create incidents from the field. These appear in dispatcher alerts for Accept or Reject. If accepted, the incident moves to the main list as unassigned; the dispatcher then assigns a responder. Responders cannot assign incidents themselves.

### Filters

- **Incidents**: `GET /api/incidents` supports `?status=`, `?unit=`, `?limit=`, `?offset=` for server-side filtering. Status can be comma-separated (e.g. `NEW,ASSIGNED`). Unit filters by assigned responder’s unit; unassigned incidents are excluded when unit is set.
- **Responders**: `GET /api/responders?unit=EMS|TRAFFIC_POLICE|CRIME_POLICE` filters by unit; omit to list all.

## API Overview

- `POST /api/auth/login` – Login (returns token)
- `POST /api/auth/register` – Register (dispatcher/responder/supervisor roles as applicable)
- `GET /api/incidents` – List incidents (`?status=`, `?unit=`, `?limit=`, `?offset=`)
- `GET /api/incidents/mine` – Operator’s incidents
- `POST /api/incidents` – Create incident (dispatcher, responder, per role settings)
- `POST /api/incidents/:id/assign` – Assign responder (dispatcher)
- `POST /api/incidents/:id/reassign` – Reassign to another responder (dispatcher; body: `{ responderId, unitOverride?, reason? }`)
- `PATCH /api/incidents/:id/status` – Update status (dispatcher, assigned responder)
- `GET /api/responder/incidents` – Assigned incidents (responder)
- `GET /api/incidents/:id/history` – Incident status timeline (dispatcher, responder, supervisor)
- `GET /api/incidents/:id/messages`, `POST` – Chat (authenticated)
- `GET /api/responders` – List responders (dispatcher, supervisor)
- `POST /api/responder/location` – Responder location (responder)
- `GET /api/audit` – Audit logs (dispatcher, supervisor; `?action=`, `?limit=`, `?offset=`)
- `POST /api/test-email` – Test email (body: `{ to, subject?, body? }`)
> Routing, ETA, and live-navigation endpoints have been retired pending a rebuild on ArcGIS Enterprise. See `docs/routing-navigation-eta.md`.
- `GET /api/twilio/status` – Check if Twilio is configured
- `POST /api/twilio/sms` – Send SMS (body: `{ to, body }`)

All incident and chat endpoints require authentication via `Authorization: Bearer <token>`.

## Real-time (Socket.IO)

- `incident:assigned` – New assignment for responder
- `incident:statusUpdate`, `incident:statusChange` – Status updates
- `chat:newMessage` – New chat message
- `responder:location` – Responder GPS updates
- `responder:availability` – Online/available
- `video:*` – WebRTC signaling for live video

## Development

```bash
# Backend
cd backend && npm run dev

# Dispatcher
cd dispatcher && npm run dev

# Admin portal
cd admin-portal && npm run dev

# Responder mobile (Expo)
cd responder-mobile && npm start
```

## Tests

Backend integration tests use a separate database (`cad_test`) so test data never appears in the app. Create it once:

```bash
# If using local Postgres (default port 5433)
createdb -p 5433 cad_test
```

```bash
# Backend unit + integration tests
cd backend && npm test

# E2E (starts backend + dispatcher, then runs Playwright)
npm run test:e2e
```

## Build

```bash
cd backend && npm run build
cd dispatcher && npm run build
cd admin-portal && npm run build
cd responder-mobile && npm run build
```

## Integrations (Testing Phase)

External services that are easy to obtain for testing:

| Service  | Signup  | Use for           |
|----------|---------|-------------------|
| ArcGIS   | Free    | Maps, routing     |
| Ethereal | None    | Email (test)      |
| Mailtrap | Free    | Email (test)      |
| Resend   | Free    | Email (real)      |
| Twilio   | Trial   | SMS/voice (future)|

Configure ArcGIS, email (SMTP), and Twilio using the environment variables in this README and `backend` / app `.env.example` files where provided.

- **ArcGIS:** [developers.arcgis.com](https://developers.arcgis.com/) → get `ARCGIS_CLIENT_ID` / `ARCGIS_CLIENT_SECRET`. Without them, routing uses a straight-line fallback.
- **Email:** No SMTP config → Ethereal test account is auto-created on first send. Or set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` for Mailtrap/Resend.

## Production

1. Set `NODE_ENV=production`
2. Set `DATABASE_URL` to your production PostgreSQL
3. Run `npm run migrate` in backend
4. Run `npm run build` in `backend`, `dispatcher`, `admin-portal`, and `responder-mobile` (Expo web export for mobile’s web artifact)
5. Serve backend with `node dist/index.js` and static frontends with your preferred server (nginx, etc.). Publish native builds via EAS or your store pipeline for **responder-mobile**.

### Docker

```bash
# Copy and configure env
cp .env.example .env
# Edit .env with production values (DATABASE_URL, JWT_SECRET, etc.)

# Build and run backend + Postgres
docker-compose -f docker-compose.prod.yml up -d

# Run schema migration (first time only; env comes from docker-compose)
docker-compose -f docker-compose.prod.yml exec backend node -e "
  const { pool } = require('./dist/db');
  const fs = require('fs');
  const sql = fs.readFileSync('/app/schema.sql', 'utf8');
  pool.query(sql).then(() => { console.log('Schema applied'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
"
```

The backend uses a multi-stage Dockerfile; the final image contains only production dependencies and the compiled `dist/` output.
