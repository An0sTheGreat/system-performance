// GPU tab: utilization and VRAM over time, every engine (3D, compute, copy, video) with its own chart,
// temperature and power, VRAM per program (what's holding your model in memory), sensors and driver.
// One GPU at a time; a picker appears when there are several.

import { h } from '../dom.js';
import { icon as glyph, liveChart } from '../kit.js';
import { pct, bytes, niceMax } from '../metrics.js';
import { statRow, chartCard, draw, specCard, topCard, sensorCard, picker, note, text, fill } from './detail.js';

export const id = 'gpu';
export const title = 'GPU';
export const tile = 'var(--cat-5)';
export const icon = () => glyph('gpu');
export const needsInventory = true;
export const available = ctx => !!ctx.info.gpuName;

const COLOR = 'var(--cat-5)';
const ENGINE_ORDER = ['3D', 'Compute', 'Cuda', 'Copy', 'VideoDecode', 'VideoEncode'];
const engineName = k => k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
let selected = null;
let ui = null;

function gpuList(ctx) {
  const inv = ctx.inventory?.gpus;
  if (inv?.length) return inv;
  return (ctx.sample?.gpus ?? []).map((g, i) => ({ luid: g.luid, name: i === 0 ? ctx.info.gpuName : `GPU ${i + 1}`, primary: i === 0, dedicated: i === 0 ? ctx.info.gpuDedicated : null }));
}

export function render(el, ctx) {
  const { animate } = ctx;
  ctx.actions.watchProcesses(true);
  ctx.actions.watchSensors(true);
  const list = gpuList(ctx);
  if (!list.some(g => g.luid === selected)) selected = list[0]?.luid ?? null;
  const g = list.find(x => x.luid === selected) ?? { name: ctx.info.gpuName, primary: true, dedicated: ctx.info.gpuDedicated };

  const sr = statRow([{ key: 'util', label: 'Utilization' }, { key: 'vram', label: 'Dedicated memory' }, { key: 'temp', label: 'Temperature' }, { key: 'power', label: 'Board power' }], animate);
  const main = chartCard('Utilization', [COLOR], 'GPU utilization, last 60 seconds', { size: 'tall', animate });
  const vram = chartCard('Dedicated memory', ['var(--cat-3)'], 'Dedicated GPU memory, last 60 seconds', { size: 'tall', animate });
  const engines = h('div', { class: 'ts-engines', attrs: { style: `--series: ${COLOR}` } });
  const temp = chartCard('Temperature', ['var(--cat-4)'], 'GPU temperature, last 60 seconds', { animate });
  const power = chartCard('Board power', ['var(--cat-6)'], 'GPU power, last 60 seconds', { animate });
  const byVram = topCard('vram', ctx, 'VRAM by app', animate);
  const byGpu = topCard('gpu', ctx, 'Top apps by GPU', animate);
  const sens = sensorCard('GPU sensors', note('No readable sensors for this GPU.'), animate);
  const specs = specCard('Specifications', [
    ['Name', g.name], ['Vendor', g.vendor], ['Dedicated memory', g.dedicated ? bytes(g.dedicated) : null], ['Shared memory', g.shared ? bytes(g.shared) : null],
    ['Driver version', g.driver], ['Driver date', g.driverDate], ['Display', g.primary ? g.display : null],
  ], animate);

  fill(el,
    list.length > 1 ? picker('GPU', list.map((x, i) => ({ value: x.luid, label: `${x.name}${list.filter(y => y.name === x.name).length > 1 ? ` (${i + 1})` : ''}` })), selected,
      v => { selected = v; ctx.actions.navigate(id); }) : null,
    sr.el,
    h('div', { class: 'ts-grid ts-grid--halves' }, main.card, vram.card),
    h('article', { class: 'ts-card' }, h('div', { class: 'ts-card-header' }, h('h3', { class: 'ts-card-title' }, 'Engines')), engines,
      h('p', { class: 'ts-list-footer' }, 'Games load 3D; AI and CUDA work shows as Compute or Cuda; streaming and recording use Video Encode.')),
    g.primary ? h('div', { class: 'ts-grid ts-grid--halves' }, temp.card, power.card) : null,
    h('div', { class: 'ts-grid ts-grid--halves' }, byVram.card, byGpu.card),
    h('div', { class: 'ts-grid ts-grid--halves' }, sens.card, specs));
  ui = { el, sr, main, vram, engines, engineKeys: '', temp, power, byVram, byGpu, sens, g };
  if (ctx.sample) update(el, ctx);
}

