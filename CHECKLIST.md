# Honest status — what is NOT finished yet
- SMS provider: backend/src/auth.js `sendSms` is a stub (OTP printed in dev only).
- Push notifications: DB notifications work; FCM sending stub in server.js `notify()`. Add google-services.json + FCM_SERVICE_ACCOUNT.
- Report/document upload + cloud storage: not built (needs bucket credentials).
- Prescription PDF: uses browser print for now; server-side PDF recommended.
- 3D splash: CSS animated (logo + ring + glow). Real 3D stethoscope needs a 3D asset/three.js.
- Super Admin panel UI, labs/hospital branches UI, multi-clinic doctor association: API partly ready, UI pending.
- Appointment booking by patients lives in FIREROZ Care (writes to same `appointments` table).
- Medicine alarms must be built/tested in FIREROZ Care (approved `prescription_versions` rows).
- Not tested end-to-end: no network in build sandbox. Run migrations + test before production. Add HTTPS, backups, rate limits, security review.
