import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResolution, aspectOf, parseAspect, parseRequirements, estimateGame, specFromText } from '../src/SystemPerformance/ui/estimate-game.js';
import { GAMES } from '../src/SystemPerformance/ui/data/games.js';

const g = (score, vram = 8) => ({ name: 'G', score, vram, bw: 400, up: 'FSR', igpu: false });
const c = score => ({ name: 'C', score, cores: 8 });

test('resolution parsing and shorthand', () => {
  assert.deepEqual(parseResolution('2560 × 1440'), { w: 2560, h: 1440 });
  assert.deepEqual(parseResolution('3440 x 1440 @ 144Hz'), { w: 3440, h: 1440 });
  assert.deepEqual(parseResolution('1440p'), { w: 2560, h: 1440 });
  assert.deepEqual(parseResolution('4K'), { w: 3840, h: 2160 });
  assert.equal(parseResolution('banana'), null);
  assert.equal(parseResolution('10x10'), null);
  assert.equal(aspectOf(3440, 1440), '21:9'); assert.equal(aspectOf(1366, 768), '16:9'); assert.equal(aspectOf(1920, 1200), '16:10');
  assert.equal(parseAspect('21/9'), '21:9');
});
test('steam requirement html parses', () => {
  const html = '<strong>Minimum:</strong><br><ul class="bb_ul"><li><strong>OS:</strong> Windows 10<br></li><li><strong>Processor:</strong> Intel Core i5-4460 or AMD FX-6300<br></li><li><strong>Memory:</strong> 8 GB RAM<br></li><li><strong>Graphics:</strong> NVIDIA GeForce GTX 960 2GB or AMD Radeon R7 370 2GB<br></li></ul>';
  const s = parseRequirements(html);
  assert.equal(s.ramGb, 8); assert.equal(s.vramGb, 2);
  assert.deepEqual(s.gpus.map(g => g.name), ['GTX 960', 'R7 370']);
  assert.deepEqual(s.cpus.map(c => c.name), ['Core i5-4460', 'FX-6300']);
});
test('plain-text requirements and other labels parse', () => {
  const s = parseRequirements('Minimum: OS: Windows 10 CPU: Intel Core i7-8700 Memory: 16 GB RAM Video Card: GeForce RTX 2070 (8 GB VRAM) Storage: 70 GB');
  assert.equal(s.ramGb, 16); assert.equal(s.vramGb, 8); assert.deepEqual(s.gpus.map(g => g.name), ['RTX 2070']);
  assert.equal(parseRequirements('Graphics Card: GTX 1060').gpus[0].name, 'GTX 1060');
  assert.equal(parseRequirements('<li>Memory: 8 GB RAM</li>').gpus.length, 0);
});
test('recommended gpu at 1080p High is the 60 fps anchor', () => {
  const rec = { gpus: [g(40)], cpus: [c(50)], ramGb: 16, vramGb: 8 };
  const r = estimateGame({ min: null, rec, pc: { gpu: g(40), cpu: c(100), ramGb: 32, vramGb: 8 }, res: { w: 1920, h: 1080 }, target: 60 });
  assert.ok(Math.abs(r.presets.find(p => p.name === 'High').fps - 60) < 0.5);
});
test('higher resolution and preset lower fps; 1440p follows the exponent', () => {
  const base = { min: null, rec: { gpus: [g(40)], cpus: [], ramGb: 8, vramGb: null }, pc: { gpu: g(40), cpu: null, ramGb: 16, vramGb: 8 }, target: 60 };
  const at = res => estimateGame({ ...base, res }).presets;
  const p1080 = at({ w: 1920, h: 1080 }), p1440 = at({ w: 2560, h: 1440 }), p2160 = at({ w: 3840, h: 2160 });
  p1080.forEach((p, i) => { assert.ok(p.fps > p1440[i].fps && p1440[i].fps > p2160[i].fps); if (i) assert.ok(p1080[i - 1].fps > p.fps); });
  assert.ok(Math.abs(p1440.find(p => p.name === 'High').fps - 60 * (2073600 / 3686400) ** 0.75) < 0.5);
});
test('minimum-only games scale from min × 2.2', () => {
  const r = estimateGame({ min: { gpus: [g(20)], cpus: [], ramGb: 8, vramGb: null }, rec: null, pc: { gpu: g(44), cpu: null, ramGb: 16, vramGb: 8 }, res: { w: 1920, h: 1080 }, target: 60 });
  assert.ok(Math.abs(r.presets.find(p => p.name === 'High').fps - 60) < 0.5);
});
test('cap, cpu limit, vram limit, verdicts, upscaler', () => {
  const pc = (gs, cs = 100, ram = 32, vram = 24) => ({ gpu: g(gs, vram), cpu: c(cs), ramGb: ram, vramGb: vram });
  const rec = { gpus: [g(10)], cpus: [c(50)], ramGb: 8, vramGb: 4 };
  const r1 = estimateGame({ min: null, rec: { ...rec, cpus: [] }, pc: pc(100), res: { w: 1920, h: 1080 }, target: 60 });
  assert.ok(r1.presets.every(p => p.fps <= 300)); assert.ok(r1.presets[0].capped); assert.equal(r1.verdict, 'great');
  const r2 = estimateGame({ min: null, rec, pc: pc(100, 25), res: { w: 1920, h: 1080 }, target: 60 });
  assert.ok(r2.presets.every(p => p.fps <= 60 * 0.5 * 1.5 + 0.01));
  const r3 = estimateGame({ min: null, rec: { ...rec, vramGb: 12 }, pc: pc(100, 100, 32, 8), res: { w: 1920, h: 1080 }, target: 60 });
  assert.ok(r3.presets.find(p => p.name === 'Ultra').vramLimited); assert.notEqual(r3.suggested, 'Ultra'); assert.equal(r3.checks.vram, 'fail');
  const below = estimateGame({ min: { gpus: [g(10)], cpus: [], ramGb: 16, vramGb: null }, rec, pc: pc(50, 100, 8), res: { w: 1920, h: 1080 }, target: 60 });
  assert.equal(below.verdict, 'below');
  const slow = estimateGame({ min: null, rec: { gpus: [g(40)], cpus: [], ramGb: 8, vramGb: null }, pc: pc(20), res: { w: 3840, h: 2160 }, target: 60 });
  assert.equal(slow.suggested, null); assert.ok(slow.upscaled.fps > slow.presets.find(p => p.name === 'High').fps); assert.equal(slow.verdict, 'playable');
  const unknown = estimateGame({ min: null, rec, pc: { gpu: null, cpu: null, ramGb: 32, vramGb: 8 }, res: { w: 1920, h: 1080 }, target: 60 });
  assert.equal(unknown.presets, null); assert.equal(unknown.verdict, 'unknown');
});
test('built-in games have parseable specs', () => {
  for (const game of GAMES) { const s = specFromText(game.rec ?? game.min); assert.ok(s.gpus.length > 0, game.name); assert.ok(s.ramGb > 0, game.name); }
});

