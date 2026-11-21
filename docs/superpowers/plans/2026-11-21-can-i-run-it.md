# Can I Run It? Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Can I Run It?" tab under Dashboard with a Gaming | AI toggle that estimates how well this PC runs any Steam game or any Hugging Face model.

**Architecture:** Pure estimation modules (`ui/estimate-game.js`, `ui/estimate-ai.js`) plus a hand-maintained hardware table (`ui/data/hardware.js`), all unit-tested with `node --test`. The host (`Web.cs`) makes every web request; the page asks over the existing JSON bridge with a term or an ID, never a URL. One view module (`ui/views/canirun.js`) owns the toggle and delegates to a Gaming and an AI sub-view.

**Tech Stack:** .NET 10 WinForms + WebView2 host (`HttpClient`, `System.Text.Json.Nodes`), vanilla ES modules, Tokenscope CSS components, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-21-can-i-run-it-design.md`. Read it with this plan; the plan doesn't repeat its rationale.

## Global Constraints

- Paths below are relative to the repo root `Y:\Programs\System Performance`; the app lives in `src/SystemPerformance/`.
- No new NuGet or npm packages. UI is plain ES modules imported by relative path; tests are `tests/*.test.mjs` importing `../src/SystemPerformance/ui/...`.
- The page never supplies a URL. The host builds every URL, only for `store.steampowered.com` and `huggingface.co`.
- CSP: widen only `img-src` to `'self' data: https://*.steamstatic.com`. `connect-src` stays `'self'`.
- Nothing about this PC is sent anywhere: requests carry only the search text, a Steam app ID or a Hugging Face repo ID.
- Every estimate is shown as a range with its basis. FPS above 300 shows as "300+".
- Tab title exactly `Can I Run It?`, id `canirun`, second in `ALL_VIEWS` (right after `dashboard`). Toggle labels exactly `Gaming` and `AI`.
- New privacy copy, used in both the Settings → This PC footer and the README bullet: "Only searches you type in Can I Run It? go to Steam (and its image servers) or Hugging Face."
- Views never import `bridge.js`; they call `ctx.actions.*` (existing pattern in `ui/app.js`).
- UI uses existing Tokenscope components (`ts-card`, `ts-field`, `ts-field--search`, `select.ts-field-input`, `ts-field-message` with `aria-invalid`, `ts-segmented`, `ts-list`, `ts-row`, `ts-stackbar`, `ts-badge`, `empty()`, `ts-skeleton`) before adding CSS to `ui/design/app.css`.
- Test command: `node --test "tests/*.test.mjs"` (from the repo root). Full build: `./build.ps1` (runs tests, publishes to `dist/`, runs self-check). If `dist/SystemPerformance.exe` is locked because the user's copy is running, build with `dotnet build src/SystemPerformance -c Release` instead and say so.

## Review Focus

1. **Out-of-order search replies:** typing "elden" quickly fires several searches, and an older reply can arrive last. Only the latest search's results may show. Pinned by `latestOnly` in Task 6.
2. **Hybrid laptops:** the inventory lists the iGPU first and the RTX second. Estimates must use the strongest GPU, not the first, and must skip "Microsoft Basic Render Driver". Pinned by `pickGpu` in Task 1.
3. **Steam requirement HTML in odd shapes:** a plain-text blob with no `<li>`, labels like "Video Card:", "Graphics Card:" or "CPU:", and minimum and recommended in one string. These must still parse. Pinned in Task 2.
4. **Shorthand resolutions:** "1440p", "4K" and "3440 x 1440 @ 144Hz" must parse to the right size. Pinned in Task 2.
5. **Models with no GGUF and no parameter count** (only `.safetensors` or `.bin` files): show sizes estimated from the file total, or say there's no size information. Never show an empty picker or NaN. Pinned in Task 3.

---

### Task 1: Hardware table and matching

**Files:**
- Create: `src/SystemPerformance/ui/data/hardware.js`
- Test: `tests/hardware.test.mjs`

**Interfaces:**
- Produces:
  - `type Gpu = { name: string, score: number, vram: number /*GB*/, bw: number /*GB/s*/, up: 'DLSS'|'FSR'|'XeSS', igpu: boolean }`
  - `type Cpu = { name: string, score: number, cores: number }`
  - `GPUS: Gpu[]`, `CPUS: Cpu[]`
  - `normalize(text: string): string`: lower-case; strips ®, ™, (R), (TM), "NVIDIA", "GeForce", "AMD", "Radeon", "Intel", "Graphics", "Processor", "with Radeon Graphics", "x-Core"; collapses whitespace.
  - `matchGpu(text: string): Gpu | null` and `matchCpu(text: string): Cpu | null`: the single most specific match (longest entry name wins).
  - `gpusIn(text: string): Gpu[]` and `cpusIn(text: string): Cpu[]`: every distinct part mentioned in one requirement line, in order of appearance.
  - `pickGpu(gpus: {name: string, dedicated: number}[]): { gpu: Gpu|null, name: string|null, vramBytes: number }`: the inventory adapter with the highest matched score. If none match, the one with the most dedicated memory. Skips names containing "Basic Render" or "Basic Display".

- [ ] **Step 1: Write the failing tests** in `tests/hardware.test.mjs`:

```js
test('gpu names from Windows match the most specific entry', () => {
  assert.equal(matchGpu('NVIDIA GeForce RTX 4070 Laptop GPU').name, 'RTX 4070 Laptop');
  assert.equal(matchGpu('NVIDIA GeForce RTX 4070 Ti SUPER').name, 'RTX 4070 Ti Super');
  assert.equal(matchGpu('NVIDIA GeForce RTX 4070').name, 'RTX 4070');
  assert.equal(matchGpu('AMD Radeon RX 6700 XT').name, 'RX 6700 XT');
  assert.equal(matchGpu('Intel(R) Iris(R) Xe Graphics').name, 'Iris Xe');
  assert.equal(matchGpu('AMD Radeon(TM) 780M').name, 'Radeon 780M');
  assert.equal(matchGpu('Intel(R) Arc(TM) B580 Graphics').name, 'Arc B580');
  assert.equal(matchGpu('Microsoft Basic Display Adapter'), null);
});
test('requirement lines list every gpu and cpu they mention', () => {
  assert.deepEqual(gpusIn('NVIDIA® GeForce® GTX 1060 6GB / AMD Radeon™ RX 580 8GB or better').map(g => g.name), ['GTX 1060', 'RX 580']);
  assert.deepEqual(gpusIn('GeForce GTX 970 or Radeon R9 290').map(g => g.name), ['GTX 970', 'R9 290']);
  assert.deepEqual(cpusIn('Intel Core i5-4460 or AMD FX-6300').map(c => c.name), ['Core i5-4460', 'FX-6300']);
  assert.deepEqual(cpusIn('Intel Core i7-8700 / AMD Ryzen 5 3600').map(c => c.name), ['Core i7-8700', 'Ryzen 5 3600']);
});
test('cpu names from Windows resolve', () => {
  assert.equal(matchCpu('AMD Ryzen 7 5800X3D 8-Core Processor').name, 'Ryzen 7 5800X3D');
  assert.equal(matchCpu('13th Gen Intel(R) Core(TM) i7-13700K').name, 'Core i7-13700K');
  assert.ok(matchCpu('12th Gen Intel(R) Core(TM) i5-12450H'));        // family rule covers models not listed
  assert.ok(matchCpu('Intel(R) Core(TM) Ultra 7 155H'));
  assert.ok(matchCpu('AMD Ryzen 5 7640HS w/ Radeon 760M Graphics'));
});
test('reference orderings hold', () => {
  const s = n => matchGpu(n).score;
  const desc = names => names.forEach((n, i) => i && assert.ok(s(names[i - 1]) > s(n), `${names[i - 1]} > ${n}`));
  desc(['RTX 4090', 'RTX 4080', 'RTX 3090', 'RTX 3080', 'RTX 2080 Ti', 'GTX 1080 Ti', 'GTX 1060']);
  desc(['RX 7900 XTX', 'RX 6800 XT', 'RX 5700 XT', 'RX 580']);
  const near = (a, b) => assert.ok(Math.abs(s(a) / s(b) - 1) <= 0.15, `${a} ≈ ${b}`);
  near('RTX 3060', 'RX 6600 XT'); near('GTX 1060', 'RX 580');
  assert.equal(matchGpu('RTX 4090').score, 100);
});
test('pickGpu prefers the strongest adapter', () => {
  const r = pickGpu([{ name: 'Intel(R) UHD Graphics 770', dedicated: 128e6 }, { name: 'NVIDIA GeForce RTX 4060 Laptop GPU', dedicated: 8e9 }, { name: 'Microsoft Basic Render Driver', dedicated: 0 }]);
  assert.equal(r.gpu.name, 'RTX 4060 Laptop'); assert.equal(r.vramBytes, 8e9);
  assert.equal(pickGpu([{ name: 'Mystery GPU', dedicated: 4e9 }]).gpu, null);
});
```

- [ ] **Step 2: Run** `node --test tests/hardware.test.mjs`. Expect FAIL (module not found).
- [ ] **Step 3: Write `ui/data/hardware.js`.** About 200 GPUs: NVIDIA GTX 900 through RTX 50, desktop and Laptop variants; AMD RX 400 through RX 9000, plus R9 290/390, R7 370 and Vega 56/64; Intel Arc A and B; iGPUs UHD 620/630/730/770, Iris Xe, Arc iGPU, Radeon Vega 8, 680M, 760M, 780M, 880M, 890M. Raster scores on a scale where RTX 4090 = 100, from published relative-performance charts. VRAM in GB, bandwidth in GB/s. `up` is 'DLSS' for RTX, 'XeSS' for Arc, else 'FSR'. `igpu` is true for integrated parts.
  - CPUs: about 150 named models (common requirement CPUs such as i5-2500K, i5-4460, i7-4770, i5-6600K, i7-8700, FX-6300, FX-8350, Ryzen 5 1600/2600/3600, plus current desktop and laptop parts), with a gaming score where Ryzen 7 7800X3D = 100.
  - A family rule for unlisted modern CPUs: parse Intel `Core iN-GGxxx[suffix]`, `Core Ultra N NNN` and AMD `Ryzen N GXXX[suffix]` into tier + generation, and score them from a per-generation base. Laptop suffixes (H, HS, HX, U, P) adjust the score.
  - Add a `// ponytail: hand-maintained table, refresh when new hardware ships` comment at the top.
