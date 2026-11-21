// Host messaging. Views never import this; app.js does.
// In a plain browser (design preview) a simulated machine stands in for the host.
import { demoInfo, demoSample, demoWatch, demoEnd } from './demo.js';

const webview = globalThis.chrome?.webview;
export const hosted = !!webview;
const pending = new Map();
let nextId = 1;
let onSample = null;
let demoTimer = 0;

webview?.addEventListener('message', e => {
  const m = e.data;
  if (m?.type === 'metrics') { onSample?.(m.data); return; }
  const p = pending.get(m?.id);
  if (p) { pending.delete(m.id); p(m); }
});
const request = (type, payload) => new Promise(resolve => { const id = nextId++; pending.set(id, resolve); webview.postMessage({ id, type, ...payload }); });

export function setTheme(theme) { if (hosted) request('theme', { theme }); }

// Starts the sample stream; resolves with the static hardware info.
export async function start(interval, callback) {
  onSample = callback;
  if (hosted) return (await request('start', { interval })).data ?? {};
  setRate(interval);
  return demoInfo();
}

export function setRate(interval) {
  if (hosted) { request('interval', { interval }); return; }
  clearInterval(demoTimer);
  demoTimer = setInterval(() => onSample?.(demoSample(interval)), interval);
}

// Per-process data rides along in samples (s.procs, once a second) only while watching.
export function setProcesses(on) { if (hosted) request('processes', { on }); else demoWatch(on); }

// Ends every process with this program name. Resolves { ok, ended, failed, error }.
export async function endTask(name) {
  if (!hosted) return demoEnd(name);
  const r = await request('endTask', { name });
  return { ok: !!r.ok, ended: r.data?.ended ?? 0, failed: r.data?.failed ?? 0, error: r.error };
}
