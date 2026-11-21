import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quantOf, groupFiles, synthQuants, readConfig, kvBytes, ramBandwidth, estimateModel } from '../src/SystemPerformance/ui/estimate-ai.js';

test('quant tags and grouping', () => {
  assert.equal(quantOf('Qwen3-8B-Q4_K_M.gguf'), 'Q4_K_M'); assert.equal(quantOf('m-IQ3_XXS.gguf'), 'IQ3_XXS');
  assert.equal(quantOf('m-f16.gguf'), 'F16'); assert.equal(quantOf('m-bf16.gguf'), 'BF16'); assert.equal(quantOf('model.safetensors'), null);
  const g = groupFiles([{ path: 'Q8_0/m-Q8_0-00001-of-00002.gguf', size: 5e9 }, { path: 'Q8_0/m-Q8_0-00002-of-00002.gguf', size: 3e9 },
    { path: 'm-Q4_K_M.gguf', size: 4.9e9 }, { path: 'mmproj-m-f16.gguf', size: 0.9e9 }, { path: 'README.md', size: 10 }]);
  assert.deepEqual(g.quants.map(q => [q.tag, q.size, q.files.length]), [['Q4_K_M', 4.9e9, 1], ['Q8_0', 8e9, 2]]);
  assert.deepEqual(g.mmproj.map(m => m.path), ['mmproj-m-f16.gguf']);
});
test('repos without gguf get synthesised sizes, or none', () => {
  assert.deepEqual(synthQuants(8e9, 0).map(q => [q.tag, q.size]), [['BF16', 16e9], ['8-bit', 8.56e9], ['4-bit', 4.56e9]]);
  assert.equal(synthQuants(null, 16e9)[0].size, 16e9);
  assert.deepEqual(synthQuants(null, 0), []);
});
test('config and kv cache', () => {
  const cfg = readConfig({ num_hidden_layers: 32, num_attention_heads: 32, num_key_value_heads: 8, hidden_size: 4096, max_position_embeddings: 131072 });
  assert.deepEqual([cfg.layers, cfg.kvHeads, cfg.headDim, cfg.maxCtx], [32, 8, 128, 131072]);
  assert.equal(readConfig({ text_config: { num_hidden_layers: 4, num_attention_heads: 8, hidden_size: 512 } }).headDim, 64);
  assert.deepEqual(kvBytes(cfg, 8192, null), { bytes: 2 ** 30, heuristic: false });
  assert.equal(kvBytes(null, 8192, 8e9).heuristic, true);
  assert.equal(readConfig({}), null);
});
test('ram bandwidth', () => {
  const m = n => Array.from({ length: n }, () => ({ configuredMts: 4800, ratedMts: 6000 }));
  assert.equal(ramBandwidth(m(2)), 76.8); assert.equal(ramBandwidth(m(4)), 76.8); assert.equal(ramBandwidth(m(1)), 38.4);
});
test('where it runs and how fast', () => {
  const GiB = 2 ** 30, pc = { vramBytes: 12 * GiB, ramBytes: 32 * GiB, gpuBw: 504, ramBw: 76.8, igpu: false };
  const est = (weights, p = pc) => estimateModel({ weights, mmproj: 0, kv: 0, pc: p });
  assert.equal(est(10.6 * GiB).where, 'vram');                 // need 11.4 ≤ 11.5
  assert.equal(est(10.8 * GiB).where, 'split');
  assert.equal(est(10 * GiB, { ...pc, igpu: true }).where, 'ram');
  assert.equal(est(40 * GiB).where, 'none');
  const fast = estimateModel({ weights: 4.9e9, mmproj: 0, kv: 0, pc });
  assert.ok(Math.abs(fast.tps.mid - 0.6 * 504e9 / 4.9e9) < 0.1);
  const split = est(20 * GiB), ram = est(20 * GiB, { ...pc, vramBytes: 0 });
  assert.ok(split.tps.mid > ram.tps.mid);
  assert.equal(estimateModel({ weights: 4.9e9, mmproj: 0, kv: 0, pc: { ...pc, gpuBw: null } }).tps, null);
});
test('moe active params from config', () => {
  const c = readConfig({ num_hidden_layers: 8, num_attention_heads: 8, hidden_size: 256, moe_intermediate_size: 512, num_experts: 16, num_experts_per_tok: 2 });
  assert.ok(c.activeParams > 0);
  assert.equal(readConfig({ num_hidden_layers: 8, num_attention_heads: 8, hidden_size: 256 }).activeParams, null);
});
test('config without head size is unusable, not NaN', () => {
  assert.equal(readConfig({ num_hidden_layers: 32, num_attention_heads: 32 }), null);
});
test('ram bandwidth treats a 0 clock as missing', () => {
  assert.equal(ramBandwidth([{ configuredMts: 0, ratedMts: 6000 }, { configuredMts: 0, ratedMts: 6000 }]), 96);
});
