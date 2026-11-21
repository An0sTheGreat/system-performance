// Pure helpers: formatting, rolling history and chart paths. No DOM, so node --test covers them.

export const RATES = [1000, 500, 100];   // update intervals offered, in ms
export const WINDOW_MS = 60_000;         // charts always show the last minute, whatever the rate
export const capacity = rateMs => Math.round(WINDOW_MS / rateMs);

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
export function bytes(n, digits = 1) {
  let i = 0;
  n = Math.max(0, Number(n) || 0);
  while (n >= 1024 && i < UNITS.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? digits : 0)} ${UNITS[i]}`;
}
export const perSec = n => `${bytes(n)}/s`;

// Network rates read in bits, like Task Manager and ISPs.
const BIT_UNITS = ['bps', 'Kbps', 'Mbps', 'Gbps'];
export function bits(bytesPerSec) {
  let n = Math.max(0, Number(bytesPerSec) || 0) * 8, i = 0;
  while (n >= 1000 && i < BIT_UNITS.length - 1) { n /= 1000; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${BIT_UNITS[i]}`;
}

// Small shares keep a decimal (0.4%), like Task Manager's process list.
export const pctFine = v => { const n = Math.max(0, Number(v) || 0); return n < 10 ? `${n.toFixed(1)}%` : `${Math.round(n)}%`; };
export const pct = v => `${Math.round(Math.max(0, Number(v) || 0))}%`;
export const ghz = mhz => `${(mhz / 1000).toFixed(2)} GHz`;

export function uptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hms = [Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60), s % 60].map(x => String(x).padStart(2, '0')).join(':');
  return d ? `${d}d ${hms}` : hms;
}

// "0 C: D:" -> "Disk 0 (C: D:)"
export function diskLabel(name) {
  const [index, ...volumes] = String(name).split(' ').filter(Boolean);
  return volumes.length ? `Disk ${index} (${volumes.join(' ')})` : `Disk ${index}`;
}

// Fixed-size rolling history of numbers; the oldest values fall off the front.
export class Series {
  constructor(cap) { this.cap = cap; this.values = []; }
  push(v) {
    this.values.push(Number(v) || 0);
    if (this.values.length > this.cap) this.values.splice(0, this.values.length - this.cap);
  }
  resize(cap) {
    this.cap = cap;
    if (this.values.length > cap) this.values.splice(0, this.values.length - cap);
  }
  max() { let m = 0; for (const v of this.values) if (v > m) m = v; return m; }
}

// Line through the values, right-aligned on a chart that holds `cap` points across w×h (y grows down).
export function linePath(values, cap, max, w = 1000, h = 100) {
  if (!values.length || !(max > 0)) return '';
  const step = w / Math.max(1, cap - 1);
  const x0 = w - (values.length - 1) * step;
  let d = '';
  for (let i = 0; i < values.length; i++) {
    const y = h - Math.min(1, Math.max(0, values[i] / max)) * h;
    d += `${i ? 'L' : 'M'}${(x0 + i * step).toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

// The same line closed down to the baseline, for the filled area under it.
export function areaPath(line, values, cap, w = 1000, h = 100) {
  if (!line) return '';
  const x0 = w - (values.length - 1) * (w / Math.max(1, cap - 1));
  return `${line}L${w} ${h}L${x0.toFixed(1)} ${h}Z`;
}

// A chart scale that fits the data with headroom, at a round step (1, 2 or 5 × 10^n). Floor keeps idle lines flat.
export function niceMax(v, floor = 1) {
  const x = Math.max(floor, v * 1.15);
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 5, 10].map(m => m * p).find(m => m >= x);
}

// Settings read back from storage: anything unknown falls back to the default.
export const DEFAULTS = { theme: 'system', rate: 1000 };
export function parseSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    theme: ['system', 'light', 'dark'].includes(s.theme) ? s.theme : DEFAULTS.theme,
    rate: RATES.includes(s.rate) ? s.rate : DEFAULTS.rate,
  };
}

// The n programs using the most of `key` (cpu | mem | io | gpu), biggest first, ties by name.
export function topApps(apps, key, n = 15) {
  return [...(apps ?? [])].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0) || a.name.localeCompare(b.name)).slice(0, n);
}
