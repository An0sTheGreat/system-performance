// CPU tab: utilization and clocks per logical processor, activity counters, temperatures and power (with
// PawnIO), the processor's make-up (P/E cores, caches, instruction sets for AI inference) and the platform.

import { h } from '../dom.js';
import { icon as glyph } from '../kit.js';
import { pct, ghz, uptime, bytes } from '../metrics.js';
import { statRow, chartCard, draw, specCard, topCard, sensorCard, stats, note, text, fill } from './detail.js';

export const id = 'cpu';
export const title = 'CPU';
export const tile = 'var(--cat-1)';
export const icon = () => glyph('cpu');
export const needsInventory = true;

const AI_SETS = ['AVX2', 'AVX-512', 'AVX-VNNI'];   // what CPU inference (llama.cpp and friends) looks for
let ui = null;

const card = (titleText, ...body) => h('article', { class: 'ts-card' }, h('div', { class: 'ts-card-header' }, h('h3', { class: 'ts-card-title' }, titleText)), body);
const kb = n => (n ? bytes(n * 1024, n >= 1024 ? 1 : 0) : null);

export function render(el, ctx) {
  const { animate, inventory: inv, info } = ctx;
  ctx.actions.watchProcesses(true);
  ctx.actions.watchSensors(true);
  const c = inv?.cpu, p = inv?.platform;

  const sr = statRow([{ key: 'util', label: 'Utilization' }, { key: 'speed', label: 'Speed' }, { key: 'temp', label: 'Temperature' }, { key: 'power', label: 'Package power' }], animate);
  const main = chartCard('Utilization', ['var(--cat-1)'], 'CPU utilization, last 60 seconds', { size: 'tall', animate });
  const grid = h('div', { class: 'ts-coregrid', attrs: { style: '--series: var(--cat-1)', role: 'img', 'aria-label': 'Load and clock per logical processor' } });
  const coresMeta = text('');
  const cores = h('article', { class: 'ts-card' },
    h('div', { class: 'ts-card-header' }, h('h3', { class: 'ts-card-title' }, 'Logical processors'), h('span', { class: 'ts-stat-meta' }, coresMeta)), grid);
  const act = stats({ processes: 'Processes', threads: 'Threads', uptime: 'Up time', switches: 'Context switches/s', interrupts: 'Interrupts/s', queue: 'Processor queue' });
  const top = topCard('cpu', ctx, 'Top apps by CPU', animate);
  const sens = sensorCard('CPU sensors', note('CPU temperatures, per-core clocks and power need the PawnIO driver and administrator rights.',
    { label: 'Open Sensors', onClick: () => ctx.actions.navigate('sensors') }), animate);

  const coreText = !c ? null : c.performanceCores ? `${c.cores} (${c.performanceCores} performance + ${c.efficiencyCores} efficient)` : String(c.cores);
  const specs = specCard('Specifications', [
    ['Name', c?.name ?? info.cpuName],
    ['Cores', coreText ?? (inv ? null : 'Loading…')],
    ['Logical processors', String(c?.logical ?? info.logical)],
    ['Base speed', c?.baseMhz ? ghz(c.baseMhz) : null],
    ['L1 cache', kb(c?.l1Kb)], ['L2 cache', kb(c?.l2Kb)], ['L3 cache', kb(c?.l3Kb)],
    ['Socket', c?.socket], ['Sockets', c?.sockets > 1 ? String(c.sockets) : null],
    ['Virtualization', c?.virtualization == null ? null : c.virtualization ? 'Enabled' : 'Disabled in firmware'],
    ['Architecture', c?.architecture],
  ], animate);

  const sets = c?.instructionSets ?? [];
  const missing = AI_SETS.filter(s => !sets.includes(s));
  const isa = card('Instruction sets',
    sets.length ? h('div', { class: 'ts-toolbar-group' }, sets.map(s => h('span', { class: `ts-badge${AI_SETS.includes(s) ? ' ts-badge--tint' : ''}` }, s))) : note(inv ? 'Not reported.' : 'Loading…'),
    h('p', { class: 'ts-list-footer' }, 'AVX2, AVX-512 and AVX-VNNI speed up running AI models on the CPU (llama.cpp, Ollama and similar).',
      missing.length ? ` Not supported here: ${missing.join(', ')}.` : ' All three are supported here.'));
  const platform = p ? specCard('Platform', [
    ['Motherboard', p.board], ['BIOS', [p.bios, p.biosDate].filter(Boolean).join(' · ')], ['Windows', p.os && `${p.os}${p.build ? ` (build ${p.build})` : ''}`],
  ], animate) : null;

  fill(el,
    sr.el,
    h('div', { class: 'ts-grid ts-grid--halves' }, main.card, cores),
    h('div', { class: 'ts-grid ts-grid--halves' }, card('Activity', act.el), top.card),
    h('div', { class: 'ts-grid ts-grid--halves' }, specs, h('div', { class: 'ts-stack' }, isa, platform)),
    sens.card);
  ui = { el, sr, main, grid, coresMeta, act, top, sens, baseMhz: c?.baseMhz };
  if (ctx.sample) update(el, ctx);
}

