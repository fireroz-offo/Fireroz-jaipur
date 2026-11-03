-- Shared schema for FIREROZ Doctor + FIREROZ Care (one patient database)
CREATE TABLE IF NOT EXISTS clinics (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, address TEXT, phone TEXT, email TEXT,
  logo_url TEXT, verified BOOLEAN DEFAULT FALSE, kind TEXT DEFAULT 'clinic', -- clinic|hospital|lab
  settings JSONB DEFAULT '{"token_limit":100,"consult_minutes":10,"opd_start":"09:00","opd_end":"20:00","weekly_holidays":["sun"],"online_booking":true,"walkin":true,"language":"en"}'
);
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, mobile TEXT UNIQUE NOT NULL, name TEXT, email TEXT,
  role TEXT NOT NULL CHECK (role IN ('doctor','receptionist','nurse','owner','superadmin','patient')),
  clinic_id INT REFERENCES clinics(id), qualification TEXT, specialization TEXT, license_no TEXT,
  verified BOOLEAN DEFAULT FALSE, active BOOLEAN DEFAULT TRUE, online BOOLEAN DEFAULT FALSE,
  photo_url TEXT, fcm_token TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS patient_seq START 1000;
CREATE TABLE IF NOT EXISTS patients (
  id SERIAL PRIMARY KEY, patient_code TEXT UNIQUE DEFAULT ('PT' || nextval('patient_seq')),
  user_id INT REFERENCES users(id), name TEXT NOT NULL, mobile TEXT NOT NULL, dob DATE, age INT, gender TEXT,
  allergies TEXT, medical_history TEXT, photo_url TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patients_mobile_idx ON patients(mobile);
CREATE INDEX IF NOT EXISTS patients_name_idx ON patients(lower(name));
CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY, clinic_id INT NOT NULL REFERENCES clinics(id), doctor_id INT NOT NULL REFERENCES users(id),
  patient_id INT NOT NULL REFERENCES patients(id), appt_date DATE NOT NULL, appt_time TIME, token INT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('online','walkin')), department TEXT, complaint TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','in_consult','completed','skipped','no_show','cancelled')),
  skip_count INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(), started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  UNIQUE (doctor_id, appt_date, token)
);
CREATE INDEX IF NOT EXISTS appt_queue_idx ON appointments(doctor_id, appt_date, status);
CREATE TABLE IF NOT EXISTS queue_state (
  doctor_id INT, q_date DATE, paused BOOLEAN DEFAULT FALSE, PRIMARY KEY (doctor_id, q_date)
);
CREATE TABLE IF NOT EXISTS prescriptions (
  id SERIAL PRIMARY KEY, patient_id INT NOT NULL REFERENCES patients(id), doctor_id INT NOT NULL REFERENCES users(id),
  appointment_id INT REFERENCES appointments(id), created_at TIMESTAMPTZ DEFAULT now()
);
-- Every edit of an approved prescription = new version needing fresh approval
CREATE TABLE IF NOT EXISTS prescription_versions (
  id SERIAL PRIMARY KEY, prescription_id INT NOT NULL REFERENCES prescriptions(id), version INT NOT NULL,
  data JSONB NOT NULL, -- symptoms, findings, diagnosis, notes, advice, follow_up, medicines[]
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','superseded')),
  approved_by INT REFERENCES users(id), approved_at TIMESTAMPTZ, created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(), UNIQUE (prescription_id, version)
);
-- FIREROZ Care reads ONLY status='approved' versions; reminders are created from these.
CREATE TABLE IF NOT EXISTS visit_notes (
  id SERIAL PRIMARY KEY, patient_id INT REFERENCES patients(id), doctor_id INT REFERENCES users(id),
  note TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id), patient_id INT REFERENCES patients(id),
  category TEXT, title TEXT, body TEXT, deep_link TEXT, read BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS otps (mobile TEXT, code_hash TEXT, expires_at TIMESTAMPTZ, attempts INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id), token_hash TEXT UNIQUE, expires_at TIMESTAMPTZ, revoked BOOLEAN DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY, actor_id INT, action TEXT, entity TEXT, entity_id INT, meta JSONB, at TIMESTAMPTZ DEFAULT now()
);
