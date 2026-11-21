# Can I Run It? — design

## Intent

A new **Can I Run It?** tab, placed directly under Dashboard in the sidebar. At the top, centered, sits a
pill toggle with **Gaming** on the left and **AI** on the right.

- **Gaming:** search for any game and get an estimate of how well this PC runs it: a verdict, estimated
  FPS for each graphics preset, and a suggested quality preset. The user sets the aspect ratio and
  resolution from combo boxes: pick from the list, or type a value.
- **AI:** search Hugging Face models, choose any quant the model page offers (plus its mmproj image
  projector, if it has one), and get the same kind of estimate: does it fit, where does it run (VRAM,
  split, RAM), and how fast.

The user hasn't said who the estimate is for. *Assumed:* it's for the same people as the hardware tabs,
gamers and people running local AI, checking their own PC before they buy a game or download a model.

## Goals

- Search covers nearly every PC game (Steam) plus the big titles Steam doesn't carry.
- Every estimate shows what it was based on and reads as an estimate (a range, not one exact number).
- Works with no account, no API key and no setup.
- The tab stays usable offline: it shows a clear "can't reach Steam / Hugging Face" state and never
  hangs.

## Non-goals

- Benchmark-accurate FPS.
- Smaller non-Steam games (Epic exclusives, launcher-only indies): they won't be found.
- Downloading or running models.
- Per-setting tuning (shadows, textures). Only presets: Low, Medium, High, Ultra.
- Multi-GPU estimates: only the strongest GPU counts.

## Anti-goals (a failure even if it works)

- Confident single numbers that are badly wrong: always show ranges and the basis.
- Sending anything about this PC to Steam or Hugging Face: only the search text and the game or model
  ID leave the PC.
- Freezing the UI while a request is in flight.

## Constraints

- Existing stack: .NET 10 WinForms + WebView2 host and vanilla ES-module UI with Tokenscope components
  (`ui/kit.js`, `ui/design/*.css`). Single-file exe. No new NuGet packages (`HttpClient` covers it).
- The page's CSP is `connect-src 'self'` (`MainForm.cs`), and Steam's API sends no CORS headers, so
  **all web requests run in the host** through the JSON bridge. The page sends a search term or an ID.
  The host builds the URL itself, and only for the two allowed hosts (`store.steampowered.com`,
  `huggingface.co`). The page never supplies a URL. *(Claude's call:)* game cover art loads straight
  from Steam's image CDN, by widening only `img-src` to `https://*.steamstatic.com` (Steam search
  returns those URLs). `connect-src` stays `'self'`.
- Hardware inputs come from what the app already collects: `inventory.gpus` (name, VRAM),
  `inventory.cpu` (name, cores, threads), `inventory.memory` (total, module speed, channel count from
  the module count), and `info` (GPU name, memory total).
- Privacy copy that's now untrue must change: Settings → This PC footer ("Nothing leaves this PC") and
  the README's "Private and portable" bullet. New copy: only searches you type in Can I Run It? go to
  Steam (and its image servers) or Hugging Face.

## Approaches considered

**Game data** (the user handed over this choice; Claude picked **1**):

1. **Steam's public store API, plus a built-in list of ~15 big non-Steam games (chosen).** Free, no key,
   specs for nearly every PC game. Misses small non-Steam titles.
2. Steam plus IGDB or RAWG: wider name coverage, but every user must register a developer key, and most
   extra entries have no system requirements to estimate from.
3. Scraping a requirements website: fragile and likely against its terms. Ruled out.

**AI data:** one sensible way: Hugging Face's public API (model search, file tree with sizes, model
metadata).

## Decided by the user

- One tab named **Can I Run It?**, directly under Dashboard.
- A pill toggle centered at the top: Gaming (left), AI (right).
- Aspect ratio and resolution as combo boxes (dropdown + type-in).
- AI side: any quant on the model's page is selectable, and mmproj is included in the estimate.

## Design (Claude's calls, open to correction)

### Layout

