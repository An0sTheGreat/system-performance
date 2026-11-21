// Dashboard: every resource on one screen. render() builds the cards once; update() runs on every
// sample and only writes changed text nodes, two path attributes per chart and the core bars.

import { h } from '../dom.js';
import { icon as glyph, liveChart, progress, segmented, empty, chip, liveText as text } from '../kit.js';
import { openTop } from './top.js';
import { RATES, bytes, perSec, bits, pct, ghz, uptime, diskLabel, niceMax } from '../metrics.js';

export const id = 'dashboard';
export const title = 'Dashboard';
export const tile = 'var(--cat-1)';
export const icon = () => glyph('dashboard');

const COLORS = { cpu: 'var(--cat-1)', gpu: 'var(--cat-5)', mem: 'var(--cat-3)', disk: 'var(--cat-4)', rx: 'var(--cat-2)', tx: 'var(--cat-6)' };
const ENGINE_ORDER = ['3D', 'Compute', 'Copy', 'VideoDecode', 'VideoEncode'];
const engineName = k => k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
let ui = null;

export function actions(ctx) {
  return [chip({
    label: 'Overlay', pressed: ctx.overlay.show,
    onClick: () => ctx.actions.setOverlay({ show: !ctx.overlay.show }),
  }), segmented({
    name: 'rate', label: 'Update interval', value: ctx.settings.rate,
    options: RATES.map(r => ({ value: r, label: `${r} ms` })),
    onChange: v => ctx.actions.setSetting('rate', v),
  })];
}

// dl.ts-kv of label-over-value figures; returns the element and one Text node per key.
function stats(labels) {
  const t = {};
  t.el = h('dl', { class: 'ts-kv' }, Object.entries(labels).map(([k, label]) =>
    h('div', { class: 'ts-kv-item' }, h('dt', { class: 'ts-kv-label' }, label), h('dd', { class: 'ts-kv-value' }, (t[k] = text())))));
  return t;
}

const labelled = (label, figure, bar) => h('div', null,
  h('div', { class: 'ts-progress-label' }, h('span', null, label), h('strong', null, figure)), bar);

const legend = items => h('div', { class: 'ts-chart-legend' }, items.map(([label, color]) =>
  h('span', { class: 'ts-chip' }, h('span', { class: 'ts-chip-dot', attrs: { style: `--dot: ${color}` } }), label)));

function meter({ name, glyphName, color, sub, colors, label, extra = [], animate, onTop }) {
  const value = text(), meta = text(''), subText = text(sub ?? ''), heading = text(name);
  const chart = liveChart(colors ?? [color], label);
  const tileGlyph = h('span', { class: 'ts-nav-icon', attrs: { style: `--tile: ${color}` } }, glyph(glyphName));
  const card = h('article', { class: `ts-card ts-meter${animate ? ' ts-enter' : ''}`, attrs: { style: `--series: ${color}`, 'aria-label': name } },
    h('div', { class: 'ts-meter-head' }, tileGlyph,
      h('div', { class: 'ts-meter-titles' }, h('h3', { class: 'ts-card-title' }, heading), h('p', { class: 'ts-meter-sub' }, subText)),
      onTop && h('button', { class: 'ts-button ts-button--plain ts-meter-action', attrs: { type: 'button', 'aria-label': `Top apps by ${name}` }, onclick: onTop }, 'Top apps')),
    h('div', { class: 'ts-meter-figure' }, h('span', { class: 'ts-stat-value' }, value), h('span', { class: 'ts-stat-meta' }, meta)),
    chart, extra);
  return { card, value, meta, sub: subText, chart, heading, tileGlyph };
}

