// Can I Run It? Gaming: search Steam (plus the built-in non-Steam list), pick a game, and see whether this PC
// meets its specs and roughly what FPS each preset gives at the chosen resolution.
import { h } from '../dom.js';
import { icon, combo, empty, row } from '../kit.js';
import { ASPECTS, RESOLUTIONS, parseResolution, parseAspect, aspectOf, parseRequirements, specFromText, estimateGame } from '../estimate-game.js';
import { GAMES } from '../data/games.js';
import { latestOnly, pcFromInventory, searchField } from './canirun-shared.js';

// Survives tab switches and mode toggles.
let term = '', results = null, searchError = null, searching = false;
let selected = null, details = null, detailError = null, loadingDetails = false;
let ui = null;   // the live render's painters; async replies paint whichever render is current
let web = null;  // ctx.actions.web, set by render for the async helpers below

const searchSteam = latestOnly((web, t) => web('gameSearch', { term: t }));
const fetchDetails = latestOnly((web, appId) => web('gameDetails', { appId }));

const TARGETS = [30, 60, 120, 144, 165, 240];
const VERDICT = { below: 'Below minimum', playable: 'Playable', well: 'Runs well', great: 'Great', unknown: "Can't estimate FPS" };
const MARK = { pass: ['✓', 'ts-badge--positive'], fail: ['✗', 'ts-badge--negative'], unknown: ['?', ''] };
const FOOTNOTE = 'Estimate from the published specs and a built-in GPU/CPU speed table: recommended ≈ 60 FPS at 1080p High. Real FPS varies by scene, drivers and settings.';

const resText = r => `${r.w} × ${r.h}`;
const resLabel = r => (r.w === 3840 && r.h === 2160 ? '4K' : aspectOf(r.w, r.h) === '16:9' ? `${r.h}p` : resText(r));
const parseTarget = t => { const m = String(t).trim().match(/^(\d+)\s*(?:fps)?$/i); const n = m ? +m[1] : NaN; return n >= 10 && n <= 1000 ? n : null; };
const fpsRange = p => (p.capped ? '300+ FPS' : `${Math.round(p.lo)}–${Math.round(p.hi)} FPS`);
const gb = v => (v == null ? '—' : `${v} GB`);
const hasAny = s => s && (s.gpuText || s.cpuText || s.ramGb != null || s.vramGb != null) ? s : null;
const card = (titleText, ...body) => h('article', { class: 'ts-card' }, titleText && h('div', { class: 'ts-card-header' }, h('h3', { class: 'ts-card-title' }, titleText)), body);
const builtInMatches = t => GAMES.filter(g => g.name.toLowerCase().includes(t.toLowerCase()));

function displayResolution() {
  const dpr = globalThis.devicePixelRatio || 1;
  return { w: Math.round(screen.width * dpr), h: Math.round(screen.height * dpr) };
}

