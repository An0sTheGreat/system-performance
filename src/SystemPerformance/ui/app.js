// App shell: settings, sample history, routing and the frame every view renders into.
import { h, transition, closeSheet } from './dom.js';
import * as bridge from './bridge.js';
import { Series, capacity, parseSettings } from './metrics.js';
import * as dashboard from './views/dashboard.js';
import * as cpuView from './views/cpu.js';
import * as gpuView from './views/gpu.js';
import * as memoryView from './views/memory.js';
import * as disksView from './views/disks.js';
import * as networkView from './views/network.js';
import * as sensorsView from './views/sensors.js';
import * as settingsView from './views/settings.js';
import { updateTop } from './views/top.js';

const ALL_VIEWS = [dashboard, cpuView, gpuView, memoryView, disksView, networkView, sensorsView, settingsView];
const KEY = 'sysperf.settings.v1';

// localStorage is a convenience only: reads and writes may fail and the app must still work.
const settings = (() => { try { return parseSettings(JSON.parse(localStorage.getItem(KEY))); } catch { return parseSettings(null); } })();
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage disabled */ } };

// History lives here, not in a view, so charts keep their minute when you switch tabs and come back.
// Series are created on first use, one per key (e.g. 'cpu', 'disk:4 C:/read', 'gpu:<luid>').
const history = {};
const track = (key, value) => (history[key] ??= new Series(capacity(settings.rate))).push(value);
const seriesOf = key => history[key] ??= new Series(capacity(settings.rate));

let info = {};
let inventory = null;     // what the hardware is (WMI); arrives a second or two after start
let overlay = { show: false, locked: true, trayCpu: true };
let sample = null;
let procs = null;         // last per-program snapshot, while something watches processes
let sensorList = null;    // full sensor list, while something watches sensors
let params = null;        // one-shot navigation parameters (e.g. which disk to open)
let viewRoot = null;
let rendered = null;      // the view whose render() ran last, so its leave() runs before the next
const $ = id => document.getElementById(id);
const views = () => ALL_VIEWS.filter(v => v.available?.(ctx()) ?? true);
const knownView = id => (views().some(v => v.id === id) ? id : null);
let viewId = location.hash.slice(1) || 'dashboard';
const currentView = () => views().find(v => v.id === viewId) ?? ALL_VIEWS[0];
const ctx = (animate = false) => ({ info, inventory, sample, procs, sensorList, history, series: seriesOf, settings, overlay, params, animate, actions });

function onSample(s) {
  sample = s;
  if (s.sensorList) sensorList = s.sensorList;
  if (s.procs) procs = s.procs;
  track('cpu', s.cpu.total);
  track('gpu', s.gpu?.util ?? 0);
  track('mem', s.mem.total ? (s.mem.used / s.mem.total) * 100 : 0);
  track('commit', s.mem.commitLimit ? (s.mem.commit / s.mem.commitLimit) * 100 : 0);
  track('disk', s.disks.reduce((m, d) => Math.max(m, d.active), 0));
  track('rx', s.net?.rx ?? 0);
  track('tx', s.net?.tx ?? 0);
  for (const g of s.gpus ?? []) {
    track(`gpu:${g.luid}`, g.util);
    track(`gpumem:${g.luid}`, g.dedicatedUsed);
    for (const [engine, v] of Object.entries(g.engines)) track(`gpu:${g.luid}/${engine}`, v);
  }
  if (s.sensors?.gpuTemp != null) track('gpuTemp', s.sensors.gpuTemp);
  if (s.sensors?.gpuPower != null) track('gpuPower', s.sensors.gpuPower);
  if (s.sensors?.cpuTemp != null) track('cpuTemp', s.sensors.cpuTemp);
  if (s.sensors?.cpuPower != null) track('cpuPower', s.sensors.cpuPower);
  for (const d of s.disks) { track(`disk:${d.name}/active`, d.active); track(`disk:${d.name}/read`, d.read); track(`disk:${d.name}/write`, d.write); }
  for (const n of s.nets ?? []) { track(`net:${n.id}/rx`, n.rx); track(`net:${n.id}/tx`, n.tx); }
  if (s.ping?.router?.last != null) track('ping:router', s.ping.router.last);
  if (s.ping?.internet?.last != null) track('ping:internet', s.ping.internet.last);
  if (viewRoot?.isConnected) currentView().update?.(viewRoot, ctx());
  if (s.procs) updateTop(s.procs);
}

