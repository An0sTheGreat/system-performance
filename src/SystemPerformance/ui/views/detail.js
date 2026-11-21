// Building blocks the hardware tabs share: stat rows, chart cards, spec lists, top-apps and sensor cards,
// and pickers. Each returns its element plus the live nodes an update() writes, so a 100 ms tick only
// touches text and chart paths.

import { h } from '../dom.js';
import { icon as glyph, liveChart, liveText, row, chip } from '../kit.js';
import { SENSOR_ORDER, sensorKind, sensorValue, topApps } from '../metrics.js';
import { openTop, RESOURCES } from './top.js';

export const text = liveText;

// dl.ts-kv of label-over-value figures; returns the element and one Text node per key.
export function stats(labels) {
  const t = {};
  t.el = h('dl', { class: 'ts-kv' }, Object.entries(labels).map(([k, label]) =>
    h('div', { class: 'ts-kv-item' }, h('dt', { class: 'ts-kv-label' }, label), h('dd', { class: 'ts-kv-value' }, (t[k] = text())))));
  return t;
}

export const labelled = (label, figure, bar) => h('div', null,
  h('div', { class: 'ts-progress-label' }, h('span', null, label), h('strong', null, figure)), bar);

export const legend = items => h('div', { class: 'ts-chart-legend' }, items.map(([label, color]) =>
  h('span', { class: 'ts-chip' }, h('span', { class: 'ts-chip-dot', attrs: { style: `--dot: ${color}` } }), label)));

// Four stat cards: [{ key, label }] -> { el, value: {key: Text}, meta: {key: Text} }
export function statRow(items, animate) {
  const value = {}, meta = {};
  const el = h('div', { class: 'ts-grid ts-grid--stats' }, items.map(i => h('article', { class: `ts-card ts-stat${animate ? ' ts-enter' : ''}` },
    h('span', { class: 'ts-stat-label' }, i.label),
    h('span', { class: 'ts-stat-value' }, (value[i.key] = text())),
    h('span', { class: 'ts-stat-meta' }, (meta[i.key] = text(''))))));
  return { el, value, meta };
}

// A card holding one live chart (first series filled). size: 'tall' | 'mini' | default.
export function chartCard(title, colors, label, { legendItems, size, animate } = {}) {
  const meta = text('');
  const chart = liveChart(colors, label);
  if (size) chart.classList.add(`ts-live--${size}`);
  const card = h('article', { class: `ts-card ts-meter${animate ? ' ts-enter' : ''}`, attrs: { style: `--series: ${colors[0]}` } },
    h('div', { class: 'ts-card-header' }, h('h3', { class: 'ts-card-title' }, title), h('span', { class: 'ts-stat-meta' }, meta)),
    chart,
    legendItems && legend(legendItems));
  return { card, chart, meta };
}

// Redraws a chart from history series keys; max: a number, or a function of the series' peak.
export function draw(chart, ctx, keys, max) {
  const series = keys.map(k => ctx.series(k));
  const peak = Math.max(0, ...series.map(s => s.max()));
  chart.update(series.map(s => ({ values: s.values, cap: s.cap })), typeof max === 'function' ? max(peak) : max);
}

// A titled card of label/value rows. rows: [[label, value]] where value is a string, node or Text.
export function specCard(title, rows, animate) {
  return h('article', { class: `ts-card${animate ? ' ts-enter' : ''}` },
    h('div', { class: 'ts-card-header' }, h('h3', { class: 'ts-card-title' }, title)),
    h('ul', { class: 'ts-list' }, rows.filter(r => r && r[1] != null && r[1] !== '').map(([label, value]) => row({ title: label, trailing: value }))));
}

// Top five programs by one resource, with "See all" opening the Top apps sheet. update(procs) each second.
export function topCard(key, ctx, title, animate) {
  const list = h('ul', { class: 'ts-list' }, h('li', null, h('div', { class: 'ts-row' }, h('span', { class: 'ts-skeleton', attrs: { style: 'width: 55%' } }))));
  const card = h('article', { class: `ts-card${animate ? ' ts-enter' : ''}` },
    h('div', { class: 'ts-card-header' }, h('h3', { class: 'ts-card-title' }, title),
      h('button', { class: 'ts-button ts-button--plain', attrs: { type: 'button' }, onclick: () => openTop(key, ctx) }, 'See all')),
    list);
  const update = procs => {
    if (!procs) return;
    list.replaceChildren(...topApps(procs, key, 5).map(a => row({ title: a.name, subtitle: a.count > 1 ? `${a.count} processes` : null, trailing: RESOURCES[key].format(a) })));
  };
  return { card, update };
}

// Sensor groups (Temperatures, Power, Clocks, Fans…) for the hardware match(hw) selects, from the full
// sensor list. Rebuilt only when the set of sensors changes; values are rewritten in place.
export function sensorCard(title, empty, animate) {
  const body = h('div', null, h('p', { class: 'ts-list-footer' }, 'Reading sensors…'));
  const card = h('article', { class: `ts-card${animate ? ' ts-enter' : ''}` },
    h('div', { class: 'ts-card-header' }, h('h3', { class: 'ts-card-title' }, title)), body);
  let keys = null, nodes = new Map();
  const update = (list, match, keep = () => true) => {
    if (!list) return;
    const sensors = list.filter(match).flatMap(hw => hw.sensors.filter(keep).map(s => ({ ...s, hw: hw.name })));
    const k = sensors.map(s => `${s.hw}|${s.type}|${s.name}`).join(',');
    if (k !== keys) {
      keys = k;
      nodes = new Map();
      if (!sensors.length) { body.replaceChildren(empty); return; }
      body.replaceChildren(...SENSOR_ORDER.map(type => [type, sensors.filter(s => s.type === type)]).filter(([, ss]) => ss.length).map(([type, ss]) => [
        h('p', { class: 'ts-list-header' }, sensorKind(type)),
        h('ul', { class: 'ts-list' }, ss.map(s => {
          const value = text(), range = text('');
          nodes.set(`${s.hw}|${s.type}|${s.name}`, { value, range });
          return row({ title: s.name, subtitle: range, trailing: value });
        })),
      ]).flat());
    }
    for (const s of sensors) {
      const n = nodes.get(`${s.hw}|${s.type}|${s.name}`);
      n?.value.set(sensorValue(s.type, s.value));
      n?.range.set(s.min != null && s.max != null ? `${sensorValue(s.type, s.min)} – ${sensorValue(s.type, s.max)}` : '');
    }
  };
  return { card, update };
}

// A row of toggle chips to choose one item (a GPU, a disk, an adapter).
export function picker(label, options, value, onPick) {
  const chips = options.map(o => {
    const el = chip({ label: o.label, pressed: o.value === value, onClick: () => { chips.forEach(c => c.setAttribute('aria-pressed', String(c === el))); onPick(o.value); } });
    return el;
  });
  return h('div', { class: 'ts-toolbar', attrs: { role: 'group', 'aria-label': label } }, h('div', { class: 'ts-toolbar-group' }, chips));
}

// A short note with a link to another tab (e.g. "Needs PawnIO — see Sensors").
export const note = (message, action) => h('p', { class: 'ts-list-footer' }, message, ' ',
  action && h('button', { class: 'ts-button ts-button--plain', attrs: { type: 'button' }, onclick: action.onClick }, action.label));

export const chevron = () => glyph('chevron', 'ts-meter-chevron');

// el.replaceChildren that skips null/false children (optional cards) and flattens arrays.
export const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));
