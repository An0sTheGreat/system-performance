// GPU and CPU performance table for Can I Run It?, plus name matching for Windows names and Steam requirement lines.
// ponytail: hand-maintained table, refresh when new hardware ships
// Scores are recalled from published relative-performance charts (TechPowerUp style), not measured here.

// GPU raster score: RTX 4090 = 100. Rows are [name, score, VRAM GB, bandwidth GB/s, integrated?].
// Integrated parts list VRAM 0 and their typical system memory bandwidth.
const GPU_ROWS = [
  // NVIDIA desktop
  ['RTX 5090', 125, 32, 1792], ['RTX 5080', 88, 16, 960], ['RTX 5070 Ti', 75, 16, 896], ['RTX 5070', 66, 12, 672],
  ['RTX 5060 Ti', 48, 16, 448], ['RTX 5060', 43, 8, 448], ['RTX 5050', 33, 8, 320],
  ['RTX 4090', 100, 24, 1008], ['RTX 4080 Super', 80, 16, 736], ['RTX 4080', 78, 16, 717], ['RTX 4070 Ti Super', 72, 16, 672],
  ['RTX 4070 Ti', 67, 12, 504], ['RTX 4070 Super', 63, 12, 504], ['RTX 4070', 55, 12, 504], ['RTX 4060 Ti', 41.5, 8, 288], ['RTX 4060', 35, 8, 272],
  ['RTX 3090 Ti', 67, 24, 1008], ['RTX 3090', 62, 24, 936], ['RTX 3080 Ti', 60, 12, 912], ['RTX 3080', 55, 10, 760],
  ['RTX 3070 Ti', 47, 8, 608], ['RTX 3070', 44, 8, 448], ['RTX 3060 Ti', 38, 8, 448], ['RTX 3060', 30, 12, 360], ['RTX 3050', 22, 8, 224],
  ['RTX 2080 Ti', 45, 11, 616], ['RTX 2080 Super', 39.5, 8, 496], ['RTX 2080', 37.5, 8, 448], ['RTX 2070 Super', 35, 8, 448],
  ['RTX 2070', 31, 8, 448], ['RTX 2060 Super', 29.5, 8, 448], ['RTX 2060', 26, 6, 336],
  ['GTX 1660 Ti', 22, 6, 288], ['GTX 1660 Super', 21.5, 6, 336], ['GTX 1660', 19.5, 6, 192], ['GTX 1650 Super', 16, 4, 192],
  ['GTX 1650', 12.5, 4, 128], ['GTX 1630', 7.5, 4, 96],
  ['GTX 1080 Ti', 34, 11, 484], ['GTX 1080', 27, 8, 320], ['GTX 1070 Ti', 25, 8, 256], ['GTX 1070', 22.5, 8, 256],
  ['GTX 1060', 16.5, 6, 192], ['GTX 1060 3GB', 15, 3, 192], ['GTX 1050 Ti', 10, 4, 112], ['GTX 1050', 8, 2, 112], ['GT 1030', 4.5, 2, 48],
  ['GTX 980 Ti', 21.5, 6, 336], ['GTX 980', 17, 4, 224], ['GTX 970', 15, 4, 224], ['GTX 960', 9.5, 2, 112], ['GTX 950', 7.8, 2, 106],
  // Older cards still common in minimum requirements
  ['GTX 780 Ti', 14, 3, 336], ['GTX 780', 12, 3, 288], ['GTX 770', 10, 2, 224], ['GTX 760', 8.3, 2, 192], ['GTX 750 Ti', 6, 2, 86],
  ['GTX 680', 9.6, 2, 192], ['GTX 670', 8.8, 2, 192], ['GTX 660', 6.8, 2, 144],
  // NVIDIA laptop (Windows appends "Laptop GPU" from the RTX 30 series on)
  ['RTX 5090 Laptop', 62, 24, 896], ['RTX 5080 Laptop', 54, 16, 896], ['RTX 5070 Ti Laptop', 45, 12, 672], ['RTX 5070 Laptop', 36, 8, 384],
  ['RTX 5060 Laptop', 33, 8, 384], ['RTX 5050 Laptop', 26, 8, 384],
  ['RTX 4090 Laptop', 57, 16, 576], ['RTX 4080 Laptop', 49, 12, 432], ['RTX 4070 Laptop', 33, 8, 256], ['RTX 4060 Laptop', 30.5, 8, 256], ['RTX 4050 Laptop', 25, 6, 192],
  ['RTX 3080 Ti Laptop', 42, 16, 512], ['RTX 3080 Laptop', 37, 8, 448], ['RTX 3070 Ti Laptop', 35, 8, 448], ['RTX 3070 Laptop', 31.5, 8, 448],
  ['RTX 3060 Laptop', 26, 6, 336], ['RTX 3050 Ti Laptop', 16, 4, 192], ['RTX 3050 Laptop', 14, 4, 192],
  ['RTX 2050', 11, 4, 112], ['GTX 1650 Ti', 12, 4, 192], ['MX 550', 5.5, 2, 96], ['MX 450', 5, 2, 80],
  // AMD desktop
  ['RX 9070 XT', 74, 16, 640], ['RX 9070', 66, 16, 640], ['RX 9060 XT', 45, 16, 320],
  ['RX 7900 XTX', 80, 24, 960], ['RX 7900 XT', 70, 20, 800], ['RX 7900 GRE', 62, 16, 576], ['RX 7800 XT', 58, 16, 624],
  ['RX 7700 XT', 50, 12, 432], ['RX 7600 XT', 35, 16, 288], ['RX 7600', 34, 8, 288],
  ['RX 6950 XT', 65, 16, 576], ['RX 6900 XT', 61, 16, 512], ['RX 6800 XT', 57, 16, 512], ['RX 6800', 50, 16, 512],
  ['RX 6750 XT', 44, 12, 432], ['RX 6700 XT', 42, 12, 384], ['RX 6700', 37, 10, 320], ['RX 6650 XT', 34, 8, 280],
  ['RX 6600 XT', 32, 8, 256], ['RX 6600', 28, 8, 224], ['RX 6500 XT', 14, 4, 144], ['RX 6400', 11, 4, 128],
  ['RX 5700 XT', 31, 8, 448], ['RX 5700', 28, 8, 448], ['RX 5600 XT', 25.5, 6, 336], ['RX 5500 XT', 16.5, 8, 224],
  ['Vega 64', 25.5, 8, 484], ['Vega 56', 22.5, 8, 410],
  ['RX 590', 18.5, 8, 256], ['RX 580', 17, 8, 256], ['RX 570', 14.5, 4, 224], ['RX 560', 8.5, 4, 112], ['RX 550', 5.5, 2, 112],
  ['RX 480', 16, 8, 256], ['RX 470', 13.5, 4, 211], ['RX 460', 8, 4, 112],
  ['R9 390X', 15.5, 8, 384], ['R9 390', 14.5, 8, 384], ['R9 290X', 13.5, 4, 320], ['R9 290', 12.5, 4, 320],
  ['R9 380X', 10.5, 4, 182], ['R9 380', 9.5, 4, 182], ['R9 280X', 9.8, 3, 288], ['R9 280', 8.5, 3, 240], ['R9 270X', 7, 2, 179], ['R7 370', 6.8, 2, 179],
  ['HD 7970', 9.2, 3, 264], ['HD 7950', 7.8, 3, 240], ['HD 7870', 6.8, 2, 154], ['HD 7850', 5.6, 2, 154],
  // AMD laptop
  ['RX 6800M', 40, 12, 384], ['RX 6700M', 34, 10, 320], ['RX 6600M', 28, 8, 224], ['RX 6500M', 12, 4, 144],
  ['RX 7600M XT', 30, 8, 288], ['RX 7600S', 26, 8, 256],
  // Intel Arc
  ['Arc B580', 36, 12, 456], ['Arc B570', 31, 10, 380], ['Arc A770', 33, 16, 560], ['Arc A750', 31, 8, 512],
  ['Arc A580', 27, 8, 512], ['Arc A380', 11, 6, 186], ['Arc A310', 8, 4, 124],
  // Integrated. "Arc Graphics" is how Windows names the Core Ultra iGPU.
  ['HD 4000', 0.9, 0, 26, true], ['HD 520', 1.4, 0, 34, true], ['HD 530', 1.7, 0, 34, true], ['HD 620', 1.6, 0, 34, true], ['HD 630', 1.9, 0, 38, true],
  ['UHD 620', 1.6, 0, 34, true], ['UHD 630', 2, 0, 42, true], ['UHD 730', 2.2, 0, 51, true], ['UHD 770', 2.7, 0, 77, true],
  ['Iris Plus', 3.5, 0, 58, true], ['Iris Xe', 5, 0, 68, true], ['Arc Graphics', 9, 0, 120, true], ['Arc 140V', 11, 0, 136, true],
  ['Vega 8', 3.5, 0, 51, true], ['Vega 11', 4.2, 0, 51, true], ['Radeon 660M', 6, 0, 77, true], ['Radeon 680M', 9, 0, 102, true],
  ['Radeon 760M', 9.5, 0, 120, true], ['Radeon 780M', 11, 0, 120, true], ['Radeon 880M', 11.5, 0, 120, true], ['Radeon 890M', 13.5, 0, 120, true],
  ['Radeon 8050S', 24, 0, 256, true], ['Radeon 8060S', 30, 0, 256, true],
];
export const GPUS = GPU_ROWS.map(([name, score, vram, bw, igpu = false]) =>
  ({ name, score, vram, bw, up: name.startsWith('RTX') ? 'DLSS' : name.startsWith('Arc') ? 'XeSS' : 'FSR', igpu }));

