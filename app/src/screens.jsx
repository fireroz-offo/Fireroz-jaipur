import React, { useEffect, useRef, useState } from 'react';
import { api, post, put, publicGet, WS_URL, logout } from './api.js';
import { t, getLang, setLang } from './i18n.js';

const Header = ({ title, ctx, sub }) => (<div className="hdr"><div className="row sp">
  <div className="row">{ctx.back && ctx.me && <span onClick={() => ctx.back()} style={{ fontSize: 22 }}>←</span>}<div><h2>{title}</h2>{sub && <p>{sub}</p>}</div></div>
  <span onClick={() => ctx.go('notifications')} style={{ fontSize: 22 }}>🔔</span></div></div>);
const Back = ({ title, ctx }) => <Header title={title} ctx={ctx} />;
const useDoctors = ctx => { const [d, setD] = useState([]); useEffect(() => { if (ctx.me.role !== 'doctor') api('/api/doctors').then(x => { setD(x); if (!ctx.doctorId && x[0]) ctx.setDoctorId(x[0].id); }); }, []); return d; };
const DoctorPicker = ({ ctx }) => { const d = useDoctors(ctx); return ctx.me.role === 'doctor' ? null :
  <div style={{ padding: '10px 14px 0' }}><select value={ctx.doctorId || ''} onChange={e => ctx.setDoctorId(+e.target.value)}>{d.map(x => <option key={x.id} value={x.id}>Dr. {x.name} · {x.specialization}</option>)}</select></div>; };
const dq = ctx => ctx.doctorId ? `?doctor_id=${ctx.doctorId}` : '';

function useLiveQueue(ctx) {
  const [snap, setSnap] = useState(null);
  const load = () => ctx.doctorId && api('/api/queue' + dq(ctx)).then(setSnap).catch(() => {});
  useEffect(() => { load(); if (!ctx.doctorId) return;
    const ws = new WebSocket(WS_URL); ws.onopen = () => ws.send(JSON.stringify({ sub: 'doctor:' + ctx.doctorId })); ws.onmessage = load;
    const iv = setInterval(load, 15000); return () => { ws.close(); clearInterval(iv); }; }, [ctx.doctorId]);
  return [snap, load];
}

export function Home({ ctx }) {
  const [s, setS] = useState(null); const [online, setOnline] = useState(ctx.me.online);
  useEffect(() => { api('/api/dashboard/stats' + dq(ctx)).then(setS).catch(() => {}); }, [ctx.doctorId]);
  const [q] = useLiveQueue(ctx); const m = ctx.me;
  return (<div>
    <div className="hdr"><div className="row sp"><div><h2>Good Day, {m.role === 'doctor' ? 'Dr. ' : ''}{m.name} 👋</h2><p>{m.clinic_name} {m.verified ? '✅ Verified' : '⏳ Verification pending'}</p></div><span onClick={() => ctx.go('notifications')} style={{ fontSize: 22 }}>🔔</span></div>
      {m.role === 'doctor' && <div className="row" style={{ marginTop: 10 }}><span className="live" style={{ background: online ? '#4ade80' : '#999' }} /><label style={{ color: '#fff' }}>{online ? 'Online' : 'Offline'}</label>
        <button className="btn sm ghost" onClick={async () => { await post('/api/me/online', { online: !online }); setOnline(!online); }}>Toggle</button></div>}</div>
    <div className="grid">{[['Patients', s?.total], ['In Queue', s?.waiting], ['Done', s?.completed]].map(([l, v]) => <div className="stat fade" key={l}><b>{v ?? '–'}</b><span>{l}</span></div>)}</div>
    <div className="grid" style={{ marginTop: 10 }}>{[['Online', s?.online], ['Walk-in', s?.walkin], ['Cancelled', s?.cancelled]].map(([l, v]) => <div className="stat" key={l}><b>{v ?? '–'}</b><span>{l}</span></div>)}</div>
    <DoctorPicker ctx={ctx} />
    <div className="card cur"><div className="row sp"><div><label>Current token</label><div className="token">#{q?.current_token ?? '–'}</div></div><div><label>Next</label><div className="token" style={{ fontSize: 30 }}>#{q?.next_token ?? '–'}</div></div></div>
      <button className="btn" onClick={() => ctx.setTab('queue')}>{t('live')} →</button></div>
    <div className="qa">{[[t('today'), () => ctx.setTab('patients')], [t('live'), () => ctx.setTab('queue')], [t('walkin'), () => ctx.go('walkin')], [t('search'), () => ctx.setTab('patients')], [t('reports'), () => ctx.setTab('reports')], [t('rx'), () => ctx.setTab('patients')]]
      .map(([l, f]) => <button key={l} onClick={f}>{l}</button>)}</div>
  </div>);
}

