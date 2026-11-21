import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchGpu, matchCpu, gpusIn, cpusIn, pickGpu } from '../src/SystemPerformance/ui/data/hardware.js';

test('gpu names from Windows match the most specific entry', () => {
  assert.equal(matchGpu('NVIDIA GeForce RTX 4070 Laptop GPU').name, 'RTX 4070 Laptop');
  assert.equal(matchGpu('NVIDIA GeForce RTX 4070 Ti SUPER').name, 'RTX 4070 Ti Super');
  assert.equal(matchGpu('NVIDIA GeForce RTX 4070').name, 'RTX 4070');
  assert.equal(matchGpu('AMD Radeon RX 6700 XT').name, 'RX 6700 XT');
  assert.equal(matchGpu('Intel(R) Iris(R) Xe Graphics').name, 'Iris Xe');
  assert.equal(matchGpu('AMD Radeon(TM) 780M').name, 'Radeon 780M');
  assert.equal(matchGpu('Intel(R) Arc(TM) B580 Graphics').name, 'Arc B580');
  assert.equal(matchGpu('Microsoft Basic Display Adapter'), null);
});
test('requirement lines list every gpu and cpu they mention', () => {
  assert.deepEqual(gpusIn('NVIDIA® GeForce® GTX 1060 6GB / AMD Radeon™ RX 580 8GB or better').map(g => g.name), ['GTX 1060', 'RX 580']);
  assert.deepEqual(gpusIn('GeForce GTX 970 or Radeon R9 290').map(g => g.name), ['GTX 970', 'R9 290']);
  assert.deepEqual(cpusIn('Intel Core i5-4460 or AMD FX-6300').map(c => c.name), ['Core i5-4460', 'FX-6300']);
  assert.deepEqual(cpusIn('Intel Core i7-8700 / AMD Ryzen 5 3600').map(c => c.name), ['Core i7-8700', 'Ryzen 5 3600']);
});
test('cpu names from Windows resolve', () => {
  assert.equal(matchCpu('AMD Ryzen 7 5800X3D 8-Core Processor').name, 'Ryzen 7 5800X3D');
  assert.equal(matchCpu('13th Gen Intel(R) Core(TM) i7-13700K').name, 'Core i7-13700K');
  assert.ok(matchCpu('12th Gen Intel(R) Core(TM) i5-12450H'));        // family rule covers models not listed
  assert.ok(matchCpu('Intel(R) Core(TM) Ultra 7 155H'));
  assert.ok(matchCpu('AMD Ryzen 5 7640HS w/ Radeon 760M Graphics'));
});
test('reference orderings hold', () => {
  const s = n => matchGpu(n).score;
  const desc = names => names.forEach((n, i) => i && assert.ok(s(names[i - 1]) > s(n), `${names[i - 1]} > ${n}`));
  desc(['RTX 4090', 'RTX 4080', 'RTX 3090', 'RTX 3080', 'RTX 2080 Ti', 'GTX 1080 Ti', 'GTX 1060']);
  desc(['RX 7900 XTX', 'RX 6800 XT', 'RX 5700 XT', 'RX 580']);
  const near = (a, b) => assert.ok(Math.abs(s(a) / s(b) - 1) <= 0.15, `${a} ≈ ${b}`);
  near('RTX 3060', 'RX 6600 XT'); near('GTX 1060', 'RX 580');
  assert.equal(matchGpu('RTX 4090').score, 100);
});
test('pickGpu prefers the strongest adapter', () => {
  const r = pickGpu([{ name: 'Intel(R) UHD Graphics 770', dedicated: 128e6 }, { name: 'NVIDIA GeForce RTX 4060 Laptop GPU', dedicated: 8e9 }, { name: 'Microsoft Basic Render Driver', dedicated: 0 }]);
  assert.equal(r.gpu.name, 'RTX 4060 Laptop'); assert.equal(r.vramBytes, 8e9);
  assert.equal(pickGpu([{ name: 'Mystery GPU', dedicated: 4e9 }]).gpu, null);
});

// Beyond the plan's tests: spellings seen in Steam requirement lines and Windows names, and the anchors later tasks rely on.
test('matching tolerates loose spellings', () => {
  assert.deepEqual(gpusIn('GTX960 / RX580').map(g => g.name), ['GTX 960', 'RX 580']);
  assert.deepEqual(cpusIn('Intel i5 4460, Ryzen 5 3600XT').map(c => c.name), ['Core i5-4460', 'Ryzen 5 3600XT']);
  assert.equal(matchCpu('Intel(R) Core(TM) i5-12400F').name, 'Core i5-12400');
  assert.equal(matchCpu('AMD FX(tm)-6300 Six-Core Processor').name, 'FX-6300');
  assert.equal(matchGpu('NVIDIA GeForce GTX 1060 3GB').name, 'GTX 1060 3GB');
});
test('anchors and the family rule', () => {
  assert.equal(matchCpu('AMD Ryzen 7 7800X3D 8-Core Processor').score, 100);
  assert.equal(matchGpu('NVIDIA GeForce RTX 4070').vram, 12);
  const s = n => matchCpu(n).score;
  assert.ok(s('Core i5-1345U') < s('Core i5-13505H') && s('Core i5-13505H') < s('Core i5-13490F'), 'laptop suffixes rank below desktop');
  assert.ok(s('Ryzen 5 7520U') < s('Ryzen 5 7645HX'), 'older Zen in the 7000 laptop range scores lower');
  assert.equal(matchCpu('Core i5-12450H').name, 'Core i5-12450H');
});
test('unlisted Arc dGPUs do not fall back to the Arc iGPU', () => {
  assert.equal(matchGpu('Intel(R) Arc(TM) A770M Graphics'), null);
  assert.equal(matchGpu('Intel Arc A-series'), null);
  assert.equal(matchGpu('Intel(R) Arc(TM) Graphics').name, 'Arc Graphics');
});
test('NVIDIA xxxM names do not match a Radeon iGPU', () => {
  assert.equal(matchGpu('NVIDIA GeForce GTX 780M'), null);
  assert.equal(matchGpu('NVIDIA GeForce GTX 660M'), null);
});
test('older parts from real requirement specs resolve without stealing neighbours', () => {
  assert.deepEqual(gpusIn('NVIDIA GeForce GT 730 / AMD Radeon R7 240').map(g => g.name), ['GT 730', 'R7 240']);
  assert.equal(matchGpu('Intel(R) HD Graphics 4600').name, 'HD 4600');
  assert.equal(matchGpu('Intel(R) UHD Graphics 630').name, 'UHD 630');
});
test('pickGpu never prefers a recognised iGPU over an unrecognised discrete card', () => {
  assert.deepEqual(pickGpu([{ name: 'Intel(R) UHD Graphics 630', dedicated: 128e6 }, { name: 'NVIDIA RTX A2000', dedicated: 6e9 }]),
    { gpu: null, name: 'NVIDIA RTX A2000', vramBytes: 6e9 });
});