```
                 ( Gaming | AI )                    ← ts-segmented, centered

Gaming
[ Search games…                                  ]
Resolution [2560 × 1440 ▾]  Aspect [16:9 ▾]  Target [60 FPS ▾]
┌ results: cover art, name, release year ─────────┐  ← until one is picked
┌ Verdict ─────────────────────────────────────────┐
│ Runs well at 1440p        GPU ✓  CPU ✓  RAM ✓  VRAM ✓
│ Suggested: High · ~70–90 FPS                     │
└──────────────────────────────────────────────────┘
┌ Presets ───────────┐  ┌ Requirements ────────────────────┐
│ Low     140–170    │  │          Minimum  Recommended You │
│ Medium  105–130    │  │ GPU      GTX 1060 RTX 2070   …    │
│ High ★   70–90     │  │ CPU      …                        │
│ Ultra    52–65     │  │ RAM      8 GB    16 GB      32 GB │
└────────────────────┘  └───────────────────────────────────┘
Footnote: how the estimate was made.

AI
[ Search Hugging Face models…                    ]
results: repo id, downloads, likes, task tag
Quant [Q4_K_M · 4.9 GB ▾]  Image projector [mmproj-F16 · 0.9 GB ▾ | None]  Context [8,192 ▾]
┌ Verdict ─────────────────────────────────────────┐
│ Fits in VRAM · ~45–60 tokens/s                   │
│ [weights | mmproj | context | overhead]  ── VRAM line
└──────────────────────────────────────────────────┘
┌ All quants: size · where it runs · est. tokens/s (click a row to select) ┐
```

- Combo boxes are a native `<input list>` + `<datalist>`, styled as Tokenscope fields.
- The toggle position, resolution, aspect, target FPS and context length persist in the existing
  settings (`parseSettings`, localStorage).
- The last search and selection survive switching tabs within a session (module state, as `disks.js`
  keeps `selected`).

### Resolution and aspect

- Aspect options: 16:9, 16:10, 21:9, 32:9, 4:3. The resolution list is filtered to the chosen aspect
  (16:9: 1280×720, 1920×1080, 2560×1440, 3840×2160; 16:10: 1920×1200, 2560×1600; 21:9: 2560×1080,
  3440×1440, 5120×2160; 32:9: 3840×1080, 5120×1440; 4:3: 1024×768, 1600×1200).
- Typed values are parsed loosely ("2560x1440", "2560 × 1440", "21:9"). Typing a resolution sets the
  aspect to its reduced ratio, snapped to the nearest named one (3440×1440 → 21:9). Invalid input keeps
  the last valid value and marks the field.
- Default: the primary display's resolution (`screen.width/height × devicePixelRatio`).
- Target FPS combo: 30, 60, 120, 144, 165, 240, or typed. Default 60. *(Claude's addition: the suggested
  preset needs a target.)*

### Game data

- Search: `GET https://store.steampowered.com/api/storesearch/?term=…&l=english&cc=US`, games only,
  debounced ~300 ms, at most 20 results. Built-in non-Steam entries matching the term are merged in at
  the top.
- Details: `GET https://store.steampowered.com/api/appdetails?appids=…` → `pc_requirements.minimum` /
  `.recommended` (HTML). The host returns the HTML as text; the page parses it.
- Built-in non-Steam list (`ui/data/games.js`): official min/rec specs from publishers' pages for roughly
  Valorant, League of Legends, Fortnite, Minecraft (Java), Roblox, Genshin Impact, Honkai: Star Rail,
  Zenless Zone Zero, World of Warcraft, Escape from Tarkov, Star Citizen, and League-sized others the
  builder finds missing from Steam. The builder verifies each one is truly absent from Steam.
- Requirement parsing: from the Graphics/Video, Processor, Memory and VRAM lines, extract every
  GPU/CPU model mentioned ("GTX 1060 6GB / RX 580 8GB or better"), match each against the hardware
  table, and use the mean score of the matches. RAM in GB. A line with no recognisable part leaves that
  check as "unknown", not failed.

### Hardware table (`ui/data/hardware.js`)

