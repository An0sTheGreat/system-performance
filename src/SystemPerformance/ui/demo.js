// Simulated machine for the browser preview: same shape as the host's samples, values on a random walk.
const GB = 1024 ** 3;
const walk = (v, step, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v + (Math.random() - 0.5) * step));
let cpu = 18, mem = 0.58, gpu = 22, disk = 4, rx = 2e5, tx = 4e4, t = 0;
let cores = Array.from({ length: 16 }, () => 15);
let watching = false, nextProcs = 0;
const MB = 1024 ** 2;
let apps = [
  ['chrome', 24, 6, 2100], ['Code', 9, 3, 900], ['explorer', 1, 0.6, 140], ['Spotify', 6, 1.2, 380], ['Discord', 7, 0.9, 520],
  ['steam', 4, 0.4, 260], ['Teams', 8, 1.5, 610], ['dwm', 1, 1.1, 150], ['svchost', 92, 0.8, 560], ['OneDrive', 1, 0.1, 90],
  ['node', 3, 2.2, 310], ['obs64', 1, 4, 420], ['Photoshop', 1, 0.2, 1500], ['msedge', 6, 0.5, 450], ['python', 2, 0.7, 120],
].map(([name, count, cpu, mem]) => ({ name, count, cpu, mem: mem * MB, io: 0, gpu: 0, vram: ['obs64', 'chrome', 'python', 'Photoshop'].includes(name) ? mem * MB * 1.5 : 0 }));
export const demoWatch = on => { watching = on; nextProcs = 0; };
let sensorsOn = false;
export const demoSensors = on => { sensorsOn = on; };
const sensor = (name, type, value, min, max) => ({ name, type, value, min: min ?? value, max: max ?? value });
export function demoEnd(name) {
  if (name === 'svchost') return { ok: false, ended: 0, failed: 0, error: "svchost is part of Windows or this app and can't be ended here." };
  const n = apps.find(a => a.name === name)?.count ?? 0;
  apps = apps.filter(a => a.name !== name);
  return { ok: n > 0, ended: n, failed: 0, error: n ? null : `${name} is no longer running.` };
}

export const demoInfo = () => ({
  cpuName: 'Preview CPU (simulated)', logical: 16, memTotal: 32 * GB,
  gpuName: 'Preview GPU (simulated)', gpuDedicated: 8 * GB, gpuShared: 16 * GB,
});

