import jwt from 'jsonwebtoken'; import crypto from 'crypto'; import { Router } from 'express';
import { q } from './db.js';
const SECRET = process.env.JWT_SECRET; if (!SECRET) throw new Error('JWT_SECRET is required');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const sign = u => jwt.sign({ id: u.id, role: u.role, clinic_id: u.clinic_id }, SECRET, { expiresIn: '15m' });

async function sendSms(mobile, code) {
  // TODO: plug in provider (MSG91/Twilio) using SMS_PROVIDER + SMS_API_KEY from env.
  if (process.env.NODE_ENV !== 'production') console.log(`[DEV OTP] ${mobile}: ${code}`);
}

export const authenticate = async (req, res, next) => {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    req.user = jwt.verify(t, SECRET);
    const r = await q('SELECT active FROM users WHERE id=$1', [req.user.id]);
    if (!r.rows[0]?.active) return res.status(403).json({ error: 'Account inactive' });
    next();
  } catch { res.status(401).json({ error: 'Unauthorized' }); }
};
export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Not allowed for your role' });

export const authRouter = Router();
authRouter.post('/otp/request', async (req, res) => {
  const { mobile } = req.body;
  if (!/^\+?\d{10,13}$/.test(mobile || '')) return res.status(400).json({ error: 'Invalid mobile' });
  const code = String(crypto.randomInt(100000, 999999));
  await q('DELETE FROM otps WHERE mobile=$1', [mobile]);
  await q("INSERT INTO otps(mobile,code_hash,expires_at) VALUES($1,$2,now()+interval '5 minutes')", [mobile, sha(code)]);
  await sendSms(mobile, code);
  res.json({ ok: true });
});
authRouter.post('/otp/verify', async (req, res) => {
  const { mobile, code } = req.body;
  const o = (await q('SELECT * FROM otps WHERE mobile=$1', [mobile])).rows[0];
  if (!o || o.expires_at < new Date() || o.attempts >= 5) return res.status(400).json({ error: 'OTP expired' });
  if (o.code_hash !== sha(String(code))) {
    await q('UPDATE otps SET attempts=attempts+1 WHERE mobile=$1', [mobile]);
    return res.status(400).json({ error: 'Wrong OTP' });
  }
  await q('DELETE FROM otps WHERE mobile=$1', [mobile]);
  const u = (await q("SELECT * FROM users WHERE mobile=$1 AND role<>'patient'", [mobile])).rows[0];
  if (!u) return res.status(404).json({ error: 'No staff account. Please register first.' });
  const refresh = crypto.randomBytes(40).toString('hex');
  await q("INSERT INTO refresh_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 days')", [u.id, sha(refresh)]);
  res.json({ access: sign(u), refresh, user: u });
});
authRouter.post('/register-doctor', async (req, res) => {
  const { name, mobile, email, qualification, specialization, license_no, clinic_name, address } = req.body;
  if (!name || !mobile || !license_no) return res.status(400).json({ error: 'name, mobile, license_no required' });
  const dup = await q('SELECT 1 FROM users WHERE mobile=$1', [mobile]);
  if (dup.rowCount) return res.status(409).json({ error: 'Mobile already registered' });
  const c = await q('INSERT INTO clinics(name,address) VALUES($1,$2) RETURNING id', [clinic_name || `${name} Clinic`, address]);
  // verified=false until FIREROZ super admin verifies
  await q(`INSERT INTO users(mobile,name,email,role,clinic_id,qualification,specialization,license_no,verified)
           VALUES($1,$2,$3,'doctor',$4,$5,$6,$7,false)`, [mobile, name, email, c.rows[0].id, qualification, specialization, license_no]);
  res.json({ ok: true, message: 'Registered. Pending verification by FIREROZ Admin.' });
});
authRouter.post('/refresh', async (req, res) => {
  const r = (await q('SELECT * FROM refresh_tokens WHERE token_hash=$1 AND NOT revoked AND expires_at>now()', [sha(req.body.refresh || '')])).rows[0];
  if (!r) return res.status(401).json({ error: 'Session expired' });
  const u = (await q('SELECT * FROM users WHERE id=$1', [r.user_id])).rows[0];
  res.json({ access: sign(u) });
});
authRouter.post('/logout', async (req, res) => {
  await q('UPDATE refresh_tokens SET revoked=true WHERE token_hash=$1', [sha(req.body.refresh || '')]);
  res.json({ ok: true });
});
