// Can I Run It? AI: search Hugging Face, pick a model, a quant, an image projector and a context length, and
// see whether it fits this PC (VRAM, split, system RAM) and roughly how many tokens/s it generates.
import { h } from '../dom.js';
import { icon, combo, empty } from '../kit.js';
import { bytes } from '../metrics.js';
import { groupFiles, synthQuants, readConfig, kvBytes, estimateModel, VRAM_MARGIN } from '../estimate-ai.js';
import { latestOnly, pcFromInventory, searchField } from './canirun-shared.js';

// Survives tab switches and mode toggles.
let term = '', results = null, searchError = null, searching = false;
let selected = null, model = null, modelError = null, loading = false;
let quantTag = null, mmprojPath = '';   // '' = no image projector
let ui = null;   // the live render's painters; async replies paint whichever render is current
let web = null;  // ctx.actions.web, set by render for the async helpers below

const searchHf = latestOnly((web, t) => web('modelSearch', { term: t }));
const fetchModel = latestOnly(loadModel);

const CONTEXTS = [2048, 4096, 8192, 16384, 32768, 65536, 131072];
const WHERE = { vram: 'VRAM', split: 'Split', ram: 'System RAM', none: "Won't fit" };
const FOOTNOTE = 'Assumes a llama.cpp-based runtime (LM Studio, Ollama, llama.cpp). Speed is generation from memory bandwidth; MoE models may run faster.';

export const ctxLabel = n => (n % 1024 === 0 ? `${n / 1024}K` : String(n));
// "8192", "8,192", "8K" or "8k"; null outside 512..1048576.
export function parseContext(text) {
  const m = String(text).replace(/,/g, '').trim().match(/^(\d+)\s*(k)?$/i);
  const n = m ? +m[1] * (m[2] ? 1024 : 1) : NaN;
  return n >= 512 && n <= 1048576 ? n : null;
}
// The largest quant that fits in VRAM, else the smallest. rows: [{ tag, size, where }] in any order.
export function defaultQuant(rows) {
  const bySize = [...rows].sort((a, b) => a.size - b.size);
  return (bySize.filter(r => r.where === 'vram').pop() ?? bySize[0])?.tag ?? null;
}

const count = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const rate = v => (v < 10 ? v.toFixed(1) : String(Math.round(v)));
const tpsText = t => `~${rate(t.lo)}–${rate(t.hi)} tokens/s`;
const whereText = e => (e.where === 'split' ? `Split, ${Math.round(e.gpuShare * 100)}% on GPU` : WHERE[e.where]);
const fileLabel = p => p.split('/').pop().replace(/\.gguf$/i, '');
const card = (titleText, ...body) => h('article', { class: 'ts-card' }, titleText && h('div', { class: 'ts-card-header' }, h('h3', { class: 'ts-card-title' }, titleText)), body);
const selectField = (label, options, value, onChange) => {
  const sel = h('select', { class: 'ts-field-input', attrs: { 'aria-label': label }, onchange: () => onChange(sel.value) },
    options.map(([v, text]) => h('option', { attrs: { value: v } }, text)));
  sel.value = value;
  return h('label', { class: 'ts-field ts-cir-select' }, sel, icon('chevron'));
};

