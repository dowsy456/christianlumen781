// Compiled at release build time. This program only installs the already
// publisher-verified portable EXE; it does not download code or run a script.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Chat App Native Updater")]
[assembly: AssemblyDescription("Verified portable Chat App update and restart")]
[assembly: AssemblyCompany("Chat App")]
[assembly: AssemblyProduct("Chat App")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class NativeUpdateHelper {
  private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16384 };
  private const long MaximumBytes = 512L * 1024 * 1024;
  private static string Text(Dictionary<string, object> job, string key) {
    object value;
    if (!job.TryGetValue(key, out value) || !(value is string) || ((string)value).Length == 0) throw new InvalidDataException("The update job is missing " + key + ".");
    return (string)value;
  }
  private static string LocalPath(string value) {
    if (value.Length > 32000 || value.IndexOf('\0') >= 0 || value.StartsWith(@"\\", StringComparison.Ordinal) || !Path.IsPathRooted(value)) throw new InvalidDataException("Native updates need a local absolute file path.");
    string full = Path.GetFullPath(value);
    if (full.Length < 4 || full[1] != ':' || full[2] != Path.DirectorySeparatorChar || full.IndexOf(':', 2) >= 0) throw new InvalidDataException("The native update path is invalid.");
    for (string item = full; item != null; item = Path.GetDirectoryName(item)) {
      if ((File.Exists(item) || Directory.Exists(item)) && (File.GetAttributes(item) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Native update paths cannot contain links or junctions.");
    }
    return full;
  }
  private static string Hash(Stream input) {
    input.Position = 0;
    using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
  }
  private static void Verify(Stream input, string expectedHash, long expectedSize, bool executable) {
    if (input.Length != expectedSize || expectedSize <= 0 || expectedSize > MaximumBytes) throw new InvalidDataException("The update EXE has an invalid size.");
    if (Hash(input) != expectedHash) throw new InvalidDataException("The update EXE failed its integrity check.");
    if (executable) {
      if (input.Length < 70) throw new InvalidDataException("The update is not a Windows executable.");
      using (var reader = new BinaryReader(input, Encoding.UTF8, true)) {
        input.Position = 0;
        if (reader.ReadUInt16() != 0x5a4d) throw new InvalidDataException("The update is not a Windows executable.");
        input.Position = 60;
        long offset = reader.ReadUInt32();
        if (offset < 64 || offset > input.Length - 6) throw new InvalidDataException("The update has an invalid executable header.");
        input.Position = offset;
        if (reader.ReadUInt32() != 0x4550 || reader.ReadUInt16() != 0x8664) throw new InvalidDataException("The update requires a 64-bit Windows executable.");
      }
    }
    input.Position = 0;
  }
  private static void DeleteFile(string file) {
    if (String.IsNullOrEmpty(file)) return;
    try { File.Delete(file); } catch { }
  }
  private static void Result(string root, string status, string message, string target, string version, string backup) {
    if (String.IsNullOrEmpty(root)) return;
    try {
      File.WriteAllText(Path.Combine(root, "result.json"), Json.Serialize(new { status = status, message = message, target = target, version = version, backup = backup, at = DateTime.UtcNow.ToString("o") }), new UTF8Encoding(false));
    } catch { }
  }
  private static Process Launch(string target) {
    var launch = new ProcessStartInfo(target) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(target) };
    // The launcher supplies its own correct location to the new runtime.
    launch.EnvironmentVariables.Remove("PORTABLE_EXECUTABLE_FILE");
    launch.EnvironmentVariables.Remove("PORTABLE_EXECUTABLE_DIR");
    return Process.Start(launch);
  }
  private static void Replace(string prepared, string target) {
    Exception last = null;
    for (int attempt = 0; attempt < 60; attempt++) {
      try { File.Replace(prepared, target, null); return; }
      catch (IOException error) { last = error; Thread.Sleep(500); }
      catch (UnauthorizedAccessException error) { last = error; Thread.Sleep(500); }
    }
    throw new IOException("Windows could not replace Chat App.exe. Close other copies of the app and check that its folder is writable.", last);
  }
  [STAThread]
  public static void Main(string[] args) {
    string prepared = null, backup = null, root = null, target = null, version = null;
    string originalHash = null;
    bool committed = false, replaced = false, successful = false, backupCreated = false;
    try {
      if (!Environment.Is64BitProcess || args.Length != 1 || args[0] != "--apply") throw new InvalidDataException("The updater must be started by Chat App.");
      // Detached Windows children have redirected pipes but no console code
      // page handle. Explicit stream readers/writers avoid Console.*Encoding
      // setters, which fail with "The handle is invalid" in that situation.
      Console.SetIn(new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false)));
      Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
      Console.SetError(new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false)) { AutoFlush = true });
      string line = Console.ReadLine();
      if (line == null || line.Length > 16384) throw new InvalidDataException("The update job is invalid.");
      var job = Json.Deserialize<Dictionary<string, object>>(line);
      if (Convert.ToInt32(job["schemaVersion"]) != 1) throw new InvalidDataException("The update job format is unsupported.");
      string source = LocalPath(Text(job, "source"));
      target = LocalPath(Text(job, "target"));
      string expectedHash = Text(job, "sha256");
      originalHash = Text(job, "originalSha256");
      version = Text(job, "version");
      long size = Convert.ToInt64(job["size"]);
      int pid = Convert.ToInt32(job["pid"]);
      if (!Regex.IsMatch(expectedHash, "^[a-f0-9]{64}$") || !Regex.IsMatch(originalHash, "^[a-f0-9]{64}$") || !Regex.IsMatch(version, @"^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$")) throw new InvalidDataException("The update identity is invalid.");
      root = Path.GetDirectoryName(source);
      if (Path.GetFileName(source) != "update.exe" || !Path.GetFileName(root).StartsWith("release-", StringComparison.Ordinal) || Path.GetFileName(Path.GetDirectoryName(root)) != "native-updates") throw new InvalidDataException("The update is outside its private staging folder.");
      if (String.Equals(source, target, StringComparison.OrdinalIgnoreCase) || !String.Equals(Path.GetExtension(target), ".exe", StringComparison.OrdinalIgnoreCase) || !File.Exists(target)) throw new InvalidDataException("The original portable EXE could not be located.");
      if (pid <= 0 || pid == Process.GetCurrentProcess().Id) throw new InvalidDataException("The running Chat App process is invalid.");
      using (var parent = Process.GetProcessById(pid)) {
        // Capture a real process handle before READY, so PID reuse cannot cause
        // this updater to wait for or interfere with a different application.
        IntPtr parentHandle = parent.Handle;
        if (parent.HasExited) throw new InvalidDataException("Chat App closed before its update was prepared.");
        prepared = Path.Combine(Path.GetDirectoryName(target), ".chat-app-update-" + Guid.NewGuid().ToString("N") + ".tmp");
        backup = Path.Combine(root, "previous.exe");
        using (var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read)) {
          Verify(input, expectedHash, size, true);
          using (var original = new FileStream(target, FileMode.Open, FileAccess.Read, FileShare.Read)) {
            if (Hash(original) != originalHash) throw new InvalidDataException("The original Chat App.exe changed while the update was preparing.");
            original.Position = 0;
            // Preserve recovery bytes in the private app cache before touching
            // the original. CreateNew prevents overwriting any unrelated file.
            using (var copy = new FileStream(backup, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { backupCreated = true; original.CopyTo(copy); copy.Flush(true); }
          }
          input.Position = 0;
          using (var output = new FileStream(prepared, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { input.CopyTo(output); output.Flush(true); }
        }
        Console.WriteLine("READY"); Console.Out.Flush();
        if (Console.ReadLine() != "COMMIT") return;
        Console.WriteLine("COMMITTED"); Console.Out.Flush();
        committed = true;
        // The parent closes itself normally. Never terminate other app copies
        // or force a shutdown when an unfinished call/draft blocks the restart.
        if (!parent.WaitForExit(120000)) throw new TimeoutException("Chat App did not finish closing. Your original EXE has not been replaced.");
        LocalPath(target); LocalPath(prepared); LocalPath(backup);
        using (var original = new FileStream(target, FileMode.Open, FileAccess.Read, FileShare.Read)) {
          if (Hash(original) != originalHash) throw new InvalidDataException("The original EXE changed before the update could be installed.");
        }
        using (var verified = new FileStream(prepared, FileMode.Open, FileAccess.Read, FileShare.Read)) Verify(verified, expectedHash, size, true);
        Replace(prepared, target); replaced = true;
        using (var verified = new FileStream(target, FileMode.Open, FileAccess.Read, FileShare.Read)) Verify(verified, expectedHash, size, true);
        using (var launched = Launch(target)) {
          if (launched == null) throw new IOException("Windows did not start the updated Chat App.");
        }
        successful = true;
        Result(root, "installed", "The verified update was installed and reopened.", target, version, backup);
        // Keep one recovery copy in this release's private cache. It is never
        // advertised as installed code; the next successful release may remove
        // that cache using its exact verified path.
      }
    } catch (Exception error) {
      string message = error.Message;
      if (replaced && !successful && backup != null && File.Exists(backup)) {
        try {
          string rollback = Path.Combine(Path.GetDirectoryName(target), ".chat-app-rollback-" + Guid.NewGuid().ToString("N") + ".tmp");
          try {
            using (var previous = new FileStream(backup, FileMode.Open, FileAccess.Read, FileShare.Read)) {
              if (Hash(previous) != originalHash) throw new InvalidDataException("The recovery EXE failed its integrity check.");
              previous.Position = 0;
              using (var copy = new FileStream(rollback, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { previous.CopyTo(copy); copy.Flush(true); }
            }
            Replace(rollback, target);
            using (var restored = Launch(target)) { }
            message += " Your previous Chat App.exe was restored.";
          } finally { DeleteFile(rollback); }
        } catch (Exception recovery) { message += " Recovery could not finish: " + recovery.Message + " Your previous EXE is saved at: " + backup; }
      }
      Result(root, "failed", message, target, version, backup);
      if (committed) MessageBox.Show("Chat App could not finish updating.\n\n" + message, "Chat App update", MessageBoxButtons.OK, MessageBoxIcon.Error);
      else { try { Console.Error.WriteLine(message); } catch { } }
      Environment.ExitCode = 1;
    } finally {
      DeleteFile(prepared);
      if (!committed && backupCreated) DeleteFile(backup);
    }
  }
}