export function demoSample(interval) {
  const k = Math.sqrt(interval / 1000);
  t += interval;
  cpu = walk(cpu, 12 * k, 2, 95);
  cores = cores.map(c => walk(c * 0.7 + cpu * 0.3, 30 * k));
  mem = walk(mem, 0.01 * k, 0.4, 0.9);
  gpu = walk(gpu, 14 * k);
  disk = walk(disk, 10 * k, 0, 60);
  rx = walk(rx, 6e5 * k, 0, 8e6);
  tx = walk(tx, 1e5 * k, 0, 2e6);
  let procs = null;
  if (watching && t >= nextProcs) {
    nextProcs = t + 1000;
    apps = apps.map(a => ({ ...a, cpu: walk(a.cpu, 2, 0, 40), io: walk(a.io, 4e6, 0, 5e7), gpu: a.name === 'obs64' || a.name === 'chrome' ? walk(a.gpu, 8, 0, 60) : 0 }));
    procs = apps;
  }
  const cpuTemp = 38 + cpu * 0.5, gpuTemp = 34 + gpu * 0.45;
  const sensors = {
    ready: t > 1500, admin: false, pawnIO: false, error: null, cpuTemp: null, cpuPower: null,
    gpuTemp, gpuHotSpot: gpuTemp + 9, gpuPower: 18 + gpu * 2.4, gpuFanRpm: 600 + gpu * 14, gpuFanPercent: 30 + gpu / 3, gpuClock: 600 + gpu * 22, gpuMemoryClock: 810,
    battery: { level: 76, pluggedIn: false, charging: false, watts: 11.4, remainingSeconds: 9420 },
  };
  const sensorList = sensorsOn && t % 1000 < interval ? [
    { name: 'Preview GPU (simulated)', type: 'GpuNvidia', sensors: [
      sensor('GPU Core', 'Temperature', gpuTemp, 30, 71), sensor('GPU Hot Spot', 'Temperature', gpuTemp + 9, 38, 80), sensor('GPU Memory Junction', 'Temperature', 48, 40, 62),
      sensor('GPU Package', 'Power', sensors.gpuPower, 14, 260), sensor('GPU Core', 'Clock', sensors.gpuClock, 590, 2800), sensor('GPU Memory', 'Clock', 810, 810, 15000),
      sensor('GPU Fan 1', 'Fan', sensors.gpuFanRpm, 0, 2100), sensor('GPU Fan 1', 'Control', sensors.gpuFanPercent, 30, 70), sensor('GPU Core Voltage', 'Voltage', 0.81, 0.8, 1.05)] },
    { name: 'Preview battery (simulated)', type: 'Battery', sensors: [
      sensor('Charge Level', 'Level', 76, 74, 100), sensor('Discharge Rate', 'Power', 11.4, 6, 24), sensor('Degradation Level', 'Level', 8.2), sensor('Voltage', 'Voltage', 12.1, 11.9, 12.6)] },
  ] : null;
  const gpuSample = { luid: 'luid_demo', util: gpu, engines: { '3D': gpu, Compute: gpu / 2, Copy: gpu / 5, VideoDecode: 3, VideoEncode: 0 }, dedicatedUsed: (2.6 + gpu / 20) * GB, sharedUsed: 0.4 * GB };
  const wifiNet = {
    id: 'demo-wifi', name: 'Wi-Fi', description: 'Simulated Wi-Fi 6 adapter', wireless: true, primary: true, ssid: 'Preview network', signal: 82, linkMbps: 866, rx, tx,
    totalRx: 48.2 * GB + t * 1e4, totalTx: 6.1 * GB + t * 2e3,
    wifi: { ssid: 'Preview network', signal: 82, standard: 'Wi-Fi 6 (802.11ax)', channel: 44, band: '5 GHz', rxMbps: 866, txMbps: 720 },
    details: { type: 'Wireless80211', mac: '02:00:00:AB:CD:EF', ipv4: '192.168.1.42', ipv6: 'fd00::42', gateway: '192.168.1.1', dns: '192.168.1.1', dhcp: true },
  };
  const ethNet = {
    id: 'demo-eth', name: 'Ethernet', description: 'Simulated 2.5GbE adapter', wireless: false, primary: false, linkMbps: 2500, rx: rx / 8, tx: tx / 8, totalRx: 2 * GB, totalTx: 0.3 * GB, wifi: null,
    details: { type: 'Ethernet', mac: '02:00:00:12:34:56', ipv4: '10.0.0.5', ipv6: '', gateway: '', dns: '10.0.0.1', dhcp: false },
  };
  const ping = networkOn ? {
    gateway: '192.168.1.1',
    router: { last: Math.round(2 + Math.random() * 3), avg: 2.8, jitter: 0.6, loss: 0, samples: 30 },
    internetHost: pingInternet ? '1.1.1.1' : null,
    internet: pingInternet ? { last: Math.round(14 + Math.random() * 8), avg: 17.4, jitter: 2.1, loss: 0, samples: 30 } : null,
  } : null;
  return {
    sensors,
    sensorList,
    procs,
    ping,
    cpu: {
      total: cpu, cores, coresMhz: cores.map(c => Math.round(3600 + c * 14)), mhz: 3200 + cpu * 12, processes: 312, threads: 4180,
      contextSwitches: Math.round(40000 + cpu * 900), interrupts: Math.round(25000 + cpu * 400), queue: Math.round(cpu / 30), uptime: 3_600_000 * 27 + t,
    },
    mem: {
      total: 32 * GB, used: mem * 32 * GB, commit: mem * 36 * GB, commitLimit: 50 * GB,
      standby: (1 - mem) * 32 * GB * 0.8, modified: 0.3 * GB, free: (1 - mem) * 32 * GB * 0.2, pagedPool: 0.9 * GB, nonPagedPool: 0.6 * GB, hardFaults: Math.round(Math.random() * 4), pageFile: 4.2,
    },
    disks: [
      { name: '0 C:', active: disk, read: disk * 4e5, write: disk * 2e5, latencyMs: 0.4, queue: 0, readsPerSec: Math.round(disk * 30), writesPerSec: Math.round(disk * 12), used: 410 * GB, total: 953 * GB },
      { name: '1 D:', active: disk / 3, read: 0, write: disk * 5e4, latencyMs: 1.1, queue: 0, readsPerSec: 0, writesPerSec: Math.round(disk * 3), used: 1200 * GB, total: 1863 * GB },
      { name: '2 E:', active: 0, read: 0, write: 0, latencyMs: 0, queue: 0, readsPerSec: 0, writesPerSec: 0, used: 300 * GB, total: 931 * GB },
      { name: '3 F:', active: disk / 6, read: disk * 1e4, write: 0, latencyMs: 2.3, queue: 0, readsPerSec: Math.round(disk), writesPerSec: 0, used: 3100 * GB, total: 3726 * GB },
    ],
    net: wifiNet,
    nets: [wifiNet, ethNet],
    gpu: gpuSample,
    gpus: [gpuSample],
  };
}

