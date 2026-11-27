using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Win32;

namespace SystemPerformance;

// Reads everything the dashboard and the detail tabs show. All performance counters sit in one PDH query,
// so a tick is one PdhCollectQueryData call plus a few cheap Win32 reads. Slow lookups (adapters and their
// addresses, drive sizes, Wi-Fi details) refresh every SlowMs, not every tick. Per-process data, the full
// sensor list and network latency are only gathered while a screen that shows them is open.
sealed class Sampler : IDisposable
{
    const long SlowMs = 2000;
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    readonly Pdh pdh = new();
    readonly IntPtr cpuTotal, cpuPerf, cpuFreq, cpuCores, corePerf, coreFreq, procs, threads, contextSwitches, interrupts, queue,
        commit, commitLimit, standbyReserve, standbyNormal, standbyCore, modified, freeZero, poolPaged, poolNonpaged, pageReads, pageFile,
        diskIdle, diskRead, diskWrite, diskLatency, diskQueue, diskReads, diskWrites,
        gpuEngine, gpuDedicated, gpuShared, gpuProcessMemory;
    readonly IReadOnlyList<Gpu.Adapter> gpus;
    readonly Gpu.Adapter? gpu;   // the primary GPU (most dedicated memory): the dashboard card, overlay and sensors
    readonly string cpuName = CpuName();

    long nextSlow;
    readonly Dictionary<char, (long Used, long Total)> drives = [];
    readonly Stopwatch clock = Stopwatch.StartNew();

    // Network: every up adapter, with the primary one (Wi-Fi first, else the one with a gateway) on the dashboard.
    sealed class Adapter
    {
        public required NetworkInterface Nic;
        public object? Details;           // addresses etc., refreshed every SlowMs
        public Wlan.Info? Wifi;
        public long Rx0, Tx0, At;
        public double Rx, Tx;
    }
    List<Adapter> adapters = [];
    Adapter? primaryNic;
    readonly Pinger pinger = new();

    readonly ProcessSampler processes = new();
    readonly Sensors sensors;
    readonly Dictionary<int, double> gpuByPid = [];
    readonly Dictionary<int, long> vramByPid = [];
    volatile bool watch;
    long nextProcs;
    bool primed;

    public bool WatchProcesses { set { watch = value; nextProcs = 0; primed = false; } }
    public bool WatchSensors { set => sensors.WatchAll = value; }
    public void WatchNetwork(bool on, bool internet) => pinger.Set(on, internet);

    // The headline numbers of the last sample, for the overlay and the tray icon.
    public Overlay.Reading Latest { get; private set; }
    double? lastGpu, lastRx, lastTx;

