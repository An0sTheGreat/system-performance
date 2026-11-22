import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseContext, ctxLabel, defaultQuant } from '../src/SystemPerformance/ui/views/canirun-ai.js';

test('context parses integers and Nk within 512..1048576', () => {
  assert.equal(parseContext('8192'), 8192); assert.equal(parseContext(' 8,192 '), 8192);
  assert.equal(parseContext('128K'), 131072); assert.equal(parseContext('32k'), 32768);
  assert.equal(parseContext('256'), null); assert.equal(parseContext('2048k'), null); assert.equal(parseContext('lots'), null);
  assert.equal(ctxLabel(8192), '8K'); assert.equal(ctxLabel(3000), '3000');
});
test('default quant is the largest that fits in VRAM, else the smallest', () => {
  const q = (tag, size, where) => ({ tag, size, where });
  assert.equal(defaultQuant([q('BF16', 16, 'split'), q('8-bit', 8, 'vram'), q('4-bit', 4, 'vram')]), '8-bit');
  assert.equal(defaultQuant([q('Q8_0', 12, 'ram'), q('Q4_K_M', 7, 'split')]), 'Q4_K_M');
  assert.equal(defaultQuant([]), null);
});