export function leave(ctx) { ctx.actions.watchProcesses(false); ctx.actions.watchSensors(false); ui = null; }

export function update(el, ctx) {
  if (!ui || ui.el !== el || !ctx.sample) return;
  const s = (ctx.sample.gpus ?? []).find(x => x.luid === selected) ?? ctx.sample.gpu;
  if (!s) return;
  const sn = ui.g.primary ? ctx.sample.sensors ?? {} : {};
  const total = ui.g.dedicated || 0;
  ui.sr.value.util.set(pct(s.util));
  ui.sr.meta.util.set(`Peak ${pct(ctx.series(`gpu:${s.luid}`).max())} in the last minute`);
  ui.sr.value.vram.set(bytes(s.dedicatedUsed));
  ui.sr.meta.vram.set(total ? `of ${bytes(total)} · ${pct(s.dedicatedUsed / total * 100)}` : '');
  ui.sr.value.temp.set(sn.gpuTemp != null ? `${Math.round(sn.gpuTemp)} °C` : '—');
  ui.sr.meta.temp.set(sn.gpuHotSpot != null ? `Hot spot ${Math.round(sn.gpuHotSpot)} °C` : sn.gpuFanRpm != null ? `Fan ${Math.round(sn.gpuFanRpm).toLocaleString()} RPM` : '');
  ui.sr.value.power.set(sn.gpuPower != null ? `${sn.gpuPower.toFixed(1)} W` : '—');
  ui.sr.meta.power.set([sn.gpuClock != null && `Core ${Math.round(sn.gpuClock).toLocaleString()} MHz`, sn.gpuMemoryClock != null && `Memory ${Math.round(sn.gpuMemoryClock).toLocaleString()} MHz`].filter(Boolean).join(' · '));

  draw(ui.main.chart, ctx, [`gpu:${s.luid}`], 100);
  ui.main.meta.set('Busiest engine, last 60 seconds');
  draw(ui.vram.chart, ctx, [`gpumem:${s.luid}`], total || (peak => niceMax(peak, 1)));
  ui.vram.meta.set(total ? `${bytes(s.dedicatedUsed)} of ${bytes(total)}` : bytes(s.dedicatedUsed));
  if (ui.g.primary) {
    draw(ui.temp.chart, ctx, ['gpuTemp'], peak => niceMax(peak, 50));
    ui.temp.meta.set(sn.gpuTemp != null ? `${sn.gpuTemp.toFixed(1)} °C` : '—');
    draw(ui.power.chart, ctx, ['gpuPower'], peak => niceMax(peak, 50));
    ui.power.meta.set(sn.gpuPower != null ? `${sn.gpuPower.toFixed(1)} W` : '—');
  }

  const keys = Object.keys(s.engines).sort((a, b) => (ENGINE_ORDER.indexOf(a) + 1 || 99) - (ENGINE_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
  if (keys.join() !== ui.engineKeys) {
    ui.engineKeys = keys.join();
    ui.engineNodes = keys.map(k => {
      const v = text(), chart = liveChart([COLOR], `${engineName(k)} load, last 60 seconds`);
      chart.classList.add('ts-live--mini');
      return { k, v, chart, el: h('div', { class: 'ts-engine' }, h('div', { class: 'ts-engine-head' }, h('span', null, engineName(k)), h('strong', null, v)), chart) };
    });
    ui.engines.replaceChildren(...ui.engineNodes.map(n => n.el));
  }
  for (const n of ui.engineNodes) {
    n.v.set(pct(s.engines[n.k] ?? 0));
    draw(n.chart, ctx, [`gpu:${s.luid}/${n.k}`], 100);
  }
  ui.byVram.update(ctx.procs);
  ui.byGpu.update(ctx.procs);
  ui.sens.update(ctx.sensorList, hw => hw.type.startsWith('Gpu') && (hw.name === ui.g.name || ui.g.name?.includes(hw.name)));
}