    public Sampler()
    {
        cpuTotal = pdh.Add(@"\Processor Information(_Total)\% Processor Utility");
        cpuPerf = pdh.Add(@"\Processor Information(_Total)\% Processor Performance");
        cpuFreq = pdh.Add(@"\Processor Information(_Total)\Processor Frequency");
        cpuCores = pdh.Add(@"\Processor Information(*)\% Processor Utility");
        corePerf = pdh.Add(@"\Processor Information(*)\% Processor Performance");
        coreFreq = pdh.Add(@"\Processor Information(*)\Processor Frequency");
        procs = pdh.Add(@"\System\Processes");
        threads = pdh.Add(@"\System\Threads");
        contextSwitches = pdh.Add(@"\System\Context Switches/sec");
        interrupts = pdh.Add(@"\Processor Information(_Total)\Interrupts/sec");
        queue = pdh.Add(@"\System\Processor Queue Length");
        commit = pdh.Add(@"\Memory\Committed Bytes");
        commitLimit = pdh.Add(@"\Memory\Commit Limit");
        standbyReserve = pdh.Add(@"\Memory\Standby Cache Reserve Bytes");
        standbyNormal = pdh.Add(@"\Memory\Standby Cache Normal Priority Bytes");
        standbyCore = pdh.Add(@"\Memory\Standby Cache Core Bytes");
        modified = pdh.Add(@"\Memory\Modified Page List Bytes");
        freeZero = pdh.Add(@"\Memory\Free & Zero Page List Bytes");
        poolPaged = pdh.Add(@"\Memory\Pool Paged Bytes");
        poolNonpaged = pdh.Add(@"\Memory\Pool Nonpaged Bytes");
        pageReads = pdh.Add(@"\Memory\Page Reads/sec");
        pageFile = pdh.Add(@"\Paging File(_Total)\% Usage");
        diskIdle = pdh.Add(@"\PhysicalDisk(*)\% Idle Time");
        diskRead = pdh.Add(@"\PhysicalDisk(*)\Disk Read Bytes/sec");
        diskWrite = pdh.Add(@"\PhysicalDisk(*)\Disk Write Bytes/sec");
        diskLatency = pdh.Add(@"\PhysicalDisk(*)\Avg. Disk sec/Transfer");
        diskQueue = pdh.Add(@"\PhysicalDisk(*)\Current Disk Queue Length");
        diskReads = pdh.Add(@"\PhysicalDisk(*)\Disk Reads/sec");
        diskWrites = pdh.Add(@"\PhysicalDisk(*)\Disk Writes/sec");
        gpuEngine = pdh.Add(@"\GPU Engine(*)\Utilization Percentage");
        gpuDedicated = pdh.Add(@"\GPU Adapter Memory(*)\Dedicated Usage");
        gpuShared = pdh.Add(@"\GPU Adapter Memory(*)\Shared Usage");
        gpuProcessMemory = pdh.Add(@"\GPU Process Memory(*)\Dedicated Usage");
        pdh.Collect();   // rate counters need a previous sample
        // DXGI can list one card under extra LUIDs (display paths) that no counter reports on; keep the real ones.
        var all = Gpu.All();
        var counted = pdh.Array(gpuEngine).Select(e => e.Name).Concat(pdh.Array(gpuDedicated).Select(e => e.Name)).ToList();
        var live = all.Where(g => counted.Any(n => n.Contains(g.Luid, StringComparison.OrdinalIgnoreCase))).ToList();
        gpus = live.Count > 0 ? live : all;
        gpu = gpus.FirstOrDefault();
        sensors = new Sensors(gpu?.Name);
    }

    public string InfoJson()
    {
        var mem = Memory();
        return JsonSerializer.Serialize(new
        {
            cpuName, logical = Environment.ProcessorCount, memTotal = mem.Total,
            gpuName = gpu?.Name, gpuDedicated = (long?)gpu?.Dedicated, gpuShared = (long?)gpu?.Shared,
        }, Json);
    }

    public string InventoryJson() => Inventory.BuildJson(gpus);

    public string SampleJson()
    {
        pdh.Collect();
        long now = clock.ElapsedMilliseconds;
        if (now >= nextSlow) { RefreshSlow(); nextSlow = now + SlowMs; }
        var mem = Memory();
        double cpu = Math.Min(100, pdh.Value(cpuTotal));
        lastGpu = null; lastRx = lastTx = null;
        var gpuSamples = GpuSamples();
        var nets = Nets(now);
        sensors.Want();
        var sensed = sensors.Latest;
        var (cores, coresMhz) = Cores();
        Latest = new Overlay.Reading(cpu, lastGpu, mem.Total > 0 ? (mem.Total - mem.Available) * 100.0 / mem.Total : 0, lastRx, lastTx, sensed.CpuTemp, sensed.GpuTemp);
        long standby = (long)(pdh.Value(standbyReserve) + pdh.Value(standbyNormal) + pdh.Value(standbyCore));
        return JsonSerializer.Serialize(new
        {
            type = "metrics",
            data = new
            {
                cpu = new
                {
                    total = cpu,
                    cores, coresMhz,
                    mhz = pdh.Value(cpuFreq) * pdh.Value(cpuPerf) / 100,
                    processes = (int)pdh.Value(procs),
                    threads = (int)pdh.Value(threads),
                    contextSwitches = Math.Round(pdh.Value(contextSwitches)),
                    interrupts = Math.Round(pdh.Value(interrupts)),
                    queue = (int)pdh.Value(queue),
                    uptime = Environment.TickCount64,
                },
                mem = new
                {
                    total = mem.Total, used = mem.Total - mem.Available,
                    commit = (long)pdh.Value(commit), commitLimit = (long)pdh.Value(commitLimit),
                    standby, modified = (long)pdh.Value(modified), free = (long)pdh.Value(freeZero),
                    pagedPool = (long)pdh.Value(poolPaged), nonPagedPool = (long)pdh.Value(poolNonpaged),
                    hardFaults = Math.Round(pdh.Value(pageReads)), pageFile = Math.Round(pdh.Value(pageFile), 1),
                },
                disks = Disks(),
                net = primaryNic is null ? null : nets.FirstOrDefault(n => n.Item1 == primaryNic).Item2,
                nets = nets.Select(n => n.Item2).ToArray(),
                gpu = gpuSamples.FirstOrDefault(),
                gpus = gpuSamples,
                procs = ProcSample(now),   // after GpuSamples: it fills gpuByPid and vramByPid
                sensors = sensed,
                sensorList = sensors.TakeList(),
                ping = pinger.Summary(),
            },
        }, Json);
    }

