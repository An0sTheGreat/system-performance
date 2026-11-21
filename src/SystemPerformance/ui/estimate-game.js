// Can I Run It? game side: resolution and aspect parsing, requirement parsing, and the FPS estimate. Pure, runs in node.
import { gpusIn, cpusIn } from './data/hardware.js';

// FPS model constants (see the design spec, "FPS model"). Tune these against measured results.
const REC_FPS = 60, MIN_TO_REC = 2.2, PRESETS = { Low: 1.8, Medium: 1.35, High: 1, Ultra: 0.75 }, RES_EXP = 0.75,
  CPU_HEADROOM = 1.5, BAND = 0.2, FPS_CAP = 300, UPSCALE = 0.67;

export const ASPECTS = ['16:9', '16:10', '21:9', '32:9', '4:3'];
export const RESOLUTIONS = {
  '16:9': [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]],
  '16:10': [[1920, 1200], [2560, 1600]],
  '21:9': [[2560, 1080], [3440, 1440], [5120, 2160]],
  '32:9': [[3840, 1080], [5120, 1440]],
  '4:3': [[1024, 768], [1600, 1200]],
};

const SHORTHAND = { '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '2160p': [3840, 2160], '4k': [3840, 2160], '5k': [5120, 2880] };
const inRange = n => n >= 320 && n <= 15360;
export function parseResolution(text) {
  const t = String(text ?? '').trim().toLowerCase();
  const m = t.match(/^(\d+)\s*[x×*]\s*(\d+)/);
  const [w, h] = m ? [+m[1], +m[2]] : SHORTHAND[t] ?? [];
  return inRange(w) && inRange(h) ? { w, h } : null;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
export function aspectOf(w, h) {
  const near = ASPECTS.map(a => { const [x, y] = a.split(':'); return { a, d: Math.abs(w / h / (x / y) - 1) }; })
    .sort((p, q) => p.d - q.d)[0];
  if (near.d <= 0.03) return near.a;
  const k = gcd(w, h);
  return `${w / k}:${h / k}`;
}
export function parseAspect(text) {
  const m = String(text ?? '').trim().match(/^(\d+)\s*[:/]\s*(\d+)$/);
  return m && +m[1] && +m[2] ? aspectOf(+m[1], +m[2]) : null;
}

// Requirement labels. A value runs to the next label of any kind (including ones not extracted) or the end of the line.
const KIND = {
  processor: 'cpu', cpu: 'cpu', memory: 'ram', ram: 'ram',
  'graphics card': 'gpu', 'video card': 'gpu', graphics: 'gpu', video: 'gpu', gpu: 'gpu',
  'video memory': 'vram', vram: 'vram',
  os: null, storage: null, 'hard drive': null, 'hard disk space': null, directx: null, network: null,
  'sound card': null, 'additional notes': null, 'vr support': null,
};
const LABEL_RE = new RegExp(`(?<![a-z])(${Object.keys(KIND).sort((a, b) => b.length - a.length).join('|')})\\s*\\*?\\s*:`, 'gi');

// Smallest size in the text, in GB (GiB): "8 GB RAM" -> 8, "GTX 1060 6GB / RX 580 8GB" -> 6, "512 MB" -> 0.5.
function gb(text) {
  const v = [...String(text ?? '').matchAll(/(\d+(?:\.\d+)?)\s*([gm])i?b\b/gi)].map(m => (m[2].toLowerCase() === 'm' ? m[1] / 1024 : +m[1]));
  return v.length ? Math.min(...v) : null;
}
const spec = (gpuText, cpuText, ramGb, vramGb) =>
  ({ gpus: gpusIn(gpuText ?? ''), cpus: cpusIn(cpuText ?? ''), ramGb, vramGb: vramGb ?? gb(gpuText), gpuText, cpuText });

export function parseRequirements(html) {
  const text = String(html ?? '').replace(/<br\s*\/?>|<\/?li\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&[a-z0-9#]+;/gi, ' ');
  const found = { cpu: [], ram: [], gpu: [], vram: [] };
  for (const line of text.split('\n').map(l => l.replace(/\s+/g, ' '))) {
    const ms = [...line.matchAll(LABEL_RE)];
    ms.forEach((m, i) => {
      const kind = KIND[m[1].toLowerCase()];
      if (kind) found[kind].push(line.slice(m.index + m[0].length, ms[i + 1]?.index).trim());
    });
  }
  const join = a => a.filter(Boolean).join(' / ') || null;
  return spec(join(found.gpu), join(found.cpu), gb(join(found.ram)), gb(join(found.vram)));
}

// Built-in games store text: { gpu, cpu, ramGb, vramGb }.
export const specFromText = entry => entry && spec(entry.gpu ?? null, entry.cpu ?? null, entry.ramGb ?? null, entry.vramGb ?? null);

const mean = parts => (parts?.length ? parts.reduce((s, p) => s + p.score, 0) / parts.length : null);
// Score the game needs at the 60 FPS anchor: recommended parts, else minimum parts × MIN_TO_REC.
const anchor = (min, rec, k) => mean(rec?.[k]) ?? (mean(min?.[k]) == null ? null : mean(min[k]) * MIN_TO_REC);
const check = (have, need) => (have == null || need == null ? 'unknown' : have >= need ? 'pass' : 'fail');

export function estimateGame({ min, rec, pc, res, target }) {
  const vramNeed = rec?.vramGb ?? min?.vramGb ?? null;
  const checks = {
    gpu: check(pc.gpu?.score, mean(rec?.gpus) ?? mean(min?.gpus)),
    cpu: check(pc.cpu?.score, mean(rec?.cpus) ?? mean(min?.cpus)),
    ram: check(pc.ramGb, rec?.ramGb ?? min?.ramGb ?? null),
    vram: check(pc.vramGb, vramNeed),
  };
  const below = (min?.ramGb != null && pc.ramGb < min.ramGb) || (pc.gpu && mean(min?.gpus) != null && pc.gpu.score < mean(min.gpus));

  const recGpu = anchor(min, rec, 'gpus'), recCpu = anchor(min, rec, 'cpus');
  // No GPU on either side means no estimate: an unmatched requirement line is as unknown as an unmatched PC GPU.
  if (!pc.gpu || recGpu == null) return { verdict: below ? 'below' : 'unknown', checks, presets: null, suggested: null, upscaled: null };

  const high = REC_FPS * pc.gpu.score / recGpu * (1920 * 1080 / (res.w * res.h)) ** RES_EXP;
  const cap = pc.cpu && recCpu ? REC_FPS * pc.cpu.score / recCpu * CPU_HEADROOM : Infinity;
  const fpsOf = gpuFps => Math.min(gpuFps, cap, FPS_CAP);
  const presets = Object.entries(PRESETS).map(([name, f]) => {
    const fps = fpsOf(high * f);
    return { name, fps, lo: fps * (1 - BAND), hi: fps * (1 + BAND), capped: Math.min(high * f, cap) > FPS_CAP,
      vramLimited: (name === 'High' || name === 'Ultra') && vramNeed != null && pc.vramGb < vramNeed };
  });
  const usable = presets.filter(p => !p.vramLimited);
  const suggested = usable.filter(p => p.lo >= target).at(-1)?.name ?? null;
  // Upscaling renders at UPSCALE × the resolution; it can't lift a CPU limit, so no line when it gains nothing.
  const up = fpsOf(high * (1 / UPSCALE ** 2) ** RES_EXP), highFps = presets.find(p => p.name === 'High').fps;
  const upscaled = !suggested && up > highFps ? { tech: pc.gpu.up, fps: up } : null;
  // VRAM-limited presets don't count toward "great": High/Ultra are capped by VRAM, as in the spec.
  const reaches = names => usable.some(p => names.includes(p.name) && p.fps >= target);
  const verdict = below ? 'below' : reaches(['High', 'Ultra']) ? 'great' : reaches(['Low', 'Medium']) ? 'well' : 'playable';
  return { verdict, checks, presets, suggested, upscaled };
}
