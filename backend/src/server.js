import express from 'express'; import cors from 'cors'; import helmet from 'helmet'; import http from 'http';
import rateLimit from 'express-rate-limit'; import { WebSocketServer } from 'ws';
import { q, tx, audit } from './db.js';
import { authRouter, authenticate, requireRole } from './auth.js';
import { validateRx } from './rx.js';

const app = express();
app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '1mb' }));
app.use('/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }));
app.use('/auth', authRouter);
app.get('/health', (_, r) => r.json({ ok: true }));

// ---------- realtime (WebSocket) ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const channels = new Map(); // "doctor:ID" -> Set<ws>
wss.on('connection', ws => {
  ws.on('message', m => { try { const { sub } = JSON.parse(m); if (/^doctor:\d+$/.test(sub)) {
    (channels.get(sub) || channels.set(sub, new Set()).get(sub)).add(ws); ws.on('close', () => channels.get(sub)?.delete(ws)); } } catch {} });
});
const today = () => new Date().toISOString().slice(0, 10);
async function queueSnapshot(doctorId, date = today()) {
  const rows = (await q(`SELECT id, token, status, skip_count FROM appointments WHERE doctor_id=$1 AND appt_date=$2 AND status IN ('waiting','in_consult','skipped')
     ORDER BY (token + skip_count*3)`, [doctorId, date])).rows;
  const cur = rows.find(r => r.status === 'in_consult');
  const waiting = rows.filter(r => r.status === 'waiting');
  const paused = (await q('SELECT paused FROM queue_state WHERE doctor_id=$1 AND q_date=$2', [doctorId, date])).rows[0]?.paused || false;
  return { current_token: cur?.token ?? null, next_token: waiting[0]?.token ?? null, waiting: waiting.length, paused };
}
async function broadcast(doctorId) {
  const snap = await queueSnapshot(doctorId); // public-safe: token numbers only, no patient data
  channels.get(`doctor:${doctorId}`)?.forEach(ws => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'queue', ...snap })));
}
async function notify(c, { user_id = null, patient_id = null, category, title, body, deep_link }) {
  await (c || { query: q }).query('INSERT INTO notifications(user_id,patient_id,category,title,body,deep_link) VALUES($1,$2,$3,$4,$5,$6)',
    [user_id, patient_id, category, title, body, deep_link]);
  // TODO FCM: send push to users.fcm_token using FCM_SERVICE_ACCOUNT
}

// Public TV screen (no private medical data)
app.get('/tv/:doctorId', async (req, res) => {
  const d = (await q(`SELECT u.name doctor, u.specialization dept, c.name clinic FROM users u JOIN clinics c ON c.id=u.clinic_id WHERE u.id=$1 AND u.role='doctor'`, [req.params.doctorId])).rows[0];
  if (!d) return res.status(404).json({ error: 'Not found' });
  res.json({ ...d, ...(await queueSnapshot(req.params.doctorId)) });
});

// ---------- authenticated API ----------
const api = express.Router(); api.use(authenticate); app.use('/api', api);
const STAFF = ['doctor', 'receptionist', 'nurse', 'owner'];
const doctorOf = u => u.role === 'doctor' ? u.id : null;
async function resolveDoctor(req) {
  if (req.user.role === 'doctor') return req.user.id;
  const id = Number(req.query.doctor_id || req.body?.doctor_id);
  const d = (await q("SELECT id FROM users WHERE id=$1 AND role='doctor' AND clinic_id=$2", [id, req.user.clinic_id])).rows[0];
  return d?.id;
}

api.get('/me', async (req, res) => {
  const u = (await q('SELECT u.*, c.name clinic_name, c.verified clinic_verified FROM users u LEFT JOIN clinics c ON c.id=u.clinic_id WHERE u.id=$1', [req.user.id])).rows[0];
  res.json(u);
});
api.post('/me/online', async (req, res) => { await q('UPDATE users SET online=$1 WHERE id=$2', [!!req.body.online, req.user.id]); res.json({ ok: true }); });
api.post('/me/fcm', async (req, res) => { await q('UPDATE users SET fcm_token=$1 WHERE id=$2', [req.body.token, req.user.id]); res.json({ ok: true }); });
api.get('/doctors', async (req, res) => res.json((await q("SELECT id,name,specialization FROM users WHERE role='doctor' AND clinic_id=$1 AND active", [req.user.clinic_id])).rows));

