import { h } from '../dom.js';
import { icon as glyph, row, list, segmented, switchInput } from '../kit.js';
import { RATES, bytes } from '../metrics.js';

export const id = 'settings';
export const title = 'Settings';
export const tile = 'var(--color-label-2)';
export const icon = () => glyph('settings');

const control = (title, el) => h('li', null, h('div', { class: 'ts-row' },
  h('span', { class: 'ts-row-content' }, h('span', { class: 'ts-row-title' }, title)),
  h('span', { class: 'ts-row-trailing' }, el)));

export function render(el, ctx) {
  const { settings, actions, info } = ctx;
  const section = (...parts) => h('section', { class: ctx.animate ? 'ts-enter' : null }, ...parts);
  el.replaceChildren(
    section(...list('Appearance', [control('Theme', segmented({
      name: 'theme', label: 'Theme', value: settings.theme,
      options: [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
      onChange: v => actions.setSetting('theme', v),
    }))])),
    section(...list('Updates', [control('Update every', segmented({
      name: 'rate-setting', label: 'Update interval', value: settings.rate,
      options: RATES.map(r => ({ value: r, label: `${r} ms` })),
      onChange: v => actions.setSetting('rate', v),
    }))], 'Charts always show the last 60 seconds. Faster updates use a little more CPU. Closing the window keeps the app in the tray; use Quit there to exit. With the window and overlay both hidden, sampling pauses, or drops to once a second for the tray icon.')),
    section(...list('Overlay', [
      control('Show mini overlay', switchInput({ label: 'Show mini overlay', checked: ctx.overlay.show, onChange: v => actions.setOverlay({ show: v }) })),
      control('Lock position (click-through)', switchInput({ label: 'Lock overlay position', checked: ctx.overlay.locked, onChange: v => actions.setOverlay({ locked: v }) })),
      control('Live CPU % in tray icon', switchInput({ label: 'Live CPU % in tray icon', checked: ctx.overlay.trayCpu, onChange: v => actions.setOverlay({ trayCpu: v }) })),
    ], 'An always-on-top strip with CPU, GPU, RAM and network that stays up when this window is closed. Unlock it to drag it into place; lock it so clicks go through to the game or app underneath. Also in the tray icon\'s menu. It shows over borderless and windowed games, not exclusive full-screen ones.')),
    section(...list('This PC', [
      row({ title: 'Processor', trailing: info.cpuName ?? '—' }),
      row({ title: 'Logical processors', trailing: String(info.logical ?? '—') }),
      row({ title: 'Memory', trailing: info.memTotal ? bytes(info.memTotal) : '—' }),
      row({ title: 'Graphics', trailing: info.gpuName ?? 'None found' }),
    ], 'Read from Windows performance counters, DXGI and the Native Wifi API. Nothing leaves this PC.')),
    section(...list('About', [row({ title: 'System Performance', trailing: 'Version 1.2.0' })])));
}