    // Per logical processor: load and effective clock. Instances are "group,index" plus "_Total" rows;
    // order by group then index like Task Manager.
    (double[] Load, double[] Mhz) Cores()
    {
        static IEnumerable<(int G, int I, double V)> Parse(List<(string Name, double Value)> rows) => rows
            .Select(c => (Key: c.Name.Split(','), c.Value))
            .Where(c => c.Key.Length == 2 && int.TryParse(c.Key[0], out _) && int.TryParse(c.Key[1], out _))
            .Select(c => (int.Parse(c.Key[0]), int.Parse(c.Key[1]), c.Value))
            .OrderBy(c => c.Item1).ThenBy(c => c.Item2);
        var load = Parse(pdh.Array(cpuCores)).Select(c => Math.Round(Math.Min(100, c.V), 1)).ToArray();
        var perf = Parse(pdh.Array(corePerf)).ToDictionary(c => (c.G, c.I), c => c.V);
        var mhz = Parse(pdh.Array(coreFreq)).Select(c => Math.Round(c.V * perf.GetValueOrDefault((c.G, c.I), 100) / 100)).ToArray();
        return (load, mhz);
    }

    object[] Disks()
    {
        Dictionary<string, double> Of(IntPtr c) => pdh.Array(c).ToDictionary(d => d.Name, d => d.Value);
        var read = Of(diskRead); var write = Of(diskWrite); var latency = Of(diskLatency);
        var q = Of(diskQueue); var reads = Of(diskReads); var writes = Of(diskWrites);
        return pdh.Array(diskIdle)
            .Where(d => d.Name != "_Total")
            .OrderBy(d => d.Name, StringComparer.OrdinalIgnoreCase)
            .Select(d =>
            {
                // "0 C: D:" -> disk 0 holding volumes C and D
                var letters = d.Name.Split(' ', StringSplitOptions.RemoveEmptyEntries).Skip(1).Where(p => p.Length == 2 && p[1] == ':').Select(p => char.ToUpperInvariant(p[0])).ToArray();
                long used = 0, total = 0;
                foreach (var l in letters) if (drives.TryGetValue(l, out var v)) { used += v.Used; total += v.Total; }
                return (object)new
                {
                    name = d.Name,
                    active = Math.Clamp(100 - d.Value, 0, 100),
                    read = read.GetValueOrDefault(d.Name),
                    write = write.GetValueOrDefault(d.Name),
                    latencyMs = latency.GetValueOrDefault(d.Name) * 1000,
                    queue = q.GetValueOrDefault(d.Name),
                    readsPerSec = Math.Round(reads.GetValueOrDefault(d.Name)),
                    writesPerSec = Math.Round(writes.GetValueOrDefault(d.Name)),
                    used, total,
                };
            }).ToArray();
    }