api.get('/dashboard/stats', requireRole(...STAFF), async (req, res) => {
  const f = req.user.role === 'doctor' ? 'AND doctor_id=$3' : '';
  const p = [req.user.clinic_id, today()]; if (f) p.push(req.user.id);
  const r = (await q(`SELECT count(*) total,
     count(*) FILTER (WHERE type='online') online, count(*) FILTER (WHERE type='walkin') walkin,
     count(*) FILTER (WHERE status IN ('waiting','in_consult')) waiting,
     count(*) FILTER (WHERE status='completed') completed, count(*) FILTER (WHERE status='cancelled') cancelled
     FROM appointments WHERE clinic_id=$1 AND appt_date=$2 ${f}`, p)).rows[0];
  const doc = await resolveDoctor(req);
  res.json({ ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)])), queue: doc ? await queueSnapshot(doc) : null });
});

api.get('/appointments', requireRole(...STAFF), async (req, res) => {
  const date = req.query.date || today(); const p = [req.user.clinic_id, date]; let f = '';
  if (req.user.role === 'doctor') { p.push(req.user.id); f = 'AND a.doctor_id=$3'; }
  const rows = (await q(`SELECT a.id,a.token,a.type,a.status,a.appt_time,a.complaint,a.doctor_id,p.id patient_id,p.name,p.mobile,p.patient_code
    FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE a.clinic_id=$1 AND a.appt_date=$2 ${f} ORDER BY a.token`, p)).rows;
  res.json(rows);
});

api.get('/patients/search', requireRole(...STAFF), async (req, res) => {
  const s = `%${(req.query.q || '').toLowerCase()}%`;
  // only patients who have visited this clinic (privacy)
  const rows = (await q(`SELECT DISTINCT p.id,p.patient_code,p.name,p.mobile,p.age,p.gender FROM patients p
     LEFT JOIN appointments a ON a.patient_id=p.id AND a.clinic_id=$2
     WHERE (lower(p.name) LIKE $1 OR p.mobile LIKE $1 OR lower(p.patient_code) LIKE $1 OR a.token::text = $3) AND (a.id IS NOT NULL OR p.mobile=$3)
     LIMIT 30`, [s, req.user.clinic_id, req.query.q || ''])).rows;
  res.json(rows);
});

api.get('/patients/:id', requireRole('doctor', 'receptionist', 'nurse'), async (req, res) => {
  const id = req.params.id;
  const seen = await q('SELECT 1 FROM appointments WHERE patient_id=$1 AND clinic_id=$2 LIMIT 1', [id, req.user.clinic_id]);
  if (!seen.rowCount) return res.status(403).json({ error: 'No access to this patient' });
  const p = (await q('SELECT * FROM patients WHERE id=$1', [id])).rows[0];
  const visits = (await q('SELECT id,appt_date,token,status,complaint,type FROM appointments WHERE patient_id=$1 AND clinic_id=$2 ORDER BY appt_date DESC', [id, req.user.clinic_id])).rows;
  const out = { patient: p, visits };
  if (req.user.role !== 'receptionist') { // restricted medical info
    out.prescriptions = (await q(`SELECT pr.id, v.id version_id, v.version, v.status, v.data, v.approved_at, v.created_at FROM prescriptions pr
      JOIN prescription_versions v ON v.prescription_id=pr.id WHERE pr.patient_id=$1 ORDER BY v.created_at DESC`, [id])).rows;
    out.notes = (await q('SELECT n.*, u.name doctor FROM visit_notes n JOIN users u ON u.id=n.doctor_id WHERE patient_id=$1 ORDER BY created_at DESC', [id])).rows;
  }
  await audit(null, req.user.id, 'view_patient', 'patient', Number(id));
  res.json(out);
});
api.post('/patients/:id/notes', requireRole('doctor'), async (req, res) => {
  const r = await q('INSERT INTO visit_notes(patient_id,doctor_id,note) VALUES($1,$2,$3) RETURNING *', [req.params.id, req.user.id, req.body.note]);
  res.json(r.rows[0]);
});