export function render(el, ctx) {
  const { info, animate } = ctx;
  const top = key => () => openTop(key, ctx);

  const cores = h('div', { class: 'ts-cores', attrs: { role: 'img', 'aria-label': 'Load per logical processor' } });
  const cpuStats = stats({ processes: 'Processes', threads: 'Threads', uptime: 'Up time' });
  const cpu = meter({ name: 'CPU', glyphName: 'cpu', color: COLORS.cpu, sub: info.cpuName, label: 'CPU usage, last 60 seconds', extra: [cores, cpuStats.el], animate, onTop: top('cpu') });

  const gpuBar = progress('Dedicated GPU memory'), gpuMem = text();
  const gpuEngines = h('dl', { class: 'ts-kv' });
  const gpu = info.gpuName
    ? meter({ name: 'GPU', glyphName: 'gpu', color: COLORS.gpu, sub: info.gpuName, label: 'GPU usage, last 60 seconds', extra: [labelled('Dedicated memory', gpuMem, gpuBar), gpuEngines], animate, onTop: top('gpu') })
    : null;
  const gpuCard = gpu?.card ?? h('article', { class: `ts-card ts-meter${animate ? ' ts-enter' : ''}` },
    empty({ glyph: 'gpu', title: 'No GPU found', text: 'Windows reported no hardware graphics adapter.' }));

  const memBar = progress('Committed memory'), commit = text();
  const memStats = stats({ used: 'In use', avail: 'Available', load: 'Load' });
  const mem = meter({ name: 'Memory', glyphName: 'memory', color: COLORS.mem, sub: `${bytes(info.memTotal ?? 0)} installed`, label: 'Memory usage, last 60 seconds',
    extra: [labelled('Committed', commit, memBar), memStats.el], animate, onTop: top('mem') });

  const disks = h('div', { class: 'ts-disks' });
  const disk = meter({ name: 'Disk', glyphName: 'disk', color: COLORS.disk, label: 'Busiest disk active time, last 60 seconds', extra: [disks], animate, onTop: top('io') });

  const netStats = stats({ adapter: 'Adapter', network: 'Network', signal: 'Signal', link: 'Link speed', rx: 'Receive', tx: 'Send' });
  const net = meter({
    name: 'Network', glyphName: 'wifi', color: COLORS.rx, colors: [COLORS.rx, COLORS.tx], label: 'Network throughput, last 60 seconds',
    extra: [legend([['Receive', COLORS.rx], ['Send', COLORS.tx]]), netStats.el], animate,
  });

  el.replaceChildren(
    h('div', { class: 'ts-grid' }, cpu.card, gpuCard, mem.card),
    h('div', { class: 'ts-grid ts-grid--halves' }, disk.card, net.card));
  el.querySelectorAll('.ts-enter').forEach((c, i) => c.style.setProperty('--i', String(i)));

  ui = { cpu, cores, cpuStats, gpu, gpuBar, gpuMem, gpuEngines, engineNodes: {}, engineKeys: '', mem, memBar, commit, memStats, disk, disks, diskNodes: [], diskKeys: '', net, netStats, netWireless: null };
  if (ctx.sample) update(el, ctx);
}

