// Simulated machine for the browser preview: same shape as the host's samples, values on a random walk.
const GB = 1024 ** 3;
const walk = (v, step, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v + (Math.random() - 0.5) * step));
let cpu = 18, mem = 0.58, gpu = 22, disk = 4, rx = 2e5, tx = 4e4, t = 0;
let cores = Array.from({ length: 16 }, () => 15);

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
  return {
    cpu: { total: cpu, cores, mhz: 3200 + cpu * 12, processes: 312, threads: 4180, uptime: 3_600_000 * 27 + t },
    mem: { total: 32 * GB, used: mem * 32 * GB, commit: mem * 36 * GB, commitLimit: 50 * GB },
    disks: [
      { name: '0 C:', active: disk, read: disk * 4e5, write: disk * 2e5, latencyMs: 0.4, used: 410 * GB, total: 953 * GB },
      { name: '1 D:', active: disk / 3, read: 0, write: disk * 5e4, latencyMs: 1.1, used: 1200 * GB, total: 1863 * GB },
      { name: '2 E:', active: 0, read: 0, write: 0, latencyMs: 0, used: 300 * GB, total: 931 * GB },
      { name: '3 F:', active: disk / 6, read: disk * 1e4, write: 0, latencyMs: 2.3, used: 3100 * GB, total: 3726 * GB },
    ],
    net: { name: 'Wi-Fi', description: 'Simulated adapter', wireless: true, ssid: 'Preview network', signal: 82, linkMbps: 866, rx, tx },
    gpu: { util: gpu, engines: { '3D': gpu, Copy: gpu / 5, VideoDecode: 3, VideoEncode: 0, Compute: gpu / 2 }, dedicatedUsed: 2.6 * GB, sharedUsed: 0.4 * GB },
  };
}