// Walk-in: search existing patient first, avoid duplicates, same queue as online
api.post('/walkin', requireRole('receptionist', 'doctor', 'nurse', 'owner'), async (req, res) => {
  const { name, mobile, age, dob, gender, complaint, department } = req.body;
  if (!name || !mobile) return res.status(400).json({ error: 'name and mobile required' });
  const doctorId = await resolveDoctor(req); if (!doctorId) return res.status(400).json({ error: 'Select a valid doctor' });
  const date = req.body.date || today();
  try {
    const out = await tx(async c => {
      const clinic = (await c.query('SELECT settings FROM clinics WHERE id=$1', [req.user.clinic_id])).rows[0];
      if (clinic.settings.walkin === false) throw Object.assign(new Error('Walk-in disabled'), { code: 'BIZ' });
      let pt = (await c.query('SELECT * FROM patients WHERE mobile=$1 AND lower(name)=lower($2)', [mobile, name])).rows[0];
      if (!pt) pt = (await c.query('INSERT INTO patients(name,mobile,age,dob,gender) VALUES($1,$2,$3,$4,$5) RETURNING *', [name, mobile, age || null, dob || null, gender || null])).rows[0];
      await c.query('SELECT pg_advisory_xact_lock($1)', [doctorId]);
      const last = (await c.query('SELECT coalesce(max(token),0) m, count(*) n FROM appointments WHERE doctor_id=$1 AND appt_date=$2', [doctorId, date])).rows[0];
      if (Number(last.n) >= (clinic.settings.token_limit ?? 100)) throw Object.assign(new Error('Token limit reached'), { code: 'BIZ' });
      const token = Number(last.m) + 1;
      const a = (await c.query(`INSERT INTO appointments(clinic_id,doctor_id,patient_id,appt_date,appt_time,token,type,department,complaint)
        VALUES($1,$2,$3,$4,localtime,$5,'walkin',$6,$7) RETURNING *`, [req.user.clinic_id, doctorId, pt.id, date, token, department, complaint])).rows[0];
      await audit(c, req.user.id, 'walkin_create', 'appointment', a.id);
      return { patient: pt, appointment: a, existing: pt.created_at < new Date(Date.now() - 1000) };
    });
    await broadcast(doctorId); res.json(out);
  } catch (e) { if (e.code === 'BIZ') return res.status(409).json({ error: e.message }); throw e; }
});