    List<(Adapter, object)> Nets(long now)
    {
        var list = new List<(Adapter, object)>();
        foreach (var a in adapters)
        {
            try
            {
                var s = a.Nic.GetIPStatistics();
                double secs = Math.Max(0.001, (now - a.At) / 1000.0);
                bool first = a.At == 0;
                a.Rx = first ? 0 : Math.Max(0, (s.BytesReceived - a.Rx0) / secs);
                a.Tx = first ? 0 : Math.Max(0, (s.BytesSent - a.Tx0) / secs);
                (a.Rx0, a.Tx0, a.At) = (s.BytesReceived, s.BytesSent, now);
                if (a == primaryNic) { lastRx = a.Rx; lastTx = a.Tx; }
                list.Add((a, new
                {
                    id = a.Nic.Id, name = a.Nic.Name, description = a.Nic.Description,
                    wireless = a.Nic.NetworkInterfaceType == NetworkInterfaceType.Wireless80211,
                    primary = a == primaryNic,
                    ssid = a.Wifi?.Ssid, signal = a.Wifi?.Signal, linkMbps = a.Nic.Speed / 1_000_000,
                    rx = a.Rx, tx = a.Tx, totalRx = s.BytesReceived, totalTx = s.BytesSent,
                    wifi = a.Wifi, details = a.Details,
                }));
            }
            catch (NetworkInformationException) { }
        }
        return list;
    }

    // Every hardware GPU in one pass over the engine counters. "pid_1234_luid_0x..._phys_0_eng_0_engtype_3D":
    // Task Manager's GPU % is the busiest engine type, each type summed over processes; numbered engines
    // (Compute_0, Compute_1) fold into one.
    object[] GpuSamples()
    {
        if (gpus.Count == 0) return [];
        var engines = gpus.ToDictionary(g => g.Luid, _ => new Dictionary<string, double>(), StringComparer.OrdinalIgnoreCase);
        var perPid = watch ? new Dictionary<(int Pid, string Type), double>() : null;
        foreach (var e in pdh.Array(gpuEngine))
        {
            int l = e.Name.IndexOf("luid_", StringComparison.Ordinal), at = e.Name.IndexOf("engtype_", StringComparison.Ordinal);
            if (l < 0 || at < 0 || l + 26 > e.Name.Length) continue;
            if (!engines.TryGetValue(e.Name.Substring(l, 26), out var map)) continue;   // "luid_0x00000000_0x0000C2E1"
            var type = e.Name[(at + 8)..];
            int us = type.LastIndexOf('_');
            if (us > 0 && type[(us + 1)..].All(char.IsDigit)) type = type[..us];
            map[type] = map.GetValueOrDefault(type) + e.Value;
            int end = e.Name.IndexOf('_', 4);
            if (perPid != null && e.Name.StartsWith("pid_", StringComparison.Ordinal) && end > 4 && int.TryParse(e.Name.AsSpan(4, end - 4), out int pid))
                perPid[(pid, type)] = perPid.GetValueOrDefault((pid, type)) + e.Value;
        }
        var dedicated = pdh.Array(gpuDedicated); var shared = pdh.Array(gpuShared);
        if (perPid != null)
        {
            gpuByPid.Clear();   // a process's GPU % is its busiest engine type, as in Task Manager
            foreach (var (k, v) in perPid) gpuByPid[k.Pid] = Math.Max(gpuByPid.GetValueOrDefault(k.Pid), v);
            vramByPid.Clear();  // "pid_1234_luid_..._phys_0": dedicated memory per process, all GPUs together
            // Windows overstates some processes (dwm read 26 GB on a GPU using 2.3 GB), so no process gets more
            // than its adapter ("luid_..._phys_0") has in use.
            var adapterUsed = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
            foreach (var d in dedicated) adapterUsed[d.Name] = d.Value;
            foreach (var m in pdh.Array(gpuProcessMemory))
            {
                int end = m.Name.IndexOf('_', 4);
                if (!m.Name.StartsWith("pid_", StringComparison.Ordinal) || end <= 4 || !int.TryParse(m.Name.AsSpan(4, end - 4), out int pid)) continue;
                double v = adapterUsed.TryGetValue(m.Name[(end + 1)..], out var cap) ? Math.Min(m.Value, cap) : m.Value;
                vramByPid[pid] = vramByPid.GetValueOrDefault(pid) + (long)v;
            }
        }
        long Mem(List<(string Name, double Value)> rows, string luid) => (long)rows.Where(m => m.Name.Contains(luid, StringComparison.OrdinalIgnoreCase)).Sum(m => m.Value);
        var result = gpus.Select(g =>
        {
            var rounded = engines[g.Luid].ToDictionary(e => e.Key, e => Math.Round(Math.Min(100, e.Value), 1));
            double util = rounded.Count == 0 ? 0 : rounded.Values.Max();
            if (g == gpu) lastGpu = util;
            return (object)new { luid = g.Luid, util, engines = rounded, dedicatedUsed = Mem(dedicated, g.Luid), sharedUsed = Mem(shared, g.Luid) };
        }).ToArray();
        return result;
    }