export function render(el, ctx) {
  if (!ctx.inventory) { el.replaceChildren(empty({ title: 'Reading your hardware…' })); ui = null; return; }
  web = ctx.actions.web;
  const { ai: pc } = pcFromInventory(ctx.inventory, ctx.info);
  const usableVram = pc.igpu ? 0 : Math.max(0, pc.vramBytes - VRAM_MARGIN);

  const cap = () => { const c = model?.cfg?.maxCtx ?? model?.info.ctx; return c > 0 ? c : Infinity; };
  const contextLen = () => Math.min(ctx.settings.context, cap());
  const ctxCombo = combo({
    label: 'Context', value: ctxLabel(contextLen()), options: [], parse: parseContext,
    onChange: n => { ctx.actions.setSetting('context', n); ctxCombo.setValue(ctxLabel(contextLen())); paintVerdict(); },
  });
  const control = (label, c) => h('div', { class: 'ts-cir-control' }, h('span', { class: 'ts-cir-label' }, label), c);

  const resultsSlot = h('div');
  const headSlot = h('div', { class: 'ts-stack' });
  const controlsSlot = h('div');
  const outSlot = h('div', { class: 'ts-stack' });

  // Every quant's estimate at the current projector and context.
  function estimates() {
    const { info, cfg } = model;
    const mm = model.mmproj.find(m => m.path === mmprojPath)?.size ?? 0;
    const len = contextLen();
    return model.quants.map(q => {
      // Without a parameter count, back one out of the file size at ~4.5 bits per weight.
      const params = info.params ?? q.size * 8 / 4.5;
      const kv = kvBytes(cfg, len, params);
      const activeFraction = cfg?.activeParams && info.params ? Math.min(1, cfg.activeParams / info.params) : 1;
      return { ...q, mm, kv, ...estimateModel({ weights: q.size, mmproj: mm, kv: kv.bytes, activeFraction, pc }) };
    });
  }

  function paintResults() {
    if (!term || selected) { resultsSlot.replaceChildren(); return; }
    let body;
    if (searching) {
      body = h('ul', { class: 'ts-list' }, [70, 55, 62].map(w => h('li', null, h('div', { class: 'ts-row' }, h('span', { class: 'ts-skeleton', attrs: { style: `width: ${w}%` } })))));
    } else {
      const rows = (results ?? []).map(m => h('li', null, h('button', { class: 'ts-row', attrs: { type: 'button' }, onclick: () => pick(m) },
        h('span', { class: 'ts-row-content' }, h('span', { class: 'ts-row-title' }, m.id),
          h('span', { class: 'ts-row-subtitle' }, `↓ ${count.format(m.downloads ?? 0)} · ♥ ${count.format(m.likes ?? 0)}`)),
        m.task && h('span', { class: 'ts-row-trailing' }, h('span', { class: 'ts-badge' }, m.task)))));
      body = [
        rows.length ? h('ul', { class: 'ts-list' }, rows) : null,
        searchError ? unreachable(searchError, () => runSearch(term)) : !rows.length ? empty({ title: 'No models found' }) : null,
      ];
    }
    resultsSlot.replaceChildren(card('Results', body));
  }

  // Head, controls and the estimate; runs when the picked model (or its loading state) changes.
  function paintModel() {
    controlsSlot.replaceChildren(); outSlot.replaceChildren();
    if (!selected) { headSlot.replaceChildren(); return; }
    headSlot.replaceChildren(h('div', { class: 'ts-cir-game' },
      h('h2', { class: 'ts-cir-game-name' }, selected.id),
      (model?.info.task ?? selected.task) && h('span', { class: 'ts-badge' }, model?.info.task ?? selected.task)));
    if (loading) { outSlot.replaceChildren(card(null, h('span', { class: 'ts-skeleton', attrs: { style: 'width: 45%' } }), h('span', { class: 'ts-skeleton ts-skeleton--block' }))); return; }
    if (modelError) { outSlot.replaceChildren(card(null, unreachable(modelError, () => pick(selected)))); return; }
    if (!model.quants.length) { outSlot.replaceChildren(card(null, empty({ title: 'No size information for this model' })), ggufCard()); return; }

    const rows = estimates();
    if (!rows.some(r => r.tag === quantTag)) quantTag = defaultQuant(rows);
    const quantSelect = selectField('Quant', model.quants.map(q => [q.tag, `${q.tag} · ${bytes(q.size)}`]), quantTag, v => { quantTag = v; paintVerdict(); });
    ctxCombo.setOptions(CONTEXTS.filter(n => n <= cap()).map(ctxLabel));
    ctxCombo.setValue(ctxLabel(contextLen()));
    controlsSlot.replaceChildren(h('div', { class: 'ts-cir-controls' },
      control('Quant', quantSelect),
      model.mmproj.length > 0 && control('Image projector', selectField('Image projector',
        [['', 'None'], ...model.mmproj.map(m => [m.path, `${fileLabel(m.path)} · ${bytes(m.size)}`])], mmprojPath, v => { mmprojPath = v; paintVerdict(); })),
      control('Context', ctxCombo.el)));
    ui.quantSelect = quantSelect.firstChild;
    paintVerdict();
  }

  // Verdict, all quants and footnote; runs on every control change without refetching.
  function paintVerdict() {
    if (!model?.quants.length || loading || modelError) return;
    const rows = estimates();
    const r = rows.find(q => q.tag === quantTag);
    ui.quantSelect.value = quantTag;
    const headline = r.where === 'vram' ? 'Fits in VRAM' : r.where === 'split' ? `Runs split: ${Math.round(r.gpuShare * 100)}% on GPU`
      : r.where === 'ram' ? 'Runs from system RAM' : "Won't fit";
    const speed = r.tps ? ` · ${tpsText(r.tps)}` : r.where !== 'none' ? ' · speed unknown for this GPU' : '';

    const parts = [['Weights', r.size, 'var(--cat-1)'], ['Image projector', r.mm, 'var(--cat-2)'], ['Context', r.kv.bytes, 'var(--cat-3)'],
      ['Overhead', r.need - r.size - r.mm - r.kv.bytes, 'var(--cat-4)']].filter(p => p[1] > 0);
    const scale = Math.max(r.need, usableVram);
    const bar = h('div', { class: 'ts-cir-bar' },
      h('div', { class: 'ts-stackbar', attrs: { role: 'img', 'aria-label': `Needs ${bytes(r.need)}${usableVram ? ` of ${bytes(usableVram)} usable VRAM` : ''}` } },
        parts.map(([, size, color]) => h('span', { class: 'ts-stackbar-seg', attrs: { style: `--seg: ${color}; flex-grow: ${size}` } })),
        scale > r.need && h('span', { class: 'ts-stackbar-seg', attrs: { style: `flex-grow: ${scale - r.need}` } })),
      usableVram > 0 && h('span', { class: 'ts-cir-vram', attrs: { style: `inset-inline-start: ${(usableVram / scale * 100).toFixed(2)}%` } }));
    const legend = h('div', { class: 'ts-chart-legend' },
      parts.map(([label, size, color]) => h('span', { class: 'ts-chip' }, h('span', { class: 'ts-chip-dot', attrs: { style: `--dot: ${color}` } }), label, ' ', h('strong', null, bytes(size)))),
      usableVram > 0 && h('span', { class: 'ts-chip' }, h('span', { class: 'ts-chip-dot ts-cir-vram-dot' }), 'Usable VRAM ', h('strong', null, bytes(usableVram))));
    const verdict = card(null,
      h('p', { class: 'ts-cir-verdict-line', dataset: { verdict: r.where } }, headline, h('span', { class: 'ts-cir-muted' }, speed)),
      bar, legend);

    const all = card('All quants', h('ul', { class: 'ts-list' }, rows.map(q => h('li', null, h('button', {
      class: 'ts-row ts-cir-quant', attrs: { type: 'button', 'aria-current': q.tag === quantTag ? 'true' : null },
      onclick: () => { quantTag = q.tag; paintVerdict(); },
    },
    h('span', { class: 'ts-row-content' }, h('span', { class: 'ts-row-title' }, q.tag), h('span', { class: 'ts-row-subtitle' }, `${bytes(q.size)} · ${whereText(q)}`)),
    h('span', { class: 'ts-row-trailing' }, q.tps ? tpsText(q.tps) : '—'))))));

    outSlot.replaceChildren(verdict, all, ggufCard(),
      h('p', { class: 'ts-cir-note' }, FOOTNOTE, r.kv.heuristic ? ' Context size estimated.' : ''));
  }

  // Safetensors-only repos: the GGUF repos quantized from it, each loadable here.
  function ggufCard() {
    if (!model?.gguf.length) return '';   // replaceChildren would print null
    return card('GGUF versions', h('ul', { class: 'ts-list' }, model.gguf.map(g => h('li', null, h('button', { class: 'ts-row', attrs: { type: 'button' }, onclick: () => pick({ id: g.id }) },
      h('span', { class: 'ts-row-content' }, h('span', { class: 'ts-row-title' }, g.id), h('span', { class: 'ts-row-subtitle' }, `↓ ${count.format(g.downloads ?? 0)}`)))))));
  }

  el.replaceChildren(
    searchField({ placeholder: 'Search Hugging Face models…', value: term, onSearch: t => runSearch(t) }),
    resultsSlot, headSlot, controlsSlot, outSlot);
  ui = { paintResults, paintModel, quantSelect: null };
  paintResults();
  paintModel();
}