// Queue: all transitions validated server-side
api.get('/queue', requireRole(...STAFF), async (req, res) => {
  const doc = await resolveDoctor(req); if (!doc) return res.status(400).json({ error: 'doctor_id required' });
  const snap = await queueSnapshot(doc);
  const mins = (await q('SELECT settings FROM clinics WHERE id=$1', [req.user.clinic_id])).rows[0].settings.consult_minutes || 10;
  const list = (await q(`SELECT a.id,a.token,a.status,a.type,p.name FROM appointments a JOIN patients p ON p.id=a.patient_id
     WHERE a.doctor_id=$1 AND a.appt_date=$2 AND a.status IN ('waiting','in_consult','skipped') ORDER BY (a.token+a.skip_count*3)`, [doc, today()])).rows;
  res.json({ ...snap, est_wait_min: snap.waiting * mins, list });
});
api.post('/queue/:action', requireRole('doctor', 'receptionist', 'nurse'), async (req, res) => {
  const doc = await resolveDoctor(req); if (!doc) return res.status(400).json({ error: 'doctor_id required' });
  const act = req.params.action; const d = today();
  try {
    await tx(async c => {
      const cur = (await c.query("SELECT * FROM appointments WHERE doctor_id=$1 AND appt_date=$2 AND status='in_consult' FOR UPDATE", [doc, d])).rows[0];
      const set = (id, st, extra = '') => c.query(`UPDATE appointments SET status=$2 ${extra} WHERE id=$1`, [id, st]);
      if (act === 'hold' || act === 'resume') {
        await c.query(`INSERT INTO queue_state(doctor_id,q_date,paused) VALUES($1,$2,$3) ON CONFLICT (doctor_id,q_date) DO UPDATE SET paused=$3`, [doc, d, act === 'hold']);
      } else if (act === 'next') {
        const st = (await c.query('SELECT paused FROM queue_state WHERE doctor_id=$1 AND q_date=$2', [doc, d])).rows[0];
        if (st?.paused) throw Object.assign(new Error('Queue is on HOLD'), { code: 'BIZ' });
        if (cur) throw Object.assign(new Error('Complete or skip the current patient first'), { code: 'BIZ' });
        const n = (await c.query("SELECT id,patient_id FROM appointments WHERE doctor_id=$1 AND appt_date=$2 AND status='waiting' ORDER BY (token+skip_count*3) LIMIT 1 FOR UPDATE", [doc, d])).rows[0];
        if (!n) throw Object.assign(new Error('No patients waiting'), { code: 'BIZ' });
        await set(n.id, 'in_consult', ', started_at=now()');
        await notify(c, { patient_id: n.patient_id, category: 'queue', title: 'Your turn', body: 'Doctor is calling you now', deep_link: 'care://queue' });
      } else if (act === 'complete') {
        if (!cur) throw Object.assign(new Error('No active consultation'), { code: 'BIZ' }); await set(cur.id, 'completed', ', completed_at=now()');
      } else if (act === 'skip') {
        if (!cur) throw Object.assign(new Error('No active consultation'), { code: 'BIZ' });
        await c.query("UPDATE appointments SET status='waiting', skip_count=skip_count+1 WHERE id=$1", [cur.id]); // goes 3 places back
      } else if (act === 'no-show') {
        const id = req.body.appointment_id || cur?.id; if (!id) throw Object.assign(new Error('appointment_id required'), { code: 'BIZ' });
        await set(id, 'no_show');
      } else throw Object.assign(new Error('Unknown action'), { code: 'BIZ' });
      await audit(c, req.user.id, `queue_${act}`, 'doctor', doc);
    });
  } catch (e) { if (e.code === 'BIZ') return res.status(409).json({ error: e.message }); throw e; }
  await broadcast(doc); res.json(await queueSnapshot(doc));
});

