using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Win32;

namespace SystemPerformance;

// Reads everything the dashboard shows. All performance counters sit in one PDH query, so a tick is one
// PdhCollectQueryData call plus a few cheap Win32 reads. Slow lookups (adapters, drive sizes, Wi-Fi
// signal) refresh every SlowMs, not every tick.
sealed class Sampler : IDisposable
{
    const long SlowMs = 2000;
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    readonly Pdh pdh = new();
    readonly IntPtr cpuTotal, cpuPerf, cpuFreq, cpuCores, procs, threads, commit, commitLimit,
        diskIdle, diskRead, diskWrite, diskLatency, gpuEngine, gpuDedicated, gpuShared;
    readonly Gpu.Adapter? gpu = Gpu.Primary();
    readonly string cpuName = CpuName();

    long nextSlow;
    readonly Dictionary<char, (long Used, long Total)> drives = [];
    NetworkInterface? nic;
    long rx0, tx0, netAt;
    readonly Stopwatch clock = Stopwatch.StartNew();
    (string? Ssid, int? Signal) wifi;

    // Per-process sampling runs only while the page shows the Top apps sheet, once a second.
    readonly ProcessSampler processes = new();
    readonly Sensors sensors;
    public bool WatchSensors { set => sensors.WatchAll = value; }
    readonly Dictionary<int, double> gpuByPid = [];
    volatile bool watch;
    long nextProcs;
    bool primed;
    // The headline numbers of the last sample, for the overlay and the tray icon.
    public Overlay.Reading Latest { get; private set; }
    double? lastGpu, lastRx, lastTx;

    public bool WatchProcesses { set { watch = value; nextProcs = 0; primed = false; } }