    object? ProcSample(long now)
    {
        if (!watch || now < nextProcs) return null;
        nextProcs = now + 1000;
        var apps = processes.Sample(gpuByPid, vramByPid);
        if (primed) return apps;
        primed = true;   // the first snapshot only sets the baseline for CPU and I/O rates
        return null;
    }

    void RefreshSlow()
    {
        drives.Clear();
        foreach (var d in DriveInfo.GetDrives())
        {
            try { if (d.DriveType == DriveType.Fixed && d.IsReady) drives[char.ToUpperInvariant(d.Name[0])] = (d.TotalSize - d.TotalFreeSpace, d.TotalSize); }
            catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
        var up = NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType is not (NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel))
            .Where(HasIPv4)   // drops the filter-driver and Wi-Fi Direct pseudo-adapters Windows also reports as up
            .ToArray();
        var old = adapters.ToDictionary(a => a.Nic.Id);
        adapters = up.Select(n => old.TryGetValue(n.Id, out var a) ? Refresh(a, n) : Refresh(new Adapter { Nic = n }, n)).ToList();
        // Prefer a connected Wi-Fi adapter; otherwise the first up adapter with a gateway (Ethernet).
        primaryNic = adapters.FirstOrDefault(a => a.Nic.NetworkInterfaceType == NetworkInterfaceType.Wireless80211)
            ?? adapters.FirstOrDefault(a => a.Nic.GetIPProperties().GatewayAddresses.Count > 0);
        pinger.Gateway = primaryNic?.Nic.GetIPProperties().GatewayAddresses.Select(g => g.Address)
            .FirstOrDefault(a => a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork);
    }

    static bool HasIPv4(NetworkInterface n)
    {
        try { return n.GetIPProperties().UnicastAddresses.Any(u => u.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork); }
        catch (NetworkInformationException) { return false; }
    }