// ---------- Prescriptions & approval ----------
api.post('/prescriptions', requireRole('doctor'), async (req, res) => {
  const { patient_id, appointment_id, data } = req.body;
  const out = await tx(async c => {
    const p = (await c.query('INSERT INTO prescriptions(patient_id,doctor_id,appointment_id) VALUES($1,$2,$3) RETURNING id', [patient_id, req.user.id, appointment_id || null])).rows[0];
    const v = (await c.query("INSERT INTO prescription_versions(prescription_id,version,data,created_by) VALUES($1,1,$2,$3) RETURNING *", [p.id, data, req.user.id])).rows[0];
    await audit(c, req.user.id, 'rx_draft', 'prescription', p.id); return v;
  });
  res.json(out);
});
api.put('/prescriptions/:id', requireRole('doctor'), async (req, res) => {
  const out = await tx(async c => {
    const pr = (await c.query('SELECT * FROM prescriptions WHERE id=$1 AND doctor_id=$2', [req.params.id, req.user.id])).rows[0];
    if (!pr) throw Object.assign(new Error('Not found'), { code: 'BIZ' });
    const last = (await c.query('SELECT * FROM prescription_versions WHERE prescription_id=$1 ORDER BY version DESC LIMIT 1', [pr.id])).rows[0];
    if (last.status === 'draft') return (await c.query('UPDATE prescription_versions SET data=$2 WHERE id=$1 RETURNING *', [last.id, req.body.data])).rows[0];
    // editing approved/rejected => NEW version, previous approved stays active until new one is approved
    const v = (await c.query('INSERT INTO prescription_versions(prescription_id,version,data,created_by) VALUES($1,$2,$3,$4) RETURNING *', [pr.id, last.version + 1, req.body.data, req.user.id])).rows[0];
    await audit(c, req.user.id, 'rx_new_version', 'prescription', pr.id, { version: v.version }); return v;
  }).catch(e => e.code === 'BIZ' ? null : Promise.reject(e));
  out ? res.json(out) : res.status(404).json({ error: 'Not found' });
});
api.post('/prescription-versions/:vid/approve', requireRole('doctor'), async (req, res) => {
  const doctor = (await q('SELECT verified FROM users WHERE id=$1', [req.user.id])).rows[0];
  if (!doctor.verified) return res.status(403).json({ error: 'Doctor not verified by FIREROZ Admin yet' });
  try {
    const out = await tx(async c => {
      const v = (await c.query(`SELECT v.*, pr.doctor_id, pr.patient_id FROM prescription_versions v JOIN prescriptions pr ON pr.id=v.prescription_id WHERE v.id=$1 FOR UPDATE OF v`, [req.params.vid])).rows[0];
      if (!v || v.doctor_id !== req.user.id) throw Object.assign(new Error('Not found'), { code: 'BIZ' });
      if (v.status !== 'draft') throw Object.assign(new Error(`Version is already ${v.status}`), { code: 'BIZ' });
      const errs = validateRx(v.data); if (errs.length) throw Object.assign(new Error(errs.join('; ')), { code: 'BIZ' });
      await c.query("UPDATE prescription_versions SET status='superseded' WHERE prescription_id=$1 AND status='approved'", [v.prescription_id]);
      const r = (await c.query("UPDATE prescription_versions SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1 RETURNING *", [v.id, req.user.id])).rows[0];
      await audit(c, req.user.id, 'rx_approved', 'prescription_version', v.id);
      await notify(c, { patient_id: v.patient_id, category: 'prescription', title: 'New prescription', body: 'Your doctor approved a prescription', deep_link: `care://rx/${v.prescription_id}` });
      return r; // FIREROZ Care reads approved versions from the shared DB and creates reminders
    });
    res.json({ approved: true, version: out });  // UI shows success only after this response
  } catch (e) { if (e.code === 'BIZ') return res.status(409).json({ error: e.message }); throw e; }
});
api.post('/prescription-versions/:vid/reject', requireRole('doctor'), async (req, res) => {
  const r = await q("UPDATE prescription_versions SET status='rejected' WHERE id=$1 AND status='draft' AND prescription_id IN (SELECT id FROM prescriptions WHERE doctor_id=$2) RETURNING *", [req.params.vid, req.user.id]);
  r.rowCount ? res.json(r.rows[0]) : res.status(404).json({ error: 'Not found' });
});
api.post('/prescriptions/validate', requireRole('doctor'), (req, res) => res.json({ errors: validateRx(req.body.data || {}) }));

