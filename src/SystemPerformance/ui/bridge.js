// Host messaging. Views never import this; app.js does.
// In a plain browser (design preview) a simulated machine stands in for the host.
import { demoInfo, demoSample, demoWatch, demoEnd, demoSensors } from './demo.js';

const webview = globalThis.chrome?.webview;
export const hosted = !!webview;
const pending = new Map();
let nextId = 1;
let onSample = null;
let onOverlay = null;
let demoTimer = 0;

webview?.addEventListener('message', e => {
  const m = e.data;
  if (m?.type === 'metrics') { onSample?.(m.data); return; }
  if (m?.type === 'overlay') { onOverlay?.(m.data); return; }
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

// Mini overlay + tray icon settings are owned by the host (the tray menu changes them too).
// listen(state) hears every change, whoever made it.
let demoOverlay = { show: false, locked: true, trayCpu: true };
export async function overlay(listen) {
  onOverlay = listen;
  return hosted ? (await request('overlayGet', {})).data : { ...demoOverlay };
}
export function setOverlay(patch) {
  if (hosted) { request('overlaySet', patch); return; }
  demoOverlay = { ...demoOverlay, ...patch };
  onOverlay?.({ ...demoOverlay });
}

// The full sensor list rides along in samples (s.sensorList, once a second) only while watching.
export function setSensors(on) { if (hosted) request('sensors', { on }); else demoSensors(on); }

// Restarts the app as administrator (Windows asks first). Resolves false if the user said no.
export async function elevate() { return hosted ? !!(await request('elevate', {})).ok : false; }

export function openExternal(url) { if (hosted) request('openExternal', { url }); else globalThis.open(url, '_blank', 'noopener'); }
