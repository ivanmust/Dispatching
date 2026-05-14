# Dispatch Master Deployment

This setup hosts the backend on Render, hosts the Dispatcher and Admin Portal on Vercel, and builds the Responder Android APK with Expo EAS.

## Target Architecture

- Backend API and Socket.IO: Render web service
- PostgreSQL: existing Render Postgres, Neon, Supabase, or another public Postgres provider
- Dispatcher web app: Vercel project with root directory `dispatcher`
- Admin Portal web app: Vercel project with root directory `admin-portal`
- Responder mobile app: Android APK built from `responder-mobile`

The mobile app and Vercel apps must use the public Render backend URL, not a LAN IP such as `192.168.x.x`.

## Backend on Render

1. Push the repository to GitHub.
2. In Render, create a new Blueprint from `render.yaml`, or create a Web Service manually:
   - Root directory: `backend`
   - Build command: `npm install && npm run build`
   - Start command: `npm run migrate && npm start`
   - Health check path: `/health`
3. Set these Render environment variables:
   - `NODE_ENV=production`
   - `PORT=3003`
   - `DATABASE_URL=<your real Postgres connection string>`
   - `JWT_SECRET=<strong random secret>`
   - `ADMIN_PORTAL_USERNAME=<admin username>`
   - `ADMIN_PORTAL_PASSWORD=<strong admin password>`
   - `ADMIN_PORTAL_JWT_SECRET=<strong random secret>`
   - `ALLOWED_ORIGINS=https://your-dispatcher.vercel.app,https://your-admin.vercel.app`
4. Add ArcGIS routing variables if the secured routing service needs them:
   - `NAV_ARCGIS_CLOSEST_FACILITY_URL`
   - `NAV_ARCGIS_PORTAL_URL`
   - `NAV_ARCGIS_USERNAME`
   - `NAV_ARCGIS_PASSWORD`

After the backend deploys, confirm:

```powershell
curl https://your-render-backend.onrender.com/health
```

## Dispatcher on Vercel

Create a Vercel project with root directory `dispatcher`.

Set environment variables:

```text
VITE_API_BASE=https://your-render-backend.onrender.com/api
VITE_SOCKET_URL=https://your-render-backend.onrender.com
VITE_ESRI_MAP_VIEWER_URL=https://esrirw.rw/portal/apps/mapviewer/index.html?webmap=3e190cfba7fd4d1f8c9600cc072a6d15
VITE_ESRI_MAP_NAVIGATION_MINIMAL=true
```

Build command:

```text
npm run build
```

Output directory:

```text
dist
```

## Admin Portal on Vercel

Create a second Vercel project with root directory `admin-portal`.

Set environment variable:

```text
VITE_API_BASE=https://your-render-backend.onrender.com/api
```

Build command:

```text
npm run build
```

Output directory:

```text
dist
```

After both Vercel projects are deployed, update Render `ALLOWED_ORIGINS` with the final Vercel URLs and redeploy the backend.

## Responder APK

Install and log in to EAS:

```powershell
cd responder-mobile
npm install
npx --yes eas-cli login
```

Set production environment values before building:

```powershell
copy .env.production.example .env.production
```

Edit `.env.production` and set:

```text
EXPO_PUBLIC_STRICT_API_BASE=1
EXPO_PUBLIC_API_BASE=https://your-render-backend.onrender.com/api
```

Build an internal APK:

```powershell
npx --yes eas-cli build -p android --profile preview
```

When EAS finishes, download the APK from the build link and install it on responder devices.

## Important Notes

- Admin Portal and Dispatcher are web apps. They are best used from the browser/PWA after Vercel deployment.
- The Responder app is the native Android APK.
- If you also need Dispatcher/Admin as APKs, add Android wrappers later using Capacitor or Trusted Web Activity.
- Render free web services may sleep after inactivity. That can delay first login/socket connection. For live CAD operations, a paid always-on backend is safer.
- Do not use a LAN IP in production mobile builds. Always use the public HTTPS Render URL.