let networkOn = false, pingInternet = false;
export const demoNetwork = (on, internet) => { networkOn = on; pingInternet = !!internet; };

export const demoInventory = () => ({
  cpu: { name: 'Preview CPU (simulated)', manufacturer: 'Preview', sockets: 1, cores: 12, performanceCores: 8, efficiencyCores: 4, logical: 16, baseMhz: 3600,
    l1Kb: 1024, l2Kb: 12288, l3Kb: 25600, virtualization: true, socket: 'LGA1700', instructionSets: ['SSE4.2', 'AVX', 'AVX2', 'FMA3', 'AVX-VNNI', 'AES-NI', 'BMI2'], architecture: 'X64' },
  platform: { board: 'Preview Board Z690', bios: '1.0', biosDate: '2025-01-01', os: 'Microsoft Windows 11', build: '26200' },
  gpus: [{ name: 'NVIDIA GeForce RTX 4070', luid: 'luid_demo', primary: true, vendor: 'NVIDIA', dedicated: 12 * GB, shared: 16 * GB, driver: '32.0.15.0000', driverDate: '2026-01-01', display: '2560 × 1440 @ 165 Hz' }],
  memory: { slots: 4, modules: [
    { slot: 'DIMM A1', capacity: 16 * GB, ratedMts: 6000, configuredMts: 4800, manufacturer: 'Preview', part: 'PV-DDR5-6000', type: 'DDR5', formFactor: 'DIMM' },
    { slot: 'DIMM B1', capacity: 16 * GB, ratedMts: 6000, configuredMts: 4800, manufacturer: 'Preview', part: 'PV-DDR5-6000', type: 'DDR5', formFactor: 'DIMM' }] },
  disks: [
    { number: 0, model: 'Preview NVMe SSD 1TB', media: 'SSD', bus: 'NVMe', size: 1000 * GB, health: 'Healthy', rpm: null },
    { number: 1, model: 'Preview SATA SSD 2TB', media: 'SSD', bus: 'SATA', size: 2000 * GB, health: 'Healthy', rpm: null },
    { number: 2, model: 'Preview HDD 1TB', media: 'HDD', bus: 'SATA', size: 1000 * GB, health: 'Healthy', rpm: 7200 },
    { number: 3, model: 'Preview HDD 4TB', media: 'HDD', bus: 'SATA', size: 4000 * GB, health: 'Warning', rpm: 5400 }],
  volumes: [
    { letter: 'C', label: 'Windows', fileSystem: 'NTFS', total: 953 * GB, free: 543 * GB },
    { letter: 'D', label: 'Games', fileSystem: 'NTFS', total: 1863 * GB, free: 663 * GB },
    { letter: 'E', label: 'Backup', fileSystem: 'NTFS', total: 931 * GB, free: 631 * GB },
    { letter: 'F', label: 'Media', fileSystem: 'exFAT', total: 3726 * GB, free: 626 * GB }],
});

