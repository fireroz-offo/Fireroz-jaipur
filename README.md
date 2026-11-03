# FIREROZ Doctor — Dare to Be Different.

Doctor / clinic management app (React + Vite + Capacitor Android) with Node.js + Express + PostgreSQL backend
that is **shared with FIREROZ Care** (one patient database, approved prescriptions are read by Care).

## Quick start
### Backend
```
cd backend && cp .env.example .env   # fill DATABASE_URL, JWT_SECRET
npm install && npm run migrate && npm start
```
In development, OTP is printed in the server console. Create a first owner/superadmin user via SQL
(`INSERT INTO users(mobile,name,role,clinic_id,verified) ...`).

### App
```
cd app && cp .env.example .env   # set VITE_API_URL / VITE_WS_URL
npm install && npm run dev
```
TV screen: open `#/tv/<doctorId>` on the waiting-room TV browser.

### Android APK (GitHub Actions)
1. Push repo to GitHub, add secrets `API_URL` (and `WS_URL`).
2. Actions → "Build FIREROZ Doctor APK" → Run. Download APK from the run's Artifacts.
(Upload zip? Put `fireroz-doctor.zip` in repo root → "Unzip project" workflow extracts it.)

## Implemented
OTP login + refresh tokens, role-based access (doctor/receptionist/nurse/owner/superadmin), doctor registration (unverified until admin verifies),
dashboard, today's patients, walk-in (dedupe + token limit), patient search/profile/history/notes, prescription editor with validation,
doctor-only approval with versioning + audit log, live queue (NEXT/HOLD/SKIP/NO-SHOW/COMPLETE, WebSocket), TV screen, reports (CSV/print),
clinic settings, staff management, notifications, Hindi/English, splash with skip + short repeat launch + reduced-motion.

## Needs your config / further work (see CHECKLIST.md)
SMS OTP provider, Firebase push (FCM), cloud file storage for report uploads, PDF generation (server-side), real 3D splash assets,
Super-admin UI, lab network, branches, and medicine alarms in FIREROZ Care.
