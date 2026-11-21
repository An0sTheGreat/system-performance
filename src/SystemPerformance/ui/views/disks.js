// Disks tab: pick any physical disk to see its activity, throughput, latency, queue and IOPS over time,
// what it is (model, SSD/HDD, NVMe/SATA, health), its volumes, and its sensors (temperature, wear) when the
// app runs as administrator.

import { h } from '../dom.js';
import { icon as glyph, progress } from '../kit.js';
import { pct, perSec, bytes, diskLabel, niceMax } from '../metrics.js';
import { statRow, chartCard, draw, specCard, topCard, sensorCard, picker, stats, note, text, fill } from './detail.js';

export const id = 'disks';
export const title = 'Disks';
export const tile = 'var(--cat-4)';
export const icon = () => glyph('disk');
export const needsInventory = true;

let selected = null;   // PDH instance name, e.g. "4 C:"
let ui = null;

const card = (titleText, ...body) => h('article', { class: 'ts-card' }, h('div', { class: 'ts-card-header' }, h('h3', { class: 'ts-card-title' }, titleText)), body);
const numberOf = name => Number(String(name).split(' ')[0]);
const lettersOf = name => String(name).split(' ').slice(1).map(l => l.replace(':', ''));

export function render(el, ctx) {
  const { animate, inventory: inv } = ctx;
  ctx.actions.watchProcesses(true);
  ctx.actions.watchSensors(true);
  const disks = ctx.sample?.disks ?? [];
  if (ctx.params?.disk) selected = ctx.params.disk;
  if (!disks.some(d => d.name === selected)) selected = disks.find(d => lettersOf(d.name).includes('C'))?.name ?? disks[0]?.name ?? null;
  const info = inv?.disks?.find(d => d.number === numberOf(selected));
  const model = d => inv?.disks?.find(x => x.number === numberOf(d.name))?.model;

  const sr = statRow([{ key: 'active', label: 'Active time' }, { key: 'read', label: 'Read' }, { key: 'write', label: 'Write' }, { key: 'latency', label: 'Response time' }], animate);
  const activeChart = chartCard('Active time', ['var(--cat-4)'], 'Disk active time, last 60 seconds', { size: 'tall', animate });
  const rw = chartCard('Throughput', ['var(--cat-2)', 'var(--cat-6)'], 'Disk read and write speed, last 60 seconds', { size: 'tall', animate, legendItems: [['Read', 'var(--cat-2)'], ['Write', 'var(--cat-6)']] });
  const act = stats({ queue: 'Queue length', reads: 'Reads/s', writes: 'Writes/s', used: 'Used', free: 'Free', capacity: 'Capacity' });
  const specs = specCard('Specifications', [
    ['Model', info?.model ?? (inv ? null : 'Loading…')],
    ['Type', info?.media], ['Interface', info?.bus], ['Health', info?.health],
    ['Capacity', info?.size ? bytes(info.size, 0) : null], ['Spindle speed', info?.rpm ? `${info.rpm.toLocaleString()} RPM` : null],
    ['Disk number', selected != null ? String(numberOf(selected)) : null],
  ], animate);
  const vols = (inv?.volumes ?? []).filter(v => lettersOf(selected).includes(v.letter));
  const volumes = card('Volumes', vols.length
    ? h('ul', { class: 'ts-list' }, vols.map(v => {
      const bar = progress(`${v.letter}: used space`);
      bar.set((v.total - v.free) / v.total);
      return h('li', null, h('div', { class: 'ts-row' },
        h('span', { class: 'ts-row-content' },
          h('span', { class: 'ts-row-title' }, `${v.letter}:${v.label ? ` ${v.label}` : ''}`),
          h('span', { class: 'ts-row-subtitle' }, `${v.fileSystem} · ${bytes(v.free, 0)} free of ${bytes(v.total, 0)}`), bar)));
    }))
    : note(inv ? 'No lettered volumes on this disk.' : 'Loading…'));
  const sens = sensorCard('Drive sensors', note('Drive temperature, wear and lifetime writes appear when the app runs as administrator.',
    { label: 'Restart as administrator', onClick: () => ctx.actions.elevate() }), animate);
  const top = topCard('io', ctx, 'Top apps by disk I/O', animate);

  fill(el,
    disks.length > 1 ? picker('Disk', disks.map(d => ({ value: d.name, label: `${diskLabel(d.name)}${model(d) ? ` · ${model(d)}` : ''}` })), selected,
      v => ctx.actions.navigate(id, { disk: v })) : null,
    sr.el,
    h('div', { class: 'ts-grid ts-grid--halves' }, activeChart.card, rw.card),
    h('div', { class: 'ts-grid ts-grid--halves' }, card('Activity', act.el), specs),
    h('div', { class: 'ts-grid ts-grid--halves' }, volumes, sens.card),
    top.card);
  ui = { el, sr, activeChart, rw, act, sens, top, model: info?.model };
  if (ctx.sample) update(el, ctx);
}

export function leave(ctx) { ctx.actions.watchProcesses(false); ctx.actions.watchSensors(false); ui = null; }

export function update(el, ctx) {
  if (!ui || ui.el !== el || !ctx.sample) return;
  const d = ctx.sample.disks.find(x => x.name === selected);
  if (!d) return;
  ui.sr.value.active.set(pct(d.active));
  ui.sr.meta.active.set(diskLabel(d.name));
  ui.sr.value.read.set(perSec(d.read));
  ui.sr.meta.read.set(`${(d.readsPerSec ?? 0).toLocaleString()} reads/s`);
  ui.sr.value.write.set(perSec(d.write));
  ui.sr.meta.write.set(`${(d.writesPerSec ?? 0).toLocaleString()} writes/s`);
  ui.sr.value.latency.set(`${d.latencyMs.toFixed(1)} ms`);
  ui.sr.meta.latency.set('Average per transfer');
  draw(ui.activeChart.chart, ctx, [`disk:${d.name}/active`], 100);
  ui.activeChart.meta.set('Last 60 seconds');
  draw(ui.rw.chart, ctx, [`disk:${d.name}/read`, `disk:${d.name}/write`], peak => niceMax(peak, 1024 * 1024));
  ui.rw.meta.set(`Read ${perSec(d.read)} · Write ${perSec(d.write)}`);
  ui.act.queue.set((d.queue ?? 0).toFixed(0));
  ui.act.reads.set((d.readsPerSec ?? 0).toLocaleString());
  ui.act.writes.set((d.writesPerSec ?? 0).toLocaleString());
  ui.act.used.set(d.total ? bytes(d.used, 0) : '—');
  ui.act.free.set(d.total ? bytes(d.total - d.used, 0) : '—');
  ui.act.capacity.set(d.total ? bytes(d.total, 0) : '—');
  ui.top.update(ctx.procs);
  const m = ui.model?.toLowerCase();
  ui.sens.update(ctx.sensorList, hw => hw.type === 'Storage' && !!m && (hw.name.toLowerCase().includes(m) || m.includes(hw.name.toLowerCase())));
}