// Can I Run It? in the preview: canned Steam and Hugging Face replies in the host's shapes (see Web.cs).
// Search "zzz" for no hits. The GGUF repo has 4 quants, a 2-part split and an mmproj; Qwen3-8B is safetensors only.
const STEAM_CDN = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/';
const steamReq = (kind, os, cpu, ram, gpu, dx, storage) => `<strong>${kind}:</strong><br><ul class="bb_ul">` +
  ['Requires a 64-bit processor and operating system', `<strong>OS:</strong> ${os}`, `<strong>Processor:</strong> ${cpu}`, `<strong>Memory:</strong> ${ram} GB RAM`,
    `<strong>Graphics:</strong> ${gpu}`, `<strong>DirectX:</strong> Version ${dx}`, `<strong>Storage:</strong> ${storage} GB available space`]
    .map(li => `<li>${li}<br></li>`).join('') + '</ul>';
const DEMO_GAMES = [
  { id: 1245620, name: 'ELDEN RING', released: '24 Feb, 2022',
    min: steamReq('Minimum', 'Windows 10', 'INTEL CORE I5-8400 or AMD RYZEN 3 3300X', 12, 'NVIDIA GEFORCE GTX 1060 3 GB or AMD RADEON RX 580 4 GB', 12, 60),
    rec: steamReq('Recommended', 'Windows 10/11', 'INTEL CORE I7-8700K or AMD RYZEN 5 3600X', 16, 'NVIDIA GEFORCE GTX 1070 8 GB or AMD RADEON RX VEGA 56 8 GB', 12, 60) },
  { id: 1091500, name: 'Cyberpunk 2077', released: '9 Dec, 2020',
    min: steamReq('Minimum', '64-bit Windows 10', 'Core i7-6700 or Ryzen 5 1600', 12, 'GeForce GTX 1060 6GB or Radeon RX 580 8GB or Arc A380', 12, 70),
    rec: steamReq('Recommended', '64-bit Windows 10', 'Core i7-12700 or Ryzen 7 7800X3D', 16, 'GeForce RTX 2060 SUPER or Radeon RX 5700 XT or Arc A770', 12, 70) },
  { id: 1086940, name: 'Baldur\'s Gate 3', released: 'Aug 3, 2023',
    min: steamReq('Minimum', 'Windows 10 64-bit', 'Intel I5 4690 / AMD FX 8350', 8, 'Nvidia GTX 970 / RX 480 / Intel Arc A380 (4GB+ of VRAM)', 11, 150),
    rec: steamReq('Recommended', 'Windows 10 64-bit', 'Intel i7 8700K / AMD r5 3600', 16, 'Nvidia 2060 Super / RX 5700 XT / Intel Arc A580 (8GB+ of VRAM)', 11, 150) },
];
const DEMO_MODELS = {
  'unsloth/gemma-3-12b-it-GGUF': {
    info: { task: 'image-text-to-text', downloads: 182455, likes: 241, params: 11766034176, ctx: 131072, baseModel: 'google/gemma-3-12b-it', gated: false },
    files: [['.gitattributes', 2311], ['README.md', 14882], ['gemma-3-12b-it-Q4_K_M.gguf', 7300574976], ['gemma-3-12b-it-Q5_K_M.gguf', 8445225216],
      ['gemma-3-12b-it-Q6_K.gguf', 9661198592], ['gemma-3-12b-it-Q8_0.gguf', 12509902592], ['BF16/gemma-3-12b-it-BF16-00001-of-00002.gguf', 15831398400],
      ['BF16/gemma-3-12b-it-BF16-00002-of-00002.gguf', 7708467200], ['mmproj-F16.gguf', 854200224]],
    config: null,   // a GGUF repo has no config.json; the view falls back to baseModel's
  },
  'google/gemma-3-12b-it': {   // only its config (multimodal: the text model's layout is in text_config)
    config: { architectures: ['Gemma3ForConditionalGeneration'], model_type: 'gemma3',
      text_config: { hidden_size: 3840, num_hidden_layers: 48, num_attention_heads: 16, num_key_value_heads: 8, head_dim: 256, max_position_embeddings: 131072 } },
  },
  'Qwen/Qwen3-8B': {
    info: { task: 'text-generation', downloads: 6189636, likes: 2209, params: 8190735360, ctx: null, baseModel: 'Qwen/Qwen3-8B-Base', gated: false },
    files: [['.gitattributes', 1570], ['LICENSE', 11343], ['README.md', 16795], ['config.json', 728], ['generation_config.json', 239],
      ['model-00001-of-00005.safetensors', 3996250744], ['model-00002-of-00005.safetensors', 3993160032], ['model-00003-of-00005.safetensors', 3959604768],
      ['model-00004-of-00005.safetensors', 3187841392], ['model-00005-of-00005.safetensors', 1244659840], ['model.safetensors.index.json', 32878],
      ['tokenizer.json', 11422654], ['tokenizer_config.json', 9732], ['vocab.json', 2776833]],
    config: { architectures: ['Qwen3ForCausalLM'], model_type: 'qwen3', hidden_size: 4096, intermediate_size: 12288, num_hidden_layers: 36, num_attention_heads: 32,
      num_key_value_heads: 8, head_dim: 128, max_position_embeddings: 40960, torch_dtype: 'bfloat16', vocab_size: 151936 },
  },
};
const DEMO_GGUF = { 'google/gemma-3-12b-it': [{ id: 'unsloth/gemma-3-12b-it-GGUF', downloads: 182455 }] };
const notFound = { ok: false, error: 'http 404' };

