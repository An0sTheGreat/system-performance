import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sensorValue, duration, heat, bytes, bits, pct, pctFine, topApps, uptime, diskLabel, Series, linePath, areaPath, niceMax, parseSettings, capacity } from '../src/SystemPerformance/ui/metrics.js';

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

test('top apps sort by the chosen resource, ties by name', () => {
  const apps = [{ name: 'b', cpu: 1, mem: 5 }, { name: 'a', cpu: 1, mem: 9 }, { name: 'c', cpu: 7, mem: 1 }];
  assert.deepEqual(topApps(apps, 'cpu').map(a => a.name), ['c', 'a', 'b']);
  assert.deepEqual(topApps(apps, 'mem', 2).map(a => a.name), ['a', 'b']);
  assert.deepEqual(topApps(null, 'cpu'), []);
  assert.equal(pctFine(0.44), '0.4%');
  assert.equal(pctFine(42.6), '43%');
});

test('sensor values carry their unit; heat joins what is readable', () => {
  assert.equal(sensorValue('Temperature', 54.26), '54.3 °C');
  assert.equal(sensorValue('Power', 14.46), '14.5 W');
  assert.equal(sensorValue('Voltage', 0.8), '0.800 V');
  assert.equal(sensorValue('Fan', null), '—');
  assert.equal(duration(9420), '2:37:00');
  assert.equal(duration(600), '10 min');
  assert.equal(heat(54.4, 65.2), '54 °C · 65 W');
  assert.equal(heat(null, 65), '65 W');
  assert.equal(heat(null, null), '');
});
