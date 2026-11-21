// Sensors: every temperature, power, clock, fan and voltage LibreHardwareMonitor can read, grouped by
// hardware and kind, plus battery. The host sends the full list once a second only while this screen is open.

import { h } from '../dom.js';
import { icon as glyph, liveText, row } from '../kit.js';
import { SENSOR_ORDER, sensorKind, sensorValue, duration } from '../metrics.js';

export const id = 'sensors';
export const title = 'Sensors';
export const tile = 'var(--cat-7)';
export const icon = () => glyph('thermo');

const PAWNIO_URL = 'https://pawnio.eu/';
let ui = null;

export function render(el, ctx) {
  ctx.actions.watchSensors(true);
  ui = { el, banner: h('div', { class: 'ts-stack' }), battery: h('div'), grid: h('div', { class: 'ts-grid' }), keys: '', nodes: new Map(), bannerKey: '' };
  ui.grid.append(h('article', { class: 'ts-card' }, h('span', { class: 'ts-skeleton', attrs: { style: 'width: 40%' } }),
    h('span', { class: 'ts-skeleton ts-skeleton--block' })));
  el.replaceChildren(ui.banner, ui.battery, ui.grid);
  update(el, ctx);
}

export function leave(ctx) { ctx.actions.watchSensors(false); ui = null; }

export function update(el, ctx) {
  if (!ui || ui.el !== el) return;
  const s = ctx.sample?.sensors;
  if (s) { banners(s, ctx); battery(s.battery); }
  if (ctx.sensorList) hardware(ctx.sensorList);
}

function banners(s, ctx) {
  const missingCpu = s.ready && s.cpuTemp == null;
  const key = [s.ready, s.error, missingCpu, s.pawnIO, s.admin].join();
  if (key === ui.bannerKey) return;
  ui.bannerKey = key;
  const banner = (tone, title, text, ...buttons) => h('div', { class: `ts-banner ts-banner--${tone}`, attrs: { role: 'status' } },
    glyph('warning', 'ts-banner-icon'),
    h('div', { class: 'ts-banner-content' }, h('span', { class: 'ts-banner-title' }, title), h('p', { class: 'ts-banner-text' }, text)),
    buttons);
  const button = (label, onClick) => h('button', { class: 'ts-button ts-button--tinted', attrs: { type: 'button' }, onclick: onClick }, label);
  const items = [];
  if (s.error) items.push(banner('negative', 'Sensors could not start', s.error));
  else if (!s.ready) items.push(banner('tint', 'Reading sensors…', 'The first scan of your hardware takes a few seconds.'));
  if (missingCpu && !s.pawnIO) {
    items.push(banner('warning', 'CPU temperature and power need the PawnIO driver',
      'Windows only lets a signed driver read the CPU and motherboard sensors (CPU temperature, CPU power, motherboard fans). ' +
      'Install the free PawnIO driver, then restart this app as administrator. Some games’ anti-cheat software objects to such drivers.',
      button('Get PawnIO', () => ctx.actions.openExternal(PAWNIO_URL))));
  } else if (missingCpu && !s.admin) {
    items.push(banner('warning', 'CPU temperature and power need administrator rights',
      'PawnIO is installed. Restart as administrator to read the CPU and motherboard sensors.',
      button('Restart as administrator', () => ctx.actions.elevate())));
  }
  if (!s.admin && !(missingCpu && s.pawnIO)) {
    items.push(h('p', { class: 'ts-list-footer' }, 'Drive temperatures appear when the app runs as administrator. ',
      h('button', { class: 'ts-button ts-button--plain', attrs: { type: 'button' }, onclick: () => ctx.actions.elevate() }, 'Restart as administrator')));
  }
  ui.banner.replaceChildren(...items);
}

function battery(b) {
  if (!b) { ui.battery.replaceChildren(); return; }
  if (!ui.batteryNodes) {
    const n = ui.batteryNodes = { level: liveText(), state: liveText(), rate: liveText(), left: liveText() };
    ui.battery.replaceChildren(h('div', { class: 'ts-grid ts-grid--stats' },
      [['Battery', n.level], ['Status', n.state], ['Power', n.rate], ['Time left', n.left]].map(([label, value]) =>
        h('article', { class: 'ts-card ts-stat' }, h('span', { class: 'ts-stat-label' }, label), h('span', { class: 'ts-stat-value' }, value)))));
  }
  const n = ui.batteryNodes;
  n.level.set(`${Math.round(b.level)}%`);
  n.state.set(b.charging ? 'Charging' : b.pluggedIn ? 'Plugged in' : 'On battery');
  n.rate.set(b.watts != null ? `${b.watts.toFixed(1)} W` : '—');
  n.left.set(b.remainingSeconds != null ? duration(b.remainingSeconds) : b.pluggedIn ? '—' : 'Estimating…');
}

// One card per piece of hardware, one list per kind of sensor. Built once per set of sensors; each update
// only rewrites the value and min–max text of each row.
function hardware(list) {
  const keys = list.map(hw => `${hw.name}:${hw.sensors.map(s => `${s.type}/${s.name}`).join(',')}`).join('|');
  if (keys !== ui.keys) {
    ui.keys = keys;
    ui.nodes = new Map();
    ui.grid.replaceChildren(...list.map(hw => {
      const groups = SENSOR_ORDER.map(type => [type, hw.sensors.filter(s => s.type === type)]).filter(([, ss]) => ss.length);
      return h('article', { class: 'ts-card' },
        h('div', { class: 'ts-card-header' }, h('h3', { class: 'ts-card-title' }, hw.name)),
        groups.map(([type, ss]) => [
          h('p', { class: 'ts-list-header' }, sensorKind(type)),
          h('ul', { class: 'ts-list' }, ss.map(s => {
            const value = liveText(), range = liveText('');
            ui.nodes.set(`${hw.name}|${s.type}|${s.name}`, { value, range });
            return row({ title: s.name, subtitle: range, trailing: value });
          })),
        ]));
    }));
  }
  for (const hw of list) {
    for (const s of hw.sensors) {
      const n = ui.nodes.get(`${hw.name}|${s.type}|${s.name}`);
      if (!n) continue;
      n.value.set(sensorValue(s.type, s.value));
      n.range.set(s.min != null && s.max != null ? `${sensorValue(s.type, s.min)} – ${sensorValue(s.type, s.max)}` : '');
    }
  }
}