    static Adapter Refresh(Adapter a, NetworkInterface n)
    {
        a.Nic = n;
        try
        {
            var ip = n.GetIPProperties();
            string Addr(System.Net.Sockets.AddressFamily f) => string.Join(", ", ip.UnicastAddresses.Where(u => u.Address.AddressFamily == f && !u.Address.IsIPv6LinkLocal).Select(u => u.Address.ToString()));
            a.Details = new
            {
                type = n.NetworkInterfaceType.ToString(),
                mac = string.Join(':', n.GetPhysicalAddress().GetAddressBytes().Select(b => b.ToString("X2"))),
                ipv4 = Addr(System.Net.Sockets.AddressFamily.InterNetwork),
                ipv6 = Addr(System.Net.Sockets.AddressFamily.InterNetworkV6),
                gateway = string.Join(", ", ip.GatewayAddresses.Select(g => g.Address.ToString()).Where(g => g != "0.0.0.0")),
                dns = string.Join(", ", ip.DnsAddresses.Select(d => d.ToString())),
                dhcp = n.Supports(NetworkInterfaceComponent.IPv4) && ip.GetIPv4Properties()?.IsDhcpEnabled == true,
            };
        }
        catch (NetworkInformationException) { }
        a.Wifi = n.NetworkInterfaceType == NetworkInterfaceType.Wireless80211 && Guid.TryParse(n.Id, out var g) ? Wlan.Query(g) : null;
        return a;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MEMORYSTATUSEX { public uint Length, Load; public ulong Total, Avail, TotalPage, AvailPage, TotalVirtual, AvailVirtual, AvailExtended; }
    [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX m);
    static (long Total, long Available) Memory()
    {
        var m = new MEMORYSTATUSEX { Length = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() };
        return GlobalMemoryStatusEx(ref m) ? ((long)m.Total, (long)m.Avail) : (0, 0);
    }

    static string CpuName() =>
        (Registry.GetValue(@"HKEY_LOCAL_MACHINE\HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString", null) as string)?.Trim() ?? "Processor";

    public void Dispose() { pdh.Dispose(); processes.Dispose(); sensors.Dispose(); pinger.Dispose(); }
}

// Round-trip time to the router (and, only when the user opts in, to 1.1.1.1) once a second while the
// Network tab is open. Keeps the last 30 replies per target for average, jitter and loss.
sealed class Pinger : IDisposable
{
    const string InternetHost = "1.1.1.1";
    readonly Thread thread;
    volatile bool on, internet, stop;
    public volatile System.Net.IPAddress? Gateway;
    readonly Queue<long?> gw = new(), net = new();
    readonly object gate = new();

    public Pinger() { thread = new Thread(Run) { IsBackground = true, Name = "Pinger" }; thread.Start(); }
    public void Set(bool on, bool internet) { this.on = on; this.internet = internet; if (!internet) lock (gate) net.Clear(); }

    void Run()
    {
        using var ping = new Ping();
        while (!stop)
        {
            if (on)
            {
                if (Gateway is { } g) Record(gw, Send(ping, g.ToString()));
                if (internet) Record(net, Send(ping, InternetHost));
            }
            Thread.Sleep(1000);
        }
    }

    static long? Send(Ping ping, string host)
    {
        try { var r = ping.Send(host, 1000); return r.Status == IPStatus.Success ? r.RoundtripTime : null; }
        catch (PingException) { return null; }
    }

    void Record(Queue<long?> q, long? ms) { lock (gate) { q.Enqueue(ms); while (q.Count > 30) q.Dequeue(); } }

    static object? Stats(Queue<long?> q)
    {
        if (q.Count == 0) return null;
        var ok = q.Where(v => v.HasValue).Select(v => (double)v!.Value).ToArray();
        double jitter = ok.Length > 1 ? ok.Zip(ok.Skip(1), (a, b) => Math.Abs(b - a)).Average() : 0;
        return new { last = q.Last(), avg = ok.Length > 0 ? Math.Round(ok.Average(), 1) : (double?)null, jitter = Math.Round(jitter, 1), loss = Math.Round(100.0 * (q.Count - ok.Length) / q.Count, 1), samples = q.Count };
    }

    public object? Summary()
    {
        if (!on) return null;
        lock (gate) return new { gateway = Gateway?.ToString(), router = Stats(gw), internetHost = internet ? InternetHost : null, internet = internet ? Stats(net) : null };
    }

