using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;

namespace SystemPerformance;

static class Program
{
    const string AppTitle = "System Performance";
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int processId);

    [STAThread]
    static int Main(string[] args)
    {
        if (args is ["--selfcheck"]) return typeof(Program).Assembly.GetManifestResourceStream("ui/index.html") is null ? 1 : 0;
        if (args is ["--sample"])   // prints two samples; checks the counters work on this PC
        {
            using var s = new Sampler();
            Console.WriteLine(s.InfoJson());
            Thread.Sleep(500);
            Console.WriteLine(s.SampleJson());
            return 0;
        }

        using var mutex = new Mutex(true, @"Local\SystemPerformance.Instance", out bool first);
        using var activate = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\SystemPerformance.Activate");
        if (!first) { AllowSetForegroundWindow(-1); activate.Set(); return 0; }   // bring the running window forward

        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            try
            {
                var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SystemPerformance");
                Directory.CreateDirectory(dir);
                File.AppendAllText(Path.Combine(dir, "crash.log"), $"{DateTime.Now:O}\n{e.ExceptionObject}\n\n");
            }
            catch (IOException) { }
        };
        ApplicationConfiguration.Initialize();
        try { CoreWebView2Environment.GetAvailableBrowserVersionString(); }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show($"{AppTitle} needs the Microsoft Edge WebView2 Runtime.\n\nhttps://developer.microsoft.com/microsoft-edge/webview2/",
                AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        using var form = new MainForm();
        _ = form.Handle;
        var wait = ThreadPool.RegisterWaitForSingleObject(activate, (_, _) =>
        {
            try { form.BeginInvoke(form.ShowAndActivate); } catch (InvalidOperationException) { }
        }, null, Timeout.Infinite, executeOnlyOnce: false);
        Application.Run(form);
        wait.Unregister(null);
        return 0;
    }
}
