// Memory tab: usage over time, what the memory is doing (in use, modified, standby cache, free), commit
// and paging pressure, and the installed modules with their speed (and a nudge when XMP/EXPO looks off).

import { h } from '../dom.js';
import { icon as glyph } from '../kit.js';
import { pct, bytes } from '../metrics.js';
import { statRow, chartCard, draw, specCard, topCard, stats, legend, labelled, text, fill } from './detail.js';
import { progress } from '../kit.js';

export const id = 'memory';
export const title = 'Memory';
export const tile = 'var(--cat-3)';
export const icon = () => glyph('memory');
export const needsInventory = true;

const PARTS = [['inUse', 'In use', 'var(--cat-3)'], ['modified', 'Modified', 'var(--cat-6)'], ['standby', 'Standby (cache)', 'var(--cat-2)'], ['free', 'Free', 'var(--color-fill-2)']];
let ui = null;

const card = (titleText, ...body) => h('article', { class: 'ts-card' }, h('div', { class: 'ts-card-header' }, h('h3', { class: 'ts-card-title' }, titleText)), body);

export function render(el, ctx) {
  const { animate, inventory: inv, info } = ctx;
  ctx.actions.watchProcesses(true);
  const mods = inv?.memory?.modules ?? [];

  const sr = statRow([{ key: 'used', label: 'In use' }, { key: 'avail', label: 'Available', warn: false }, { key: 'commit', label: 'Committed' }, { key: 'cached', label: 'Cached', warn: false }], animate);
  const main = chartCard('Memory usage', ['var(--cat-3)', 'var(--cat-6)'], 'Memory in use and committed, last 60 seconds', { size: 'tall', animate, legendItems: [['In use', 'var(--cat-3)'], ['Committed', 'var(--cat-6)']] });
  const segs = Object.fromEntries(PARTS.map(([k, , color]) => [k, h('span', { class: 'ts-stackbar-seg', attrs: { style: `--seg: ${color}` } })]));
  const partText = Object.fromEntries(PARTS.map(([k]) => [k, text('')]));
  const commitBar = progress('Commit charge'), commitText = text();
  const pressure = stats({ paged: 'Paged pool', nonPaged: 'Non-paged pool', faults: 'Hard faults/s', pageFile: 'Page file used' });
  const composition = card('Composition',
    h('div', { class: 'ts-stackbar', attrs: { role: 'img', 'aria-label': 'Memory composition' } }, Object.values(segs)),
    h('div', { class: 'ts-chart-legend' }, PARTS.map(([k, label, color]) =>
      h('span', { class: 'ts-chip' }, h('span', { class: 'ts-chip-dot', attrs: { style: `--dot: ${color}` } }), label, ' ', h('strong', null, partText[k])))),
    labelled('Commit charge', commitText, commitBar),
    pressure.el,
    h('p', { class: 'ts-list-footer' }, 'Standby is cache Windows hands back the moment a program needs it. Steady hard faults mean RAM is short and Windows is reading from the page file.'));

  const total = mods.reduce((t, m) => t + (m.capacity ?? 0), 0) || info.memTotal;
  const speeds = [...new Set(mods.map(m => m.configuredMts).filter(Boolean))];
  const rated = Math.max(0, ...mods.map(m => m.ratedMts ?? 0));
  const slow = mods.some(m => m.configuredMts && m.ratedMts && m.configuredMts < m.ratedMts);
  const kind = mods.find(m => m.type)?.type;
  const summary = specCard('Specifications', [
    ['Installed', bytes(total ?? 0)],
    ['Type', kind && `${kind}${mods.find(m => m.formFactor)?.formFactor ? ` ${mods.find(m => m.formFactor).formFactor}` : ''}`],
    ['Speed', speeds.length ? `${speeds.join(' / ')} MT/s` : null],
    ['Slots used', mods.length ? `${mods.length}${inv?.memory?.slots ? ` of ${inv.memory.slots}` : ''}` : (inv ? null : 'Loading…')],
  ], animate);
  const modules = mods.length ? card('Modules',
    slow && h('div', { class: 'ts-banner ts-banner--warning', attrs: { role: 'status' } }, glyph('warning', 'ts-banner-icon'),
      h('div', { class: 'ts-banner-content' }, h('span', { class: 'ts-banner-title' }, 'Memory is running below its rated speed'),
        h('p', { class: 'ts-banner-text' }, `Configured ${Math.min(...speeds)} MT/s; the modules report ${rated} MT/s. Turning on XMP (Intel) or EXPO (AMD) in the BIOS usually unlocks it.`))),
    h('ul', { class: 'ts-list' }, mods.map(m => h('li', null, h('div', { class: 'ts-row' },
      h('span', { class: 'ts-row-content' },
        h('span', { class: 'ts-row-title' }, [m.manufacturer, m.part].filter(Boolean).join(' ') || 'Memory module'),
        h('span', { class: 'ts-row-subtitle' }, [m.slot, m.type, m.configuredMts && `${m.configuredMts} MT/s`, m.ratedMts && m.ratedMts !== m.configuredMts && `rated ${m.ratedMts}`].filter(Boolean).join(' · '))),
      h('span', { class: 'ts-row-trailing' }, m.capacity ? bytes(m.capacity, 0) : ''))))),
    h('p', { class: 'ts-list-footer' }, 'Speeds are what the memory reports to Windows; some boards report the configured speed for both.')) : null;
  const top = topCard('mem', ctx, 'Top apps by memory', animate);

  fill(el,
    sr.el,
    h('div', { class: 'ts-grid ts-grid--halves' }, main.card, composition),
    h('div', { class: 'ts-grid ts-grid--halves' }, top.card, h('div', { class: 'ts-stack' }, summary, modules)));
  ui = { el, sr, main, segs, partText, commitBar, commitText, pressure, top };
  if (ctx.sample) update(el, ctx);
}

