// Can I Run It? pieces both modes share: stale-reply guard, this PC's specs, and the debounced search field.
import { h } from '../dom.js';
import { icon } from '../kit.js';
import { pickGpu, matchCpu } from '../data/hardware.js';
import { ramBandwidth } from '../estimate-ai.js';

const GiB = 2 ** 30;

// Only the latest call's result resolves; a reply that lands after a newer call resolves to undefined.
export function latestOnly(fn) {
  let seq = 0;
  return async (...args) => {
    const mine = ++seq;
    const result = await fn(...args);
    return mine === seq ? result : undefined;
  };
}

// Pc for the game estimate, AiPc for the model estimate. Sizes round to whole GB: Windows reports 31.9 GiB for 32 GB.
export function pcFromInventory(inventory, info) {
  const { gpu, name, vramBytes } = pickGpu(inventory?.gpus);
  const ramBytes = info?.memTotal ?? 0;
  return {
    pc: { gpu, cpu: matchCpu(inventory?.cpu?.name ?? ''), ramGb: Math.round(ramBytes / GiB), vramGb: Math.round(vramBytes / GiB) },
    ai: { igpu: gpu?.igpu ?? false, vramBytes, ramBytes, gpuBw: gpu?.bw ?? null, ramBw: ramBandwidth(inventory?.memory?.modules ?? []) },
    gpuName: name,
  };
}

// Search box: onSearch(term) 300 ms after typing stops; under 2 characters it reports '' (nothing to search).
export function searchField({ placeholder, value = '', onSearch }) {
  let timer = 0;
  const input = h('input', {
    class: 'ts-field-input', attrs: { type: 'search', placeholder, 'aria-label': placeholder, autocomplete: 'off', spellcheck: 'false', value },
    oninput: () => {
      clearTimeout(timer);
      timer = setTimeout(() => { const t = input.value.trim(); onSearch(t.length >= 2 ? t : ''); }, 300);
    },
  });
  return h('label', { class: 'ts-field ts-field--search' }, icon('search', 'ts-field-icon'), input);
}