export function leave() { ui = null; }

function unreachable(error, retry) {
  const net = error === 'offline' || error === 'timeout';
  return empty({ glyph: 'warning', title: "Can't reach Hugging Face", text: net ? 'Check your connection and try again.' : `Hugging Face replied ${error}. Try again in a moment.`,
    action: { label: 'Retry', onClick: retry } });
}

async function runSearch(t) {
  term = t; selected = null; model = null; modelError = null; searchError = null;
  if (!t) { results = null; searching = false; ui?.paintResults(); ui?.paintModel(); return; }
  searching = true; ui?.paintResults(); ui?.paintModel();
  const r = await searchHf(web, t);
  if (r === undefined) return;   // a newer search is in flight
  searching = false;
  results = r.ok ? r.data ?? [] : [];
  searchError = r.ok ? null : r.error;
  ui?.paintResults();
}

async function pick(m) {
  selected = m; model = null; modelError = null; quantTag = null; loading = true;
  ui?.paintResults(); ui?.paintModel();
  const r = await fetchModel(web, m.id);
  if (r === undefined || selected !== m) return;
  loading = false;
  if (r.ok) { model = r.data; mmprojPath = model.mmproj[0]?.path ?? ''; } else modelError = r.error;
  ui?.paintModel();
}

// Info and file list, then the config (the base model's when the repo has none or it fails, e.g. gated),
// plus the GGUF repos when the files carry no quant sizes.
async function loadModel(web, id) {
  const [info, files] = await Promise.all([web('modelInfo', { id }), web('modelFiles', { id })]);
  if (!info.ok) return info;
  if (!files.ok) return files;
  const groups = groupFiles(files.data ?? []);
  let quants = groups.quants.filter(q => q.size > 0);
  const synth = !quants.length;
  if (synth) quants = synthQuants(info.data.params, files.data.filter(f => /\.safetensors$/i.test(f.path)).reduce((t, f) => t + (f.size || 0), 0));
  const configOf = async repo => { const c = await web('modelConfig', { id: repo }); return c.ok ? readConfig(c.data) : null; };
  const [cfg, gguf] = await Promise.all([
    configOf(id).then(c => c ?? (info.data.baseModel ? configOf(info.data.baseModel) : null)),
    synth ? web('modelGguf', { id }).then(g => (g.ok ? g.data ?? [] : [])) : [],
  ]);
  return { ok: true, data: { info: info.data, cfg, quants, mmproj: groups.mmproj, gguf } };
}