    public Sampler()
    {
        cpuTotal = pdh.Add(@"\Processor Information(_Total)\% Processor Utility");
        cpuPerf = pdh.Add(@"\Processor Information(_Total)\% Processor Performance");
        cpuFreq = pdh.Add(@"\Processor Information(_Total)\Processor Frequency");
        cpuCores = pdh.Add(@"\Processor Information(*)\% Processor Utility");
        procs = pdh.Add(@"\System\Processes");
        threads = pdh.Add(@"\System\Threads");
        commit = pdh.Add(@"\Memory\Committed Bytes");
        commitLimit = pdh.Add(@"\Memory\Commit Limit");
        diskIdle = pdh.Add(@"\PhysicalDisk(*)\% Idle Time");
        diskRead = pdh.Add(@"\PhysicalDisk(*)\Disk Read Bytes/sec");
        diskWrite = pdh.Add(@"\PhysicalDisk(*)\Disk Write Bytes/sec");
        diskLatency = pdh.Add(@"\PhysicalDisk(*)\Avg. Disk sec/Transfer");
        gpuEngine = pdh.Add(@"\GPU Engine(*)\Utilization Percentage");
        gpuDedicated = pdh.Add(@"\GPU Adapter Memory(*)\Dedicated Usage");
        gpuShared = pdh.Add(@"\GPU Adapter Memory(*)\Shared Usage");
        pdh.Collect();   // rate counters need a previous sample
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

    public string SampleJson()
    {
        pdh.Collect();
        long now = clock.ElapsedMilliseconds;
        if (now >= nextSlow) { RefreshSlow(); nextSlow = now + SlowMs; }
        var mem = Memory();
        double cpu = Math.Min(100, pdh.Value(cpuTotal));
        lastGpu = null; lastRx = lastTx = null;
        var gpuSample = GpuSample();
        var netSample = Net(now);
        sensors.Want();
        var sensed = sensors.Latest;
        Latest = new Overlay.Reading(cpu, lastGpu, mem.Total > 0 ? (mem.Total - mem.Available) * 100.0 / mem.Total : 0, lastRx, lastTx, sensed.CpuTemp, sensed.GpuTemp);
        return JsonSerializer.Serialize(new
        {
            type = "metrics",
            data = new
            {
                cpu = new
                {
                    total = cpu,
                    cores = Cores(),
                    mhz = pdh.Value(cpuFreq) * pdh.Value(cpuPerf) / 100,
                    processes = (int)pdh.Value(procs),
                    threads = (int)pdh.Value(threads),
                    uptime = Environment.TickCount64,
                },
                mem = new { total = mem.Total, used = mem.Total - mem.Available, commit = (long)pdh.Value(commit), commitLimit = (long)pdh.Value(commitLimit) },
                disks = Disks(),
                net = netSample,
                gpu = gpuSample,
                procs = ProcSample(now),   // after GpuSample: it fills gpuByPid
                sensors = sensed,
                sensorList = sensors.TakeList(),
            },
        }, Json);
    }

    double[] Cores()
    {
        // Instances are "group,index" plus "_Total" rows; order by group then index like Task Manager.
        return pdh.Array(cpuCores)
            .Where(c => !c.Name.Contains("_Total"))
            .Select(c => (Key: c.Name.Split(','), c.Value))
            .Where(c => c.Key.Length == 2 && int.TryParse(c.Key[0], out _) && int.TryParse(c.Key[1], out _))
            .OrderBy(c => int.Parse(c.Key[0])).ThenBy(c => int.Parse(c.Key[1]))
            .Select(c => Math.Round(Math.Min(100, c.Value), 1)).ToArray();
    }

    object[] Disks()
    {
        var read = pdh.Array(diskRead).ToDictionary(d => d.Name, d => d.Value);
        var write = pdh.Array(diskWrite).ToDictionary(d => d.Name, d => d.Value);
        var latency = pdh.Array(diskLatency).ToDictionary(d => d.Name, d => d.Value);
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
                    used, total,
                };
            }).ToArray();
    }

    object? Net(long now)
    {
        if (nic is null) return null;
        try
        {
            var s = nic.GetIPStatistics();
            double secs = Math.Max(0.001, (now - netAt) / 1000.0);
            double rx = Math.Max(0, (s.BytesReceived - rx0) / secs), tx = Math.Max(0, (s.BytesSent - tx0) / secs);
            bool first = netAt == 0;
            (rx0, tx0, netAt) = (s.BytesReceived, s.BytesSent, now);
            return new
            {
                name = nic.Name, description = nic.Description, wireless = nic.NetworkInterfaceType == NetworkInterfaceType.Wireless80211,
                ssid = wifi.Ssid, signal = wifi.Signal, linkMbps = nic.Speed / 1_000_000,
                rx = lastRx = first ? 0 : rx, tx = lastTx = first ? 0 : tx,
            };
        }
        catch (NetworkInformationException) { nic = null; return null; }
    }

    object? GpuSample()
    {
        if (gpu is null) return null;
        // "pid_1234_luid_0x00000000_0x0000C2E1_phys_0_eng_0_engtype_3D": Task Manager's GPU % is the busiest
        // engine type, each type summed over processes. Numbered engines (Compute_0, Compute_1) fold into one.
        var engines = new Dictionary<string, double>();
        var perPid = watch ? new Dictionary<(int Pid, string Type), double>() : null;
        foreach (var e in pdh.Array(gpuEngine))
        {
            if (!e.Name.Contains(gpu.Luid, StringComparison.OrdinalIgnoreCase)) continue;
            int at = e.Name.IndexOf("engtype_", StringComparison.Ordinal);
            if (at < 0) continue;
            var type = e.Name[(at + 8)..];
            int us = type.LastIndexOf('_');
            if (us > 0 && type[(us + 1)..].All(char.IsDigit)) type = type[..us];
            engines[type] = engines.GetValueOrDefault(type) + e.Value;
            int end = e.Name.IndexOf('_', 4);
            if (perPid != null && e.Name.StartsWith("pid_", StringComparison.Ordinal) && end > 4 && int.TryParse(e.Name.AsSpan(4, end - 4), out int pid))
                perPid[(pid, type)] = perPid.GetValueOrDefault((pid, type)) + e.Value;
        }
        if (perPid != null)
        {
            // A process's GPU % is its busiest engine type, as in Task Manager.
            gpuByPid.Clear();
            foreach (var (k, v) in perPid) gpuByPid[k.Pid] = Math.Max(gpuByPid.GetValueOrDefault(k.Pid), v);
        }
        var rounded = engines.ToDictionary(e => e.Key, e => Math.Round(Math.Min(100, e.Value), 1));
        long Mem(IntPtr c) => (long)pdh.Array(c).Where(m => m.Name.Contains(gpu.Luid, StringComparison.OrdinalIgnoreCase)).Sum(m => m.Value);
        lastGpu = rounded.Count == 0 ? 0 : rounded.Values.Max();
        return new { util = lastGpu, engines = rounded, dedicatedUsed = Mem(gpuDedicated), sharedUsed = Mem(gpuShared) };
    }

    object? ProcSample(long now)
    {
        if (!watch || now < nextProcs) return null;
        nextProcs = now + 1000;
        var apps = processes.Sample(gpuByPid);
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
        // Prefer a connected Wi-Fi adapter; otherwise the first up adapter with a gateway (Ethernet).
        var up = NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType is not (NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel))
            .ToArray();
        var pick = up.FirstOrDefault(n => n.NetworkInterfaceType == NetworkInterfaceType.Wireless80211)
            ?? up.FirstOrDefault(n => n.GetIPProperties().GatewayAddresses.Count > 0);
        if (pick?.Id != nic?.Id) { nic = pick; netAt = 0; }
        wifi = nic?.NetworkInterfaceType == NetworkInterfaceType.Wireless80211 && Guid.TryParse(nic.Id, out var g) ? Wlan.Query(g) : (null, null);
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

    public void Dispose() { pdh.Dispose(); processes.Dispose(); sensors.Dispose(); }
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