export function update(el, ctx) {
  if (!ui) return;
  const { sample: s, history: hs, info } = ctx;
  const chart = (m, keys, max) => m.chart.update(keys.map(k => ({ values: hs[k].values, cap: hs[k].cap })), max);

  // CPU
  ui.cpu.value.set(pct(s.cpu.total));
  ui.cpu.meta.set(`${ghz(s.cpu.mhz)} · ${info.logical} logical processors`);
  ui.cpuStats.processes.set(s.cpu.processes.toLocaleString());
  ui.cpuStats.threads.set(s.cpu.threads.toLocaleString());
  ui.cpuStats.uptime.set(uptime(s.cpu.uptime));
  chart(ui.cpu, ['cpu'], 100);
  if (ui.cores.children.length !== s.cpu.cores.length) {
    ui.cores.replaceChildren(...s.cpu.cores.map(() => h('span', { class: 'ts-core' }, h('span', { class: 'ts-core-fill' }))));
  }
  s.cpu.cores.forEach((v, i) => ui.cores.children[i].firstChild.style.setProperty('--value', (v / 100).toFixed(3)));

  // GPU
  if (ui.gpu && s.gpu) {
    ui.gpu.value.set(pct(s.gpu.util));
    const total = info.gpuDedicated || 0;
    ui.gpuMem.set(total ? `${bytes(s.gpu.dedicatedUsed)} of ${bytes(total)}` : bytes(s.gpu.dedicatedUsed));
    if (total) ui.gpuBar.set(s.gpu.dedicatedUsed / total);
    chart(ui.gpu, ['gpu'], 100);
    const keys = Object.keys(s.gpu.engines)
      .sort((a, b) => (ENGINE_ORDER.indexOf(a) + 1 || 99) - (ENGINE_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b)).slice(0, 5);
    if (keys.join() !== ui.engineKeys) {
      ui.engineKeys = keys.join();
      const t = stats({ ...Object.fromEntries(keys.map(k => [k, engineName(k)])), shared: 'Shared memory' });
      ui.engineNodes = t;
      ui.gpuEngines.replaceChildren(...t.el.children);
    }
    for (const k of keys) ui.engineNodes[k].set(pct(s.gpu.engines[k]));
    ui.engineNodes.shared.set(bytes(s.gpu.sharedUsed));
    const top = keys.reduce((a, k) => (s.gpu.engines[k] > s.gpu.engines[a] ? k : a), keys[0]);
    ui.gpu.meta.set(top && s.gpu.engines[top] >= 1 ? `Busiest: ${engineName(top)}` : 'Idle');
  }

  // Memory
  const load = s.mem.total ? (s.mem.used / s.mem.total) * 100 : 0;
  ui.mem.value.set(pct(load));
  ui.mem.meta.set(`${bytes(s.mem.used)} of ${bytes(s.mem.total)}`);
  ui.memStats.used.set(bytes(s.mem.used));
  ui.memStats.avail.set(bytes(s.mem.total - s.mem.used));
  ui.memStats.load.set(pct(load));
  ui.commit.set(`${bytes(s.mem.commit)} of ${bytes(s.mem.commitLimit)}`);
  if (s.mem.commitLimit) ui.memBar.set(s.mem.commit / s.mem.commitLimit);
  chart(ui.mem, ['mem'], 100);

  // Disks
  let busiest = 0, read = 0, write = 0;
  for (const d of s.disks) { busiest = Math.max(busiest, d.active); read += d.read; write += d.write; }
  ui.disk.value.set(pct(busiest));
  ui.disk.meta.set(`Read ${perSec(read)} · Write ${perSec(write)}`);
  ui.disk.sub.set(`${s.disks.length} physical ${s.disks.length === 1 ? 'disk' : 'disks'} · busiest shown`);
  chart(ui.disk, ['disk'], 100);
  const diskKeys = s.disks.map(d => d.name).join('|');
  if (diskKeys !== ui.diskKeys) {
    ui.diskKeys = diskKeys;
    ui.diskNodes = s.disks.map(d => ({ name: diskLabel(d.name), value: text(), meta: text('') }));
    ui.disks.replaceChildren(...ui.diskNodes.map(n => h('div', { class: 'ts-disk' },
      h('div', { class: 'ts-disk-head' }, h('span', { class: 'ts-disk-name' }, n.name), h('span', { class: 'ts-disk-value' }, n.value)),
      h('div', { class: 'ts-disk-meta' }, n.meta))));
  }
  s.disks.forEach((d, i) => {
    const n = ui.diskNodes[i];
    n.value.set(pct(d.active));
    n.meta.set(`R ${perSec(d.read)} · W ${perSec(d.write)} · ${d.latencyMs.toFixed(1)} ms${d.total ? ` · ${bytes(d.used, 0)} of ${bytes(d.total, 0)}` : ''}`);
  });

  // Network
  const n = s.net;
  if (n && n.wireless !== ui.netWireless) {
    ui.netWireless = n.wireless;
    ui.net.heading.set(n.wireless ? 'Wi-Fi' : 'Ethernet');
    ui.net.tileGlyph.replaceChildren(glyph(n.wireless ? 'wifi' : 'ethernet'));
  }
  ui.net.value.set(n ? bits(n.rx + n.tx) : '—');
  ui.net.meta.set(n ? 'total throughput' : '');
  ui.net.sub.set(n ? n.description : 'Not connected');
  ui.netStats.adapter.set(n?.name ?? '—');
  ui.netStats.network.set(n?.ssid || (n?.wireless ? 'Hidden' : n ? 'Wired' : '—'));
  ui.netStats.signal.set(n?.signal != null ? pct(n.signal) : '—');
  ui.netStats.link.set(n?.linkMbps ? `${n.linkMbps.toLocaleString()} Mbps` : '—');
  ui.netStats.rx.set(n ? bits(n.rx) : '—');
  ui.netStats.tx.set(n ? bits(n.tx) : '—');
  chart(ui.net, ['rx', 'tx'], niceMax(Math.max(hs.rx.max(), hs.tx.max()), 1000));
}
