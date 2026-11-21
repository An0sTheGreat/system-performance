using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Runtime.InteropServices;

namespace SystemPerformance;

// Always-on-top mini strip (CPU, GPU, RAM, network) for watching while a game or full-screen app runs.
// A per-pixel-alpha layered window drawn with GDI+, so it needs no second browser process.
// Locked = clicks pass through to whatever is beneath; unlocked = drag it anywhere.
sealed class Overlay : Form
{
    public readonly record struct Reading(double Cpu, double? Gpu, double Mem, double? Rx, double? Tx, double? CpuTemp = null, double? GpuTemp = null);

    // Raw colours live here, like MainForm.ApplyTheme: the overlay is native, outside the CSS tokens.
    static readonly Color Back = Color.FromArgb(214, 20, 20, 22);
    static readonly Color Label = Color.FromArgb(255, 174, 174, 182);
    static readonly Color Value = Color.White;
    static readonly Color Hot = Color.FromArgb(255, 255, 159, 10);     // >= 90 %
    static readonly Color Tint = Color.FromArgb(255, 0, 110, 230);     // --color-tint-fill

    bool locked = true;
    Reading last;
    Font? labelFontCache, valueFontCache;
    float fontScale;
    public event Action<Point>? Moved;

    public Overlay()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        Text = "System Performance overlay";
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST | (locked ? WS_EX_TRANSPARENT : 0);
            return cp;
        }
    }

    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public bool Locked
    {
        get => locked;
        set
        {
            locked = value;
            if (IsHandleCreated)
            {
                int ex = GetWindowLong(Handle, GWL_EXSTYLE);
                SetWindowLong(Handle, GWL_EXSTYLE, value ? ex | WS_EX_TRANSPARENT : ex & ~WS_EX_TRANSPARENT);
            }
            Redraw();
        }
    }

    public void ShowReading(Reading r) { last = r; Redraw(); }

    // Some full-screen apps take the topmost slot; called about once a second to take it back.
    public void KeepOnTop() { if (Visible) SetWindowPos(Handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE); }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (locked || e.Button != MouseButtons.Left) return;
        ReleaseCapture();
        SendMessage(Handle, WM_NCLBUTTONDOWN, HTCAPTION, 0);   // the system's own move loop; returns when released
        Moved?.Invoke(Location);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { labelFontCache?.Dispose(); valueFontCache?.Dispose(); }
        base.Dispose(disposing);
    }

    static string Pct(double v) => $"{Math.Round(Math.Clamp(v, 0, 100))}%";
    static string Bits(double bytesPerSec)
    {
        double n = Math.Max(0, bytesPerSec) * 8;
        string[] units = ["bps", "Kbps", "Mbps", "Gbps"];
        int i = 0;
        while (n >= 1000 && i < units.Length - 1) { n /= 1000; i++; }
        return i == 0 ? $"{n:0} {units[i]}" : $"{n:0.0} {units[i]}";
    }

    void Redraw()
    {
        if (!IsHandleCreated || !Visible) return;
        float s = DeviceDpi / 96f;
        // A temperature, when the sensor is readable, rides after the load: "CPU 23%  54°". Hot at 90 °C.
        static string WithTemp(string pct, double? t) => t is double c ? $"{pct}  {Math.Round(c)}°" : pct;
        var items = new List<(string Label, string Value, string Widest, bool Hot)>
        {
            ("CPU", WithTemp(Pct(last.Cpu), last.CpuTemp), last.CpuTemp is null ? "100%" : "100%  100°", last.Cpu >= 90 || last.CpuTemp >= 90),
        };
        if (last.Gpu is double g) items.Add(("GPU", WithTemp(Pct(g), last.GpuTemp), last.GpuTemp is null ? "100%" : "100%  100°", g >= 90 || last.GpuTemp >= 90));
        items.Add(("RAM", Pct(last.Mem), "100%", last.Mem >= 90));
        if (last.Rx is double rx) items.Add(("NET", $"↓ {Bits(rx)}   ↑ {Bits(last.Tx ?? 0)}", "↓ 888.8 Mbps   ↑ 888.8 Mbps", false));

        if (fontScale != s)   // fonts follow the monitor's DPI; rebuilt only when it changes
        {
            labelFontCache?.Dispose(); valueFontCache?.Dispose();
            labelFontCache = new Font("Segoe UI Semibold", 8.5f * s, GraphicsUnit.Point);
            valueFontCache = new Font("Segoe UI", 10.5f * s, FontStyle.Bold, GraphicsUnit.Point);
            fontScale = s;
        }
        var (labelFont, valueFont) = (labelFontCache!, valueFontCache!);
        using var measure = new Bitmap(1, 1);
        using var mg = Graphics.FromImage(measure);
        var fmt = StringFormat.GenericTypographic;
        float padX = 14 * s, padY = 7 * s, gap = 16 * s, inner = 6 * s;
        float lineH = Math.Max(valueFont.GetHeight(mg), labelFont.GetHeight(mg));
        var widths = items.Select(i => (L: mg.MeasureString(i.Label, labelFont, 1000, fmt).Width, V: mg.MeasureString(i.Widest, valueFont, 1000, fmt).Width)).ToArray();
        int w = (int)Math.Ceiling(padX * 2 + widths.Sum(x => x.L + inner + x.V) + gap * (items.Count - 1));
        int h = (int)Math.Ceiling(lineH + padY * 2);

        using var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (var gfx = Graphics.FromImage(bmp))
        {
            gfx.SmoothingMode = SmoothingMode.AntiAlias;
            gfx.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;   // ClearType can't blend onto alpha
            gfx.Clear(Color.Transparent);
            using (var path = Pill(new RectangleF(0.5f, 0.5f, w - 1, h - 1)))
            {
                using var back = new SolidBrush(Back);
                gfx.FillPath(back, path);
                if (!locked) { using var pen = new Pen(Tint, 1.5f * s); gfx.DrawPath(pen, path); }   // "you can move me"
            }
            using var labelBrush = new SolidBrush(Label);
            using var valueBrush = new SolidBrush(Value);
            using var hotBrush = new SolidBrush(Hot);
            float x = padX;
            for (int i = 0; i < items.Count; i++)
            {
                var (label, value, _, hot) = items[i];
                gfx.DrawString(label, labelFont, labelBrush, x, (h - labelFont.GetHeight(gfx)) / 2 + s, fmt);
                x += widths[i].L + inner;
                gfx.DrawString(value, valueFont, hot ? hotBrush : valueBrush, x, (h - valueFont.GetHeight(gfx)) / 2, fmt);
                x += widths[i].V + gap;
            }
        }
        Present(bmp);
    }

    static GraphicsPath Pill(RectangleF r)
    {
        float d = r.Height;
        var p = new GraphicsPath();
        p.AddArc(r.Left, r.Top, d, d, 90, 180);
        p.AddArc(r.Right - d, r.Top, d, d, 270, 180);
        p.CloseFigure();
        return p;
    }

    void Present(Bitmap bmp)
    {
        IntPtr screen = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(screen), hbmp = bmp.GetHbitmap(Color.FromArgb(0)), old = SelectObject(mem, hbmp);
        try
        {
            var size = new SIZE { cx = bmp.Width, cy = bmp.Height };
            var src = new POINT();
            var dst = new POINT { x = Left, y = Top };
            var blend = new BLENDFUNCTION { BlendOp = 0, SourceConstantAlpha = 255, AlphaFormat = 1 };   // AC_SRC_ALPHA
            UpdateLayeredWindow(Handle, screen, ref dst, ref size, mem, ref src, 0, ref blend, 2);      // ULW_ALPHA
        }
        finally { SelectObject(mem, old); DeleteObject(hbmp); DeleteDC(mem); ReleaseDC(IntPtr.Zero, screen); }
    }

    // ---- tray icon with a live number ----

    public static Icon NumberIcon(int value, Size size)
    {
        value = Math.Clamp(value, 0, 100);
        using var bmp = new Bitmap(size.Width, size.Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            g.Clear(Color.Transparent);
            float w = size.Width, h = size.Height, r = w * 0.22f;
            using (var path = new GraphicsPath())
            {
                path.AddArc(0, 0, r * 2, r * 2, 180, 90);
                path.AddArc(w - r * 2 - 1, 0, r * 2, r * 2, 270, 90);
                path.AddArc(w - r * 2 - 1, h - r * 2 - 1, r * 2, r * 2, 0, 90);
                path.AddArc(0, h - r * 2 - 1, r * 2, r * 2, 90, 90);
                path.CloseFigure();
                using var fill = new SolidBrush(value >= 90 ? Hot : Tint);
                g.FillPath(fill, path);
            }
            string text = value.ToString();
            using var font = new Font("Segoe UI", h * (text.Length >= 3 ? 0.46f : 0.66f), FontStyle.Bold, GraphicsUnit.Pixel);
            using var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
            g.DrawString(text, font, Brushes.White, new RectangleF(-1, 0, w + 2, h + h * 0.06f), sf);
        }
        IntPtr hicon = bmp.GetHicon();
        try { using var shared = Icon.FromHandle(hicon); return (Icon)shared.Clone(); }   // the clone owns its own copy
        finally { DestroyIcon(hicon); }
    }

    // ---- Win32 ----
    const int GWL_EXSTYLE = -20, WS_EX_LAYERED = 0x80000, WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x8000000, WS_EX_TOPMOST = 0x8;
    const int WM_NCLBUTTONDOWN = 0xA1, HTCAPTION = 2;
    const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOACTIVATE = 0x10;
    static readonly IntPtr HWND_TOPMOST = new(-1);
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx, cy; }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] struct BLENDFUNCTION { public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat; }
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, int w, int l);
    [DllImport("user32.dll")] static extern bool UpdateLayeredWindow(IntPtr h, IntPtr dst, ref POINT pDst, ref SIZE size, IntPtr src, ref POINT pSrc, int key, ref BLENDFUNCTION blend, int flags);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
}