- [ ] **Step 4: Run** `node --test tests/hardware.test.mjs`. Expect PASS.
- [ ] **Step 5: Commit** `git add src/SystemPerformance/ui/data/hardware.js tests/hardware.test.mjs && git commit -m "Can I Run It: GPU/CPU performance table and matching"`

---

### Task 2: Game estimation (resolution, requirements, FPS) and non-Steam games

**Files:**
- Create: `src/SystemPerformance/ui/estimate-game.js`, `src/SystemPerformance/ui/data/games.js`
- Test: `tests/estimate-game.test.mjs`

**Interfaces:**
- Consumes: `matchGpu`, `gpusIn`, `cpusIn`, `Gpu`, `Cpu` from Task 1.
- Produces:
  - `ASPECTS = ['16:9', '16:10', '21:9', '32:9', '4:3']`; `RESOLUTIONS: Record<aspect, [w, h][]>` (values as in the spec).
  - `parseResolution(text): {w, h} | null`: accepts `2560x1440`, `2560 × 1440`, `2560*1440` and `2560 x 1440 @ 144Hz` (ignores everything after the size), plus shorthand 720p, 1080p, 1440p, 2160p/4K (16:9) and 5K (5120×2880). Both sides must be in 320..15360.
  - `aspectOf(w, h): string`: the named aspect if within 3% (1366×768 → '16:9', 3440×1440 → '21:9', 2560×1080 → '21:9'), else the reduced 'a:b'.
  - `parseAspect(text): string | null`: 'a:b' or 'a/b' → snapped like `aspectOf`.
  - `type Spec = { gpus: Gpu[], cpus: Cpu[], ramGb: number|null, vramGb: number|null, gpuText: string|null, cpuText: string|null }`
  - `parseRequirements(html: string): Spec`
  - `type Pc = { gpu: Gpu|null, cpu: Cpu|null, ramGb: number, vramGb: number }`
  - `estimateGame({ min: Spec|null, rec: Spec|null, pc: Pc, res: {w, h}, target: number }) → { verdict: 'below'|'playable'|'well'|'great'|'unknown', checks: { gpu, cpu, ram, vram: 'pass'|'fail'|'unknown' }, presets: { name: 'Low'|'Medium'|'High'|'Ultra', fps: number, lo: number, hi: number, capped: boolean, vramLimited: boolean }[] | null, suggested: string | null, upscaled: { tech: string, fps: number } | null }`
  - `GAMES` (in `data/games.js`): `{ id: string /*'ns:valorant'*/, name: string, image: null, min: Spec-like, rec: Spec-like, source: string /*publisher URL*/ }[]`. Spec-like means `{ gpu: string, cpu: string, ramGb, vramGb }` text, turned into a `Spec` with `specFromText(entry)` exported from `estimate-game.js`.