export function render(el, ctx) {
  if (!ctx.inventory) { el.replaceChildren(empty({ title: 'Reading your hardware…' })); ui = null; return; }
  web = ctx.actions.web;
  const { pc, gpuName } = pcFromInventory(ctx.inventory, ctx.info);
  const set = ctx.actions.setSetting;
  let res = parseResolution(ctx.settings.resolution) ?? displayResolution();
  let aspect = ctx.settings.aspect ?? aspectOf(res.w, res.h);
  let target = ctx.settings.targetFps;

  const resOptions = a => (RESOLUTIONS[a] ?? []).map(([w, hh]) => resText({ w, h: hh }));
  const resCombo = combo({
    label: 'Resolution', value: resText(res), options: resOptions(aspect), parse: parseResolution,
    onChange: r => {
      res = r; resCombo.setValue(resText(r)); set('resolution', resText(r));
      const a = aspectOf(r.w, r.h);
      if (a !== aspect) { aspect = a; set('aspect', a); aspectCombo.setValue(a); resCombo.setOptions(resOptions(a)); }
      paintEstimate();
    },
  });
  const aspectCombo = combo({
    label: 'Aspect', value: aspect, options: ASPECTS, parse: parseAspect,
    onChange: a => {
      aspect = a; aspectCombo.setValue(a); set('aspect', a); resCombo.setOptions(resOptions(a));
      const list = RESOLUTIONS[a];
      if (list && aspectOf(res.w, res.h) !== a) {
        // Prefer the 1080-high entry, else the nearest height.
        const [w, hh] = list.find(([, y]) => y === 1080) ?? [...list].sort((p, q) => Math.abs(p[1] - res.h) - Math.abs(q[1] - res.h))[0];
        res = { w, h: hh }; resCombo.setValue(resText(res)); set('resolution', resText(res));
      }
      paintEstimate();
    },
  });
  const targetCombo = combo({
    label: 'Target', value: `${target} FPS`, options: TARGETS.map(n => `${n} FPS`), parse: parseTarget,
    onChange: n => { target = n; targetCombo.setValue(`${n} FPS`); set('targetFps', n); paintEstimate(); },
  });
  const control = (label, c) => h('div', { class: 'ts-cir-control' }, h('span', { class: 'ts-cir-label' }, label), c.el);

  const resultsSlot = h('div');
  const outSlot = h('div', { class: 'ts-stack' });

  function paintResults() {
    if (!term || selected) { resultsSlot.replaceChildren(); return; }
    let body;
    if (searching) {
      body = h('ul', { class: 'ts-list' }, [70, 55, 62].map(w => h('li', null, h('div', { class: 'ts-row' },
        h('span', { class: 'ts-skeleton ts-cir-cover' }), h('span', { class: 'ts-skeleton', attrs: { style: `width: ${w}%` } })))));
    } else {
      const rows = (results ?? []).map(g => h('li', null, h('button', { class: 'ts-row', attrs: { type: 'button' }, onclick: () => pick(g) },
        g.image ? h('img', { class: 'ts-cir-cover', attrs: { src: g.image, alt: '', width: 120, height: 45, loading: 'lazy' } })
          : h('span', { class: 'ts-cir-cover ts-cir-cover--none' }, icon('gauge')),
        h('span', { class: 'ts-row-content' }, h('span', { class: 'ts-row-title' }, g.name)),
        g.builtIn && h('span', { class: 'ts-row-trailing' }, h('span', { class: 'ts-badge' }, 'Not on Steam')))));
      body = [
        rows.length ? h('ul', { class: 'ts-list' }, rows) : null,
        searchError ? unreachable(searchError, () => runSearch(term)) : !rows.length ? empty({ title: 'No games found' }) : null,
      ];
    }
    resultsSlot.replaceChildren(card('Results', body));
  }

  function paintEstimate() {
    if (!selected) { outSlot.replaceChildren(); return; }
    const head = h('div', { class: 'ts-cir-game' },
      selected.image && h('img', { class: 'ts-cir-cover', attrs: { src: selected.image, alt: '', width: 120, height: 45 } }),
      h('h2', { class: 'ts-cir-game-name' }, details?.name ?? selected.name),
      details?.released && h('span', { class: 'ts-cir-muted' }, details.released));
    if (loadingDetails) { outSlot.replaceChildren(head, card(null, h('span', { class: 'ts-skeleton', attrs: { style: 'width: 45%' } }), h('span', { class: 'ts-skeleton ts-skeleton--block' }))); return; }
    if (detailError) { outSlot.replaceChildren(head, card(null, unreachable(detailError, () => pick(selected)))); return; }
    if (!details?.min && !details?.rec) { outSlot.replaceChildren(head, card(null, empty({ title: 'No PC requirements published' }))); return; }

    const est = estimateGame({ min: details.min, rec: details.rec, pc, res, target });
    const sug = est.presets?.find(p => p.name === est.suggested);
    const line = !pc.gpu ? `Your GPU isn't in the table yet${gpuName ? ` (${gpuName})` : ''}`
      : sug ? `Suggested: ${sug.name} · ~${fpsRange(sug)}`
      : est.upscaled ? `With ${est.upscaled.tech} Quality: ~${Math.round(est.upscaled.fps)} FPS at High`
      : !est.presets ? 'The requirements name no graphics card the table knows'
      : `No preset reaches ${target} FPS`;
    const verdict = card(null,
      h('div', { class: 'ts-cir-verdict' },
        h('p', { class: 'ts-cir-verdict-line', dataset: { verdict: est.verdict } }, VERDICT[est.verdict], h('span', { class: 'ts-cir-muted' }, ` at ${resLabel(res)}`)),
        h('div', { class: 'ts-cir-checks' }, Object.entries({ GPU: 'gpu', CPU: 'cpu', RAM: 'ram', VRAM: 'vram' }).map(([label, k]) => {
          const [mark, cls] = MARK[est.checks[k]];
          return h('span', { class: `ts-badge ${cls}`, attrs: { title: `${label}: ${est.checks[k]}` } }, `${label} ${mark}`);
        }))),
      h('p', { class: 'ts-cir-suggest' }, line));

    const presets = est.presets && card('Presets', h('ul', { class: 'ts-list' }, est.presets.map(p => row({
      title: [p.name, p.name === est.suggested ? h('span', { class: 'ts-badge ts-badge--tint ts-cir-star' }, '★') : null],
      subtitle: p.vramLimited ? 'Needs more VRAM' : null,
      trailing: fpsRange(p),
    }))));
    const { min, rec } = details;
    const reqRows = [
      ['GPU', min?.gpuText, rec?.gpuText, gpuName],
      ['CPU', min?.cpuText, rec?.cpuText, ctx.inventory.cpu?.name],
      ['RAM', gb(min?.ramGb), gb(rec?.ramGb), gb(pc.ramGb)],
      ['VRAM', gb(min?.vramGb), gb(rec?.vramGb), gb(pc.vramGb)],
    ];
    const requirements = card('Requirements', h('table', { class: 'ts-table ts-cir-req' },
      h('thead', null, h('tr', null, ['', 'Minimum', 'Recommended', 'This PC'].map(t => h('th', { attrs: { scope: 'col' } }, t)))),
      h('tbody', null, reqRows.map(([label, ...cells]) => h('tr', null, h('th', { attrs: { scope: 'row' } }, label), cells.map(c => h('td', null, c ?? '—')))))));
    outSlot.replaceChildren(head, verdict,
      h('div', { class: `ts-grid ${presets ? 'ts-cir-split' : ''}` }, presets, requirements),
      h('p', { class: 'ts-cir-note' }, FOOTNOTE));
  }

  el.replaceChildren(
    searchField({ placeholder: 'Search games…', value: term, onSearch: t => runSearch(t) }),
    h('div', { class: 'ts-cir-controls' }, control('Resolution', resCombo), control('Aspect', aspectCombo), control('Target', targetCombo)),
    resultsSlot, outSlot);
  ui = { paintResults, paintEstimate };
  paintResults();
  paintEstimate();
}

