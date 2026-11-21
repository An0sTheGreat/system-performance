import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytes, bits, pct, uptime, diskLabel, Series, linePath, areaPath, niceMax, parseSettings, capacity } from '../src/SystemPerformance/ui/metrics.js';

test('formatting', () => {
  assert.equal(bytes(0), '0 B');
  assert.equal(bytes(1536), '1.5 KB');
  assert.equal(bytes(16 * 1024 ** 3), '16.0 GB');
  assert.equal(bits(125_000), '1.0 Mbps');
  assert.equal(bits(10), '80 bps');
  assert.equal(pct(42.6), '43%');
  assert.equal(uptime(90_061_000), '1d 01:01:01');
  assert.equal(diskLabel('0 C: D:'), 'Disk 0 (C: D:)');
  assert.equal(diskLabel('2'), 'Disk 2');
});

test('series keeps the newest values within capacity', () => {
  const s = new Series(3);
  [1, 2, 3, 4].forEach(v => s.push(v));
  assert.deepEqual(s.values, [2, 3, 4]);
  s.resize(2);
  assert.deepEqual(s.values, [3, 4]);
  assert.equal(s.max(), 4);
  assert.equal(capacity(100), 600);
});

test('paths are right-aligned and clamped', () => {
  assert.equal(linePath([0, 50, 200], 3, 100, 100, 100), 'M0.0 100.0L50.0 50.0L100.0 0.0');
  assert.equal(linePath([50], 3, 100, 100, 100), 'M100.0 50.0');
  assert.equal(linePath([], 3, 100), '');
  assert.equal(areaPath('M100.0 50.0', [50], 3, 100, 100), 'M100.0 50.0L100 100L100.0 100Z');
});

test('niceMax rounds up with headroom and respects the floor', () => {
  assert.equal(niceMax(0, 1000), 1000);
  assert.equal(niceMax(900), 2000);
  assert.equal(niceMax(4000), 5000);
});

test('settings fall back to defaults', () => {
  assert.deepEqual(parseSettings(null), { theme: 'system', rate: 1000 });
  assert.deepEqual(parseSettings({ theme: 'dark', rate: 100 }), { theme: 'dark', rate: 100 });
  assert.deepEqual(parseSettings({ theme: 'neon', rate: 7 }), { theme: 'system', rate: 1000 });
});
