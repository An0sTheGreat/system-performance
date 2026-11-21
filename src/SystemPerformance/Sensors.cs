using System.Diagnostics;
using System.Security.Principal;
using LibreHardwareMonitor.Hardware;
using Microsoft.Win32;

namespace SystemPerformance;

// Temperatures, power, clocks, fans and battery via LibreHardwareMonitor, on its own thread once a second
// (sensor reads can take tens of ms, which must never stall the 100 ms sampler). GPU and battery sensors
// work as a normal user; CPU and motherboard sensors need the PawnIO driver plus administrator rights,
// and drive temperatures need administrator rights. Anything unavailable reads as null.
sealed class Sensors : IDisposable
{
    public sealed record BatteryInfo(double Level, bool PluggedIn, bool Charging, double? Watts, double? RemainingSeconds);
    public sealed record Summary(
        bool Ready, bool Admin, bool PawnIO, string? Error,
        double? CpuTemp, double? CpuPower, double? GpuTemp, double? GpuHotSpot, double? GpuPower,
        double? GpuFanRpm, double? GpuFanPercent, double? GpuClock, double? GpuMemoryClock, BatteryInfo? Battery);

    public static readonly bool IsAdmin = new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
    static readonly bool HasPawnIO = PawnIOInstalled();
    static bool PawnIOInstalled() { using var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\PawnIO"); return key is not null; }

    readonly Computer computer = new()
    {
        IsCpuEnabled = true, IsGpuEnabled = true, IsMotherboardEnabled = true, IsStorageEnabled = true,
        IsBatteryEnabled = true, IsControllerEnabled = true, IsPsuEnabled = true,
    };
    readonly string? gpuName;
    readonly Thread thread;
    volatile bool stop, opened;
    long wantedUntil;   // keeps updating while the sampler keeps asking; idles otherwise
    int tick;

    public volatile Summary Latest = new(false, IsAdmin, HasPawnIO, null, null, null, null, null, null, null, null, null, null, null);
    public volatile bool WatchAll;   // the Sensors screen is open: also build the full list
    object? pendingList;

    public Sensors(string? gpuName)
    {
        this.gpuName = gpuName;
        thread = new Thread(Run) { IsBackground = true, Name = "Sensors", Priority = ThreadPriority.BelowNormal };
        thread.Start();
    }

    public void Want() => Interlocked.Exchange(ref wantedUntil, Environment.TickCount64 + 3000);
    public object? TakeList() => Interlocked.Exchange(ref pendingList, null);

    void Run()
    {
        try { computer.Open(); opened = true; }   // can take a few seconds (driver, SMBus, HID scans)
        catch (Exception ex) { Latest = Latest with { Error = ex.Message }; return; }
        while (!stop)
        {
            if (Environment.TickCount64 <= Interlocked.Read(ref wantedUntil))
            {
                try { Update(); }
                catch (Exception ex) { Debug.WriteLine(ex); }
            }
            Thread.Sleep(1000);
        }
    }

    void Update()
    {
        tick++;
        foreach (var hw in computer.Hardware)
        {
            if (hw.HardwareType == HardwareType.Storage && tick % 10 != 1) continue;   // SMART reads are slow: every 10 s
            hw.Update();
            foreach (var sub in hw.SubHardware) sub.Update();
        }
        Latest = Summarise();
        if (WatchAll) pendingList = List();
    }

    static IEnumerable<ISensor> All(IHardware hw) => hw.Sensors.Concat(hw.SubHardware.SelectMany(All));

    static double? Pick(IHardware? hw, SensorType type, params string[] names)
    {
        if (hw is null) return null;
        var live = All(hw).Where(s => s.SensorType == type && s.Value is float v && float.IsFinite(v)).ToList();
        foreach (var name in names)
            if (live.FirstOrDefault(s => s.Name.Equals(name, StringComparison.OrdinalIgnoreCase)) is { } hit) return Math.Round(hit.Value!.Value, 1);
        return names.Length == 0 && live.Count > 0 ? Math.Round(live[0].Value!.Value, 1) : null;
    }

    // A temperature or power of 0 means "not readable" (no driver), not a real reading.
    static double? Real(double? v) => v > 0 ? v : null;

    Summary Summarise()
    {
        var cpu = computer.Hardware.FirstOrDefault(h => h.HardwareType == HardwareType.Cpu);
        var gpus = computer.Hardware.Where(h => h.HardwareType is HardwareType.GpuNvidia or HardwareType.GpuAmd or HardwareType.GpuIntel).ToList();
        var gpu = gpus.FirstOrDefault(g => gpuName is not null && (gpuName.Contains(g.Name, StringComparison.OrdinalIgnoreCase) || g.Name.Contains(gpuName, StringComparison.OrdinalIgnoreCase)))
            ?? gpus.FirstOrDefault(g => g.HardwareType != HardwareType.GpuIntel) ?? gpus.FirstOrDefault();
        return Latest with
        {
            Ready = true,
            CpuTemp = Real(Pick(cpu, SensorType.Temperature, "CPU Package", "Core (Tctl/Tdie)", "Core Max", "Core Average")),
            CpuPower = Real(Pick(cpu, SensorType.Power, "CPU Package", "Package")),
            GpuTemp = Real(Pick(gpu, SensorType.Temperature, "GPU Core")),
            GpuHotSpot = Real(Pick(gpu, SensorType.Temperature, "GPU Hot Spot")),
            GpuPower = Real(Pick(gpu, SensorType.Power, "GPU Package", "GPU Power", "GPU Core")),
            GpuFanRpm = Pick(gpu, SensorType.Fan),
            GpuFanPercent = Pick(gpu, SensorType.Control),
            GpuClock = Real(Pick(gpu, SensorType.Clock, "GPU Core")),
            GpuMemoryClock = Real(Pick(gpu, SensorType.Clock, "GPU Memory")),
            Battery = Battery(),
        };
    }

    BatteryInfo? Battery()
    {
        var ps = System.Windows.Forms.SystemInformation.PowerStatus;   // GetSystemPowerStatus: level, plug and time left need no driver
        if (ps.BatteryChargeStatus.HasFlag(BatteryChargeStatus.NoSystemBattery)) return null;
        var hw = computer.Hardware.FirstOrDefault(h => h.HardwareType == HardwareType.Battery);
        bool plugged = ps.PowerLineStatus == PowerLineStatus.Online;
        return new BatteryInfo(
            Math.Round(ps.BatteryLifePercent * 100),
            plugged,
            ps.BatteryChargeStatus.HasFlag(BatteryChargeStatus.Charging),
            Real(plugged ? Pick(hw, SensorType.Power, "Charge Rate") : Pick(hw, SensorType.Power, "Discharge Rate")),
            !plugged && ps.BatteryLifeRemaining > 0 ? ps.BatteryLifeRemaining : null);
    }

    object List() => computer.Hardware
        .SelectMany(h => new[] { h }.Concat(h.SubHardware))
        .Select(h => new
        {
            name = h.Name,
            type = h.HardwareType.ToString(),
            sensors = h.Sensors.Where(Shown)
                .Select(s => new { name = s.Name, type = s.SensorType.ToString(), value = R(s.Value), min = R(s.Min), max = R(s.Max) })
                .ToArray(),
        })
        .Where(h => h.sensors.Length > 0)
        .ToArray();

    // Skips what would mislead or repeat: readings stuck at 0 because no driver can read them, and the
    // D3D engine loads the dashboard's GPU card already shows.
    static bool Shown(ISensor s) =>
        s.Value is float v && float.IsFinite(v) && !s.Name.StartsWith("D3D ", StringComparison.Ordinal)
        && !(s.SensorType is SensorType.Temperature or SensorType.Power or SensorType.Clock or SensorType.Voltage && s.Max is not > 0);

    static double? R(float? v) => v is float f && float.IsFinite(f) ? Math.Round(f, 2) : null;

    public void Dispose()
    {
        stop = true;
        thread.Join(2000);
        if (opened) try { computer.Close(); } catch (Exception ex) { Debug.WriteLine(ex); }
    }
}