export function leave(ctx) { ctx.actions.watchProcesses(false); ui = null; }

export function update(el, ctx) {
  if (!ui || ui.el !== el || !ctx.sample) return;
  const m = ctx.sample.mem;
  const cached = (m.standby ?? 0) + (m.modified ?? 0);
  ui.sr.value.used.set(bytes(m.used));
  ui.sr.meta.used.set(`of ${bytes(m.total)} · ${pct(m.used / m.total * 100)}`);
  ui.sr.value.avail.set(bytes(m.total - m.used));
  ui.sr.meta.avail.set('Free plus standby cache');
  ui.sr.value.commit.set(bytes(m.commit));
  ui.sr.meta.commit.set(`of ${bytes(m.commitLimit)} limit`);
  ui.sr.value.cached.set(bytes(cached));
  ui.sr.meta.cached.set('Standby and modified pages');
  ui.sr.bar.used.set(m.used / m.total);
  ui.sr.bar.avail.set((m.total - m.used) / m.total);
  ui.sr.bar.commit.set(m.commitLimit ? m.commit / m.commitLimit : 0);
  ui.sr.bar.cached.set(cached / m.total);
  draw(ui.main.chart, ctx, ['mem', 'commit'], 100);
  ui.main.meta.set('% of RAM and of commit limit');

  const parts = { inUse: Math.max(0, m.used - (m.modified ?? 0)), modified: m.modified ?? 0, standby: m.standby ?? 0, free: m.free ?? 0 };
  for (const [k] of PARTS) { ui.segs[k].style.flexGrow = String(parts[k]); ui.partText[k].set(bytes(parts[k])); }
  if (m.commitLimit) ui.commitBar.set(m.commit / m.commitLimit);
  ui.commitText.set(`${bytes(m.commit)} of ${bytes(m.commitLimit)}`);
  ui.pressure.paged.set(bytes(m.pagedPool ?? 0));
  ui.pressure.nonPaged.set(bytes(m.nonPagedPool ?? 0));
  ui.pressure.faults.set((m.hardFaults ?? 0).toLocaleString());
  ui.pressure.pageFile.set(m.pageFile != null ? `${m.pageFile}%` : '—');
  ui.top.update(ctx.procs);
}