// CPU gaming score (single-thread weighted): Ryzen 7 7800X3D = 100. Rows are [name, score, cores].
const CPU_ROWS = [
  // Intel desktop
  ['Core 2 Duo E8400', 12, 2], ['Core 2 Quad Q6600', 13, 4], ['Pentium G4560', 30, 2],
  ['Core i3-2100', 22, 2], ['Core i5-2400', 30, 4], ['Core i5-2500K', 33, 4], ['Core i7-2600', 36, 4], ['Core i7-2600K', 37, 4],
  ['Core i3-3220', 24, 2], ['Core i5-3470', 34, 4], ['Core i5-3570K', 36, 4], ['Core i7-3770', 39, 4], ['Core i7-3770K', 40, 4],
  ['Core i3-4130', 26, 2], ['Core i3-4160', 27, 2], ['Core i5-4460', 37, 4], ['Core i5-4590', 38, 4], ['Core i5-4670K', 40, 4],
  ['Core i5-4690K', 41, 4], ['Core i7-4770', 43, 4], ['Core i7-4770K', 44, 4], ['Core i7-4790', 45, 4], ['Core i7-4790K', 47, 4],
  ['Core i3-6100', 33, 2], ['Core i5-6400', 40, 4], ['Core i5-6500', 42, 4], ['Core i5-6600K', 47, 4], ['Core i7-6700', 51, 4], ['Core i7-6700K', 53, 4],
  ['Core i3-7100', 35, 2], ['Core i5-7400', 44, 4], ['Core i5-7500', 46, 4], ['Core i5-7600K', 51, 4], ['Core i7-7700', 54, 4], ['Core i7-7700K', 57, 4],
  ['Core i3-8100', 42, 4], ['Core i5-8400', 55, 6], ['Core i5-8600K', 60, 6], ['Core i7-8700', 63, 6], ['Core i7-8700K', 65, 6],
  ['Core i3-9100', 45, 4], ['Core i5-9400', 58, 6], ['Core i5-9600K', 63, 6], ['Core i7-9700K', 68, 8], ['Core i9-9900K', 70, 8],
  ['Core i3-10100', 50, 4], ['Core i5-10400', 62, 6], ['Core i5-10600K', 68, 6], ['Core i7-10700', 70, 8], ['Core i7-10700K', 73, 8], ['Core i9-10900K', 76, 10],
  ['Core i5-11400', 68, 6], ['Core i5-11600K', 73, 6], ['Core i7-11700K', 76, 8], ['Core i9-11900K', 78, 8],
  ['Core i3-12100', 68, 4], ['Core i5-12400', 74, 6], ['Core i5-12600K', 82, 10], ['Core i7-12700', 83, 12], ['Core i7-12700K', 86, 12], ['Core i9-12900K', 89, 16],
  ['Core i5-13400', 77, 10], ['Core i5-13600K', 89, 14], ['Core i7-13700K', 93, 16], ['Core i9-13900K', 96, 24],
  ['Core i5-14400', 79, 10], ['Core i5-14600K', 90, 14], ['Core i7-14700K', 95, 20], ['Core i9-14900K', 97, 24],
  ['Core Ultra 5 245K', 86, 14], ['Core Ultra 7 265K', 90, 20], ['Core Ultra 9 285K', 92, 24],
  // Intel laptop
  ['Core i5-8250U', 30, 4], ['Core i7-8550U', 32, 4], ['Core i7-8750H', 48, 6], ['Core i5-10210U', 34, 4], ['Core i7-10750H', 55, 6],
  ['Core i5-1135G7', 45, 4], ['Core i7-1165G7', 48, 4], ['Core i5-11400H', 60, 6], ['Core i7-11800H', 66, 8],
  ['Core i5-1235U', 50, 10], ['Core i7-1255U', 52, 10], ['Core i5-12500H', 68, 12], ['Core i7-12650H', 72, 10], ['Core i7-12700H', 74, 14],
  ['Core i5-13420H', 66, 8], ['Core i5-13500H', 70, 12], ['Core i7-13620H', 74, 10], ['Core i7-13700H', 77, 14], ['Core i9-13900H', 80, 14],
  ['Core i5-13450HX', 78, 10], ['Core i7-13650HX', 85, 14], ['Core i9-13980HX', 92, 24],
  ['Core i7-14650HX', 86, 16], ['Core i7-14700HX', 89, 20], ['Core i9-14900HX', 93, 24],
  ['Core Ultra 5 125H', 66, 14], ['Core Ultra 9 185H', 73, 16], ['Core Ultra 7 258V', 68, 8], ['Core Ultra 9 275HX', 92, 24],
  // AMD desktop
  ['Phenom II X4 965', 20, 4], ['FX-4300', 20, 4], ['FX-6300', 24, 6], ['FX-8320', 27, 8], ['FX-8350', 29, 8],
  ['Ryzen 3 1200', 38, 4], ['Ryzen 5 1400', 42, 4], ['Ryzen 5 1600', 47, 6], ['Ryzen 5 1600X', 49, 6], ['Ryzen 7 1700', 49, 8], ['Ryzen 7 1800X', 52, 8],
  ['Ryzen 3 2200G', 42, 4], ['Ryzen 5 2400G', 45, 4], ['Ryzen 5 2600', 52, 6], ['Ryzen 5 2600X', 54, 6], ['Ryzen 7 2700', 54, 8], ['Ryzen 7 2700X', 56, 8],
  ['Ryzen 3 3100', 52, 4], ['Ryzen 3 3300X', 58, 4], ['Ryzen 5 3400G', 47, 4], ['Ryzen 5 3600', 62, 6], ['Ryzen 5 3600X', 63, 6],
  ['Ryzen 7 3700X', 64, 8], ['Ryzen 7 3800X', 65, 8], ['Ryzen 9 3900X', 66, 12], ['Ryzen 9 3950X', 67, 16],
  ['Ryzen 5 4600G', 60, 6], ['Ryzen 5 5500', 66, 6], ['Ryzen 5 5600G', 68, 6], ['Ryzen 5 5600', 74, 6], ['Ryzen 5 5600X', 76, 6],
  ['Ryzen 7 5700G', 70, 8], ['Ryzen 7 5700X', 77, 8], ['Ryzen 7 5800X', 78, 8], ['Ryzen 9 5900X', 79, 12], ['Ryzen 9 5950X', 80, 16],
  ['Ryzen 5 5600X3D', 83, 6], ['Ryzen 7 5700X3D', 84, 8], ['Ryzen 7 5800X3D', 87, 8],
  ['Ryzen 5 7600', 85, 6], ['Ryzen 5 7600X', 87, 6], ['Ryzen 7 7700', 88, 8], ['Ryzen 7 7700X', 89, 8], ['Ryzen 9 7900X', 89, 12], ['Ryzen 9 7950X', 91, 16],
  ['Ryzen 9 7900X3D', 95, 12], ['Ryzen 7 7800X3D', 100, 8], ['Ryzen 9 7950X3D', 99, 16], ['Ryzen 5 8600G', 78, 6], ['Ryzen 7 8700G', 80, 8],
  ['Ryzen 5 9600', 88, 6], ['Ryzen 5 9600X', 90, 6], ['Ryzen 7 9700X', 92, 8], ['Ryzen 9 9900X', 92, 12], ['Ryzen 9 9950X', 94, 16],
  ['Ryzen 9 9900X3D', 103, 12], ['Ryzen 9 9950X3D', 108, 16], ['Ryzen 7 9800X3D', 110, 8],
  // AMD laptop and handheld
  ['Ryzen 5 3500U', 30, 4], ['Ryzen 7 3750H', 36, 4], ['Ryzen 5 4500U', 45, 6], ['Ryzen 5 4600H', 52, 6], ['Ryzen 7 4800H', 55, 8],
  ['Ryzen 5 5500U', 50, 6], ['Ryzen 7 5700U', 52, 8], ['Ryzen 5 5600H', 62, 6], ['Ryzen 7 5800H', 66, 8], ['Ryzen 9 5900HX', 70, 8],
  ['Ryzen 7 6800H', 70, 8], ['Ryzen 9 6900HX', 72, 8], ['Ryzen 5 7530U', 55, 6], ['Ryzen 5 7535HS', 66, 6], ['Ryzen 7 7735HS', 70, 8],
  ['Ryzen 7 7840U', 70, 8], ['Ryzen 7 7840HS', 78, 8], ['Ryzen 9 7940HS', 80, 8], ['Ryzen 9 7945HX', 90, 16],
  ['Ryzen 7 8845HS', 79, 8], ['Ryzen 9 8945HS', 81, 8], ['Ryzen 9 9955HX', 98, 16],
  ['Ryzen AI 7 350', 76, 8], ['Ryzen AI 9 HX 370', 82, 12], ['Ryzen AI Max+ 395', 85, 16], ['Ryzen Z1 Extreme', 70, 8],
];
export const CPUS = CPU_ROWS.map(([name, score, cores]) => ({ name, score, cores }));