export function demoWeb(type, { term = '', appId, id } = {}) {
  const none = String(term).toLowerCase().includes('zzz');
  const game = DEMO_GAMES.find(g => String(g.id) === String(appId));
  const model = DEMO_MODELS[id]?.info && DEMO_MODELS[id];
  switch (type) {
    case 'gameSearch': return { ok: true, data: none ? [] : DEMO_GAMES.map(g => ({ id: g.id, name: g.name, image: `${STEAM_CDN}${g.id}/capsule_231x87.jpg` })) };
    case 'gameDetails': return game ? { ok: true, data: { name: game.name, type: 'game', image: `${STEAM_CDN}${game.id}/header.jpg`, released: game.released, min: game.min, rec: game.rec } } : notFound;
    case 'modelSearch': return { ok: true, data: none ? [] : Object.entries(DEMO_MODELS).filter(([, m]) => m.info).map(([id, m]) => ({ id, downloads: m.info.downloads, likes: m.info.likes, task: m.info.task })) };
    case 'modelInfo': return model ? { ok: true, data: { id, ...model.info } } : notFound;
    case 'modelFiles': return model ? { ok: true, data: model.files.map(([path, size]) => ({ path, size })) } : notFound;
    case 'modelConfig': return { ok: true, data: DEMO_MODELS[id]?.config ?? null };
    case 'modelGguf': return { ok: true, data: DEMO_GGUF[id] ?? [] };
    default: return { ok: false, error: 'unknown request' };
  }
}