export function leave() { ui = null; }

function unreachable(error, retry) {
  const net = error === 'offline' || error === 'timeout';
  return empty({ glyph: 'warning', title: "Can't reach Steam", text: net ? 'Check your connection and try again.' : `Steam replied ${error}. Try again in a moment.`,
    action: { label: 'Retry', onClick: retry } });
}

async function runSearch(t) {
  term = t; selected = null; details = null; detailError = null; searchError = null;
  if (!t) { results = null; searching = false; ui?.paintResults(); ui?.paintEstimate(); return; }
  searching = true; ui?.paintResults(); ui?.paintEstimate();
  const r = await searchSteam(web, t);
  if (r === undefined) return;   // a newer search is in flight
  searching = false;
  const local = builtInMatches(t).map(g => ({ id: g.id, name: g.name, image: null, builtIn: true }));
  results = [...local, ...(r.ok ? r.data ?? [] : [])];
  searchError = r.ok ? null : r.error;
  ui?.paintResults();
}

async function pick(g) {
  selected = g; details = null; detailError = null;
  const local = GAMES.find(x => x.id === g.id);
  if (local) {
    details = { name: local.name, min: specFromText(local.min), rec: specFromText(local.rec) };
    loadingDetails = false; ui?.paintResults(); ui?.paintEstimate(); return;
  }
  loadingDetails = true; ui?.paintResults(); ui?.paintEstimate();
  const r = await fetchDetails(web, g.id);
  if (r === undefined || selected !== g) return;
  loadingDetails = false;
  if (r.ok) details = { name: r.data.name, released: r.data.released, min: hasAny(r.data.min && parseRequirements(r.data.min)), rec: hasAny(r.data.rec && parseRequirements(r.data.rec)) };
  else detailError = r.error;
  ui?.paintEstimate();
}

