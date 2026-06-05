using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

internal static class NativeHostLauncher
{
    private sealed class LauncherConfig
    {
        public string NodePath;
        public string NativeHostScript;
        public string WorkingDirectory;
    }

    private static int Main()
    {
        try
        {
            return Run();
        }
        catch
        {
            return 1;
        }
    }

    private static int Run()
    {
        string launcherDir = AppDomain.CurrentDomain.BaseDirectory;
        LauncherConfig config = ReadConfig(Path.Combine(launcherDir, "native-host-launcher.json"));
        if (IsBlank(config.NodePath) || IsBlank(config.NativeHostScript))
        {
            return 1;
        }

        string workingDirectory = IsBlank(config.WorkingDirectory)
            ? Path.GetDirectoryName(config.NativeHostScript)
            : config.WorkingDirectory;

        ProcessStartInfo startInfo = new ProcessStartInfo();
        startInfo.FileName = config.NodePath;
        startInfo.Arguments = QuoteArgument(config.NativeHostScript);
        startInfo.WorkingDirectory = workingDirectory;
        startInfo.UseShellExecute = false;
        startInfo.CreateNoWindow = true;
        startInfo.RedirectStandardInput = true;
        startInfo.RedirectStandardOutput = true;
        startInfo.RedirectStandardError = true;

        using (Process child = new Process())
        {
            child.StartInfo = startInfo;
            child.Start();

            Thread stdinThread = StartCopyThread(Console.OpenStandardInput(), child.StandardInput.BaseStream, true);
            Thread stdoutThread = StartCopyThread(child.StandardOutput.BaseStream, Console.OpenStandardOutput(), false);
            Thread stderrThread = StartCopyThread(child.StandardError.BaseStream, Stream.Null, false);

            child.WaitForExit();
            stdinThread.Join(1000);
            stdoutThread.Join(5000);
            stderrThread.Join(1000);
            return child.ExitCode;
        }
    }

    private static LauncherConfig ReadConfig(string configPath)
    {
        string json = File.ReadAllText(configPath, Encoding.UTF8);
        LauncherConfig config = new LauncherConfig();
        config.NodePath = ReadJsonString(json, "nodePath");
        config.NativeHostScript = ReadJsonString(json, "nativeHostScript");
        config.WorkingDirectory = ReadJsonString(json, "workingDirectory");
        return config;
    }

    private static Thread StartCopyThread(Stream source, Stream target, bool closeTarget)
    {
        Thread thread = new Thread(delegate()
        {
            try
            {
                CopyStream(source, target);
            }
            catch
            {
                // Native messaging closes pipes aggressively when the browser tab goes away.
            }
            finally
            {
                if (closeTarget)
                {
                    try
                    {
                        target.Close();
                    }
                    catch
                    {
                    }
                }
            }
        });
        thread.IsBackground = true;
        thread.Start();
        return thread;
    }

    private static void CopyStream(Stream source, Stream target)
    {
        byte[] buffer = new byte[81920];
        while (true)
        {
            int read = source.Read(buffer, 0, buffer.Length);
            if (read <= 0)
            {
                break;
            }
            target.Write(buffer, 0, read);
            target.Flush();
        }
    }

    private static string ReadJsonString(string json, string propertyName)
    {
        Regex regex = new Regex("\"" + Regex.Escape(propertyName) + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"", RegexOptions.CultureInvariant);
        Match match = regex.Match(json);
        return match.Success ? UnescapeJsonString(match.Groups[1].Value) : "";
    }

    private static string UnescapeJsonString(string value)
    {
        StringBuilder result = new StringBuilder(value.Length);
        for (int i = 0; i < value.Length; i++)
        {
            char c = value[i];
            if (c != '\\' || i + 1 >= value.Length)
            {
                result.Append(c);
                continue;
            }

            char escaped = value[++i];
            switch (escaped)
            {
                case '"':
                case '\\':
                case '/':
                    result.Append(escaped);
                    break;
                case 'b':
                    result.Append('\b');
                    break;
                case 'f':
                    result.Append('\f');
                    break;
                case 'n':
                    result.Append('\n');
                    break;
                case 'r':
                    result.Append('\r');
                    break;
                case 't':
                    result.Append('\t');
                    break;
                case 'u':
                    if (i + 4 < value.Length)
                    {
                        string hex = value.Substring(i + 1, 4);
                        result.Append((char)Convert.ToInt32(hex, 16));
                        i += 4;
                    }
                    break;
                default:
                    result.Append(escaped);
                    break;
            }
        }
        return result.ToString();
    }

    private static string QuoteArgument(string argument)
    {
        if (argument.Length == 0)
        {
            return "\"\"";
        }

        if (argument.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
        {
            return argument;
        }

        StringBuilder quoted = new StringBuilder();
        quoted.Append('"');
        int backslashes = 0;
        for (int i = 0; i < argument.Length; i++)
        {
            char c = argument[i];
            if (c == '\\')
            {
                backslashes++;
                continue;
            }
            if (c == '"')
            {
                quoted.Append('\\', backslashes * 2 + 1);
                quoted.Append('"');
                backslashes = 0;
                continue;
            }
            quoted.Append('\\', backslashes);
            backslashes = 0;
            quoted.Append(c);
        }
        quoted.Append('\\', backslashes * 2);
        quoted.Append('"');
        return quoted.ToString();
    }

    private static bool IsBlank(string value)
    {
        return value == null || value.Trim().Length == 0;
    }
}