- Constants block at the top of `estimate-game.js` (spec values):
  `REC_FPS = 60, MIN_TO_REC = 2.2, PRESETS = { Low: 1.8, Medium: 1.35, High: 1, Ultra: 0.75 }, RES_EXP = 0.75, CPU_HEADROOM = 1.5, BAND = 0.2, FPS_CAP = 300, UPSCALE = 0.67`.
- Model, in the spec's order:
  - `recScore` = mean of `rec.gpus` scores, else mean of `min.gpus` × `MIN_TO_REC`.
  - High at 1080p = `REC_FPS × pc.gpu.score / recScore`. Each preset multiplies by its factor, then by `(1920·1080 / (w·h)) ^ RES_EXP`.
  - CPU cap = `REC_FPS × pc.cpu.score / recCpu × CPU_HEADROOM`, with recCpu from rec, else min × `MIN_TO_REC`. No cap when either side is unknown.
  - fps = min(gpu, cap), clamped to `FPS_CAP` (`capped` = true when clamped). `lo` = fps × (1 − BAND), `hi` = fps × (1 + BAND).
  - `vramLimited` on High and Ultra when `pc.vramGb` < the requirement's VRAM (`rec.vramGb ?? min.vramGb`, from an explicit VRAM line or "NGB" in the graphics line). Limited presets are never suggested.
  - `suggested` = the highest non-limited preset with `lo ≥ target`.
  - `upscaled`: only when `suggested` is null: High fps × `(1 / UPSCALE²) ^ RES_EXP`, `tech = pc.gpu.up`.
  - Verdict: 'below' if `pc.ramGb < min.ramGb` or the pc GPU score is under the min GPU score. Else 'unknown' if `pc.gpu` is null. Else 'great' if High or Ultra reaches the target, 'well' if Low or Medium does, else 'playable'.
  - `checks`: each compares pc to rec, else min. 'unknown' when either side is missing.

- [ ] **Step 1: Write the failing tests** in `tests/estimate-game.test.mjs`, with inline helpers `const g = (score, vram = 8) => ({ name: 'G', score, vram, bw: 400, up: 'FSR', igpu: false })` and `const c = score => ({ name: 'C', score, cores: 8 })`. "GB" throughout means GiB (bytes / 2^30).