    public void Dispose() { stop = true; thread.Join(1500); }
}

// Minimal PDH wrapper: English counter paths (work on any display language), doubles, wildcard arrays.
sealed class Pdh : IDisposable
{
    const uint Fmt = 0x200 | 0x8000;   // PDH_FMT_DOUBLE | PDH_FMT_NOCAP100
    const int MoreData = unchecked((int)0x800007D2);
    readonly IntPtr query;

    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhOpenQueryW(string? source, IntPtr user, out IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhAddEnglishCounterW(IntPtr query, string path, IntPtr user, out IntPtr counter);
    [DllImport("pdh.dll")] static extern int PdhCollectQueryData(IntPtr query);
    [DllImport("pdh.dll")] static extern int PdhGetFormattedCounterValue(IntPtr counter, uint format, out uint type, out FmtValue value);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhGetFormattedCounterArrayW(IntPtr counter, uint format, ref uint size, out uint count, IntPtr buffer);
    [DllImport("pdh.dll")] static extern int PdhCloseQuery(IntPtr query);

    [StructLayout(LayoutKind.Explicit)] struct FmtValue { [FieldOffset(0)] public uint Status; [FieldOffset(8)] public double Double; }

    public Pdh() { if (PdhOpenQueryW(null, IntPtr.Zero, out query) != 0) throw new InvalidOperationException("PDH unavailable"); }

    // A counter this PC lacks (no GPU driver counters, say) yields Zero and reads as empty.
    public IntPtr Add(string path) => PdhAddEnglishCounterW(query, path, IntPtr.Zero, out var c) == 0 ? c : IntPtr.Zero;
    public void Collect() => PdhCollectQueryData(query);

    public double Value(IntPtr counter) =>
        counter != IntPtr.Zero && PdhGetFormattedCounterValue(counter, Fmt, out _, out var v) == 0 && v.Status <= 1 ? v.Double : 0;

    public List<(string Name, double Value)> Array(IntPtr counter)
    {
        var list = new List<(string, double)>();
        if (counter == IntPtr.Zero) return list;
        for (int attempt = 0; attempt < 3; attempt++)
        {
            uint size = 0;
            if (PdhGetFormattedCounterArrayW(counter, Fmt, ref size, out _, IntPtr.Zero) != MoreData) return list;
            var buf = Marshal.AllocHGlobal((int)size);
            try
            {
                int r = PdhGetFormattedCounterArrayW(counter, Fmt, ref size, out uint count, buf);
                if (r == MoreData) continue;   // instances appeared between the two calls
                if (r != 0) return list;
                // PDH_FMT_COUNTERVALUE_ITEM_W on x64: name pointer, status (+pad), double = 24 bytes
                for (int i = 0; i < count; i++)
                {
                    var item = buf + i * 24;
                    if (Marshal.ReadInt32(item, 8) > 1) continue;
                    list.Add((Marshal.PtrToStringUni(Marshal.ReadIntPtr(item)) ?? "", BitConverter.Int64BitsToDouble(Marshal.ReadInt64(item, 16))));
                }
                return list;
            }
            finally { Marshal.FreeHGlobal(buf); }
        }
        return list;
    }

    public void Dispose() => PdhCloseQuery(query);
}

// Hardware GPUs via DXGI, most dedicated memory first: the first is the primary GPU (the discrete card on
// a hybrid laptop) that the dashboard, overlay and sensors follow; the GPU tab can show each.
static class Gpu
{
    public sealed record Adapter(string Name, string Luid, ulong Dedicated, ulong Shared, uint VendorId);