export const normalize = text => String(text ?? '').toLowerCase()
  .replace(/®|™|\(r\)|\(tm\)/g, ' ')
  .replace(/\bwith radeon graphics\b|\b(?:nvidia|geforce|amd|radeon|intel|graphics|processor|[a-z0-9]+-core)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();

// Matching key: also forgives the spellings requirement lines use ("GTX960", "i5 4460", "Intel i5-4460", "i5-12400F").
const key = text => normalize(text).replace(/-/g, ' ')
  .replace(/(?<![a-z0-9])([a-z]{2,})(?=\d)/g, '$1 ')   // gtx960 -> gtx 960
  .replace(/\bcore\b/g, ' ')                           // "Intel i5" and "Intel Core i5" mean the same part
  .replace(/(\d{4,5}[a-z]?)f\b/g, '$1')                // F only drops the iGPU: 12400f -> 12400, 13700kf -> 13700k
  .replace(/\s+/g, ' ').trim();

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bounded = src => new RegExp(`(?<![a-z0-9])${src}(?![a-z0-9])`, 'g');
const index = list => list.map(item => ({ item, re: bounded(esc(key(item.name))) }));
const GPU_INDEX = index(GPUS), CPU_INDEX = index(CPUS);

const hits = (k, idx) => idx.flatMap(({ item, re }) => [...k.matchAll(re)].map(m => ({ at: m.index, len: m[0].length, item })));

// Every part in order of appearance; where matches overlap, the longest (most specific) wins.
function scan(hitList) {
  const out = [];
  let end = -1;
  for (const h of hitList.sort((a, b) => a.at - b.at || b.len - a.len || a.rank - b.rank)) {
    if (h.at < end) continue;
    end = h.at + h.len;
    if (!out.some(o => o.name === h.item.name)) out.push(h.item);
  }
  return out;
}
const longest = hitList => hitList.reduce((best, h) => (!best || h.len > best.len || (h.len === best.len && h.rank < best.rank) ? h : best), null)?.item ?? null;

// Family rule for modern CPUs missing from the table: tier + generation -> a Core i5 / Ryzen 5 base, then tier and suffix factors.
// ponytail: naive per-generation bases, add the model to CPU_ROWS when one is noticeably off
const TIER = { 3: 0.8, 5: 1, 7: 1.08, 9: 1.12 };
const CORES = { 3: 4, 5: 6, 7: 8, 9: 12 };
const INTEL_BASE = { 2: 30, 3: 34, 4: 37, 5: 39, 6: 41, 7: 45, 8: 55, 9: 58, 10: 62, 11: 68, 12: 74, 13: 77, 14: 79 };
const ULTRA_BASE = { 1: 74, 2: 78 };
const RYZEN_BASE = { 1: 47, 2: 52, 3: 62, 4: 64, 5: 74, 6: 76, 7: 85, 8: 85, 9: 90 };
function suffixFactor(sfx) {
  if (sfx.startsWith('hx')) return 0.98;
  if (sfx.startsWith('h')) return 0.88;                // H, HS, HK
  if (sfx.startsWith('p') || sfx.startsWith('v')) return 0.78;
  if (/^[ugy]/.test(sfx)) return 0.7;                  // U, Ice/Tiger Lake G7, Y (Ryzen G is handled before this)
  if (sfx.startsWith('k')) return 1.07;
  return 1;
}
const FAMILIES = [
  { re: bounded('i([3579]) (\\d{4,5})([a-z]{0,2}\\d?)'), make: ([, t, num, sfx]) => {
    // Five digits, or four starting with 1 (1065G7, 1235U), carry a two-digit generation.
    const gen = num.length === 5 || num[0] === '1' ? +num.slice(0, 2) : +num[0];
    return INTEL_BASE[gen] && { name: `Core i${t}-${num}${sfx.toUpperCase()}`, score: INTEL_BASE[gen] * TIER[t] * suffixFactor(sfx), cores: CORES[t] };
  } },
  { re: bounded('ultra ([579]) (\\d)(\\d\\d)([a-z]{0,2})'), make: ([, t, series, rest, sfx]) =>
    ULTRA_BASE[series] && { name: `Core Ultra ${t} ${series}${rest}${sfx.toUpperCase()}`, score: ULTRA_BASE[series] * TIER[t] * suffixFactor(sfx), cores: CORES[t] + 6 } },
  { re: bounded('ryzen ([3579]) (?:pro )?(\\d)(\\d)(\\d\\d)([a-z0-9]{0,3})'), make: ([, t, g, arch, rest, sfx]) => {
    const gen = +g, laptop = /^[hu]/.test(sfx);
    let base = RYZEN_BASE[gen];
    if (gen === 3 && sfx && !sfx.startsWith('x')) base = 52;   // 3xxxG/U/H are Zen+
    if (gen === 7 && laptop && +arch < 4) base = 70;           // 7x20/7x30/7x35 laptops are Zen 2/3
    const f = sfx === 'x3d' ? 1.15 : sfx.startsWith('x') ? 1.02 : sfx.startsWith('g') ? 0.92 : suffixFactor(sfx);
    return base && { name: `Ryzen ${t} ${g}${arch}${rest}${sfx.toUpperCase()}`, score: base * TIER[t] * f, cores: CORES[t] };
  } },
];
const familyHits = k => FAMILIES.flatMap(({ re, make }) =>
  [...k.matchAll(re)].map(m => ({ at: m.index, len: m[0].length, item: make(m), rank: 1 })).filter(h => h.item));

const gpuHits = text => hits(key(text), GPU_INDEX).map(h => ({ ...h, rank: 0 }));
const cpuHits = text => { const k = key(text); return [...hits(k, CPU_INDEX).map(h => ({ ...h, rank: 0 })), ...familyHits(k)]; };

export const matchGpu = text => longest(gpuHits(text));
export const matchCpu = text => longest(cpuHits(text));
export const gpusIn = text => scan(gpuHits(text));
export const cpusIn = text => scan(cpuHits(text));

// Hybrid laptops list the iGPU first: take the strongest recognised adapter, else the one with the most dedicated memory.
export function pickGpu(gpus) {
  const real = (gpus ?? []).filter(g => !/basic render|basic display/i.test(g.name ?? ''))
    .map(g => ({ g, gpu: matchGpu(g.name) }));
  const matched = real.filter(r => r.gpu).sort((a, b) => b.gpu.score - a.gpu.score)[0];
  const best = matched ?? real.sort((a, b) => (b.g.dedicated || 0) - (a.g.dedicated || 0))[0];
  return best ? { gpu: best.gpu, name: best.g.name, vramBytes: best.g.dedicated || 0 } : { gpu: null, name: null, vramBytes: 0 };
}
