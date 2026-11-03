const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';
export const WS_URL = import.meta.env.VITE_WS_URL || BASE.replace(/^http/, 'ws') + '/ws';
const S = { get: k => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), del: k => localStorage.removeItem(k) };
export const session = { has: () => !!S.get('access'), save: d => { S.set('access', d.access); S.set('refresh', d.refresh); }, clear: () => { S.del('access'); S.del('refresh'); } };
async function raw(path, opt = {}) {
  const r = await fetch(BASE + path, { ...opt, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (S.get('access') || ''), ...(opt.headers || {}) },
    body: opt.body ? JSON.stringify(opt.body) : undefined });
  return r;
}
export async function api(path, opt = {}) {
  let r = await raw(path, opt);
  if (r.status === 401 && S.get('refresh')) {
    const t = await fetch(BASE + '/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: S.get('refresh') }) });
    if (t.ok) { S.set('access', (await t.json()).access); r = await raw(path, opt); } else { session.clear(); location.reload(); }
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
export const post = (p, body) => api(p, { method: 'POST', body });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const authApi = (p, body) => fetch(BASE + '/auth' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Failed'); return j; });
export const publicGet = p => fetch(BASE + p).then(r => r.json());
export async function logout() { try { await authApi('/logout', { refresh: S.get('refresh') }); } catch {} session.clear(); }
