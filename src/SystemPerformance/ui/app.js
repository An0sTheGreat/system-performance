// App shell: settings, sample history, routing and the frame every view renders into.
import { h, transition, closeSheet } from './dom.js';
import * as bridge from './bridge.js';
import { Series, capacity, parseSettings } from './metrics.js';
import * as dashboard from './views/dashboard.js';
import * as settingsView from './views/settings.js';
import { updateTop } from './views/top.js';

const VIEWS = [dashboard, settingsView];
const KEY = 'sysperf.settings.v1';

// localStorage is a convenience only: reads and writes may fail and the app must still work.
const settings = (() => { try { return parseSettings(JSON.parse(localStorage.getItem(KEY))); } catch { return parseSettings(null); } })();
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage disabled */ } };

// History lives here, not in a view, so charts keep their minute when you visit Settings and come back.
const history = Object.fromEntries(['cpu', 'gpu', 'mem', 'disk', 'rx', 'tx'].map(k => [k, new Series(capacity(settings.rate))]));
let info = {};
let overlay = { show: false, locked: true, trayCpu: true };
let sample = null;
let viewRoot = null;
const $ = id => document.getElementById(id);
const knownView = id => (VIEWS.some(v => v.id === id) ? id : null);
let viewId = knownView(location.hash.slice(1)) ?? 'dashboard';
const currentView = () => VIEWS.find(v => v.id === viewId) ?? VIEWS[0];
const ctx = (animate = false) => ({ info, sample, history, settings, overlay, animate, actions });

function onSample(s) {
  sample = s;
  history.cpu.push(s.cpu.total);
  history.gpu.push(s.gpu?.util ?? 0);
  history.mem.push(s.mem.total ? (s.mem.used / s.mem.total) * 100 : 0);
  history.disk.push(s.disks.reduce((m, d) => Math.max(m, d.active), 0));
  history.rx.push(s.net?.rx ?? 0);
  history.tx.push(s.net?.tx ?? 0);
  if (viewRoot?.isConnected) currentView().update?.(viewRoot, ctx());
  if (s.procs) updateTop(s.procs);
}

const actions = {
  navigate(id) { location.hash = `#${id}`; },
  watchProcesses: on => bridge.setProcesses(on),
  endTask: name => bridge.endTask(name),
  setOverlay: patch => bridge.setOverlay(patch),
  setSetting(key, value) {
    if (settings[key] === value) return;
    settings[key] = value;
    persist();
    if (key === 'theme') applyTheme();
    if (key === 'rate') {
      for (const s of Object.values(history)) s.resize(capacity(value));
      bridge.setRate(value);
    }
  },
};

function applyTheme() {
  if (settings.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
  bridge.setTheme(settings.theme);
}

function buildNav() {
  $('nav').append(...VIEWS.map((v, i) => h('a', { class: 'ts-nav-item', attrs: { href: `#${v.id}`, title: `${v.title} (${i + 1})` }, dataset: { view: v.id } },
    h('span', { class: 'ts-nav-icon', attrs: { style: `--tile: ${v.tile}` } }, v.icon()),
    h('span', { class: 'ts-nav-label' }, v.title))));
}

function syncNav() {
  $('nav').style.setProperty('--index', String(VIEWS.findIndex(v => v.id === viewId)));
  for (const a of $('nav').querySelectorAll('.ts-nav-item')) {
    if (a.dataset.view === viewId) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

function render(animate) {
  const view = currentView();
  const c = ctx(animate);
  $('bar-title').textContent = view.title;
  document.title = `System Performance — ${view.title}`;
  $('bar-actions').replaceChildren(...(view.actions?.(c) ?? []));
  viewRoot = h('div', { class: 'ts-stack' });
  $('content').replaceChildren(h('h1', { class: 'ts-large-title' }, view.title), viewRoot);
  view.render(viewRoot, c);
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
  if (e.key >= '1' && e.key <= String(VIEWS.length)) actions.navigate(VIEWS[e.key - 1].id);
});

applyTheme();
buildNav();
syncNav();
info = await bridge.start(settings.rate, onSample);
overlay = await bridge.overlay(state => {
  overlay = state;
  const view = currentView();
  $('bar-actions').replaceChildren(...(view.actions?.(ctx()) ?? []));
  if (view.id === 'settings') render(false);
});
render(true);
