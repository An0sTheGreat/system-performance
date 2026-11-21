// View kit: the small builders every screen shares (from Tokenscope's kit, trimmed to what this app uses).
// Everything here emits design-system markup only; strings become text nodes.

import { h, svg } from './dom.js';
import { linePath, areaPath } from './metrics.js';

// ---- icons: 24 px stroke glyphs ----

const ICONS = {
  dashboard: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  settings: 'M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 5v4 M9 15v4',
  cpu: 'M7 7h10v10H7z M10 10h4v4h-4z M9 3v4 M15 3v4 M9 17v4 M15 17v4 M3 9h4 M3 15h4 M17 9h4 M17 15h4',
  gpu: 'M3 7h18v10H3z M7 17v3 M11 17v3 M10 12a2 2 0 1 0-4 0a2 2 0 1 0 4 0 M14 10h4 M14 14h4',
  memory: 'M4 8h16v8H4z M8 8v8 M12 8v8 M16 8v8 M6 16v3 M18 16v3',
  disk: 'M4 6h16v12H4z M4 14h16 M16 16h1',
  wifi: 'M2.5 9a14 14 0 0 1 19 0 M5.5 12.5a9.5 9.5 0 0 1 13 0 M8.5 16a5 5 0 0 1 7 0 M12 19.5v.01',
  ethernet: 'M6 4h12v10H6z M9 14v3 M15 14v3 M5 20h14 M12 17v3',
  warning: 'M12 4l9 16H3z M12 10v4 M12 17v.5',
  empty: 'M4 19h16 M7 16v-4 M12 16V8 M17 16v-7',
  chevron: 'M9 6l6 6-6 6',
  thermo: 'M10 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z M12 11v5',
  battery: 'M3 8h15v8H3z M18 11h2v2h-2 M6 11v2',
};

export function icon(name, cls) {
  return svg('svg', {
    class: cls, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  }, svg('path', { d: ICONS[name] ?? ICONS.empty }));
}

// A Text node that is only written when its value changes (cheap to call on every sample).
export function liveText(initial = '—') {
  const node = document.createTextNode(initial);
  node.set = v => { if (node.data !== v) node.data = v; };
  return node;
}

export function empty({ glyph = 'empty', title, text, action }) {
  return h('div', { class: 'ts-empty' },
    h('div', { class: 'ts-empty-glyph' }, icon(glyph)),
    h('h3', { class: 'ts-empty-title' }, title),
    text && h('p', { class: 'ts-empty-text' }, text),
    action && h('button', { class: 'ts-button', attrs: { type: 'button' }, onclick: action.onClick }, action.label));
}

// li > div.ts-row. `trailing` may be a Text node the caller keeps and updates in place.
export function row({ tile, glyph, title, subtitle, trailing }) {
  return h('li', null, h('div', { class: 'ts-row' },
    glyph && h('span', { class: 'ts-row-leading' }, h('span', { class: 'ts-nav-icon', attrs: { style: `--tile: ${tile ?? 'var(--color-tint-fill)'}` } }, icon(glyph))),
    h('span', { class: 'ts-row-content' },
      h('span', { class: 'ts-row-title' }, title),
      subtitle != null && h('span', { class: 'ts-row-subtitle' }, subtitle)),
    trailing != null && h('span', { class: 'ts-row-trailing' }, trailing)));
}

export function list(header, rows, footer) {
  return [
    header && h('p', { class: 'ts-list-header' }, header),
    h('ul', { class: 'ts-list' }, rows),
    footer && h('p', { class: 'ts-list-footer' }, footer),
  ];
}

// Radio-backed segmented control; keeps its own --index so the thumb slides before any re-render.
export function segmented({ name, label, options, value, onChange }) {
  const index = options.findIndex(o => o.value === value);
  const el = h('div', { class: 'ts-segmented', attrs: { role: 'radiogroup', 'aria-label': label, style: `--index: ${Math.max(0, index)}` } },
    h('span', { class: 'ts-segmented-thumb' }),
    options.map((o, i) => h('label', { class: 'ts-segmented-item' },
      h('input', {
        attrs: { type: 'radio', name, value: String(o.value), checked: i === index },
        onchange: () => { el.style.setProperty('--index', String(i)); onChange(o.value); },
      }),
      h('span', null, o.label))));
  return el;
}

export function switchInput({ label, checked, onChange }) {
  return h('input', {
    class: 'ts-switch', attrs: { type: 'checkbox', role: 'switch', 'aria-label': label, checked },
    onchange: e => onChange(e.target.checked),
  });
}

export function chip({ label, pressed, onClick }) {
  return h('button', { class: 'ts-chip', attrs: { type: 'button', 'aria-pressed': String(!!pressed) }, onclick: onClick }, label);
}

// Validate typed text through the caller's parse (null = invalid).
export function comboCommit(text, parse) {
  const value = parse(text);
  return value == null ? { ok: false, value: null } : { ok: true, value };
}

