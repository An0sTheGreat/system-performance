// Can I Run It? tab: a Gaming | AI toggle over the two estimate views.
import { h } from '../dom.js';
import { icon as glyph, segmented, empty } from '../kit.js';
import * as gaming from './canirun-gaming.js';

export const id = 'canirun';
export const title = 'Can I Run It?';
export const tile = 'var(--cat-5)';
export const icon = () => glyph('gauge');
export const needsInventory = true;

// Until the AI view lands (Task 7).
const ai = { render: el => el.replaceChildren(empty({ title: 'Coming next' })) };
const modes = { gaming, ai };
let shown = null;

export function render(el, ctx) {
  const body = h('div', { class: 'ts-stack' });
  const renderMode = () => {
    shown?.leave?.(ctx);
    shown = modes[ctx.settings.cirMode];
    shown.render(body, ctx);
  };
  el.replaceChildren(
    h('div', { class: 'ts-cir-toggle' }, segmented({
      name: 'cir-mode', label: 'Mode', options: [{ value: 'gaming', label: 'Gaming' }, { value: 'ai', label: 'AI' }],
      value: ctx.settings.cirMode, onChange: v => { ctx.actions.setSetting('cirMode', v); renderMode(); },
    })),
    body);
  shown = null;
  renderMode();
}

export function leave(ctx) { shown?.leave?.(ctx); shown = null; }