- ~200 GPUs: NVIDIA GTX 900 → RTX 50, AMD RX 400 → RX 9000, Intel Arc A/B, common iGPUs (Intel UHD /
  Iris Xe / Arc iGPU, Radeon 680M/780M/890M). Per GPU: match patterns, relative raster score (one scale,
  e.g. RTX 4090 = 100), VRAM, memory bandwidth (GB/s), and whether it has DLSS, FSR or XeSS.
- ~150 CPUs or CPU families with a relative gaming score (single-thread-weighted) and core count.
- *(Claude's call:)* scores are written from widely published relative-performance charts (e.g.
  TechPowerUp's relative performance) as recalled, not from a supplied file. A test pins a set of
  reference orderings so a typo can't invert them: RTX 4090 > 4080 > 3090 > 3080 > 2080 Ti > 1080 Ti >
  1060; RX 7900 XTX > 6800 XT > 5700 XT > 580; plus a few matched pairs (RTX 3060 ≈ RX 6600 XT ±15%,
  GTX 1060 6GB ≈ RX 580 ±15%). A `ponytail:` note marks the table as hand-maintained, to refresh when
  new hardware ships.
- *(Claude's call:)* there's no calibration step against real FPS. If the user later supplies
  measured results (game, resolution, preset, FPS), the constants block gets tuned to them.
- Matching is pattern-based on normalised names ("NVIDIA GeForce RTX 4070 Laptop GPU" → RTX 4070 Laptop
  entry). This PC's own hardware unmatched → the estimate says so ("your GPU isn't in the table yet")
  rather than guessing.

### FPS model (`ui/estimate.js`, pure functions)

- Anchors: the recommended GPU ≈ 60 FPS at 1080p High, and the minimum GPU ≈ 30 FPS at 1080p Low.
  *(Claude's call:)* the recommended anchor drives the estimate. The minimum anchor is used only when
  there's no recommended spec, converted as a recommended score = minimum score × 1.8 (30 FPS at Low →
  60 FPS at High).
- GPU FPS at 1080p High ≈ 60 × (yourScore / recScore). Preset multipliers relative to High: Low ×1.8,
  Medium ×1.35, Ultra ×0.75. Resolution: × (1920·1080 / pixels)^0.75. Estimates above 300 FPS show as
  "300+" (an old or weak recommended spec otherwise predicts nonsense for a modern GPU).
- CPU cap: ≈ 60 × (yourCpu / recCpu) × 1.5, the same at every resolution. FPS = min(GPU, CPU cap). No
  parseable CPU in the requirements → no CPU cap, and the CPU check shows "unknown".
- Shown as a range of ±20% around the estimate. VRAM below the requirement → lower presets get a warning
  and High/Ultra are capped. RAM below minimum → verdict "Below minimum".
- Verdict tiers, judged at the chosen resolution against the target FPS:
  - **Below minimum:** RAM or GPU under the minimum spec.
  - **Playable:** the minimum spec is met, but even Low falls short of the target.
  - **Runs well:** Low or Medium reaches the target.
  - **Great:** High or Ultra reaches the target.
- This PC's GPU not in the table: no FPS figures. The RAM and VRAM checks still show, plus "your GPU
  isn't in the table yet".
- A Steam game with no published PC requirements (or a non-game result): shown in results, and opening
  it shows "No PC requirements published". No extra request per search result.
- Suggested preset: the highest whose low end ≥ target FPS. When none reaches the target and the GPU
  supports an upscaler, one line: "With DLSS / FSR Quality: ~X FPS at High" (render at 0.67 scale).
- These constants live in one block at the top of `estimate.js` so they can be tuned.

### AI data

- Search: `GET https://huggingface.co/api/models?search=…&sort=downloads&limit=20`. Show repo ID,
  downloads, likes and pipeline tag.
- Files: `GET https://huggingface.co/api/models/{id}/tree/main?recursive=true` (paths and sizes) and
  `GET https://huggingface.co/api/models/{id}` (metadata: `safetensors.total` parameter count, `gguf`
  block, `cardData.base_model`). The builder confirms the exact query parameters (e.g. `expand[]`)
  against the live API.
- Quants: group `*.gguf` files by quant tag parsed from the filename (Q2_K … Q8_0, IQ*, F16, BF16, with
  split `-00001-of-0000N` files and subfolders summed). Files with `mmproj` in the name go to the image
  projector picker (default: the smallest; plus "None").
- Repos with no GGUF: synthesise options from the parameter count: BF16 (2.0 bytes/param), 8-bit
  (~1.07), 4-bit (~0.57). Also list "GGUF versions" from
  `GET /api/models?filter=base_model:quantized:{id}&sort=downloads`, clickable to load that repo.
- Context options: 2K, 4K, 8K, 16K, 32K, 64K, 128K, or typed, capped at the model's maximum when known.
  Default 8K.

### AI model (`ui/estimate.js`)

- KV cache = 2 × layers × kvHeads × headDim × context × 2 bytes (FP16). Read layers, heads and head size
  from `config.json` in the repo or its `base_model` (`/{id}/resolve/main/config.json`, fetched by the
  host). If unavailable, use a labelled heuristic from the parameter count.
- Memory needed = weights + mmproj + KV cache + ~0.8 GB compute overhead.
- Where it runs:
  - **Fits in VRAM** when needed ≤ VRAM − 0.5 GB.
  - **Split** when it fits in VRAM + (RAM − 4 GB): show the share on the GPU. *(Claude's call:)* total
    RAM minus a 4 GB Windows reserve everywhere, not live free RAM, so the verdict doesn't flicker.
  - **CPU / RAM only** with no usable GPU.
  - **Won't fit** beyond VRAM + (RAM − 4 GB for Windows).
- Generation speed ≈ 0.6 × bandwidth / bytes read per token (≈ weight size). Split: time per token =
  GPU part / GPU bandwidth + CPU part / RAM bandwidth. RAM bandwidth = channels × MT/s × 8 bytes, with
  channels inferred from the module count (cap 2 on desktop parts) and speed from `inventory.memory`.
  An iGPU counts as RAM bandwidth. Shown as a range of ±25%.
- This PC's GPU not in the table: the fit verdict still shows (it needs only DXGI VRAM). Speed is
  omitted, with "speed unknown for this GPU".
- MoE models: when the active parameter count is known (metadata or config), bytes per token use active
  params; otherwise note that MoE speed may be higher than shown.
- Footnote: assumes a llama.cpp-based runtime (LM Studio, Ollama, llama.cpp).

### Host (`Web.cs`, new)

- One static `HttpClient` with a User-Agent of `SystemPerformance/<version>` and a 10 s timeout.
- Bridge requests (reply via the existing request/reply mechanism): `gameSearch {term}`,
  `gameDetails {appId}`, `modelSearch {term}`, `modelFiles {id}`, `modelConfig {id}`. Each validates its
  input (Steam app ID: digits; HF ID: `owner/name` of `[A-Za-z0-9._-]`), builds the URL and returns the
  JSON or text, or `{error}` on timeout, offline or HTTP error.
- A small in-memory cache (per session) so toggling between results doesn't re-fetch.

### Testing

- `node --test tests/*.test.mjs`, covering the pure functions:
  - resolution and aspect parsing and snapping
  - requirement-text GPU/CPU/RAM extraction on real Steam HTML samples
  - hardware-name matching for this PC's style of names
  - monotonic FPS (higher resolution or preset → lower FPS)
  - quant grouping, including split files and mmproj
  - KV and memory verdict thresholds
- `demo.js` gets canned bridge replies so the preview (`ui-preview`) shows both modes.
- Real exe via CDP: search a Steam game and an HF model live, with no JS errors.

## Left to the builder

- File split inside `ui/views/` (one view module with two sub-modules is the expected shape).
- The sidebar icon (from the existing glyph set, or a new one in the same style).
- Exact hardware-table contents and the non-Steam game specs, within the scope above.
- Empty, loading and error states, following existing Tokenscope patterns (`empty()`, skeletons).
- Whether the sidebar label needs `Can I Run It?` to fit as is (it should; check at the narrowest
  window).