export function Patients({ ctx }) {
  const [list, setList] = useState([]); const [f, setF] = useState('all'); const [qs, setQs] = useState(''); const [res, setRes] = useState(null); const [loading, setLoading] = useState(true);
  useEffect(() => { api('/api/appointments').then(x => { setList(x); setLoading(false); }); }, []);
  useEffect(() => { if (qs.length < 3) return setRes(null); const id = setTimeout(() => api('/api/patients/search?q=' + encodeURIComponent(qs)).then(setRes), 300); return () => clearTimeout(id); }, [qs]);
  const tabs = { all: () => true, online: a => a.type === 'online', walkin: a => a.type === 'walkin', waiting: a => ['waiting', 'in_consult'].includes(a.status), completed: a => a.status === 'completed', cancelled: a => ['cancelled', 'no_show'].includes(a.status) };
  const shown = list.filter(tabs[f]);
  return (<div><Header title={t('today')} ctx={{ ...ctx, back: null }} sub={`${list.length} total`} />
    <div style={{ padding: '10px 14px 0' }}><input placeholder="🔍 Name / mobile / patient ID / token" value={qs} onChange={e => setQs(e.target.value)} /></div>
    {res ? res.map(p => <div className="card fade" key={p.id} onClick={() => ctx.go('profile', { pid: p.id })}><b>{p.name}</b> <span className="badge">{p.patient_code}</span><p style={{ fontSize: 13, color: '#666' }}>{p.mobile} · {p.age || '-'} · {p.gender || ''}</p></div>) : <>
      <div className="tabs">{Object.keys(tabs).map(k => <button key={k} className={'tab ' + (f === k ? 'on' : '')} onClick={() => setF(k)}>{k}</button>)}</div>
      {loading && <div className="card">Loading…</div>}
      {shown.map(a => <div key={a.id} className={'card fade ' + (a.status === 'in_consult' ? 'cur' : '')}>
        <div className="row sp"><div><b>#{a.token} {a.name}</b><p style={{ fontSize: 12, color: '#666' }}>{a.type === 'walkin' ? 'Walk-in' : 'Online'} · {a.appt_time?.slice(0, 5) || ''} · {a.patient_code}</p></div><span className={'badge ' + a.status}>{a.status.replace('_', ' ')}</span></div>
        <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => ctx.go('profile', { pid: a.patient_id })}>View</button>
          <a className="btn sm ghost" style={{ textDecoration: 'none' }} href={'tel:' + a.mobile}>Call</a>
          {ctx.me.role === 'doctor' && <button className="btn sm ok" onClick={() => ctx.go('rx', { pid: a.patient_id, aid: a.id, pname: a.name })}>Rx</button>}</div></div>)}
      {!loading && !shown.length && <div className="card">No patients.</div>}</>}
  </div>);
}

