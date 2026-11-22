// AI-model estimate: GGUF quant grouping, memory need, where it runs, tokens/s. Pure; sizes in bytes, bandwidths in GB/s.
const GiB = 2 ** 30;
const OVERHEAD = 0.8 * GiB;
export const VRAM_MARGIN = 0.5 * GiB;   // kept free of the model on a dedicated GPU
const OS_RESERVE = 4 * GiB, EFF = 0.6, BAND = 0.25;

const QUANT_RE = /(?:^|[-_.])((?:UD-)?(?:IQ\d_[A-Z]+|Q\d_[A-Z0-9_]+|BF16|F16|F32|MXFP4))(?=[-_.]|$)/i;

export function quantOf(path) {
  if (!/\.gguf$/i.test(path)) return null;
  const base = path.split('/').pop().replace(/\.gguf$/i, '');
  const m = QUANT_RE.exec(base);
  return m ? m[1].toUpperCase() : null;
}

export function groupFiles(files) {
  const by = new Map(), mmproj = [];
  for (const f of files) {
    if (!/\.gguf$/i.test(f.path)) continue;
    if (/mmproj/i.test(f.path)) { mmproj.push({ path: f.path, size: f.size }); continue; }
    const tag = quantOf(f.path);
    if (!tag) continue;
    const q = by.get(tag) ?? { tag, size: 0, files: [] };
    q.size += f.size; q.files.push(f.path); by.set(tag, q);
  }
  return { quants: [...by.values()].sort((a, b) => a.size - b.size), mmproj: mmproj.sort((a, b) => a.size - b.size) };
}

// Bytes per parameter for repos that only ship safetensors (no GGUF to read sizes from).
export function synthQuants(params, safetensorsBytes) {
  const p = params ?? safetensorsBytes / 2;
  if (!(p > 0)) return [];
  return [['BF16', 2.0], ['8-bit', 1.07], ['4-bit', 0.57]].map(([tag, bpp]) => ({ tag, size: Math.round(p * bpp) }));
}

export function readConfig(json) {
  const c = json?.text_config ?? json;
  const layers = c?.num_hidden_layers, heads = c?.num_attention_heads, hidden = c?.hidden_size;
  if (!(layers > 0 && heads > 0)) return null;
  const headDim = c.head_dim ?? hidden / heads;
  if (!(Number.isFinite(headDim) && headDim > 0 && (c.num_key_value_heads ?? heads) > 0)) return null;
  const experts = c.num_local_experts ?? c.num_experts, k = c.num_experts_per_tok;
  let activeParams = null;
  if (experts > 0 && k > 0 && hidden > 0) {
    // ponytail: rough count (attention + embeddings + routed experts), ignores shared experts and dense layers
    const inter = c.moe_intermediate_size ?? c.intermediate_size ?? hidden * 4;
    activeParams = layers * 4 * hidden * hidden + (c.vocab_size ?? 0) * hidden + layers * k * 3 * hidden * inter;
  }
  return { layers, kvHeads: c.num_key_value_heads ?? heads, headDim, maxCtx: c.max_position_embeddings, activeParams };
}

// fp16 K and V per layer, per token
export function kvBytes(cfg, ctx, params) {
  if (cfg) return { bytes: 2 * cfg.layers * cfg.kvHeads * cfg.headDim * ctx * 2, heuristic: false };
  return { bytes: ctx * 48 * 1024 * Math.pow(params / 1e9, 0.45), heuristic: true };
}

export function ramBandwidth(modules) {
  const channels = Math.max(1, Math.min(modules.length, 2));
  // WMI reports 0 for an unknown clock
  const mts = modules[0]?.configuredMts || modules[0]?.ratedMts || 3200;
  return channels * mts * 8 / 1000;
}

export function estimateModel({ weights, mmproj, kv, activeFraction = 1, pc }) {
  const need = weights + mmproj + kv + OVERHEAD;
  const gpuMem = pc.igpu ? 0 : pc.vramBytes - VRAM_MARGIN, ramMem = pc.ramBytes - OS_RESERVE;
  let where = 'none', gpuShare = 0;
  if (gpuMem > 0 && need <= gpuMem) { where = 'vram'; gpuShare = 1; }
  else if (gpuMem > 0 && need <= gpuMem + ramMem) { where = 'split'; gpuShare = gpuMem / need; }
  else if (gpuMem <= 0 && need <= ramMem) where = 'ram';
  const B = weights * activeFraction, gpu = pc.gpuBw * 1e9, ram = pc.ramBw * 1e9;
  let mid = null;
  if (where === 'ram') mid = EFF * ram / B;
  else if (where === 'vram' && pc.gpuBw != null) mid = EFF * gpu / B;
  else if (where === 'split' && pc.gpuBw != null) mid = EFF / (gpuShare * B / gpu + (1 - gpuShare) * B / ram);
  return { where, gpuShare, need, tps: mid == null ? null : { mid, lo: mid * (1 - BAND), hi: mid * (1 + BAND) } };
}