    [ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDXGIFactory1
    {
        void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
        void EnumAdapters(); void MakeWindowAssociation(); void GetWindowAssociation(); void CreateSwapChain(); void CreateSoftwareAdapter();
        [PreserveSig] int EnumAdapters1(uint index, out IDXGIAdapter1 adapter);
    }

    [ComImport, Guid("29038f61-3839-4626-91fd-086879011a05"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDXGIAdapter1
    {
        void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
        void EnumOutputs(); void GetDesc(); void CheckInterfaceSupport();
        [PreserveSig] int GetDesc1(out Desc1 desc);
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Desc1
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
        public uint VendorId, DeviceId, SubSysId, Revision;
        public nuint DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
        public uint LuidLow; public int LuidHigh; public uint Flags;
    }

    [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid riid, out IDXGIFactory1 factory);

    public static IReadOnlyList<Adapter> All()
    {
        try
        {
            var iid = typeof(IDXGIFactory1).GUID;
            if (CreateDXGIFactory1(ref iid, out var factory) != 0) return [];
            var all = new List<Adapter>();
            for (uint i = 0; factory.EnumAdapters1(i, out var a) == 0; i++)
            {
                if (a.GetDesc1(out var d) == 0 && (d.Flags & 2) == 0)   // skip DXGI_ADAPTER_FLAG_SOFTWARE
                {
                    var luid = $"luid_0x{d.LuidHigh:X8}_0x{d.LuidLow:X8}";
                    if (all.All(x => x.Luid != luid))   // an adapter can be listed once per output
                        all.Add(new Adapter(d.Description.Trim(), luid, d.DedicatedVideoMemory, d.SharedSystemMemory, d.VendorId));
                }
                Marshal.ReleaseComObject(a);
            }
            Marshal.ReleaseComObject(factory);
            return all.OrderByDescending(a => a.Dedicated).ToList();
        }
        catch (Exception ex) when (ex is COMException or DllNotFoundException or InvalidCastException) { return []; }
    }
}

// The current Wi-Fi connection from the Native Wifi API. Windows 11 may withhold it from desktop apps
// until location access is allowed; then Query returns null.
static class Wlan
{
    public sealed record Info(string Ssid, int Signal, string? Standard, int? Channel, string? Band, int RxMbps, int TxMbps);

    static IntPtr handle;
    static bool unavailable;

    [DllImport("wlanapi.dll")] static extern int WlanOpenHandle(uint version, IntPtr reserved, out uint negotiated, out IntPtr handle);
    [DllImport("wlanapi.dll")] static extern int WlanQueryInterface(IntPtr handle, ref Guid iface, int opcode, IntPtr reserved, out uint size, out IntPtr data, IntPtr type);
    [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr memory);

    public static Info? Query(Guid iface)
    {
        try
        {
            if (unavailable) return null;
            if (handle == IntPtr.Zero && WlanOpenHandle(2, IntPtr.Zero, out _, out handle) != 0) { unavailable = true; return null; }
            // wlan_intf_opcode_current_connection -> WLAN_CONNECTION_ATTRIBUTES; WLAN_ASSOCIATION_ATTRIBUTES at 520
            if (WlanQueryInterface(handle, ref iface, 7, IntPtr.Zero, out _, out var data, IntPtr.Zero) != 0) return null;
            string ssid; int phy, signal, rx, tx;
            try
            {
                int len = Math.Clamp(Marshal.ReadInt32(data, 520), 0, 32);
                var bytes = new byte[len];
                Marshal.Copy(data + 524, bytes, 0, len);
                ssid = System.Text.Encoding.UTF8.GetString(bytes);
                phy = Marshal.ReadInt32(data, 568);
                signal = Marshal.ReadInt32(data, 576);
                rx = Marshal.ReadInt32(data, 580) / 1000;   // kbps -> Mbps
                tx = Marshal.ReadInt32(data, 584) / 1000;
            }
            finally { WlanFreeMemory(data); }
            int? channel = null;
            if (WlanQueryInterface(handle, ref iface, 8, IntPtr.Zero, out _, out var ch, IntPtr.Zero) == 0)   // wlan_intf_opcode_channel_number
            {
                channel = Marshal.ReadInt32(ch);
                WlanFreeMemory(ch);
            }
            string? standard = phy switch { 4 => "802.11a", 5 => "802.11b", 6 => "802.11g", 7 => "Wi-Fi 4 (802.11n)", 8 => "Wi-Fi 5 (802.11ac)", 10 => "Wi-Fi 6 (802.11ax)", 11 => "Wi-Fi 7 (802.11be)", _ => null };
            // ponytail: band from the channel number alone; 6 GHz channels reuse 1–233, so Wi-Fi 6E/7 on 6 GHz can read as 2.4/5 GHz. Read the BSS centre frequency if that matters.
            string? band = channel switch { >= 1 and <= 14 => "2.4 GHz", >= 32 and <= 177 => "5 GHz", > 177 => "6 GHz", _ => null };
            return new Info(ssid, signal, standard, channel, band, rx, tx);
        }
        catch (DllNotFoundException) { unavailable = true; return null; }
    }
}