// Feeds the host only produces on request (per-process data, the full sensor list, latency). Several
// screens and the Top apps sheet can want one at once, so they're counted: on at the first, off at the last.
const watchers = { processes: 0, sensors: 0, network: 0 };
function watch(kind, on) {
  const before = watchers[kind];
  watchers[kind] = Math.max(0, before + (on ? 1 : -1));
  if ((before === 0) === (watchers[kind] === 0)) return;
  if (kind === 'processes') bridge.setProcesses(watchers[kind] > 0);
  if (kind === 'sensors') bridge.setSensors(watchers[kind] > 0);
  if (kind === 'network') bridge.setNetwork(watchers[kind] > 0, settings.pingInternet);
}

const actions = {
  navigate(id, p = null) {
    params = p;
    if (location.hash === `#${id}`) go(id); else location.hash = `#${id}`;
  },
  watchProcesses: on => watch('processes', on),
  watchSensors: on => watch('sensors', on),
  watchNetwork: on => watch('network', on),
  endTask: name => bridge.endTask(name),
  setOverlay: patch => bridge.setOverlay(patch),
  elevate: () => bridge.elevate(),
  openExternal: url => bridge.openExternal(url),
  web: (type, payload) => bridge.web(type, payload),
  setSetting(key, value) {
    if (settings[key] === value) return;
    settings[key] = value;
    persist();
    if (key === 'theme') applyTheme();
    if (key === 'rate') {
      for (const s of Object.values(history)) s.resize(capacity(value));
      bridge.setRate(value);
    }
    if (key === 'pingInternet' && watchers.network > 0) bridge.setNetwork(true, value);
  },
};

function applyTheme() {
  if (settings.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
  bridge.setTheme(settings.theme);
}

function buildNav() {
  const pill = $('nav').querySelector('.ts-nav-pill');
  $('nav').replaceChildren(pill, ...views().map((v, i) => h('a', { class: 'ts-nav-item', attrs: { href: `#${v.id}`, title: `${v.title} (${i + 1})` }, dataset: { view: v.id } },
    h('span', { class: 'ts-nav-icon', attrs: { style: `--tile: ${v.tile}` } }, v.icon()),
    h('span', { class: 'ts-nav-label' }, v.title))));
}

function syncNav() {
  $('nav').style.setProperty('--index', String(views().findIndex(v => v.id === viewId)));
  for (const a of $('nav').querySelectorAll('.ts-nav-item')) {
    if (a.dataset.view === viewId) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

function render(animate) {
  const view = currentView();
  viewId = view.id;
  const c = ctx(animate);
  $('bar-title').textContent = view.title;
  document.title = `System Performance — ${view.title}`;
  rendered?.leave?.(c);   // views start their feeds in render() and stop them in leave()
  rendered = view;
  $('bar-actions').replaceChildren(...(view.actions?.(c) ?? []));
  viewRoot = h('div', { class: 'ts-stack' });
  $('content').replaceChildren(h('h1', { class: 'ts-large-title' }, view.title), viewRoot);
  view.render(viewRoot, c);
  params = null;
}

function go(id) {
  if (!knownView(id)) return;
  transition(() => {
    viewId = id;
    closeSheet();
    syncNav();
    render(true);
    $('main').scrollTop = 0;
  });
}

addEventListener('hashchange', () => go(location.hash.slice(1)));
addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const list = views();
  if (e.key >= '1' && e.key <= String(list.length)) actions.navigate(list[e.key - 1].id);
});

applyTheme();
info = await bridge.start(settings.rate, onSample);
buildNav();
syncNav();
overlay = await bridge.overlay(state => {
  overlay = state;
  const view = currentView();
  $('bar-actions').replaceChildren(...(view.actions?.(ctx()) ?? []));
  if (view.id === 'settings') render(false);
});
render(true);
bridge.inventory().then(inv => {
  inventory = inv;
  if (currentView().needsInventory) render(false);
});