// ---------- Reports ----------
api.get('/reports/summary', requireRole('doctor', 'owner'), async (req, res) => {
  const { from = today(), to = today() } = req.query; const p = [req.user.clinic_id, from, to]; let f = '';
  if (req.user.role === 'doctor') { p.push(req.user.id); f = 'AND doctor_id=$4'; }
  const t = (await q(`SELECT count(*) total, count(*) FILTER (WHERE type='online') online, count(*) FILTER (WHERE type='walkin') walkin,
    count(*) FILTER (WHERE status='completed') completed, count(*) FILTER (WHERE status='cancelled') cancelled, count(*) FILTER (WHERE status='no_show') no_show,
    coalesce(round(avg(extract(epoch FROM (started_at-created_at))/60) FILTER (WHERE started_at IS NOT NULL)),0) avg_wait_min
    FROM appointments WHERE clinic_id=$1 AND appt_date BETWEEN $2 AND $3 ${f}`, p)).rows[0];
  const byDay = (await q(`SELECT appt_date::text d, count(*) n FROM appointments WHERE clinic_id=$1 AND appt_date BETWEEN $2 AND $3 ${f} GROUP BY 1 ORDER BY 1`, p)).rows;
  const byDoctor = (await q(`SELECT u.name, count(*) n FROM appointments a JOIN users u ON u.id=a.doctor_id WHERE a.clinic_id=$1 AND a.appt_date BETWEEN $2 AND $3 ${f.replace('doctor_id', 'a.doctor_id')} GROUP BY 1`, p)).rows;
  res.json({ totals: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Number(v)])), byDay, byDoctor });
});

// ---------- Clinic, staff, notifications ----------
api.get('/clinic', requireRole(...STAFF), async (req, res) => res.json((await q('SELECT * FROM clinics WHERE id=$1', [req.user.clinic_id])).rows[0]));
api.put('/clinic', requireRole('owner'), async (req, res) => {
  const { name, address, phone, email, settings } = req.body;
  const r = await q('UPDATE clinics SET name=coalesce($2,name),address=coalesce($3,address),phone=coalesce($4,phone),email=coalesce($5,email),settings=settings||coalesce($6::jsonb,\'{}\'::jsonb) WHERE id=$1 RETURNING *',
    [req.user.clinic_id, name, address, phone, email, settings ? JSON.stringify(settings) : null]);
  await audit(null, req.user.id, 'clinic_update', 'clinic', req.user.clinic_id); res.json(r.rows[0]);
});
api.get('/staff', requireRole('owner', 'doctor'), async (req, res) => res.json((await q('SELECT id,name,mobile,role,active,verified FROM users WHERE clinic_id=$1 ORDER BY role,name', [req.user.clinic_id])).rows));
api.post('/staff', requireRole('owner'), async (req, res) => {
  const { name, mobile, role } = req.body;
  if (!['receptionist', 'nurse'].includes(role)) return res.status(400).json({ error: 'Owner can add receptionist or nurse here. Doctors register & get verified by FIREROZ Admin.' });
  const r = await q('INSERT INTO users(name,mobile,role,clinic_id,verified) VALUES($1,$2,$3,$4,true) ON CONFLICT (mobile) DO NOTHING RETURNING id,name,role', [name, mobile, role, req.user.clinic_id]);
  r.rowCount ? res.json(r.rows[0]) : res.status(409).json({ error: 'Mobile already exists' });
});
api.patch('/staff/:id', requireRole('owner'), async (req, res) => {
  await q("UPDATE users SET active=$1 WHERE id=$2 AND clinic_id=$3 AND role IN ('receptionist','nurse')", [!!req.body.active, req.params.id, req.user.clinic_id]); res.json({ ok: true });
});
api.get('/notifications', async (req, res) => res.json((await q('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user.id])).rows));
api.post('/notifications/:id/read', async (req, res) => { await q('UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); res.json({ ok: true }); });

// ---------- Super Admin (platform-level, separate from clinic owner) ----------
api.post('/admin/verify/:kind/:id', requireRole('superadmin'), async (req, res) => {
  const t = { doctor: 'users', clinic: 'clinics' }[req.params.kind]; if (!t) return res.status(400).json({ error: 'kind must be doctor|clinic' });
  await q(`UPDATE ${t} SET verified=$1 WHERE id=$2`, [req.body.verified !== false, req.params.id]);
  await audit(null, req.user.id, 'admin_verify', req.params.kind, Number(req.params.id)); res.json({ ok: true });
});

app.use((e, req, res, next) => { console.error(e); res.status(500).json({ error: 'Server error' }); });
server.listen(process.env.PORT || 4000, () => console.log('FIREROZ backend on', process.env.PORT || 4000));
