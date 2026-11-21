import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comboCommit } from '../src/SystemPerformance/ui/kit.js';

test('combo commit validates through parse', () => {
  const parse = t => (/^\d+$/.test(t.trim()) ? Number(t) : null);
  assert.deepEqual(comboCommit(' 60 ', parse), { ok: true, value: 60 });
  assert.deepEqual(comboCommit('sixty', parse), { ok: false, value: null });
});
