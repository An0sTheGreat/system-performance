using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
using System.Runtime.Intrinsics.X86;
using System.Text.Json;

namespace SystemPerformance;

// What the hardware is (not what it's doing): read once, on demand, for the detail tabs. WMI queries take
// a second or two, so the page asks for this after the dashboard is up. Every part is best-effort: a
// query that fails leaves its fields empty instead of failing the whole inventory.
static class Inventory
{
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static string BuildJson(IReadOnlyList<Gpu.Adapter> gpus) => JsonSerializer.Serialize(new
    {
        cpu = Cpu(),
        platform = Platform(),
        gpus = Gpus(gpus),
        memory = Memory(),
        disks = Disks(),
        volumes = Volumes(),
    }, Json);

    // ---- WMI helper ----
    static List<Dictionary<string, object?>> Wmi(string wql, string scope = @"root\cimv2")
    {
        var rows = new List<Dictionary<string, object?>>();
        try
        {
            using var searcher = new ManagementObjectSearcher(new ManagementScope(scope), new ObjectQuery(wql));
            foreach (var o in searcher.Get())
            {
                using (o)
                {
                    var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                    foreach (var p in o.Properties) row[p.Name] = p.Value;
                    rows.Add(row);
                }
            }
        }
        catch (Exception ex) when (ex is ManagementException or COMException or UnauthorizedAccessException) { Debug.WriteLine(ex); }
        return rows;
    }
    static string? Str(Dictionary<string, object?> r, string k) => r.TryGetValue(k, out var v) && v is not null ? v.ToString()?.Trim() : null;
    static long? Num(Dictionary<string, object?> r, string k) => r.TryGetValue(k, out var v) && v is not null && long.TryParse(v.ToString(), out var n) ? n : null;

    // ---- CPU ----
    static object Cpu()
    {
        var p = Wmi("SELECT Name, Manufacturer, MaxClockSpeed, VirtualizationFirmwareEnabled, SocketDesignation FROM Win32_Processor");
        var topo = Topology();
        var sets = new List<string>();
        void Add(bool ok, string name) { if (ok) sets.Add(name); }
        Add(Sse42.IsSupported, "SSE4.2"); Add(Avx.IsSupported, "AVX"); Add(Avx2.IsSupported, "AVX2"); Add(Fma.IsSupported, "FMA3");
        Add(Avx512F.IsSupported, "AVX-512"); Add(AvxVnni.IsSupported, "AVX-VNNI"); Add(Aes.IsSupported, "AES-NI"); Add(Bmi2.IsSupported, "BMI2");
        return new
        {
            name = p.Select(r => Str(r, "Name")).FirstOrDefault(n => n is not null),
            manufacturer = p.Select(r => Str(r, "Manufacturer")).FirstOrDefault(n => n is not null),
            sockets = Math.Max(p.Count, topo.Packages),
            cores = topo.Cores,
            performanceCores = topo.Hybrid ? topo.PCores : (int?)null,
            efficiencyCores = topo.Hybrid ? topo.Cores - topo.PCores : (int?)null,
            logical = Environment.ProcessorCount,
            baseMhz = p.Select(r => Num(r, "MaxClockSpeed")).FirstOrDefault(n => n is not null),
            l1Kb = topo.L1 / 1024, l2Kb = topo.L2 / 1024, l3Kb = topo.L3 / 1024,
            virtualization = p.Select(r => r.GetValueOrDefault("VirtualizationFirmwareEnabled") as bool?).FirstOrDefault(),
            socket = p.Select(r => Str(r, "SocketDesignation")).FirstOrDefault(n => n is not null),
            instructionSets = sets,
            architecture = RuntimeInformation.OSArchitecture.ToString(),
        };
    }

    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetLogicalProcessorInformationEx(int relation, IntPtr buffer, ref uint length);

    // Cores, hybrid (P/E) split and cache sizes from the processor topology. A hybrid CPU reports more than
    // one efficiency class; the highest class is the performance cores.
    static (int Cores, int PCores, bool Hybrid, int Packages, long L1, long L2, long L3) Topology()
    {
        uint len = 0;
        GetLogicalProcessorInformationEx(0xFFFF, IntPtr.Zero, ref len);
        if (len == 0) return (Environment.ProcessorCount, 0, false, 1, 0, 0, 0);
        var buf = Marshal.AllocHGlobal((int)len);
        try
        {
            if (!GetLogicalProcessorInformationEx(0xFFFF, buf, ref len)) return (Environment.ProcessorCount, 0, false, 1, 0, 0, 0);
            var classes = new List<byte>();
            int packages = 0;
            long l1 = 0, l2 = 0, l3 = 0;
            for (int off = 0; off < len;)
            {
                var item = buf + off;
                int relation = Marshal.ReadInt32(item), size = Marshal.ReadInt32(item, 4);
                switch (relation)
                {
                    case 0: classes.Add(Marshal.ReadByte(item, 9)); break;      // RelationProcessorCore: EfficiencyClass
                    case 3: packages++; break;                                    // RelationProcessorPackage
                    case 2:                                                       // RelationCache: level, size
                        long bytes = (uint)Marshal.ReadInt32(item, 12);
                        switch (Marshal.ReadByte(item, 8)) { case 1: l1 += bytes; break; case 2: l2 += bytes; break; case 3: l3 += bytes; break; }
                        break;
                }
                if (size <= 0) break;
                off += size;
            }
            byte top = classes.Count > 0 ? classes.Max() : (byte)0;
            return (classes.Count, classes.Count(c => c == top), classes.Distinct().Count() > 1, Math.Max(1, packages), l1, l2, l3);
        }
        finally { Marshal.FreeHGlobal(buf); }
    }