```js
test('resolution parsing and shorthand', () => {
  assert.deepEqual(parseResolution('2560 × 1440'), { w: 2560, h: 1440 });
  assert.deepEqual(parseResolution('3440 x 1440 @ 144Hz'), { w: 3440, h: 1440 });
  assert.deepEqual(parseResolution('1440p'), { w: 2560, h: 1440 });
  assert.deepEqual(parseResolution('4K'), { w: 3840, h: 2160 });
  assert.equal(parseResolution('banana'), null);
  assert.equal(parseResolution('10x10'), null);
  assert.equal(aspectOf(3440, 1440), '21:9'); assert.equal(aspectOf(1366, 768), '16:9'); assert.equal(aspectOf(1920, 1200), '16:10');
  assert.equal(parseAspect('21/9'), '21:9');
});
test('steam requirement html parses', () => {
  const html = '<strong>Minimum:</strong><br><ul class="bb_ul"><li><strong>OS:</strong> Windows 10<br></li><li><strong>Processor:</strong> Intel Core i5-4460 or AMD FX-6300<br></li><li><strong>Memory:</strong> 8 GB RAM<br></li><li><strong>Graphics:</strong> NVIDIA GeForce GTX 960 2GB or AMD Radeon R7 370 2GB<br></li></ul>';
  const s = parseRequirements(html);
  assert.equal(s.ramGb, 8); assert.equal(s.vramGb, 2);
  assert.deepEqual(s.gpus.map(g => g.name), ['GTX 960', 'R7 370']);
  assert.deepEqual(s.cpus.map(c => c.name), ['Core i5-4460', 'FX-6300']);
});
test('plain-text requirements and other labels parse', () => {
  const s = parseRequirements('Minimum: OS: Windows 10 CPU: Intel Core i7-8700 Memory: 16 GB RAM Video Card: GeForce RTX 2070 (8 GB VRAM) Storage: 70 GB');
  assert.equal(s.ramGb, 16); assert.equal(s.vramGb, 8); assert.deepEqual(s.gpus.map(g => g.name), ['RTX 2070']);
  assert.equal(parseRequirements('Graphics Card: GTX 1060').gpus[0].name, 'GTX 1060');
  assert.equal(parseRequirements('<li>Memory: 8 GB RAM</li>').gpus.length, 0);
});
test('recommended gpu at 1080p High is the 60 fps anchor', () => {
  const rec = { gpus: [g(40)], cpus: [c(50)], ramGb: 16, vramGb: 8 };
  const r = estimateGame({ min: null, rec, pc: { gpu: g(40), cpu: c(100), ramGb: 32, vramGb: 8 }, res: { w: 1920, h: 1080 }, target: 60 });
  assert.ok(Math.abs(r.presets.find(p => p.name === 'High').fps - 60) < 0.5);
});
test('higher resolution and preset lower fps; 1440p follows the exponent', () => {
  const base = { min: null, rec: { gpus: [g(40)], cpus: [], ramGb: 8, vramGb: null }, pc: { gpu: g(40), cpu: null, ramGb: 16, vramGb: 8 }, target: 60 };
  const at = res => estimateGame({ ...base, res }).presets;
  const p1080 = at({ w: 1920, h: 1080 }), p1440 = at({ w: 2560, h: 1440 }), p2160 = at({ w: 3840, h: 2160 });
  p1080.forEach((p, i) => { assert.ok(p.fps > p1440[i].fps && p1440[i].fps > p2160[i].fps); if (i) assert.ok(p1080[i - 1].fps > p.fps); });
  assert.ok(Math.abs(p1440.find(p => p.name === 'High').fps - 60 * (2073600 / 3686400) ** 0.75) < 0.5);
});
test('minimum-only games scale from min × 2.2', () => {
  const r = estimateGame({ min: { gpus: [g(20)], cpus: [], ramGb: 8, vramGb: null }, rec: null, pc: { gpu: g(44), cpu: null, ramGb: 16, vramGb: 8 }, res: { w: 1920, h: 1080 }, target: 60 });
  assert.ok(Math.abs(r.presets.find(p => p.name === 'High').fps - 60) < 0.5);
});
test('cap, cpu limit, vram limit, verdicts, upscaler', () => {
  const pc = (gs, cs = 100, ram = 32, vram = 24) => ({ gpu: g(gs, vram), cpu: c(cs), ramGb: ram, vramGb: vram });
  const rec = { gpus: [g(10)], cpus: [c(50)], ramGb: 8, vramGb: 4 };
  const r1 = estimateGame({ min: null, rec: { ...rec, cpus: [] }, pc: pc(100), res: { w: 1920, h: 1080 }, target: 60 });
  assert.ok(r1.presets.every(p => p.fps <= 300)); assert.ok(r1.presets[0].capped); assert.equal(r1.verdict, 'great');
  const r2 = estimateGame({ min: null, rec, pc: pc(100, 25), res: { w: 1920, h: 1080 }, target: 60 });
  assert.ok(r2.presets.every(p => p.fps <= 60 * 0.5 * 1.5 + 0.01));
  const r3 = estimateGame({ min: null, rec: { ...rec, vramGb: 12 }, pc: pc(100, 100, 32, 8), res: { w: 1920, h: 1080 }, target: 60 });
  assert.ok(r3.presets.find(p => p.name === 'Ultra').vramLimited); assert.notEqual(r3.suggested, 'Ultra'); assert.equal(r3.checks.vram, 'fail');
  const below = estimateGame({ min: { gpus: [g(10)], cpus: [], ramGb: 16, vramGb: null }, rec, pc: pc(50, 100, 8), res: { w: 1920, h: 1080 }, target: 60 });
  assert.equal(below.verdict, 'below');
  const slow = estimateGame({ min: null, rec: { gpus: [g(40)], cpus: [], ramGb: 8, vramGb: null }, pc: pc(20), res: { w: 3840, h: 2160 }, target: 60 });
  assert.equal(slow.suggested, null); assert.ok(slow.upscaled.fps > slow.presets.find(p => p.name === 'High').fps); assert.equal(slow.verdict, 'playable');
  const unknown = estimateGame({ min: null, rec, pc: { gpu: null, cpu: null, ramGb: 32, vramGb: 8 }, res: { w: 1920, h: 1080 }, target: 60 });
  assert.equal(unknown.presets, null); assert.equal(unknown.verdict, 'unknown');
});
test('built-in games have parseable specs', () => {
  for (const game of GAMES) { const s = specFromText(game.rec ?? game.min); assert.ok(s.gpus.length > 0, game.name); assert.ok(s.ramGb > 0, game.name); }
});
```

- [ ] **Step 2: Run** `node --test tests/estimate-game.test.mjs`. Expect FAIL.
- [ ] **Step 3: Implement `estimate-game.js`.** `parseRequirements` works on plain strings (no DOMParser; it must run in node). Replace `<br>`, `</li>` and `<li>` with newlines, strip the other tags, then match labels `Processor|CPU`, `Memory|RAM`, `Graphics|Video Card|Graphics Card|Video|GPU` and `VRAM|Video Memory` by regex up to the next known label or the end of the line.
- [ ] **Step 4: Write `data/games.js`.** Official min/rec specs for Valorant, League of Legends, Fortnite, Minecraft (Java), Roblox, Genshin Impact, Honkai: Star Rail, Zenless Zone Zero, World of Warcraft, Escape from Tarkov and Star Citizen, plus any similarly big title confirmed absent from Steam. Check each against its publisher page and Steam search (WebSearch/WebFetch). Drop any that turn out to be on Steam, and record the `source` URL.
- [ ] **Step 5: Run** `node --test tests/estimate-game.test.mjs`. Expect PASS.
- [ ] **Step 6: Commit** `git commit -m "Can I Run It: game requirement parsing and FPS estimate"` (estimate-game.js, games.js, the test).

---

### Task 3: AI estimation (quants, memory, speed)

