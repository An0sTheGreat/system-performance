import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestOnly, pcFromInventory } from '../src/SystemPerformance/ui/views/canirun-shared.js';

test('latestOnly drops stale replies', async () => {
  const wait = (v, ms) => new Promise(r => setTimeout(() => r(v), ms));
  const search = latestOnly((v, ms) => wait(v, ms));
  const [a, b] = await Promise.all([search('old', 30), search('new', 5)]);
  assert.equal(a, undefined); assert.equal(b, 'new');
});
test('pcFromInventory uses the strongest gpu and memory speed', () => {
  const r = pcFromInventory({ gpus: [{ name: 'Intel(R) UHD Graphics 770', dedicated: 1e8 }, { name: 'NVIDIA GeForce RTX 4070', dedicated: 12 * 2 ** 30 }],
    cpu: { name: 'AMD Ryzen 7 7800X3D 8-Core Processor' }, memory: { modules: [{ configuredMts: 6000 }, { configuredMts: 6000 }] } }, { memTotal: 32 * 2 ** 30 });
  assert.equal(r.pc.gpu.name, 'RTX 4070'); assert.equal(r.pc.vramGb, 12); assert.equal(r.ai.ramBw, 96); assert.equal(r.pc.ramGb, 32);
});
test('pcFromInventory rounds Windows memory sizes to whole GB', () => {
  const r = pcFromInventory({ gpus: [{ name: 'NVIDIA GeForce RTX 4070', dedicated: 11.9 * 2 ** 30 }], cpu: { name: 'x' }, memory: { modules: [] } }, { memTotal: 31.9 * 2 ** 30 });
  assert.equal(r.pc.ramGb, 32); assert.equal(r.pc.vramGb, 12);
});
