# System Performance

A one-screen Windows dashboard for CPU, GPU, memory, disk and Wi-Fi/Ethernet, with live 60-second charts.
Updates every 1000, 500 or 100 ms (top-right switch, or Settings). Closing the window (X) keeps it running in the tray; right-click the tray icon → Quit to exit. Sampling pauses while minimised or in the tray.

**Top apps:** the *Top apps* button on the CPU, GPU, Memory and Disk cards opens a live list of the programs using the most of that resource (grouped by program, refreshed every second), sortable by CPU, memory, disk I/O or GPU. **End** (click twice to confirm) closes every process of that program. Windows-critical processes, and the WebView2 process this app's window runs on, are refused.

- **Download:** the latest standalone `SystemPerformance.exe` is on the [Releases page](https://github.com/An0sTheGreat/system-performance/releases). .NET is bundled; it needs the WebView2 Runtime, which Windows 11 already has.
- **Build:** `./build.ps1` (needs the .NET 10 Desktop Runtime to run) or `./build.ps1 -Standalone` (bundles .NET). Needs the .NET 10 SDK; Node runs the UI tests.
- **Check the counters on a PC:** `dist\SystemPerformance.exe --sample | Out-String` prints the hardware info, one sample and the five busiest programs.
- **Preview the UI in a browser:** serve `src/SystemPerformance/ui` (e.g. `python -m http.server -d src/SystemPerformance/ui`); a simulated machine stands in for the host.

Data sources: Windows performance counters (PDH) for CPU, disks and GPU engines; GlobalMemoryStatusEx; DXGI for the GPU name and memory;
.NET NetworkInterface for throughput; the Native Wifi API for SSID and signal (Windows may hide these until location access is allowed);
NtQuerySystemInformation for per-program CPU, memory and I/O. Disk I/O per program counts all file reads and writes, not only physical disk traffic.
Design system copied from Tokenscope (`ui/design/tokens.css`, `components.css`); app-only components live in `ui/design/app.css`.

## Future Plans

1. **Mini overlay and live tray icon.** A small always-on-top strip (CPU, GPU, RAM, network) that you can place over games or full-screen apps, and that clicks pass through. The tray icon would show live CPU % so the window doesn't need to be open. *For gamers, streamers, and anyone watching a long job.*
2. **Temperatures, clocks, fans, power and battery.** CPU and GPU temperature and power draw in watts, fan speeds, and on laptops the battery drain rate and time left. Needs a sensor library such as LibreHardwareMonitor; some readings need administrator rights. *For gamers, overclockers and laptop users.*
3. **History and session recording.** Hours or days of history instead of the last 60 seconds, a timeline to scroll back through, and a "record" button for a game, render or build that produces a summary (average, peak, time throttled) and a CSV export. *For developers, benchmarking, and "it was slow at 3 pm" problems.*
4. **Alerts.** Rules such as "GPU above 85 °C for 30 seconds", "less than 10% memory free" or "C: over 95% full" that raise a Windows notification, plus an option to start with Windows so it keeps watching. *For home-server owners, IT staff, and long unattended jobs.*
5. **Per-app network use.** A Network column in Top apps showing which programs are sending and receiving. Windows has no cheap counter for this, so it needs an ETW (Event Tracing for Windows) session, as Resource Monitor uses.
