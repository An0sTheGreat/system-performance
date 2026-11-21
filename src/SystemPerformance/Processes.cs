using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace SystemPerformance;

// Every process in one NtQuerySystemInformation call (no per-process handles), grouped by program name
// like Task Manager's app rows. CPU and I/O are rates since the previous call.
sealed partial class ProcessSampler : IDisposable
{
    const int SystemProcessInformation = 5;
    const int InfoLengthMismatch = unchecked((int)0xC0000004);
    [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int infoClass, IntPtr buffer, int length, out int returned);

    IntPtr buffer;
    int size = 1 << 20;
    Dictionary<(long Pid, long Created), (long Cpu, long Io)> last = [], next = [];
    long lastAt;

    public sealed record App(string Name, int Count, double Cpu, long Mem, double Io, double Gpu, long Vram);

    public List<App> Sample(IReadOnlyDictionary<int, double> gpuByPid, IReadOnlyDictionary<int, long> vramByPid)
    {
        if (!Read()) return [];
        long now = Stopwatch.GetTimestamp();
        double elapsed100ns = lastAt == 0 ? 0 : Stopwatch.GetElapsedTime(lastAt, now).Ticks;
        lastAt = now;
        int cores = Environment.ProcessorCount;
        var apps = new Dictionary<string, (int Count, double Cpu, long Mem, double Io, double Gpu, long Vram)>(StringComparer.OrdinalIgnoreCase);

        // SYSTEM_PROCESS_INFORMATION (x64): next offset @0, private working set @8, create @32, user @40,
        // kernel @48, image name (UNICODE_STRING: length @56, buffer @64), pid @80, read/write bytes @232/@240.
        for (IntPtr p = buffer; ; )
        {
            long pid = Marshal.ReadIntPtr(p, 80);
            if (pid != 0)   // 0 is the Idle "process"
            {
                int nameLen = Marshal.ReadInt16(p, 56) / 2;
                string name = nameLen > 0 ? Marshal.PtrToStringUni(Marshal.ReadIntPtr(p, 64), nameLen) : pid == 4 ? "System" : "Unknown";
                long cpu = Marshal.ReadInt64(p, 40) + Marshal.ReadInt64(p, 48);
                long io = Marshal.ReadInt64(p, 232) + Marshal.ReadInt64(p, 240);
                var key = (pid, Marshal.ReadInt64(p, 32));
                double cpuPct = 0, ioRate = 0;
                if (elapsed100ns > 0 && last.TryGetValue(key, out var prev))
                {
                    cpuPct = Math.Max(0, (cpu - prev.Cpu) / (elapsed100ns * cores) * 100);
                    ioRate = Math.Max(0, (io - prev.Io) / (elapsed100ns / 1e7));
                }
                next[key] = (cpu, io);
                if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) name = name[..^4];
                var a = apps.GetValueOrDefault(name);
                apps[name] = (a.Count + 1, a.Cpu + cpuPct, a.Mem + Marshal.ReadInt64(p, 8), a.Io + ioRate, Math.Max(a.Gpu, gpuByPid.GetValueOrDefault((int)pid)), a.Vram + vramByPid.GetValueOrDefault((int)pid));
            }
            int offset = Marshal.ReadInt32(p);
            if (offset == 0) break;
            p += offset;
        }
        (last, next) = (next, last);
        next.Clear();
        return apps.Select(kv => new App(kv.Key, kv.Value.Count, Math.Round(Math.Min(100, kv.Value.Cpu), 2), kv.Value.Mem,
            Math.Round(kv.Value.Io), Math.Round(Math.Min(100, kv.Value.Gpu), 1), kv.Value.Vram)).ToList();
    }

    bool Read()
    {
        for (int attempt = 0; attempt < 4; attempt++)
        {
            if (buffer == IntPtr.Zero) buffer = Marshal.AllocHGlobal(size);
            int status = NtQuerySystemInformation(SystemProcessInformation, buffer, size, out int needed);
            if (status == 0) return true;
            if (status != InfoLengthMismatch) return false;
            Marshal.FreeHGlobal(buffer);
            buffer = IntPtr.Zero;
            size = Math.Max(size * 2, needed + (1 << 16));   // processes can start between calls: leave room
        }
        return false;
    }

    public void Dispose() { if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer); buffer = IntPtr.Zero; }

    // ---- End task ----

    // Ending these would crash Windows, log the user out, or close this app's own window (WebView2).
    static readonly HashSet<string> Protected = new(StringComparer.OrdinalIgnoreCase)
    {
        "System", "Idle", "Registry", "Secure System", "Memory Compression", "smss", "csrss", "wininit", "winlogon",
        "services", "lsass", "lsaiso", "svchost", "dwm", "fontdrvhost", "LsaIso", "MsMpEng", "SecurityHealthService",
        "SystemPerformance", "msedgewebview2", "Unknown",
    };

    [GeneratedRegex(@"^[\w .()+\-]{1,120}$")] private static partial Regex SafeName();

    // Ends every process with this program name. Returns (ended, failed, reason for the first failure).
    public static (int Ended, int Failed, string? Error) EndTask(string? name)
    {
        if (name is null || !SafeName().IsMatch(name)) return (0, 0, "Not a program name.");
        if (Protected.Contains(name)) return (0, 0, $"{name} is part of Windows or this app and can't be ended here.");
        int ended = 0, failed = 0;
        string? error = null;
        foreach (var p in Process.GetProcessesByName(name))
        {
            using (p)
            {
                try { p.Kill(); ended++; }
                catch (Exception ex) when (ex is Win32Exception or InvalidOperationException or NotSupportedException)
                {
                    if (ex is InvalidOperationException) continue;   // already exited
                    failed++;
                    error ??= ex is Win32Exception { NativeErrorCode: 5 } ? "Access denied: it belongs to Windows or another user, or needs administrator rights." : ex.Message;
                }
            }
        }
        if (ended == 0 && failed == 0) error = $"{name} is no longer running.";
        return (ended, failed, error);
    }
}
