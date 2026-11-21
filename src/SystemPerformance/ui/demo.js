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
].map(([name, count, cpu, mem]) => ({ name, count, cpu, mem: mem * MB, io: 0, gpu: 0 }));
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
  return {
    sensors,
    sensorList,
    procs,
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