// The primary GPU via DXGI: the hardware adapter with the most dedicated memory (the discrete card on a
// hybrid laptop). ponytail: one GPU shown; add a picker if multi-GPU desktops need each card.
static class Gpu
{
    public sealed record Adapter(string Name, string Luid, ulong Dedicated, ulong Shared);

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

    public static Adapter? Primary()
    {
        try
        {
            var iid = typeof(IDXGIFactory1).GUID;
            if (CreateDXGIFactory1(ref iid, out var factory) != 0) return null;
            var all = new List<Adapter>();
            for (uint i = 0; factory.EnumAdapters1(i, out var a) == 0; i++)
            {
                if (a.GetDesc1(out var d) == 0 && (d.Flags & 2) == 0)   // skip DXGI_ADAPTER_FLAG_SOFTWARE
                    all.Add(new Adapter(d.Description.Trim(), $"luid_0x{d.LuidHigh:X8}_0x{d.LuidLow:X8}", d.DedicatedVideoMemory, d.SharedSystemMemory));
                Marshal.ReleaseComObject(a);
            }
            Marshal.ReleaseComObject(factory);
            return all.OrderByDescending(a => a.Dedicated).FirstOrDefault();
        }
        catch (Exception ex) when (ex is COMException or DllNotFoundException or InvalidCastException) { return null; }
    }
}

// Current Wi-Fi network name and signal quality (0-100) from the Native Wifi API. Windows 11 may withhold
// these from desktop apps until location access is allowed; then both read as null.
static class Wlan
{
    static IntPtr handle;
    static bool unavailable;

    [DllImport("wlanapi.dll")] static extern int WlanOpenHandle(uint version, IntPtr reserved, out uint negotiated, out IntPtr handle);
    [DllImport("wlanapi.dll")] static extern int WlanQueryInterface(IntPtr handle, ref Guid iface, int opcode, IntPtr reserved, out uint size, out IntPtr data, IntPtr type);
    [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr memory);

    public static (string? Ssid, int? Signal) Query(Guid iface)
    {
        try
        {
            if (unavailable) return (null, null);
            if (handle == IntPtr.Zero && WlanOpenHandle(2, IntPtr.Zero, out _, out handle) != 0) { unavailable = true; return (null, null); }
            // wlan_intf_opcode_current_connection -> WLAN_CONNECTION_ATTRIBUTES
            if (WlanQueryInterface(handle, ref iface, 7, IntPtr.Zero, out _, out var data, IntPtr.Zero) != 0) return (null, null);
            try
            {
                int len = Math.Clamp(Marshal.ReadInt32(data, 520), 0, 32);   // DOT11_SSID after state, mode, profile name
                var ssid = new byte[len];
                Marshal.Copy(data + 524, ssid, 0, len);
                return (System.Text.Encoding.UTF8.GetString(ssid), Marshal.ReadInt32(data, 576));   // wlanSignalQuality
            }
            finally { WlanFreeMemory(data); }
        }
        catch (DllNotFoundException) { unavailable = true; return (null, null); }
    }
}
