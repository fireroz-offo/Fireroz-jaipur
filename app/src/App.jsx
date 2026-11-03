import React, { useEffect, useState } from 'react';
import logo from './assets/logo.png';
import { api, post, authApi, session, logout } from './api.js';
import { t } from './i18n.js';
import { Home, Patients, WalkIn, Queue, Reports, SettingsScreen, PatientProfile, RxEditor, TV, Notifications } from './screens.jsx';

function Splash({ done }) {
  const first = !localStorage.getItem('seen'); const ms = first ? 3800 : 1200;
  useEffect(() => { const id = setTimeout(() => { localStorage.setItem('seen', '1'); done(); }, ms); return () => clearTimeout(id); }, []);
  return (<div className="splash" onClick={first ? undefined : done}>
    <div className="ring" /><img src={logo} alt="FIREROZ Doctor" />
    <h1>FIREROZ Doctor</h1><p>{t('tagline')}</p><p style={{ color: '#fbbf24' }}>{t('brand')}</p>
    <div className="bar"><i style={{ animationDuration: ms + 'ms' }} /></div>
    {first && <button onClick={done} style={{ position: 'absolute', bottom: 30, background: 'none', border: 0, color: '#fff9' }}>Skip</button>}
  </div>);
}

function Login({ onLogin }) {
  const [mode, setMode] = useState('login'); const [step, setStep] = useState(1);
  const [f, setF] = useState({}); const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const run = async fn => { setErr(''); setBusy(true); try { await fn(); } catch (e) { setErr(e.message); } setBusy(false); };
  return (<div className="app fade">
    <div style={{ textAlign: 'center', padding: '40px 20px 10px' }}><img src={logo} width="120" alt="" /><h2 style={{ color: 'var(--p)', marginTop: 8 }}>FIREROZ Doctor</h2><p style={{ color: '#666', fontSize: 13 }}>{t('tagline')}</p></div>
    <div className="card">
      {mode === 'login' ? (<>
        <label>Mobile</label><input inputMode="tel" placeholder="+91 98765 43210" value={f.mobile || ''} onChange={set('mobile')} disabled={step === 2} />
        {step === 2 && (<><label>OTP</label><input inputMode="numeric" maxLength="6" value={f.code || ''} onChange={set('code')} /></>)}
        {err && <div className="err-t">{err}</div>}
        {step === 1 ? <button className="btn" disabled={busy} onClick={() => run(async () => { await authApi('/otp/request', { mobile: f.mobile }); setStep(2); })}>Send OTP</button>
          : <button className="btn" disabled={busy} onClick={() => run(async () => { const d = await authApi('/otp/verify', { mobile: f.mobile, code: f.code }); session.save(d); onLogin(); })}>{t('login')}</button>}
        <p style={{ textAlign: 'center', marginTop: 14 }}><a onClick={() => setMode('signup')} style={{ color: 'var(--p)' }}>{t('signup')} (Doctor)</a></p>
        <p style={{ textAlign: 'center', fontSize: 12, color: '#888', marginTop: 8 }}>Forgot password? Login again with OTP on your registered mobile.</p>
      </>) : (<>
        {[['name', 'Full name'], ['mobile', 'Mobile'], ['email', 'Email'], ['qualification', 'Qualification (MBBS, MD…)'], ['specialization', 'Specialization'], ['license_no', 'Registration / License no.'], ['clinic_name', 'Clinic / Hospital'], ['address', 'Professional address']]
          .map(([k, l]) => <div key={k}><label>{l}</label><input value={f[k] || ''} onChange={set(k)} /></div>)}
        {err && <div className="err-t">{err}</div>}{msg && <div style={{ color: 'var(--ok)' }}>{msg}</div>}
        <button className="btn" disabled={busy} onClick={() => run(async () => { const r = await authApi('/register-doctor', f); setMsg(r.message); })}>{t('signup')}</button>
        <p style={{ textAlign: 'center', marginTop: 14 }}><a onClick={() => setMode('login')} style={{ color: 'var(--p)' }}>{t('login')}</a></p>
      </>)}
    </div></div>);
}

const TABS = [['home', '🏠', 'home'], ['patients', '👥', 'patients'], ['queue', '🎫', 'queue'], ['reports', '📊', 'reports'], ['settings', '⚙️', 'settings']];

export default function App() {
  const tvId = location.hash.match(/^#\/tv\/(\d+)/)?.[1];
  if (tvId) return <TV id={tvId} />;
  const [splash, setSplash] = useState(true); const [authed, setAuthed] = useState(session.has());
  const [me, setMe] = useState(null); const [tab, setTab] = useState('home'); const [view, setView] = useState(null); // {name, props}
  const [doctorId, setDoctorId] = useState(null);
  useEffect(() => { if (authed) api('/api/me').then(u => { setMe(u); setDoctorId(u.role === 'doctor' ? u.id : null); }).catch(() => { session.clear(); setAuthed(false); }); }, [authed]);
  if (splash) return <Splash done={() => setSplash(false)} />;
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  if (!me) return <div className="app"><p style={{ padding: 30 }}>Loading…</p></div>;
  const go = (name, props = {}) => setView({ name, props });
  const ctx = { me, go, back: () => setView(null), setTab, doctorId, setDoctorId };
  const V = { walkin: WalkIn, profile: PatientProfile, rx: RxEditor, notifications: Notifications, today: p => <Patients {...p} /> };
  const Cur = view ? V[view.name] : { home: Home, patients: Patients, queue: Queue, reports: Reports, settings: SettingsScreen }[tab];
  return (<div className="app"><Cur ctx={ctx} {...(view?.props || {})} />
    {!view && <div className="nav">{TABS.map(([k, i, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><i>{i}</i>{t(l)}</button>)}</div>}</div>);
}