export function WalkIn({ ctx }) {
  const [f, setF] = useState({ department: '' }); const [found, setFound] = useState([]); const [out, setOut] = useState(null); const [err, setErr] = useState('');
  const d = useDoctors(ctx); const set = k => e => setF({ ...f, [k]: e.target.value });
  useEffect(() => { if ((f.mobile || '').length >= 10) api('/api/patients/search?q=' + f.mobile).then(setFound); else setFound([]); }, [f.mobile]);
  const submit = async () => { setErr(''); try { setOut(await post('/api/walkin', { ...f, doctor_id: ctx.doctorId })); } catch (e) { setErr(e.message); } };
  if (out) return (<div><Back title="Token Generated" ctx={ctx} /><div className="done"><div className="tick">✓</div><h3 style={{ marginTop: 14 }}>{out.patient.name}</h3><div className="token">#{out.appointment.token}</div><button className="btn" onClick={ctx.back}>Done</button></div></div>);
  return (<div><Back title={t('walkin')} ctx={ctx} /><div className="card">
    {found.length > 0 && <div className="card" style={{ background: '#ede9fe', margin: 0 }}><b>Existing patient found — tap to use:</b>{found.map(p => <p key={p.id} onClick={() => setF({ ...f, name: p.name, age: p.age, gender: p.gender })} style={{ padding: 6 }}>• {p.name} ({p.patient_code})</p>)}</div>}
    <label>Mobile</label><input inputMode="tel" onChange={set('mobile')} /><label>Patient name</label><input value={f.name || ''} onChange={set('name')} />
    <div className="row"><div style={{ flex: 1 }}><label>Age</label><input type="number" value={f.age || ''} onChange={set('age')} /></div><div style={{ flex: 1 }}><label>Gender</label><select onChange={set('gender')}><option value="">-</option><option>Male</option><option>Female</option><option>Other</option></select></div></div>
    <label>Chief complaint</label><input onChange={set('complaint')} /><label>Department</label><input onChange={set('department')} />
    {ctx.me.role !== 'doctor' && <><label>Doctor</label><select value={ctx.doctorId || ''} onChange={e => ctx.setDoctorId(+e.target.value)}>{d.map(x => <option key={x.id} value={x.id}>Dr. {x.name}</option>)}</select></>}
    {err && <div className="err-t">{err}</div>}<button className="btn" onClick={submit}>Generate Token</button></div></div>);
}

export function Queue({ ctx }) {
  const [q, load] = useLiveQueue(ctx); const [err, setErr] = useState('');
  const act = async a => { setErr(''); try { await post('/api/queue/' + a + dq(ctx), { doctor_id: ctx.doctorId }); load(); } catch (e) { setErr(e.message); } };
  const cur = q?.list?.find(x => x.status === 'in_consult');
  return (<div><div className="hdr"><div className="row sp"><h2>{t('live')}</h2><span><span className="live" /> Live</span></div></div><DoctorPicker ctx={ctx} />
    <div className="card cur"><div className="row sp"><div style={{ textAlign: 'center', flex: 1 }}><label>Current Token</label><div className="token">#{q?.current_token ?? '–'}</div></div>
      <div style={{ textAlign: 'center', flex: 1 }}><label>Next</label><div className="token">#{q?.next_token ?? '–'}</div></div></div>
      <p style={{ textAlign: 'center' }}>{q?.waiting ?? 0} waiting · ~{q?.est_wait_min ?? 0} min {q?.paused && '· ⏸ ON HOLD'}</p></div>
    {err && <div className="err-t" style={{ margin: '0 16px' }}>{err}</div>}
    <div className="qa"><button className="btn" onClick={() => act('next')}>{t('next')}</button><button className="btn warn" onClick={() => act(q?.paused ? 'resume' : 'hold')}>{q?.paused ? t('resume') : t('hold')}</button>
      <button className="btn ghost" onClick={() => act('skip')}>{t('skip')}</button><button className="btn err" onClick={() => act('no-show')}>{t('noshow')}</button></div>
    <div style={{ margin: '0 14px' }}><button className="btn ok" onClick={() => act('complete')}>✓ {t('complete')}</button></div>
    {q?.list?.map(x => <div key={x.id} className={'card fade ' + (x.status === 'in_consult' ? 'cur' : '')}><div className="row sp"><b>#{x.token} {x.name}</b><span className={'badge ' + x.status}>{x.status.replace('_', ' ')}</span></div></div>)}
  </div>);
}

export function PatientProfile({ ctx, pid }) {
  const [d, setD] = useState(null); const [tab, setTab] = useState('history'); const [note, setNote] = useState(''); const [err, setErr] = useState('');
  const load = () => api('/api/patients/' + pid).then(setD).catch(e => setErr(e.message)); useEffect(() => { load(); }, []);
  if (err) return <div><Back title="Patient" ctx={ctx} /><div className="card err-t">{err}</div></div>; if (!d) return <div className="card">Loading…</div>;
  const p = d.patient; const isDr = ctx.me.role === 'doctor';
  return (<div><Back title="Patient Profile" ctx={ctx} /><div className="card" style={{ textAlign: 'center' }}><h3>{p.name}</h3><p>{p.age ? p.age + ' yrs · ' : ''}{p.gender} · {p.patient_code}</p><p>📞 {p.mobile}</p>
    {p.allergies && <p className="err-t">⚠ Allergies: {p.allergies}</p>}</div>
    <div className="tabs">{['history', 'prescriptions', 'visits'].map(k => <button key={k} className={'tab ' + (tab === k ? 'on' : '')} onClick={() => setTab(k)}>{k}</button>)}</div>
    {tab === 'visits' && d.visits.map(v => <div className="card" key={v.id}><b>{String(v.appt_date).slice(0, 10)}</b> · #{v.token} · {v.complaint || '-'} <span className={'badge ' + v.status}>{v.status}</span></div>)}
    {tab === 'history' && (d.notes ? <>{isDr && <div className="card"><textarea rows="3" placeholder="Add consultation note" value={note} onChange={e => setNote(e.target.value)} /><button className="btn" onClick={async () => { await post(`/api/patients/${pid}/notes`, { note }); setNote(''); load(); }}>Save note</button></div>}
      {d.notes.map(n => <div className="card" key={n.id}><label>{String(n.created_at).slice(0, 10)} · Dr. {n.doctor}</label><p>{n.note}</p></div>)}</> : <div className="card">Medical history is restricted to doctors.</div>)}
    {tab === 'prescriptions' && (d.prescriptions || []).map(r => <div className="card" key={r.version_id}><div className="row sp"><b>Rx #{r.id} v{r.version}</b><span className={'badge ' + (r.status === 'approved' ? 'completed' : '')}>{r.status}</span></div>
      <p style={{ fontSize: 13 }}>{r.data.diagnosis}</p>{(r.data.medicines || []).map((m, i) => <p key={i} style={{ fontSize: 12, color: '#666' }}>💊 {m.name} {m.strength} · {m.duration_days}d</p>)}
      {isDr && r.status !== 'approved' && <button className="btn sm" onClick={() => ctx.go('rx', { pid, pname: p.name, existing: r })}>Edit / Review</button>}
      {isDr && r.status === 'approved' && <button className="btn sm ghost" onClick={() => ctx.go('rx', { pid, pname: p.name, existing: r, newVersion: true })}>Edit (new version)</button>}</div>)}
    {isDr && <div style={{ margin: 14 }}><button className="btn" onClick={() => ctx.go('rx', { pid, pname: p.name })}>Create Prescription</button></div>}
  </div>);
}

const blankMed = () => ({ name: '', strength: '', dosage: '', times_per_day: 1, duration_days: 5, start_date: new Date().toISOString().slice(0, 10), morning: true, afternoon: false, night: false, food: 'after_food', note: '' });
export function RxEditor({ ctx, pid, aid, pname, existing }) {
  const [d, setD] = useState(existing?.data || { symptoms: '', findings: '', diagnosis: '', notes: '', advice: '', follow_up: '', medicines: [blankMed()] });
  const [rx, setRx] = useState(existing ? { prescription_id: existing.id, id: existing.version_id, status: existing.status } : null);
  const [errs, setErrs] = useState([]); const [ok, setOk] = useState(false); const [busy, setBusy] = useState(false);
  const set = k => e => setD({ ...d, [k]: e.target.value });
  const med = (i, k, v) => setD({ ...d, medicines: d.medicines.map((m, j) => j === i ? { ...m, [k]: v } : m) });
  const save = async () => { const r = rx ? await put('/api/prescriptions/' + rx.prescription_id, { data: d }) : await post('/api/prescriptions', { patient_id: pid, appointment_id: aid, data: d });
    const nr = { prescription_id: r.prescription_id, id: r.id, status: r.status }; setRx(nr); return nr; };
  const approve = async () => { setBusy(true); setErrs([]); try {
    const v = (await post('/api/prescriptions/validate', { data: d })).errors; if (v.length) { setErrs(v); setBusy(false); return; }
    const r = await save(); await post(`/api/prescription-versions/${r.id}/approve`, {}); setOk(true); } catch (e) { setErrs([e.message]); } setBusy(false); };
  if (ok) return (<div><Back title="Prescription" ctx={ctx} /><div className="done"><div className="tick">✓</div><h2 style={{ marginTop: 14 }}>Prescription Approved!</h2><p>Successfully sent to FIREROZ Care</p><button className="btn" onClick={ctx.back}>OK</button></div></div>);
  return (<div><Back title="Prescription" ctx={ctx} sub={pname} /><div className="card fade">
    {[['symptoms', 'Symptoms'], ['findings', 'Clinical findings'], ['diagnosis', 'Diagnosis *'], ['notes', 'Doctor notes'], ['advice', 'Advice']].map(([k, l]) => <div key={k}><label>{l}</label><input value={d[k] || ''} onChange={set(k)} /></div>)}
    <label>Follow-up date</label><input type="date" value={d.follow_up || ''} onChange={set('follow_up')} /></div>
    <h3 style={{ margin: '12px 16px 0' }}>Medicine Details</h3>
    {d.medicines.map((m, i) => <div className="card fade" key={i}>
      <input placeholder="Medicine name (brand/generic)" value={m.name} onChange={e => med(i, 'name', e.target.value)} />
      <div className="row"><input placeholder="Strength e.g. 500mg" value={m.strength} onChange={e => med(i, 'strength', e.target.value)} /><input placeholder="Dosage e.g. 1 tablet" value={m.dosage} onChange={e => med(i, 'dosage', e.target.value)} /></div>
      <div className="row"><div><label>Times/day</label><input type="number" min="1" max="3" value={m.times_per_day} onChange={e => med(i, 'times_per_day', +e.target.value)} /></div><div><label>Days</label><input type="number" min="1" value={m.duration_days} onChange={e => med(i, 'duration_days', +e.target.value)} /></div></div>
      <label>Start date</label><input type="date" value={m.start_date} onChange={e => med(i, 'start_date', e.target.value)} />
      <div className="row">{['morning', 'afternoon', 'night'].map(s => <label key={s}><input type="checkbox" style={{ width: 'auto' }} checked={!!m[s]} onChange={e => med(i, s, e.target.checked)} /> {s}</label>)}</div>
      <select value={m.food} onChange={e => med(i, 'food', e.target.value)}><option value="before_food">Before food</option><option value="after_food">After food</option><option value="any">Any time</option></select>
      <input placeholder="Additional instructions" value={m.note} onChange={e => med(i, 'note', e.target.value)} />
      <button className="btn sm err" onClick={() => setD({ ...d, medicines: d.medicines.filter((_, j) => j !== i) })}>Remove</button></div>)}
    <div style={{ margin: '0 14px' }}><button className="btn ghost" onClick={() => setD({ ...d, medicines: [...d.medicines, blankMed()] })}>+ Add Medicine</button></div>
    {errs.length > 0 && <div className="card">{errs.map((e, i) => <div key={i} className="err-t">• {e}</div>)}</div>}
    <div style={{ margin: 14, display: 'grid', gap: 10 }}>
      <button className="btn ok" disabled={busy} onClick={approve}>Approve & Send to FIREROZ Care</button>
      <button className="btn ghost" onClick={async () => { await save(); alert('Draft saved'); }}>Save Draft</button>
      <button className="btn ghost" onClick={() => window.print()}>Preview / PDF</button></div></div>);
}

export function Reports({ ctx }) {
  const [r, setR] = useState('today'); const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { const e = new Date(), s = new Date(); if (r === 'week') s.setDate(e.getDate() - 6); if (r === 'month') s.setDate(1); const f = x => x.toISOString().slice(0, 10);
    api(`/api/reports/summary?from=${f(s)}&to=${f(e)}`).then(setD).catch(x => setErr(x.message)); }, [r]);
  const csv = () => { const rows = [['Metric', 'Value'], ...Object.entries(d.totals)]; const b = new Blob([rows.map(x => x.join(',')).join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'report.csv'; a.click(); };
  const max = Math.max(1, ...(d?.byDay || []).map(x => +x.n));
  return (<div><div className="hdr"><h2>Daily Reports</h2></div><div className="tabs">{[['today', 'Today'], ['week', 'This Week'], ['month', 'This Month']].map(([k, l]) => <button key={k} className={'tab ' + (r === k ? 'on' : '')} onClick={() => setR(k)}>{l}</button>)}</div>
    {err && <div className="card err-t">{err}</div>}
    {d && <><div className="grid" style={{ margin: '0 14px' }}>{[['Total', d.totals.total], ['Online', d.totals.online], ['Walk-in', d.totals.walkin], ['Completed', d.totals.completed], ['No-show', d.totals.no_show], ['Avg wait (min)', d.totals.avg_wait_min]].map(([l, v]) => <div className="stat" key={l}><b>{v}</b><span>{l}</span></div>)}</div>
      <div className="card"><b>Trend</b><div className="bars">{d.byDay.map(x => <div key={x.d} title={x.d} style={{ height: (x.n / max) * 100 + '%' }} />)}</div></div>
      <div className="card"><b>Doctor-wise</b>{d.byDoctor.map(x => <p key={x.name}>{x.name}: {x.n}</p>)}</div>
      <div style={{ margin: 14, display: 'grid', gap: 10 }}><button className="btn" onClick={csv}>Export CSV</button><button className="btn ghost" onClick={() => window.print()}>Print / Save PDF</button></div></>}
  </div>);
}

export function Notifications({ ctx }) {
  const [n, setN] = useState([]); useEffect(() => { api('/api/notifications').then(setN); }, []);
  return (<div><Back title="Notifications" ctx={ctx} />{n.map(x => <div className="card fade" key={x.id} onClick={async () => { await post(`/api/notifications/${x.id}/read`); setN(n.map(y => y.id === x.id ? { ...y, read: true } : y)); }} style={{ opacity: x.read ? .6 : 1 }}><b>{x.title}</b><p style={{ fontSize: 13 }}>{x.body}</p><label>{String(x.created_at).slice(0, 16).replace('T', ' ')}</label></div>)}{!n.length && <div className="card">No notifications</div>}</div>);
}

export function SettingsScreen({ ctx }) {
  const [c, setC] = useState(null); const [staff, setStaff] = useState([]); const [ns, setNs] = useState({ role: 'receptionist' }); const [msg, setMsg] = useState('');
  const owner = ctx.me.role === 'owner';
  useEffect(() => { api('/api/clinic').then(setC); if (['owner', 'doctor'].includes(ctx.me.role)) api('/api/staff').then(setStaff); }, []);
  const s = c?.settings || {}; const setS = (k, v) => setC({ ...c, settings: { ...s, [k]: v } });
  return (<div><div className="hdr"><h2>{t('settings')}</h2><p>{ctx.me.name} · {ctx.me.role}</p></div>
    <div className="card"><label>{t('lang')}</label><select value={getLang()} onChange={e => setLang(e.target.value)}><option value="en">English</option><option value="hi">हिन्दी</option></select></div>
    {c && <div className="card"><b>{c.name}</b> {c.verified ? '✅' : ''}<p style={{ fontSize: 13, color: '#666' }}>{c.address}</p>
      {[['token_limit', 'Token limit', 'number'], ['consult_minutes', 'Consultation minutes', 'number'], ['opd_start', 'OPD start', 'time'], ['opd_end', 'OPD end', 'time']].map(([k, l, ty]) => <div key={k}><label>{l}</label><input type={ty} disabled={!owner} value={s[k] ?? ''} onChange={e => setS(k, ty === 'number' ? +e.target.value : e.target.value)} /></div>)}
      <label><input type="checkbox" style={{ width: 'auto' }} disabled={!owner} checked={s.walkin !== false} onChange={e => setS('walkin', e.target.checked)} /> Walk-in enabled</label><br />
      <label><input type="checkbox" style={{ width: 'auto' }} disabled={!owner} checked={s.online_booking !== false} onChange={e => setS('online_booking', e.target.checked)} /> Online booking enabled</label>
      {owner && <button className="btn" style={{ marginTop: 10 }} onClick={async () => { await put('/api/clinic', { name: c.name, address: c.address, phone: c.phone, email: c.email, settings: s }); setMsg('Saved ✓'); }}>Save Clinic Settings</button>}{msg && <p style={{ color: 'var(--ok)' }}>{msg}</p>}</div>}
    {['owner', 'doctor'].includes(ctx.me.role) && <div className="card"><b>Staff</b>{staff.map(u => <div className="row sp" key={u.id} style={{ padding: '8px 0' }}><span>{u.name}<br /><label>{u.role}</label></span>
      {owner && ['receptionist', 'nurse'].includes(u.role) && <button className="btn sm ghost" onClick={async () => { await api('/api/staff/' + u.id, { method: 'PATCH', body: { active: !u.active } }); setStaff(staff.map(x => x.id === u.id ? { ...x, active: !x.active } : x)); }}>{u.active ? 'Deactivate' : 'Activate'}</button>}</div>)}
      {owner && <><input placeholder="Name" onChange={e => setNs({ ...ns, name: e.target.value })} /><input placeholder="Mobile" onChange={e => setNs({ ...ns, mobile: e.target.value })} />
        <select onChange={e => setNs({ ...ns, role: e.target.value })}><option value="receptionist">Receptionist</option><option value="nurse">Nurse</option></select>
        <button className="btn" onClick={async () => { await post('/api/staff', ns); setStaff(await api('/api/staff')); }}>+ Add Staff</button></>}</div>}
    <div className="card"><p style={{ fontSize: 12, color: '#888' }}>TV screen link: <code>#/tv/{ctx.doctorId || ctx.me.id}</code> (open on waiting-room TV)</p></div>
    <div style={{ margin: 14 }}><button className="btn err" onClick={async () => { await logout(); location.reload(); }}>{t('logout')}</button></div></div>);
}

export function TV({ id }) {
  const [d, setD] = useState(null); const last = useRef(null);
  const load = () => publicGet('/tv/' + id).then(x => { setD(x); if (x.current_token !== last.current && last.current !== null && 'speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(`Token number ${x.current_token}`)); last.current = x.current_token; });
  useEffect(() => { load(); const ws = new WebSocket(WS_URL); ws.onopen = () => ws.send(JSON.stringify({ sub: 'doctor:' + id })); ws.onmessage = load; const iv = setInterval(load, 10000); return () => { ws.close(); clearInterval(iv); }; }, []);
  if (!d) return <div className="tv"><h1>Loading…</h1></div>;
  return (<div className="tv"><h1>{d.clinic}</h1><p style={{ fontSize: 22, opacity: .8 }}>Dr. {d.doctor} · {d.dept}</p><p style={{ fontSize: 28, marginTop: 30 }}>NOW SERVING / अभी बुलाया जा रहा है</p>
    <div className="big">#{d.current_token ?? '–'}</div><p style={{ fontSize: 34 }}>NEXT TOKEN #{d.next_token ?? '–'}</p><p style={{ marginTop: 24, opacity: .7 }}>{d.paused ? '⏸ Please wait' : 'Please wait for your turn'} · {d.waiting} waiting</p></div>);
}