    static object Platform()
    {
        var board = Wmi("SELECT Manufacturer, Product FROM Win32_BaseBoard").FirstOrDefault() ?? [];
        var bios = Wmi("SELECT SMBIOSBIOSVersion, ReleaseDate FROM Win32_BIOS").FirstOrDefault() ?? [];
        var os = Wmi("SELECT Caption, BuildNumber, LastBootUpTime FROM Win32_OperatingSystem").FirstOrDefault() ?? [];
        return new
        {
            board = string.Join(' ', new[] { Str(board, "Manufacturer"), Str(board, "Product") }.Where(s => !string.IsNullOrEmpty(s))),
            bios = Str(bios, "SMBIOSBIOSVersion"),
            biosDate = Date(Str(bios, "ReleaseDate")),
            os = Str(os, "Caption"),
            build = Str(os, "BuildNumber"),
        };
    }

    // WMI dates look like "20240115000000.000000+000".
    static string? Date(string? wmi) => wmi is { Length: >= 8 } ? $"{wmi[..4]}-{wmi[4..6]}-{wmi[6..8]}" : null;

    // ---- GPUs: DXGI for memory and identity, WMI for the driver ----
    static object Gpus(IReadOnlyList<Gpu.Adapter> adapters)
    {
        var wmi = Wmi("SELECT Name, DriverVersion, DriverDate, VideoProcessor, CurrentRefreshRate, CurrentHorizontalResolution, CurrentVerticalResolution FROM Win32_VideoController");
        return adapters.Select((a, i) =>
        {
            var w = wmi.FirstOrDefault(r => string.Equals(Str(r, "Name"), a.Name, StringComparison.OrdinalIgnoreCase)) ?? [];
            return new
            {
                name = a.Name, luid = a.Luid, primary = i == 0, vendor = Vendor(a.VendorId),
                dedicated = a.Dedicated, shared = a.Shared,
                driver = Str(w, "DriverVersion"), driverDate = Date(Str(w, "DriverDate")),
                display = Num(w, "CurrentHorizontalResolution") is long x && Num(w, "CurrentVerticalResolution") is long y
                    ? $"{x} × {y}" + (Num(w, "CurrentRefreshRate") is long hz and > 1 ? $" @ {hz} Hz" : "") : null,
            };
        }).ToArray();
    }
    static string Vendor(uint id) => id switch { 0x10DE => "NVIDIA", 0x1002 => "AMD", 0x8086 => "Intel", 0x1414 => "Microsoft", _ => $"0x{id:X4}" };

    // ---- Memory modules ----
    static object Memory()
    {
        var dimms = Wmi("SELECT BankLabel, DeviceLocator, Capacity, Speed, ConfiguredClockSpeed, Manufacturer, PartNumber, SMBIOSMemoryType, FormFactor FROM Win32_PhysicalMemory");
        var arrays = Wmi("SELECT MemoryDevices FROM Win32_PhysicalMemoryArray");
        return new
        {
            slots = arrays.Sum(r => Num(r, "MemoryDevices") ?? 0) is long s and > 0 ? s : (long?)null,
            modules = dimms.Select(d => new
            {
                slot = Str(d, "DeviceLocator") ?? Str(d, "BankLabel"),
                capacity = Num(d, "Capacity"),
                ratedMts = Num(d, "Speed"),
                configuredMts = Num(d, "ConfiguredClockSpeed"),
                manufacturer = Str(d, "Manufacturer"),
                part = Str(d, "PartNumber"),
                type = (Num(d, "SMBIOSMemoryType") ?? 0) switch { 20 => "DDR", 21 => "DDR2", 24 => "DDR3", 26 => "DDR4", 34 => "DDR5", 35 => "LPDDR5", 30 => "LPDDR4", _ => null },
                formFactor = (Num(d, "FormFactor") ?? 0) switch { 8 => "DIMM", 12 => "SODIMM", _ => null },
            }).ToArray(),
        };
    }

    // ---- Physical disks (Storage Management API) ----
    static object Disks() => Wmi("SELECT DeviceId, FriendlyName, MediaType, BusType, Size, HealthStatus, SpindleSpeed FROM MSFT_PhysicalDisk", @"root\Microsoft\Windows\Storage")
        .Select(d => new
        {
            number = Num(d, "DeviceId"),
            model = Str(d, "FriendlyName"),
            media = (Num(d, "MediaType") ?? 0) switch { 3 => "HDD", 4 => "SSD", 5 => "SCM", _ => null },
            bus = (Num(d, "BusType") ?? 0) switch { 17 => "NVMe", 11 => "SATA", 7 => "USB", 10 => "SAS", 8 => "RAID", 3 => "ATA", 18 => "SCM", 15 => "File-backed virtual", 14 => "Virtual", _ => null },
            size = Num(d, "Size"),
            health = (Num(d, "HealthStatus") ?? -1) switch { 0 => "Healthy", 1 => "Warning", 2 => "Unhealthy", _ => null },
            rpm = Num(d, "SpindleSpeed") is long r and > 0 and < uint.MaxValue ? r : (long?)null,
        })
        .OrderBy(d => d.number)
        .ToArray();

    static object Volumes() => DriveInfo.GetDrives()
        .Where(d => d.DriveType is DriveType.Fixed or DriveType.Removable)
        .Select(d =>
        {
            try { return d.IsReady ? new { letter = d.Name[..1].ToUpperInvariant(), label = d.VolumeLabel, fileSystem = d.DriveFormat, total = d.TotalSize, free = d.TotalFreeSpace } : null; }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return null; }
        })
        .Where(v => v is not null)
        .ToArray();
}