let comboSeq = 0;
// Dropdown + type-in field. The toggle shows every option; typing filters by substring.
// Enter/blur commit through parse; an invalid commit sets aria-invalid and skips onChange.
export function combo({ label, value, options, parse, onChange }) {
  const id = `ts-combo-${++comboSeq}`;
  let all = options, shown = options, active = -1, open = false, last = value;
  const input = h('input', {
    class: 'ts-field-input',
    attrs: { type: 'text', role: 'combobox', autocomplete: 'off', spellcheck: 'false', 'aria-label': label,
      'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': `${id}-list`, value },
  });
  const listEl = h('ul', { class: 'ts-combo-list', attrs: { role: 'listbox', id: `${id}-list`, 'aria-label': label, hidden: true }, onmousedown: e => e.preventDefault() });
  const message = h('p', { class: 'ts-field-message' }, 'Not a valid value');
  // Keep focus in the input while the pointer works the list or toggle, so blur does not commit early.
  const keepFocus = e => e.preventDefault();

  const paint = () => {
    listEl.replaceChildren(...shown.map((text, i) => h('li', {
      class: 'ts-combo-option',
      attrs: { role: 'option', id: `${id}-o${i}`, 'aria-selected': String(i === active) },
      onmousedown: keepFocus,
      onclick: () => { input.value = text; close(); commit(); },
    }, text)));
    listEl.hidden = !open || shown.length === 0;
    input.setAttribute('aria-expanded', String(open && shown.length > 0));
    if (active >= 0) input.setAttribute('aria-activedescendant', `${id}-o${active}`); else input.removeAttribute('aria-activedescendant');
    listEl.children[active]?.scrollIntoView?.({ block: 'nearest' });
  };
  const show = list => { shown = list; active = -1; open = true; paint(); };
  const close = () => { open = false; active = -1; paint(); };
  const commit = () => {
    if (input.value === last && !input.hasAttribute('aria-invalid')) return; // Enter then blur must not fire twice
    const r = comboCommit(input.value, parse);
    if (r.ok) { input.removeAttribute('aria-invalid'); last = input.value; onChange(r.value, input.value); }
    else input.setAttribute('aria-invalid', 'true');
  };

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    show(all.filter(o => o.toLowerCase().includes(q)));
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) show(all);
      if (!shown.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + shown.length) % shown.length;
      paint();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0) input.value = shown[active];
      close(); commit();
    } else if (e.key === 'Escape' && open) { e.preventDefault(); close(); }
  });
  input.addEventListener('blur', () => { if (open) close(); commit(); });

  const toggle = h('button', {
    class: 'ts-combo-toggle', attrs: { type: 'button', tabindex: '-1', 'aria-label': 'Show options' },
    onmousedown: keepFocus,
    onclick: () => { input.focus(); if (open) close(); else show(all); },
  }, icon('chevron'));
  const field = h('div', { class: 'ts-field ts-combo' }, input, toggle, listEl);
  const el = h('div', { class: 'ts-combo-wrap' }, field, message);
  // The brief's markup puts p.ts-field-message right after the field; the wrapper keeps the pair together.
  return {
    el,
    setOptions(next) { all = next; if (open) show(all); },
    setValue(text) { input.value = last = text; input.removeAttribute('aria-invalid'); },
  };
}

// A row of controls: leading group left, trailing group right; wraps when narrow.
export function toolbar(leading, trailing) {
  return h('div', { class: 'ts-toolbar' }, h('div', { class: 'ts-toolbar-group' }, leading), trailing && h('div', { class: 'ts-toolbar-group' }, trailing));
}

// Progress bar whose fill the caller moves with set(fraction). warn: turn amber/red near full (off for
// bars where full is good or just "busy", like free memory or throughput).
export function progress(label, warn = true) {
  const el = h('div', { class: 'ts-progress', attrs: { role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100' } }, h('span', { class: 'ts-progress-fill' }));
  el.set = f => {
    f = Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0;
    el.style.setProperty('--value', f.toFixed(3));
    el.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    el.classList.toggle('ts-progress--warning', warn && f >= 0.85 && f < 0.95);
    el.classList.toggle('ts-progress--over', warn && f >= 0.95);
  };
  return el;
}

/* Live chart: a fixed 1000×100 viewBox stretched to the card (strokes stay crisp via
   vector-effect), one area+line per series. update([{values, cap}], max) redraws the paths in place,
   so a 100 ms tick touches two attributes per series and nothing else. */
export function liveChart(colors, label) {
  const series = colors.map((color, i) => {
    const area = svg('path', { class: 'ts-chart-area' });
    const line = svg('path', { class: 'ts-chart-line ts-live-line' });
    return { area, line, g: svg('g', { style: `--series: ${color}` }, i === 0 ? area : null, line) };
  });
  const el = svg('svg', { class: 'ts-chart ts-live', viewBox: '0 0 1000 100', preserveAspectRatio: 'none', role: 'img', 'aria-label': label },
    [25, 50, 75].map(y => svg('line', { class: 'ts-chart-grid ts-live-line', x1: 0, x2: 1000, y1: y, y2: y })),
    series.map(s => s.g));
  el.update = (data, max) => data.forEach((d, i) => {
    const s = series[i];
    const d1 = linePath(d.values, d.cap, max);
    s.line.setAttribute('d', d1);
    if (i === 0) s.area.setAttribute('d', areaPath(d1, d.values, d.cap));
  });
  return el;
}