**Files:**
- Create: `src/SystemPerformance/ui/estimate-ai.js`
- Test: `tests/estimate-ai.test.mjs`

**Interfaces:**
- Produces:
  - `quantOf(path: string): string | null`: upper-cased quant tag from a `.gguf` filename. Covers `Q2_K` … `Q8_0`, `Q4_K_M`, `IQ1_S` … `IQ4_XS`, `UD-Q4_K_XL`, `F16`, `BF16`, `F32`, `MXFP4`. Returns null for non-GGUF files.
  - `groupFiles(files: {path: string, size: number}[]): { quants: { tag: string, size: number, files: string[] }[], mmproj: { path: string, size: number }[] }`: sorts both by size ascending. Sums split `-0000N-of-0000M` parts and parts in subfolders into one tag. Any path containing "mmproj" goes to `mmproj`.
  - `synthQuants(params: number|null, safetensorsBytes: number): { tag: 'BF16'|'8-bit'|'4-bit', size: number }[]`: bytes per parameter 2.0, 1.07 and 0.57, with sizes rounded to whole bytes. When `params` is null, params = safetensorsBytes / 2. Returns `[]` when both are empty.
  - `readConfig(json): { layers, kvHeads, headDim, maxCtx, activeParams: number|null } | null`: reads HF `config.json`, falling back to `text_config` (multimodal). `kvHeads` = `num_key_value_heads ?? num_attention_heads`; `headDim` = `head_dim ?? hidden_size / num_attention_heads`; `maxCtx` = `max_position_embeddings`. `activeParams` is null unless the config gives an expert layout (`num_experts_per_tok` with `num_local_experts` or `num_experts`), estimated proportionally.
  - `kvBytes(cfg, ctx: number, params: number|null): { bytes: number, heuristic: boolean }`: exact when there's a config, = `2 × layers × kvHeads × headDim × ctx × 2`. Otherwise heuristic: `ctx × 48 KiB × (params/1e9) ^ 0.45`.
  - `ramBandwidth(modules: {configuredMts, ratedMts}[]): number` (GB/s): `channels × MT/s × 8 / 1000`, with channels = min(module count, 2), at least 1, and MT/s = configured ?? rated ?? 3200.
  - `type AiPc = { vramBytes: number, ramBytes: number, gpuBw: number|null, ramBw: number, igpu: boolean }`
  - `estimateModel({ weights, mmproj, kv, activeFraction = 1, pc: AiPc }) → { where: 'vram'|'split'|'ram'|'none', gpuShare: number, need: number, tps: {mid, lo, hi} | null }`
- Constants (spec values): `OVERHEAD = 0.8 GiB, VRAM_MARGIN = 0.5 GiB, OS_RESERVE = 4 GiB, EFF = 0.6, BAND = 0.25`.
  - `need` = weights + mmproj + kv + OVERHEAD.
  - `gpuMem` = igpu ? 0 : vramBytes − VRAM_MARGIN; `ramMem` = ramBytes − OS_RESERVE.
  - where: 'vram' if gpuMem > 0 and need ≤ gpuMem; 'split' if gpuMem > 0 and need ≤ gpuMem + ramMem (gpuShare = gpuMem / need); 'ram' if gpuMem ≤ 0 and need ≤ ramMem; else 'none'.
  - Per-token bytes B = weights × activeFraction.
  - Bandwidths are GB/s (× 1e9 for bytes/s); weights, mmproj, kv and memory sizes are bytes.
  - tps: 'vram' → EFF × gpuBw / B; 'split' → EFF / (s·B/gpuBw + (1−s)·B/ramBw); 'ram' → EFF × ramBw / B (an iGPU uses ramBw). `null` when 'none', or when a GPU is involved and `gpuBw` is null. lo/hi = mid × (1 ∓ BAND).

- [ ] **Step 1: Write the failing tests** in `tests/estimate-ai.test.mjs`:

```js
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
```

- [ ] **Step 2: Run** `node --test tests/estimate-ai.test.mjs`. Expect FAIL.
- [ ] **Step 3: Implement `estimate-ai.js`.**
- [ ] **Step 4: Run** `node --test tests/estimate-ai.test.mjs`. Expect PASS.
- [ ] **Step 5: Commit** `git commit -m "Can I Run It: model memory and speed estimate"`

---

### Task 4: Host web requests, bridge, demo data, privacy copy

