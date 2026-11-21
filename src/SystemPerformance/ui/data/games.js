// Built-in games that aren't on Steam, with the publisher's own PC specs (checked 2026-11-21). Turned into specs by specFromText.
// ponytail: hand-maintained, recheck the sources when a game raises its requirements
// rec is null where the publisher's recommended tier names no GPU the hardware table knows; the estimate then scales from min.
export const GAMES = [
  { id: 'ns:valorant', name: 'VALORANT', image: null,
    min: { gpu: 'Intel HD 4000 / AMD Radeon R5 220', cpu: 'Intel i3-540 / AMD Athlon 200GE', ramGb: 4, vramGb: 1 },
    // Official recommended (60 FPS): GeForce GT 730 / Radeon R7 240, i3-4150 / Ryzen 3 1200, 4 GB (VRAM not stated, 1 GB as min).
    rec: { gpu: 'GeForce GT 730 / Radeon R7 240', cpu: 'Intel i3-4150 / AMD Ryzen 3 1200', ramGb: 4, vramGb: 1 },
    source: 'https://support.riotgames.com/en-us/valorant/support-tools/minimum-recommended-pc-specs' },
  { id: 'ns:league-of-legends', name: 'League of Legends', image: null,
    min: { gpu: 'GeForce 400 Series / AMD HD 6570 / Intel HD 4600 / NVIDIA GeForce 560', cpu: 'Intel Core i3-530 / AMD FX-4100', ramGb: 2, vramGb: 1 },
    rec: { gpu: 'AMD Radeon HD 6950 / Intel UHD 630', cpu: 'Intel Core i5-8250 / AMD Ryzen 3 1200', ramGb: 4, vramGb: 2 },
    source: 'https://support.riotgames.com/en-us/league-of-legends/performance/minimum-and-recommended-system-requirements-league-of-legends' },
  { id: 'ns:fortnite', name: 'Fortnite', image: null,
    min: { gpu: 'Intel HD 4000 / AMD Radeon Vega 8', cpu: 'Core i3-3225 3.3 GHz', ramGb: 8, vramGb: null },
    rec: { gpu: 'Nvidia GTX 960, AMD R9 280, or equivalent DX11 GPU', cpu: 'Core i5-7300U 3.5 GHz, AMD Ryzen 3 3300U, or equivalent', ramGb: 16, vramGb: 2 },
    source: 'https://www.epicgames.com/help/en-US/c-202300000001636/a202300000012731' },
  { id: 'ns:genshin-impact', name: 'Genshin Impact', image: null,
    min: { gpu: 'NVIDIA GeForce GTX 1050 or equivalent', cpu: '6th Generation Intel Core i5 or AMD Ryzen series or equivalent', ramGb: 8, vramGb: null },
    rec: { gpu: 'NVIDIA GeForce GTX 1060 6GB or better', cpu: '7th Generation Intel Core i7 or AMD Ryzen 5000 series or better', ramGb: 16, vramGb: null },
    source: 'https://store.epicgames.com/en-US/p/genshin-impact' },
  { id: 'ns:honkai-star-rail', name: 'Honkai: Star Rail', image: null,
    min: { gpu: 'Nvidia GeForce GTX 650 or better', cpu: 'Intel Core i5 Processor', ramGb: 8, vramGb: null },
    rec: { gpu: 'Nvidia GeForce GTX 1060 or higher', cpu: 'Intel Core i5 Processor', ramGb: 8, vramGb: null },
    source: 'https://store.epicgames.com/en-US/p/honkai-star-rail' },
  { id: 'ns:star-citizen', name: 'Star Citizen', image: null,
    // The minimum GPU line is RSI's own example list ("NVidia 1060" written as GTX 1060 so the table matches it).
    min: { gpu: 'NVIDIA GTX 1060 / AMD RX 5700, RX Vega 56, RX 460 / Intel Arc A380, UHD Graphics 730 (4 GB VRAM)', cpu: 'Quad Core CPU - Intel: i7 (Haswell or later), AMD: Excavator or later', ramGb: 16, vramGb: 4 },
    // Official recommended: DirectX 12 GPU with 8 GB VRAM, Intel i7 (Haswell or later) / AMD Ryzen 5 or later, 32 GB. No GPU model named.
    rec: null,
    source: 'https://support.robertsspaceindustries.com/hc/en-us/articles/360042417374-Star-Citizen-Minimum-System-Requirements' },
];
