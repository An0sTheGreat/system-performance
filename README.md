# System Performance

A one-screen Windows dashboard for CPU, GPU, memory, disk and Wi-Fi/Ethernet, with live 60-second charts.
Updates every 1000, 500 or 100 ms (top-right switch, or Settings). Closing the window (X) keeps it running in the tray; right-click the tray icon → Quit to exit. Sampling pauses while minimised or in the tray.

- **Run:** `dist\SystemPerformance.exe` (needs the .NET 10 Desktop Runtime and the WebView2 Runtime).
- **Build:** `./build.ps1` (or `./build.ps1 -Standalone` to bundle the .NET runtime). Needs the .NET 10 SDK; Node runs the UI tests.
- **Check the counters on a PC:** `dist\SystemPerformance.exe --sample | Out-String`.
- **Preview the UI in a browser:** serve `src/SystemPerformance/ui` (e.g. `python -m http.server -d src/SystemPerformance/ui`); a simulated machine stands in for the host.

Data sources: Windows performance counters (PDH) for CPU, disks and GPU engines; GlobalMemoryStatusEx; DXGI for the GPU name and memory;
.NET NetworkInterface for throughput; the Native Wifi API for SSID and signal (Windows may hide these until location access is allowed).
Design system copied from Tokenscope (`ui/design/tokens.css`, `components.css`); app-only components live in `ui/design/app.css`.