test('minimum checks use the weakest listed part, not the mean', () => {
  const spec = { gpus: [g(20), g(30)], cpus: [c(20), c(30)], ramGb: 8, vramGb: null };
  const r = estimateGame({ min: spec, rec: spec, pc: { gpu: g(20), cpu: c(20), ramGb: 16, vramGb: 8 }, res: { w: 1920, h: 1080 }, target: 60 });
  assert.notEqual(r.verdict, 'below');
  assert.equal(r.checks.gpu, 'pass');
  assert.equal(r.checks.cpu, 'pass');
  const weak = estimateGame({ min: spec, rec: spec, pc: { gpu: g(19), cpu: c(19), ramGb: 16, vramGb: 8 }, res: { w: 1920, h: 1080 }, target: 60 });
  assert.equal(weak.verdict, 'below');
  assert.equal(weak.checks.gpu, 'fail');
});

const R1080 = { w: 1920, h: 1080 };
test('verdict and suggested preset use the same rule', () => {
  const rec = { gpus: [g(40)], cpus: [], ramGb: 8, vramGb: null };
  for (const k of [0.3, 0.5, 0.8, 1, 1.05, 1.1, 1.3, 1.6, 2, 3]) {
    const r = estimateGame({ min: null, rec, pc: { gpu: g(40 * k), cpu: null, ramGb: 16, vramGb: 8 }, res: R1080, target: 60 });
    if (r.verdict === 'well' || r.verdict === 'great') assert.notEqual(r.suggested, null, `k=${k}`);
    if (r.verdict === 'great') assert.ok(['High', 'Ultra'].includes(r.suggested), `k=${k}`);
    if (r.verdict === 'well') assert.ok(['Low', 'Medium'].includes(r.suggested), `k=${k}`);
  }
  const r = estimateGame({ min: null, rec, pc: { gpu: g(42), cpu: null, ramGb: 16, vramGb: 8 }, res: R1080, target: 60 });
  assert.equal(r.verdict, 'well'); assert.equal(r.suggested, 'Medium');   // High's midpoint reaches 60, its low end does not
});
test('VRAM-limited presets do not count toward great', () => {
  const r = estimateGame({ min: null, rec: { gpus: [g(10)], cpus: [], ramGb: 8, vramGb: 12 }, pc: { gpu: g(100, 8), cpu: null, ramGb: 32, vramGb: 8 }, res: R1080, target: 60 });
  assert.ok(r.presets.filter(p => p.name === 'High' || p.name === 'Ultra').every(p => p.vramLimited && p.lo >= 60));
  assert.equal(r.verdict, 'well'); assert.equal(r.suggested, 'Medium');
});
test('upscaler estimate respects the CPU cap and is null when it gains nothing', () => {
  const rec = { gpus: [g(40)], cpus: [c(50)], ramGb: 8, vramGb: null }, pc = cs => ({ gpu: g(20), cpu: c(cs), ramGb: 16, vramGb: 8 }), res = { w: 3840, h: 2160 };
  const free = estimateGame({ min: null, rec, pc: pc(100), res, target: 60 });
  assert.ok(free.upscaled.fps > free.presets.find(p => p.name === 'High').fps);
  const capped = estimateGame({ min: null, rec, pc: pc(10), res, target: 60 });   // CPU cap 60 × 10/50 × 1.5 = 18
  assert.ok(capped.upscaled.fps <= 18.001 && capped.upscaled.fps > capped.presets.find(p => p.name === 'High').fps);
  const stuck = estimateGame({ min: null, rec, pc: { gpu: g(40), cpu: c(10), ramGb: 16, vramGb: 8 }, res: R1080, target: 60 });
  assert.equal(stuck.suggested, null); assert.equal(stuck.upscaled, null);
});
test('no matched requirement GPU gives no presets and an unknown verdict', () => {
  const r = estimateGame({ min: null, rec: { gpus: [], cpus: [c(50)], ramGb: 8, vramGb: null }, pc: { gpu: g(40), cpu: c(50), ramGb: 16, vramGb: 8 }, res: R1080, target: 60 });
  assert.equal(r.presets, null); assert.equal(r.suggested, null); assert.equal(r.upscaled, null); assert.equal(r.verdict, 'unknown');
});
