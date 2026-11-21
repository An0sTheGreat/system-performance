// Top apps sheet: which programs use the most CPU, memory, disk I/O or GPU, with End task.
// Opened from a dashboard card; the host sends per-process data once a second only while it is open.

import { h, openSheet } from '../dom.js';
import { icon as glyph, segmented, liveText } from '../kit.js';
import { bytes, perSec, pctFine, topApps } from '../metrics.js';

const RESOURCES = {
  cpu: { label: 'CPU', short: 'CPU', format: a => pctFine(a.cpu) },
  mem: { label: 'Memory', short: 'Mem', format: a => bytes(a.mem) },
  io: { label: 'Disk I/O', short: 'I/O', format: a => perSec(a.io) },
  gpu: { label: 'GPU', short: 'GPU', format: a => pctFine(a.gpu) },
};
const SHOWN = 15;
let sheet = null;   // { key, list, rows: Map<name,row>, apps, banner, actions, keys }

export function openTop(key, ctx) {
  const keys = Object.keys(RESOURCES).filter(k => k !== 'gpu' || ctx.info.gpuName);
  const list = h('ul', { class: 'ts-list', attrs: { 'aria-live': 'off' } },
    Array.from({ length: 6 }, () => h('li', null, h('div', { class: 'ts-row' }, h('span', { class: 'ts-skeleton', attrs: { style: 'width: 60%' } })))));
  const banner = h('div');
  const s = sheet = { key, list, rows: new Map(), apps: null, banner, actions: ctx.actions, keys };
  // The order holds still while you're on an End button (or one is armed), so a row can't move under a click.
  list.addEventListener('pointerleave', () => paint(s));
  list.addEventListener('focusout', () => paint(s));
  const content = h('div', { class: 'ts-stack' },
    segmented({
      name: 'top-by', label: 'Sort by', value: key,
      options: keys.map(k => ({ value: k, label: RESOURCES[k].label })),
      onChange: v => { s.key = v; paint(s, true); },
    }),
    banner,
    list,
    h('p', { class: 'ts-list-footer' },
      'Grouped by program, refreshed every second; the order holds still while you are on an End button. ' +
      'Disk I/O counts all file reads and writes. Ending a program closes all of its processes; unsaved work in it is lost.'));
  ctx.actions.watchProcesses(true);
  openSheet('Top apps', content, () => { if (sheet === s) sheet = null; ctx.actions.watchProcesses(false); });
}

export function updateTop(apps) {
  if (!sheet) return;
  sheet.apps = apps;
  paint(sheet);
}

function paint(s, reorder = false) {
  if (!s.apps || s !== sheet) return;
  const frozen = !reorder && s.rows.size > 0 &&
    !!s.list.querySelector('.ts-top-trailing:hover, .ts-button--negative, .ts-top-trailing button:focus-visible');
  if (frozen) {
    const byName = new Map(s.apps.map(a => [a.name, a]));
    for (const r of s.rows.values()) { const a = byName.get(r.name); if (a) fill(r, a, s); }
    return;
  }
  const rows = topApps(s.apps, s.key, SHOWN).map(a => {
    const r = s.rows.get(a.name) ?? makeRow(a.name, s);
    fill(r, a, s);
    return r;
  });
  s.rows = new Map(rows.map(r => [r.name, r]));
  s.list.replaceChildren(...rows.map(r => r.li));   // same nodes move: no flicker, button state kept
}

function fill(r, a, s) {
  r.value.set(RESOURCES[s.key].format(a));
  r.sub.set(s.keys.filter(k => k !== s.key).map(k => `${RESOURCES[k].short} ${RESOURCES[k].format(a)}`).join(' · '));
  r.count.set(String(a.count));
  r.badge.style.display = a.count < 2 ? 'none' : '';   // ts-badge's display beats the hidden attribute
}

function makeRow(name, s) {
  const value = liveText(), sub = liveText(''), count = liveText('');
  const badge = h('span', { class: 'ts-badge', attrs: { title: 'Processes' } }, count);
  const end = h('button', { class: 'ts-button ts-button--plain', attrs: { type: 'button', 'aria-label': `End ${name}` } }, 'End');
  let armed = 0;
  const disarm = () => { clearTimeout(armed); armed = 0; end.textContent = 'End'; end.classList.remove('ts-button--negative'); };
  end.addEventListener('click', async () => {
    if (!armed) {   // first click arms, second within 3 s ends
      end.textContent = 'Confirm';
      end.classList.add('ts-button--negative');
      armed = setTimeout(disarm, 3000);
      return;
    }
    clearTimeout(armed);
    armed = 0;
    end.disabled = true;
    end.textContent = 'Ending…';
    const r = await s.actions.endTask(name);
    end.disabled = false;
    if (r.ok) { end.textContent = 'Ended'; end.classList.remove('ts-button--negative'); s.banner.replaceChildren(); return; }
    disarm();
    s.banner.replaceChildren(h('div', { class: 'ts-banner ts-banner--negative ts-enter', attrs: { role: 'alert' } },
      glyph('warning', 'ts-banner-icon'),
      h('div', { class: 'ts-banner-content' },
        h('span', { class: 'ts-banner-title' }, r.ended ? `Ended ${r.ended} of ${r.ended + r.failed} ${name} processes` : `Couldn't end ${name}`),
        h('p', { class: 'ts-banner-text' }, r.error ?? 'Windows refused.'))));
  });
  const li = h('li', null, h('div', { class: 'ts-row' },
    h('span', { class: 'ts-row-content' },
      h('span', { class: 'ts-row-title' }, name, ' ', badge),
      h('span', { class: 'ts-row-subtitle' }, sub)),
    h('span', { class: 'ts-row-trailing ts-top-trailing' }, h('span', { class: 'ts-top-value' }, value), end)));
  return { name, li, value, sub, count, badge };
}
