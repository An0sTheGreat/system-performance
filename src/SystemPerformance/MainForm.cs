using System.Buffers;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace SystemPerformance;

sealed class MainForm : Form
{
    const string AppTitle = "System Performance";
    const string Origin = "https://app.sysperf/";
    const string Csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
        "connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    static readonly string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SystemPerformance");
    static readonly string PlacementFile = Path.Combine(DataDir, "window.json");
    static readonly Dictionary<string, string> Mime = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8", [".css"] = "text/css; charset=utf-8", [".js"] = "text/javascript; charset=utf-8",
        [".svg"] = "image/svg+xml", [".json"] = "application/json; charset=utf-8", [".png"] = "image/png",
    };

    readonly WebView2 web = new() { Dock = DockStyle.Fill };
    string theme = "system";

    // Sampling runs on its own thread; the UI thread only posts the finished JSON.
    Thread? sampler;
    Sampler? sampling;
    volatile int intervalMs = 1000;
    volatile bool minimized, closing;   // minimized = main window not on screen (minimised or in the tray)
    readonly NotifyIcon tray = new();
    bool quitting, trayHintShown, disposed;

    // Mini overlay and live tray icon. Their settings live here (overlay.json), not in the page, because the
    // tray menu changes them too; the page reads them with "overlayGet" and hears changes as {type: "overlay"}.
    sealed record OverlayState(bool Show = false, bool Locked = true, bool TrayCpu = true, int X = int.MinValue, int Y = int.MinValue);
    static readonly string OverlayFile = Path.Combine(DataDir, "overlay.json");
    static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);
    OverlayState ov = new();
    readonly Overlay overlay = new();
    readonly ToolStripMenuItem showOverlayItem = new("Show overlay") { CheckOnClick = true };
    readonly ToolStripMenuItem lockOverlayItem = new("Lock overlay (click-through)") { CheckOnClick = true };
    volatile bool overlayOn, trayLive;
    Icon? trayNumber;
    int trayValue = -1;
    long nextTray;
    int posting;   // 1 while a sample waits for the UI thread: a busy page skips ticks instead of queueing them
    readonly AutoResetEvent wake = new(false);

    public MainForm()
    {
        Text = AppTitle;
        using (var ico = typeof(MainForm).Assembly.GetManifestResourceStream("app.ico")!) Icon = new Icon(ico);
        MinimumSize = LogicalToDeviceUnits(new Size(960, 640));
        Size = LogicalToDeviceUnits(new Size(1360, 920));
        StartPosition = FormStartPosition.CenterScreen;
        RestorePlacement();
        ApplyTheme();
        Controls.Add(web);
        SystemEvents.UserPreferenceChanged += OnSystemPrefs;

        // Closing the window hides it to the tray; Quit in the tray menu exits.
        tray.Icon = Icon;
        tray.Text = AppTitle;
        tray.ContextMenuStrip = new ContextMenuStrip();
        tray.ContextMenuStrip.Items.Add("Open", null, (_, _) => ShowAndActivate());
        tray.ContextMenuStrip.Items.Add(showOverlayItem);
        tray.ContextMenuStrip.Items.Add(lockOverlayItem);
        tray.ContextMenuStrip.Items.Add(new ToolStripSeparator());
        tray.ContextMenuStrip.Items.Add("Quit", null, (_, _) => Quit());
        showOverlayItem.Click += (_, _) => SetOverlay(ov with { Show = showOverlayItem.Checked });
        lockOverlayItem.Click += (_, _) => SetOverlay(ov with { Locked = lockOverlayItem.Checked });
        tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) ShowAndActivate(); };
        tray.Visible = true;

        overlay.Moved += p => SetOverlay(ov with { X = p.X, Y = p.Y });
        try { ov = JsonSerializer.Deserialize<OverlayState>(File.ReadAllText(OverlayFile)) ?? new(); }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { }
    }

    protected override void OnShown(EventArgs e) { base.OnShown(e); SetOverlay(ov, save: false); }

    // Applies overlay settings everywhere: the overlay window, the tray menu and icon, the sampler, the page.
    void SetOverlay(OverlayState next, bool save = true)
    {
        bool placing = next.Show && !overlay.Visible;
        ov = next;
        overlayOn = ov.Show;
        trayLive = ov.TrayCpu;
        showOverlayItem.Checked = ov.Show;
        lockOverlayItem.Checked = ov.Locked;
        lockOverlayItem.Enabled = ov.Show;
        overlay.Locked = ov.Locked;
        if (!ov.TrayCpu && trayNumber is not null) { tray.Icon = Icon; trayNumber.Dispose(); trayNumber = null; trayValue = -1; }
        if (placing)
        {
            overlay.Show();
            overlay.ShowReading(sampling?.Latest ?? default);   // draws, which gives the window its size
            var saved = new Point(ov.X, ov.Y);
            var screen = Screen.AllScreens.FirstOrDefault(sc => sc.WorkingArea.Contains(saved)) ?? Screen.FromControl(this);
            overlay.Location = screen.WorkingArea.Contains(saved)
                ? saved
                : new Point(screen.WorkingArea.Right - overlay.Width - LogicalToDeviceUnits(16), screen.WorkingArea.Top + LogicalToDeviceUnits(16));
        }
        else if (!ov.Show && overlay.Visible) overlay.Hide();
        wake.Set();
        if (save)
        {
            try { Directory.CreateDirectory(DataDir); File.WriteAllText(OverlayFile, JsonSerializer.Serialize(ov)); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }
        if (web.CoreWebView2 is not null)
            web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "overlay", data = OverlayJson() }, WebJson));
    }

    object OverlayJson() => new { show = ov.Show, locked = ov.Locked, trayCpu = ov.TrayCpu };

    // Tray: tooltip always; the icon shows CPU % when that's on. At most once a second.
    void UpdateTray(Overlay.Reading r)
    {
        long now = Environment.TickCount64;
        if (now < nextTray) return;
        nextTray = now + 1000;
        var text = $"CPU {r.Cpu:0}% · RAM {r.Mem:0}%" + (r.Gpu is double g ? $" · GPU {g:0}%" : "");
        tray.Text = text.Length <= 127 ? text : AppTitle;
        overlay.KeepOnTop();
        int value = (int)Math.Round(r.Cpu);
        if (!ov.TrayCpu || value == trayValue) return;
        trayValue = value;
        var old = trayNumber;
        trayNumber = Overlay.NumberIcon(value, SystemInformation.SmallIconSize);
        tray.Icon = trayNumber;
        old?.Dispose();
    }

    void Quit() { quitting = true; Close(); }

    void UpdatePaused()
    {
        bool was = minimized;
        minimized = !Visible || WindowState == FormWindowState.Minimized;
        if (was && !minimized) wake.Set();
    }

    protected override void OnVisibleChanged(EventArgs e) { base.OnVisibleChanged(e); UpdatePaused(); }

    void OnSystemPrefs(object? s, UserPreferenceChangedEventArgs e) { if (theme == "system" && !IsDisposed) BeginInvoke(ApplyTheme); }

    public void ShowAndActivate()
    {
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        UpdatePaused();
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(DataDir, "webview"));   // localStorage persists here
            if (IsDisposed) return;
            await web.EnsureCoreWebView2Async(env);
            if (IsDisposed) return;
        }
        catch (Exception ex)
        {
            if (IsDisposed) return;
            MessageBox.Show(this, $"WebView2 could not start.\n\n{ex.Message}", AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }
        var core = web.CoreWebView2;
        core.Settings.IsStatusBarEnabled = false;
#if !DEBUG
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
#endif
        core.AddWebResourceRequestedFilter(Origin + "*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += ServeEmbedded;
        EventHandler<CoreWebView2NavigationStartingEventArgs> appOnly = (_, a) => { if (!a.Uri.StartsWith(Origin, StringComparison.OrdinalIgnoreCase)) a.Cancel = true; };
        core.NavigationStarting += appOnly;
        core.FrameNavigationStarting += appOnly;
        core.NewWindowRequested += (_, a) => a.Handled = true;
        core.DocumentTitleChanged += (_, _) => Text = string.IsNullOrWhiteSpace(core.DocumentTitle) ? AppTitle : core.DocumentTitle;
        core.WebMessageReceived += OnWebMessage;
        core.Navigate(Origin + "index.html");
    }

    void ServeEmbedded(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var path = Uri.UnescapeDataString(new Uri(e.Request.Uri).AbsolutePath.TrimStart('/'));
        var stream = Mime.TryGetValue(Path.GetExtension(path), out var mime) ? typeof(MainForm).Assembly.GetManifestResourceStream("ui/" + path) : null;
        var env = web.CoreWebView2.Environment;
        e.Response = stream is null
            ? env.CreateWebResourceResponse(null, 404, "Not Found", "")
            : env.CreateWebResourceResponse(stream, 200, "OK", "Content-Type: " + mime +
                (mime!.StartsWith("text/html", StringComparison.Ordinal) ? "\r\nContent-Security-Policy: " + Csp : ""));
    }

    // Bridge: page posts {id, type, ...}; host replies {id, ok, data?, error?}. Every request gets a reply.
    // Samples are pushed unasked as {type: "metrics", data}.
    async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonElement id = default;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var msg = doc.RootElement;
            if (msg.TryGetProperty("id", out var i)) id = i.Clone();
            switch (Str(msg, "type"))
            {
                case "theme":
                    if (Str(msg, "theme") is "light" or "dark" or "system") { theme = Str(msg, "theme")!; ApplyTheme(); }
                    Reply(id, true);
                    break;
                case "start":   // page is ready: reply with the static hardware info, then stream samples
                    SetInterval(msg);
                    sampling ??= new Sampler();
                    Reply(id, true, data: sampling.InfoJson());
                    if (sampler is null)
                    {
                        sampler = new Thread(SampleLoop) { IsBackground = true, Name = "Sampler" };
                        sampler.Start();
                    }
                    break;
                case "processes":   // the Top apps sheet opened (on: true) or closed
                    if (sampling is not null) sampling.WatchProcesses = msg.TryGetProperty("on", out var on) && on.ValueKind == JsonValueKind.True;
                    Reply(id, true);
                    break;
                case "endTask":
                    var (ended, failed, err) = ProcessSampler.EndTask(Str(msg, "name"));
                    Reply(id, ended > 0 && failed == 0, data: JsonSerializer.Serialize(new { ended, failed }), error: err);
                    break;
                case "inventory":   // what the hardware is; WMI takes a second or two, so off the UI thread
                    var s = sampling ??= new Sampler();
                    var json = await Task.Run(s.InventoryJson);
                    Reply(id, true, data: json);
                    break;
                case "network":   // the Network tab opened or closed; internet: also ping 1.1.1.1 (opt-in)
                    sampling?.WatchNetwork(msg.TryGetProperty("on", out var non) && non.ValueKind == JsonValueKind.True,
                        msg.TryGetProperty("internet", out var inet) && inet.ValueKind == JsonValueKind.True);
                    Reply(id, true);
                    break;
                case "sensors":   // the Sensors screen opened (on: true) or closed
                    if (sampling is not null) sampling.WatchSensors = msg.TryGetProperty("on", out var watch) && watch.ValueKind == JsonValueKind.True;
                    Reply(id, true);
                    break;
                case "elevate":   // restart as administrator for CPU, motherboard and drive sensors
                    try
                    {
                        Process.Start(new ProcessStartInfo(Environment.ProcessPath!, "--elevated") { UseShellExecute = true, Verb = "runas" })?.Dispose();
                        Reply(id, true);
                        BeginInvoke(Quit);   // the elevated copy waits for this one to let go of the single-instance lock
                    }
                    catch (System.ComponentModel.Win32Exception ex) when (ex.NativeErrorCode == 1223) { Reply(id, false, error: "cancelled"); }
                    break;
                case "openExternal":   // https links only, in the default browser
                    if (Uri.TryCreate(Str(msg, "url"), UriKind.Absolute, out var url) && url.Scheme == Uri.UriSchemeHttps)
                    { Process.Start(new ProcessStartInfo(url.AbsoluteUri) { UseShellExecute = true })?.Dispose(); Reply(id, true); }
                    else Reply(id, false, error: "only https:// links can be opened");
                    break;
                case "overlayGet":
                    Reply(id, true, data: JsonSerializer.Serialize(OverlayJson(), WebJson));
                    break;
                case "overlaySet":   // any of show / locked / trayCpu; the new state comes back as an "overlay" push
                    bool Flag(string name, bool current) => msg.TryGetProperty(name, out var f) && f.ValueKind is JsonValueKind.True or JsonValueKind.False ? f.GetBoolean() : current;
                    SetOverlay(ov with { Show = Flag("show", ov.Show), Locked = Flag("locked", ov.Locked), TrayCpu = Flag("trayCpu", ov.TrayCpu) });
                    Reply(id, true);
                    break;
                case "interval":
                    SetInterval(msg);
                    Reply(id, true);
                    break;
                default:
                    Reply(id, false, error: "unknown request");
                    break;
            }
        }
        catch (Exception ex) { Reply(id, false, error: ex.Message); }
    }

    void SetInterval(JsonElement msg)
    {
        if (msg.TryGetProperty("interval", out var v) && v.TryGetInt32(out int ms)) { intervalMs = Math.Clamp(ms, 100, 5000); wake.Set(); }
    }

    void SampleLoop()
    {
        // ponytail: Thread.Sleep follows the ~15.6 ms system timer, so "100 ms" lands at 100-110 ms; timeBeginPeriod if exact pacing matters.
        var clock = Stopwatch.StartNew();
        while (!closing)
        {
            long started = clock.ElapsedMilliseconds;
            // Full rate while the window or the overlay is on screen; once a second for the tray icon alone; else pause.
            bool page = !minimized, live = page || overlayOn;
            if (!live && !trayLive) { wake.WaitOne(); continue; }
            if (Interlocked.CompareExchange(ref posting, 1, 0) == 0)
            {
                try
                {
                    var json = sampling!.SampleJson();
                    var reading = sampling.Latest;
                    BeginInvoke(() =>
                    {
                        posting = 0;
                        if (IsDisposed) return;
                        if (page && web.CoreWebView2 is not null) web.CoreWebView2.PostWebMessageAsJson(json);
                        if (overlay.Visible) overlay.ShowReading(reading);
                        UpdateTray(reading);
                    });
                }
                catch (InvalidOperationException) { return; }   // window gone
                catch (Exception ex) { posting = 0; Debug.WriteLine(ex); }
            }
            int interval = live ? intervalMs : Math.Max(intervalMs, 1000);
            wake.WaitOne(Math.Max(1, interval - (int)(clock.ElapsedMilliseconds - started)));
        }
    }

    static string? Str(JsonElement msg, string name) =>
        msg.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    void Reply(JsonElement id, bool ok, string? data = null, string? error = null)
    {
        if (IsDisposed || web.CoreWebView2 is null) return;
        var buffer = new ArrayBufferWriter<byte>();
        using (var w = new Utf8JsonWriter(buffer))
        {
            w.WriteStartObject();
            w.WritePropertyName("id");
            if (id.ValueKind == JsonValueKind.Undefined) w.WriteNullValue(); else id.WriteTo(w);
            w.WriteBoolean("ok", ok);
            if (data != null) { w.WritePropertyName("data"); w.WriteRawValue(data); }
            if (error != null) w.WriteString("error", error);
            w.WriteEndObject();
        }
        web.CoreWebView2.PostWebMessageAsJson(Encoding.UTF8.GetString(buffer.WrittenSpan));
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        // X button, Alt+F4 and taskbar "Close window" go to the tray; Quit, shutdown and Task Manager exit.
        if (!quitting && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            SavePlacement();
            Hide();
            if (!trayHintShown) { trayHintShown = true; tray.ShowBalloonTip(3000, AppTitle, "Still running in the tray. Right-click the icon to quit.", ToolTipIcon.None); }
            return;
        }
        closing = true;
        tray.Visible = false;
        overlay.Hide();
        wake.Set();
        SavePlacement();
        base.OnFormClosing(e);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !disposed)   // WinForms disposes the closed form, then Program's using does again
        {
            disposed = true;
            SystemEvents.UserPreferenceChanged -= OnSystemPrefs;
            closing = true;
            wake.Set();
            sampler?.Join(1000);
            sampling?.Dispose();
            wake.Dispose();
            tray.Dispose();
            trayNumber?.Dispose();
            overlay.Dispose();
        }
        base.Dispose(disposing);
    }

    // ---- window placement ----
    sealed record Placement(int X, int Y, int Width, int Height, bool Maximized);
    void RestorePlacement()
    {
        try
        {
            var p = JsonSerializer.Deserialize<Placement>(File.ReadAllText(PlacementFile));
            if (p is null) return;
            var r = new Rectangle(p.X, p.Y, p.Width, p.Height);
            if (!Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(r))) return;
            StartPosition = FormStartPosition.Manual;
            Bounds = r;
            if (p.Maximized) WindowState = FormWindowState.Maximized;
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { }
    }
    void SavePlacement()
    {
        try
        {
            var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            Directory.CreateDirectory(DataDir);
            File.WriteAllText(PlacementFile, JsonSerializer.Serialize(new Placement(r.X, r.Y, r.Width, r.Height, WindowState == FormWindowState.Maximized)));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }

    // ---- theme: title bar = --color-bg-grouped, caption text = --color-label ----
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20, DWMWA_BORDER_COLOR = 34, DWMWA_CAPTION_COLOR = 35, DWMWA_TEXT_COLOR = 36;
    static bool SystemIsDark() =>
        Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1) is 0;
    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); ApplyTheme(); }
    void ApplyTheme()
    {
        bool dark = theme == "dark" || (theme == "system" && SystemIsDark());
        BackColor = dark ? Color.Black : Color.FromArgb(0xF2, 0xF2, 0xF7);   // keep in step with --color-bg-grouped
        web.DefaultBackgroundColor = BackColor;
        if (!IsHandleCreated) return;
        int on = dark ? 1 : 0;
        DwmSetWindowAttribute(Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref on, sizeof(int));
        int surface = ColorTranslator.ToWin32(BackColor), label = ColorTranslator.ToWin32(dark ? Color.White : Color.Black);
        DwmSetWindowAttribute(Handle, DWMWA_CAPTION_COLOR, ref surface, sizeof(int));
        DwmSetWindowAttribute(Handle, DWMWA_BORDER_COLOR, ref surface, sizeof(int));
        DwmSetWindowAttribute(Handle, DWMWA_TEXT_COLOR, ref label, sizeof(int));
    }
}