export function leave(ctx) { ctx.actions.watchProcesses(false); ctx.actions.watchSensors(false); ui = null; }

export function update(el, ctx) {
  if (!ui || ui.el !== el || !ctx.sample) return;
  const { cpu } = ctx.sample, sn = ctx.sample.sensors ?? {};
  ui.sr.value.util.set(pct(cpu.total));
  ui.sr.meta.util.set(`Peak ${pct(ctx.series('cpu').max())} in the last minute`);
  ui.sr.value.speed.set(ghz(cpu.mhz));
  ui.sr.meta.speed.set(ui.baseMhz ? `Base ${ghz(ui.baseMhz)}` : '');
  ui.sr.value.temp.set(sn.cpuTemp != null ? `${Math.round(sn.cpuTemp)} °C` : '—');
  ui.sr.meta.temp.set(sn.cpuTemp != null ? 'Package' : sn.ready ? 'Needs PawnIO' : 'Reading…');
  ui.sr.value.power.set(sn.cpuPower != null ? `${sn.cpuPower.toFixed(1)} W` : '—');
  ui.sr.meta.power.set(sn.cpuPower != null ? '' : sn.ready ? 'Needs PawnIO' : 'Reading…');
  draw(ui.main.chart, ctx, ['cpu'], 100);
  ui.main.meta.set('Last 60 seconds');

  if (ui.grid.children.length !== cpu.cores.length) {
    ui.grid.replaceChildren(...cpu.cores.map((_, i) => {
      const v = text(), mhz = text('');
      const tileEl = h('div', { class: 'ts-core-tile' }, h('span', { class: 'ts-core-tile-fill' }),
        h('span', { class: 'ts-core-tile-label' }, `CPU ${i}`), h('span', { class: 'ts-core-tile-value' }, v), h('span', { class: 'ts-core-tile-label' }, mhz));
      tileEl._v = v; tileEl._mhz = mhz;
      return tileEl;
    }));
  }
  cpu.cores.forEach((load, i) => {
    const t = ui.grid.children[i];
    t.firstChild.style.setProperty('--value', (load / 100).toFixed(3));
    t._v.set(pct(load));
    t._mhz.set(cpu.coresMhz?.[i] ? ghz(cpu.coresMhz[i]) : '');
  });
  ui.coresMeta.set(`${cpu.cores.length} threads`);

  ui.act.processes.set(cpu.processes.toLocaleString());
  ui.act.threads.set(cpu.threads.toLocaleString());
  ui.act.uptime.set(uptime(cpu.uptime));
  ui.act.switches.set((cpu.contextSwitches ?? 0).toLocaleString());
  ui.act.interrupts.set((cpu.interrupts ?? 0).toLocaleString());
  ui.act.queue.set(String(cpu.queue ?? 0));
  ui.top.update(ctx.procs);
  ui.sens.update(ctx.sensorList, hw => hw.type === 'Cpu', s => s.type !== 'Load');
}
