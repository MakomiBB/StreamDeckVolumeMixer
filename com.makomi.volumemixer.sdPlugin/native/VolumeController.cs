// VolumeController.cs  –  Windows Core Audio (WASAPI) helper
// C# 5 / .NET Framework 4.8  –  no external dependencies
// Compile: csc.exe /target:exe /platform:x64 /out:VolumeController.exe VolumeController.cs /r:System.dll /r:System.Drawing.dll
//
// JSON-lines protocol over stdin/stdout
//   in:  {"cmd":"list","id":1}
//        {"cmd":"get","id":2,"pid":1234}
//        {"cmd":"set","id":3,"pid":1234,"volume":0.75}
//        {"cmd":"mute","id":4,"pid":1234,"muted":true}
//        {"cmd":"foreground","id":5}
//        {"cmd":"icon","id":6,"pid":1234}
//  out:  {"id":1,"sessions":[{"pid":N,"name":"…","displayName":"…","volume":N,"muted":false}]}
//        {"id":2,"volume":0.75,"muted":false}
//        {"id":3,"ok":true}
//        {"id":4,"ok":true}
//        {"id":5,"pid":N,"name":"chrome.exe"}
//        {"id":6,"icon":"data:image/png;base64,..."}  or  {"id":6,"icon":null}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

// ── WASAPI COM interfaces ─────────────────────────────────────────────────────

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator
{
    [PreserveSig] int EnumAudioEndpoints(int flow, int mask,
        [MarshalAs(UnmanagedType.IUnknown)] out object col);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice dev);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr cb);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr cb);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice
{
    [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr parms,
        [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
    [PreserveSig] int OpenPropertyStore(int access,
        [MarshalAs(UnmanagedType.IUnknown)] out object store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out int state);
}

[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2
{
    [PreserveSig] int GetAudioSessionControl(IntPtr g, int fl, out IAudioSessionControl2 c);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr g, int fl, out ISimpleAudioVolume v);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e);
    [PreserveSig] int RegisterSessionNotification(IntPtr n);
    [PreserveSig] int UnregisterSessionNotification(IntPtr n);
    [PreserveSig] int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string s, IntPtr n);
    [PreserveSig] int UnregisterDuckNotification(IntPtr n);
}

[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator
{
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int idx, out IAudioSessionControl2 session);
}

[ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2
{
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr ctx);
    [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr ctx);
    [PreserveSig] int GetGroupingParam(out Guid guid);
    [PreserveSig] int SetGroupingParam(ref Guid guid, IntPtr ctx);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr n);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr n);
    [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetProcessId(out uint pid);
    [PreserveSig] int IsSystemSoundsSession();
    [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
}

[ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume
{
    [PreserveSig] int SetMasterVolume(float level, IntPtr ctx);
    [PreserveSig] int GetMasterVolume(out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, IntPtr ctx);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

// ── Entry point ───────────────────────────────────────────────────────────────

static class Program
{
    static readonly Guid IID_ASM2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint   GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [STAThread]
    static void Main()
    {
        Console.InputEncoding  = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;

        string line;
        while ((line = Console.ReadLine()) != null)
        {
            if (string.IsNullOrEmpty(line.Trim())) continue;
            try
            {
                int    id  = JInt(line, "id");
                string cmd = JStr(line, "cmd");
                string resp;

                switch (cmd)
                {
                    case "list":       resp = CmdList(id);                              break;
                    case "get":        resp = CmdGet(id, JInt(line, "pid"));            break;
                    case "set":        resp = CmdSet(id, JInt(line, "pid"),
                                                    (float)JDbl(line, "volume"));      break;
                    case "mute":       resp = CmdMute(id, JInt(line, "pid"),
                                                     JBool(line, "muted"));            break;
                    case "foreground": resp = CmdForeground(id);                        break;
                    case "icon":       resp = CmdIcon(id, JInt(line, "pid"));           break;
                    default:           resp = Err(id, "unknown cmd: " + cmd);           break;
                }

                Console.WriteLine(resp);
                Console.Out.Flush();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.ToString());
                Console.Out.Flush();
            }
        }
    }

    // ── Commands ──────────────────────────────────────────────────────────────

    static string CmdList(int id)
    {
        List<string> parts = new List<string>();
        try
        {
            IAudioSessionEnumerator en = GetEnumerator();
            int count;
            en.GetCount(out count);

            for (int i = 0; i < count; i++)
            {
                try
                {
                    IAudioSessionControl2 ctrl;
                    en.GetSession(i, out ctrl);

                    if (ctrl.IsSystemSoundsSession() == 0) continue;

                    uint pidU;
                    ctrl.GetProcessId(out pidU);
                    if (pidU == 0) continue;

                    Process proc;
                    try   { proc = Process.GetProcessById((int)pidU); }
                    catch { continue; }

                    string dn;
                    ctrl.GetDisplayName(out dn);
                    string display = string.IsNullOrEmpty(dn) ? proc.ProcessName : dn;
                    string title = "";
                    try { title = proc.MainWindowTitle ?? ""; } catch { }

                    ISimpleAudioVolume sav = ctrl as ISimpleAudioVolume;
                    float vol  = 0f;
                    bool  mute = false;
                    if (sav != null) { sav.GetMasterVolume(out vol); sav.GetMute(out mute); }

                    parts.Add(string.Format(CultureInfo.InvariantCulture,
                        "{{\"pid\":{0},\"name\":{1},\"displayName\":{2},\"windowTitle\":{3},\"volume\":{4:F4},\"muted\":{5}}}",
                        (int)pidU, JS(proc.ProcessName + ".exe"), JS(display),
                        JS(title), vol, mute ? "true" : "false"));
                }
                catch { }
            }
        }
        catch (Exception ex) { Console.Error.WriteLine("list: " + ex.Message); }

        return string.Format("{{\"id\":{0},\"sessions\":[{1}]}}", id, string.Join(",", parts));
    }

    static string CmdGet(int id, int pid)
    {
        try
        {
            IAudioSessionEnumerator en = GetEnumerator();
            int count;
            en.GetCount(out count);

            for (int i = 0; i < count; i++)
            {
                IAudioSessionControl2 ctrl;
                en.GetSession(i, out ctrl);
                uint pidU;
                ctrl.GetProcessId(out pidU);
                if ((int)pidU != pid) continue;

                ISimpleAudioVolume sav = ctrl as ISimpleAudioVolume;
                if (sav == null) continue;

                float vol;
                bool  mute;
                sav.GetMasterVolume(out vol);
                sav.GetMute(out mute);

                return string.Format(CultureInfo.InvariantCulture,
                    "{{\"id\":{0},\"volume\":{1:F4},\"muted\":{2}}}",
                    id, vol, mute ? "true" : "false");
            }
            return Err(id, "no audio session for pid " + pid);
        }
        catch (Exception ex) { return Err(id, ex.Message); }
    }

    static string CmdSet(int id, int pid, float volume)
    {
        if (volume < 0f) volume = 0f;
        if (volume > 1f) volume = 1f;
        bool found = false;
        try
        {
            IAudioSessionEnumerator en = GetEnumerator();
            int count;
            en.GetCount(out count);

            for (int i = 0; i < count; i++)
            {
                IAudioSessionControl2 ctrl;
                en.GetSession(i, out ctrl);
                uint pidU;
                ctrl.GetProcessId(out pidU);
                if ((int)pidU != pid) continue;

                ISimpleAudioVolume sav = ctrl as ISimpleAudioVolume;
                if (sav != null) { sav.SetMasterVolume(volume, IntPtr.Zero); found = true; }
            }
        }
        catch (Exception ex) { return Err(id, ex.Message); }
        return string.Format("{{\"id\":{0},\"ok\":{1}}}", id, found ? "true" : "false");
    }

    static string CmdMute(int id, int pid, bool muted)
    {
        bool found = false;
        try
        {
            IAudioSessionEnumerator en = GetEnumerator();
            int count;
            en.GetCount(out count);

            for (int i = 0; i < count; i++)
            {
                IAudioSessionControl2 ctrl;
                en.GetSession(i, out ctrl);
                uint pidU;
                ctrl.GetProcessId(out pidU);
                if ((int)pidU != pid) continue;

                ISimpleAudioVolume sav = ctrl as ISimpleAudioVolume;
                if (sav != null) { sav.SetMute(muted, IntPtr.Zero); found = true; }
            }
        }
        catch (Exception ex) { return Err(id, ex.Message); }
        return string.Format("{{\"id\":{0},\"ok\":{1}}}", id, found ? "true" : "false");
    }

    static string CmdForeground(int id)
    {
        try
        {
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero)
                return string.Format("{{\"id\":{0},\"pid\":0,\"name\":\"\"}}", id);

            uint pidU;
            GetWindowThreadProcessId(hwnd, out pidU);
            if (pidU == 0)
                return string.Format("{{\"id\":{0},\"pid\":0,\"name\":\"\"}}", id);

            Process proc;
            try   { proc = Process.GetProcessById((int)pidU); }
            catch { return string.Format("{{\"id\":{0},\"pid\":0,\"name\":\"\"}}", id); }

            StringBuilder title = new StringBuilder(512);
            try { GetWindowText(hwnd, title, title.Capacity); } catch { }

            return string.Format("{{\"id\":{0},\"pid\":{1},\"name\":{2},\"title\":{3}}}",
                id, (int)pidU, JS(proc.ProcessName + ".exe"), JS(title.ToString()));
        }
        catch (Exception ex) { return Err(id, ex.Message); }
    }

    static string CmdIcon(int id, int pid)
    {
        try
        {
            Process proc;
            try { proc = Process.GetProcessById(pid); }
            catch { return string.Format("{{\"id\":{0},\"icon\":null}}", id); }

            string exePath = null;
            try { exePath = proc.MainModule.FileName; } catch { }

            if (string.IsNullOrEmpty(exePath))
                return string.Format("{{\"id\":{0},\"icon\":null}}", id);

            string b64 = null;
            try
            {
                using (Icon ico = Icon.ExtractAssociatedIcon(exePath))
                {
                    if (ico == null)
                        return string.Format("{{\"id\":{0},\"icon\":null}}", id);

                    using (Bitmap src = ico.ToBitmap())
                    using (Bitmap dst = new Bitmap(48, 48))
                    using (Graphics g = Graphics.FromImage(dst))
                    {
                        g.InterpolationMode =
                            System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                        g.DrawImage(src, 0, 0, 48, 48);

                        using (MemoryStream ms = new MemoryStream())
                        {
                            dst.Save(ms, ImageFormat.Png);
                            b64 = Convert.ToBase64String(ms.ToArray());
                        }
                    }
                }
            }
            catch (Exception ex2)
            {
                Console.Error.WriteLine("icon extract: " + ex2.Message);
            }

            if (b64 == null)
                return string.Format("{{\"id\":{0},\"icon\":null}}", id);

            return string.Format("{{\"id\":{0},\"icon\":\"data:image/png;base64,{1}\"}}",
                id, b64);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("icon: " + ex.Message);
            return string.Format("{{\"id\":{0},\"icon\":null}}", id);
        }
    }

    // ── WASAPI factory ────────────────────────────────────────────────────────

    static IAudioSessionEnumerator GetEnumerator()
    {
        Guid clsid = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
        IMMDeviceEnumerator devEnum =
            (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(clsid));

        IMMDevice dev;
        devEnum.GetDefaultAudioEndpoint(0 /*eRender*/, 1 /*eMultimedia*/, out dev);

        Guid iid = IID_ASM2;
        object mgr2Obj;
        dev.Activate(ref iid, 23 /*CLSCTX_ALL*/, IntPtr.Zero, out mgr2Obj);
        IAudioSessionManager2 mgr2 = (IAudioSessionManager2)mgr2Obj;

        IAudioSessionEnumerator en;
        mgr2.GetSessionEnumerator(out en);
        return en;
    }

    // ── JSON helpers ──────────────────────────────────────────────────────────

    static string Err(int id, string msg)
    {
        return string.Format("{{\"id\":{0},\"error\":{1}}}", id, JS(msg));
    }

    static string JS(string s)
    {
        if (s == null) return "null";
        return "\"" + s.Replace("\\", "\\\\")
                       .Replace("\"", "\\\"")
                       .Replace("\r", "\\r")
                       .Replace("\n", "\\n") + "\"";
    }

    static string JStr(string j, string key)
    {
        Match m = Regex.Match(j,
            "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
        return m.Success ? m.Groups[1].Value : "";
    }

    static int JInt(string j, string key)
    {
        Match m = Regex.Match(j, "\"" + Regex.Escape(key) + "\"\\s*:\\s*(-?\\d+)");
        return m.Success ? int.Parse(m.Groups[1].Value) : 0;
    }

    static double JDbl(string j, string key)
    {
        Match m = Regex.Match(j,
            "\"" + Regex.Escape(key) + "\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)");
        return m.Success
            ? double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture)
            : 0.0;
    }

    static bool JBool(string j, string key)
    {
        Match m = Regex.Match(j, "\"" + Regex.Escape(key) + "\"\\s*:\\s*(true|false)");
        return m.Success && m.Groups[1].Value == "true";
    }
}