**Files:**
- Create: `src/SystemPerformance/Web.cs`
- Modify: `src/SystemPerformance/MainForm.cs` (the `Csp` constant at line 16; new cases in `OnWebMessage`'s switch)
- Modify: `src/SystemPerformance/Program.cs` (new CLI mode beside `--inventory`)
- Modify: `src/SystemPerformance/ui/bridge.js`, `src/SystemPerformance/ui/demo.js`, `src/SystemPerformance/ui/app.js` (an `actions.web` entry only), `src/SystemPerformance/ui/views/settings.js` (This PC footer), `README.md` (the "Private and portable" bullet)

**Interfaces:**
- Produces, in the host (`static class Web`; each method returns the reply's `data` as a JSON string and throws `WebError(string message)` on bad input or a failed request):
  - `Task<string> Call(string type, JsonElement msg)`: dispatches the types below; unknown type → `WebError("unknown request")`.
    - `gameSearch {term}` → `[{ id: number, name, image }]`, from `storesearch/?term=…&l=english&cc=US`, keeping items where `platforms.windows` is true. `image` = `tiny_image`.
    - `gameDetails {appId}` → `{ name, type, image, released, min, rec }` (requirement HTML strings, or null), from `appdetails?appids=…&l=english`.
    - `modelSearch {term}` → `[{ id, downloads, likes, task }]`, from `/api/models?search=…&sort=downloads&limit=20`.
    - `modelInfo {id}` → `{ id, task, downloads, likes, params, ctx, baseModel, gated }`, from `/api/models/{id}`. `params` = `safetensors.total ?? gguf.total`; `ctx` = `gguf.context_length`; `baseModel` = `cardData.base_model` (first entry if it's an array).
    - `modelFiles {id}` → `[{ path, size }]`, from `/api/models/{id}/tree/main?recursive=true` (files only; size = `lfs.size ?? size`).
    - `modelConfig {id}` → the repo's `config.json` object, or `null` on 404, from `/{id}/resolve/main/config.json`.
    - `modelGguf {id}` → `[{ id, downloads }]`, from `/api/models?filter=base_model:quantized:{id}&sort=downloads&limit=20`. The builder confirms against the live API that it filters as expected; if it doesn't, use `search={name}&filter=gguf`.
  - Validation: `term` trimmed, 1..100 chars, sent through `Uri.EscapeDataString`. `appId` must match `^\d{1,10}$`. `id` must match `^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9._-]+$` and be ≤ 96 chars. Anything else → `WebError("bad request")`.
  - Error messages are exactly: "offline" (`HttpRequestException` without a status code), "timeout" (`TaskCanceledException`) and "http <code>".
  - One static `HttpClient`, 10 s timeout, `User-Agent: SystemPerformance/<assembly version>`. A per-session `ConcurrentDictionary<string, string>` cache keyed by URL caches successes only.
- MainForm: one case group, `case "gameSearch" or "gameDetails" or "modelSearch" or "modelInfo" or "modelFiles" or "modelConfig" or "modelGguf":`. It does `try { Reply(id, true, data: await Web.Call(type, msg)); } catch (WebError ex) { Reply(id, false, error: ex.Message); }`.
- Program.cs: `--web <type> <arg>` prints the reply data, or `error: <message>`. The arg is the term, app ID or repo ID.
- Page: `bridge.web(type: string, payload: object): Promise<{ ok: boolean, data?: any, error?: string }>`. In the preview it returns `demoWeb(type, payload)` after ~300 ms.
- `demo.js`:
  - `demoWeb` serves canned replies for every type: a search returning 3 Steam games plus no hits for "zzz", real-shaped requirement HTML, a model search, one GGUF repo with 4 quants, 2 split parts and one mmproj, one safetensors-only repo, and a config.
  - Also change `demoInventory` GPU name to `'NVIDIA GeForce RTX 4070'` (12 GB) so the preview produces estimates.
- `app.js`: `actions.web = (type, payload) => bridge.web(type, payload)`.

- [ ] **Step 1: Build check before changes:** `dotnet build src/SystemPerformance -c Release`. Expect success (the baseline).
- [ ] **Step 2: Implement `Web.cs`, the MainForm case and the CSP change, and the Program.cs mode.**
- [ ] **Step 3: Live check.** Run `dotnet build src/SystemPerformance -c Release`, then run the built exe (WinExe: `Start-Process -Wait -RedirectStandardOutput <scratch>/out.txt`, as the existing `--sample` checks do) with each of:
  - `--web gameSearch "elden ring"`: expect a JSON array containing `"name":"ELDEN RING"`.
  - `--web gameDetails 1245620`: expect a non-null `"min"` containing `Minimum` (System.Text.Json may escape `<` as `<`).
  - `--web modelSearch qwen3`: expect a non-empty array.
  - `--web modelFiles unsloth/Qwen3-8B-GGUF`: expect paths ending `.gguf`.
  - `--web modelConfig Qwen/Qwen3-8B`: expect `"num_hidden_layers"`.
  - `--web gameDetails "../x"`: expect `error: bad request`.
- [ ] **Step 4: Implement `bridge.web`, `demoWeb`, the demo GPU rename, `actions.web` and the privacy copy** (exact text from Global Constraints).
- [ ] **Step 5: Run** `node --test "tests/*.test.mjs"`. Expect all PASS (existing tests untouched).
- [ ] **Step 6: Commit** `git commit -m "Can I Run It: host web requests for Steam and Hugging Face"`

---

### Task 5: Combo box component

**Files:**
- Modify: `src/SystemPerformance/ui/kit.js` (new export), `src/SystemPerformance/ui/design/app.css` (styles)
- Test: `tests/combo.test.mjs` (the pure filter/commit logic only)

**Interfaces:**
- Produces:
  - `combo({ label: string, value: string, options: string[], parse: (text) => any | null, onChange: (parsed, text) => void }) → { el: HTMLElement, setOptions(options: string[]): void, setValue(text: string): void }`
  - Markup: `.ts-field.ts-combo > input.ts-field-input[role=combobox][aria-expanded][aria-controls] + button.ts-combo-toggle[aria-label="Show options"] + ul.ts-combo-list[role=listbox] > li[role=option]`, followed by `p.ts-field-message` ("Not a valid value").
  - Behaviour:
    - The toggle button opens the full option list, whatever is typed. Typing filters the list by substring.
    - ArrowUp/ArrowDown move the active option, Enter commits the active option or the typed text, Escape closes, and blur commits.
    - On commit, `parse(text)` null → `aria-invalid="true"` and `onChange` is not called. Otherwise clear the invalid state and call `onChange(parsed, text)`.
  - `comboCommit(text: string, parse) → { ok: boolean, value: any }`, exported for the test.

- [ ] **Step 1: Write the failing test:**

```js
test('combo commit validates through parse', () => {
  const parse = t => (/^\d+$/.test(t.trim()) ? Number(t) : null);
  assert.deepEqual(comboCommit(' 60 ', parse), { ok: true, value: 60 });
  assert.deepEqual(comboCommit('sixty', parse), { ok: false, value: null });
});
```

`kit.js` imports `dom.js`, which touches `document` only inside functions; if importing it in node fails, put `comboCommit` in `ui/combo-logic.js` and re-export it from `kit.js`.

- [ ] **Step 2: Run** `node --test tests/combo.test.mjs`. Expect FAIL.
- [ ] **Step 3: Implement `combo` and `comboCommit`, plus `.ts-combo*` styles** with Tokenscope tokens: the list floats under the field with `--color-bg-2`, `--radius-*` and `--shadow-*` tokens from `design/tokens.css`, and the active option gets the tint.
- [ ] **Step 4: Run** `node --test "tests/*.test.mjs"`. Expect PASS.
- [ ] **Step 5: Commit** `git commit -m "Kit: combo box (dropdown + type-in)"`

---

### Task 6: Tab shell and Gaming view

**Files:**
- Create: `src/SystemPerformance/ui/views/canirun.js`, `src/SystemPerformance/ui/views/canirun-gaming.js`, `src/SystemPerformance/ui/views/canirun-shared.js`
- Modify: `src/SystemPerformance/ui/app.js` (import; `ALL_VIEWS = [dashboard, canirun, cpuView, …]`), `src/SystemPerformance/ui/metrics.js` (`DEFAULTS` + `parseSettings`), `src/SystemPerformance/ui/kit.js` (a `gauge` icon in `ICONS`), `src/SystemPerformance/ui/design/app.css`
- Test: `tests/canirun.test.mjs`, plus a `parseSettings` case in `tests/metrics.test.mjs`

**Interfaces:**
- Consumes: Tasks 1, 2, 4 (`ctx.actions.web`) and 5 (`combo`).
- Produces:
  - `canirun.js`: `id = 'canirun'`, `title = 'Can I Run It?'`, `tile = 'var(--cat-5)'`, `icon = () => glyph('gauge')`, `needsInventory = true`, and `render(el, ctx)`/`leave(ctx)` (no `update`; estimates don't depend on live samples). The toggle is `segmented({ name: 'cir-mode', label: 'Mode', options: [{value:'gaming',label:'Gaming'},{value:'ai',label:'AI'}], value: ctx.settings.cirMode, onChange: v => { ctx.actions.setSetting('cirMode', v); renderMode(); } })`, wrapped in a centered `.ts-cir-toggle` row. Below it, a body element is filled by `gaming.render(body, ctx)` or `ai.render(body, ctx)`. Until Task 7 lands, AI shows `empty({ title: 'Coming next' })`.
  - `canirun-shared.js`:
    - `latestOnly(fn)`: wraps an async fn so only the latest call's result resolves; older calls resolve to `undefined`.
    - `pcFromInventory(inventory, info) → { pc: Pc, ai: AiPc, gpuName: string|null }`, built with `pickGpu`, `matchCpu`, `ramBandwidth`. RAM is `info.memTotal`.
    - `searchField({ placeholder, onSearch })`: a `.ts-field.ts-field--search` input, debounced 300 ms, minimum 2 characters.
  - `parseSettings` new keys, with defaults:
    - `cirMode` 'gaming' | 'ai' (default 'gaming').
    - `resolution` string | null (null = the display's, from `screen.width/height × devicePixelRatio`).
    - `aspect` string | null.
    - `targetFps` integer 10..1000 (default 60).
    - `context` integer 512..1048576 (default 8192).
- Gaming view, top to bottom:
  1. Search field.
  2. Controls row:
     - **Resolution:** combo over `RESOLUTIONS[aspect]` shown as `"W × H"`, parsed by `parseResolution`. Typing a resolution sets the aspect via `aspectOf`.
     - **Aspect:** combo over `ASPECTS`, parsed by `parseAspect`. Changing it swaps the resolution options; if the current resolution doesn't match the new aspect, switch to that aspect's 1080-high entry or its nearest.
     - **Target:** combo over 30/60/120/144/165/240 as "N FPS", parsed as an integer 10..1000.
     - All three persist through `setSetting`.
  3. Results card:
     - Rows are a 120×45 `<img>` of the Steam capsule, the name, and a "Not on Steam" badge for `GAMES` entries. Built-in matches come first.
     - States: skeleton while searching, `empty({ title: 'No games found' })` for no hits, and offline/timeout → `empty({ title: "Can't reach Steam", text: 'Check your connection and try again.', action: Retry })`.
  4. After a pick:
     - **Verdict card:** the verdict line — Below minimum / Playable / Runs well / Great / "Can't estimate FPS" — plus "at <res label>", and `ts-badge`s for GPU/CPU/RAM/VRAM with ✓ ✗ ?. Then "Suggested: <preset> · ~lo–hi FPS", or the upscaler line ("With DLSS Quality: ~N FPS at High"), or "Your GPU isn't in the table yet" when `pc.gpu` is null.
     - **Presets card:** four rows of `lo–hi FPS`. Capped rows show "300+", the suggested row gets a ★ badge, and limited rows say "Needs more VRAM".
     - **Requirements card:** rows GPU / CPU / RAM / VRAM, with columns Minimum, Recommended and This PC.
     - **Footnote:** "Estimate from the published specs and a built-in GPU/CPU speed table: recommended ≈ 60 FPS at 1080p High. Real FPS varies by scene, drivers and settings."
     - With no requirements published, the cards are replaced by `empty({ title: 'No PC requirements published' })`.
  - Changing resolution, aspect or target recomputes in place with no refetch.
  - Module state (last term, results, selected game and details) survives tab switches and mode toggles.
  - With no inventory yet: "Reading your hardware…".

- [ ] **Step 1: Write the failing tests** in `tests/canirun.test.mjs`:

```js
test('latestOnly drops stale replies', async () => {
  const wait = (v, ms) => new Promise(r => setTimeout(() => r(v), ms));
  const search = latestOnly((v, ms) => wait(v, ms));
  const [a, b] = await Promise.all([search('old', 30), search('new', 5)]);
  assert.equal(a, undefined); assert.equal(b, 'new');
});
test('pcFromInventory uses the strongest gpu and memory speed', () => {
  const r = pcFromInventory({ gpus: [{ name: 'Intel(R) UHD Graphics 770', dedicated: 1e8 }, { name: 'NVIDIA GeForce RTX 4070', dedicated: 12 * 2 ** 30 }],
    cpu: { name: 'AMD Ryzen 7 7800X3D 8-Core Processor' }, memory: { modules: [{ configuredMts: 6000 }, { configuredMts: 6000 }] } }, { memTotal: 32 * 2 ** 30 });
  assert.equal(r.pc.gpu.name, 'RTX 4070'); assert.equal(r.pc.vramGb, 12); assert.equal(r.ai.ramBw, 96); assert.equal(r.pc.ramGb, 32);
});
```

and in `tests/metrics.test.mjs`: `assert.deepEqual(['cirMode','targetFps','context'].map(k => parseSettings({ cirMode: 'x', targetFps: 5, context: 'a' })[k]), ['gaming', 60, 8192])`.

- [ ] **Step 2: Run** `node --test "tests/*.test.mjs"`. Expect FAIL on the new tests.
- [ ] **Step 3: Implement the settings keys, `canirun-shared.js`, `canirun.js`, `canirun-gaming.js`, the icon, the registration and the CSS.**
- [ ] **Step 4: Run** `node --test "tests/*.test.mjs"`. Expect PASS.
- [ ] **Step 5: Preview check.** `preview_start {name: 'ui-preview'}` and open `#canirun`. Then check:
  - The toggle is centered, and the sidebar shows "Can I Run It?" second without truncation at the narrowest window.
  - Searching a demo game shows results; picking one shows verdict, presets and requirements.
  - Changing the resolution to "4K" lowers the FPS; typing "banana" marks the field invalid.
  - "zzz" shows "No games found".
  - No console errors. Take a screenshot.
- [ ] **Step 6: Commit** `git commit -m "Can I Run It: tab shell and Gaming view"`

---

### Task 7: AI view

**Files:**
- Create: `src/SystemPerformance/ui/views/canirun-ai.js`
- Modify: `src/SystemPerformance/ui/views/canirun.js` (swap the placeholder for `ai.render`), `src/SystemPerformance/ui/design/app.css` if needed

**Interfaces:**
- Consumes: Task 3 (all exports), Task 6 (`latestOnly`, `pcFromInventory`, `searchField`), `combo`, `ctx.actions.web`.
- Behaviour, top to bottom:
  1. Search field.
  2. Results list: repo ID, a "↓ downloads · ♥ likes" subtitle, a task badge. States as in Gaming, with "Can't reach Hugging Face".
  3. On pick:
     - Fetch `modelInfo` and `modelFiles` in parallel, then `modelConfig` of the repo, falling back to `info.baseModel`.
     - `groupFiles` gives the quants. With none, use `synthQuants(info.params, total .safetensors bytes)` and list `modelGguf(id)` results as a "GGUF versions" card whose rows load that repo.
     - With neither, show `empty({ title: 'No size information for this model' })`.
  4. Controls row:
     - **Quant:** `select.ts-field-input`, options "TAG · size".
     - **Image projector:** a select with "None" plus each mmproj, defaulting to the smallest. Shown only when mmproj files exist.
     - **Context:** combo over 2048…131072 shown as "8K" etc., parsed as an integer or "Nk" in 512..1048576, capped at `cfg.maxCtx ?? info.ctx`. Persisted as `context`.
  5. **Verdict card:**
     - The headline is one of "Fits in VRAM", "Runs split: N% on GPU", "Runs from system RAM", "Won't fit".
     - Then " · ~lo–hi tokens/s", or "speed unknown for this GPU".
     - A `ts-stackbar` of weights / mmproj / context / overhead against a marker at usable VRAM, with legend chips and sizes.
  6. **All quants card:** rows "TAG · size · where · ~tps"; clicking a row selects it.
  7. **Footnote:** "Assumes a llama.cpp-based runtime (LM Studio, Ollama, llama.cpp). Speed is generation from memory bandwidth; MoE models may run faster." Add "Context size estimated" when `kv.heuristic`.
  - Default quant: the largest whose where is 'vram', else the smallest.
  - Module state persists like Gaming. Gated repos still show sizes (the tree lists them).

- [ ] **Step 1: Implement `canirun-ai.js` and wire it into `canirun.js`.** The logic already has tests in Task 3; this task is wiring.
- [ ] **Step 2: Run** `node --test "tests/*.test.mjs"`. Expect PASS.
- [ ] **Step 3: Preview check** at `#canirun`, toggled to AI:
  - The demo GGUF repo shows 4 quants with the split one summed, and the mmproj picker.
  - Switching to the safetensors-only repo shows BF16/8-bit/4-bit and the GGUF versions card.
  - Context "128K" grows the context segment and can change the verdict.
  - The toggle remembers AI after reload. No console errors. Take a screenshot.
- [ ] **Step 4: Commit** `git commit -m "Can I Run It: AI view"`

---

### Task 8: README and real-app verification

**Files:**
- Modify: `README.md` (feature section for Can I Run It?, next to the hardware tabs section)

- [ ] **Step 1: Add the README feature section.** Two short paragraphs, Gaming and AI, saying what each estimates, that the figures are estimates from published specs and a built-in speed table, and that searches go to Steam/Hugging Face.
- [ ] **Step 2: Full build:** `./build.ps1`. Expect "Built …\dist\SystemPerformance.exe" and all tests passing. If dist is locked, use the fallback in Global Constraints.
- [ ] **Step 3: Real-app check over CDP:**
  - Launch the built exe with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333 --remote-allow-origins=*'`.
  - On `#canirun`, search "cyberpunk", pick Cyberpunk 2077, and confirm the verdict and presets render with FPS numbers for this PC.
  - Toggle to AI, search "qwen3 8b gguf", pick a result, and confirm the quants list and verdict render.
  - Confirm Steam cover images load (CSP). No console errors.
  - Close the app via SC_CLOSE plus tray Quit, as earlier tests did.
- [ ] **Step 4: Commit** `git commit -m "README: Can I Run It?"`
