using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace WellbeingCompanionSetup
{
    internal static class Program
    {
        private const string ProductName = "Wellbeing Companion (Working Title)";
        private const string SupportDirectoryName = "Support";
        private const string InstallerScriptName = "Install-WellbeingCompanion.ps1";

        [STAThread]
        private static int Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string setupRoot = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string supportRoot = Path.GetFullPath(Path.Combine(setupRoot, SupportDirectoryName));
            string installerScript = Path.GetFullPath(Path.Combine(supportRoot, InstallerScriptName));

            if (!IsStrictChildPath(setupRoot, supportRoot) || !IsStrictChildPath(supportRoot, installerScript))
            {
                ShowError("The setup support path is not safe. Nothing was installed.");
                return 10;
            }

            if (!Directory.Exists(supportRoot) || !File.Exists(installerScript))
            {
                ShowError(
                    "Wellbeing Companion setup is incomplete. Extract the entire replacement package, then double-click SETUP-WELLBEING-COMPANION.exe again."
                );
                return 11;
            }

            DialogResult acknowledgement = MessageBox.Show(
                "This owner-test build is not publisher-signed. Setup will verify the sealed package receipt before copying any program files. Continue only if you received this package directly from the owner-test folder.",
                ProductName + " setup",
                MessageBoxButtons.OKCancel,
                MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button2
            );
            if (acknowledgement != DialogResult.OK)
            {
                return 2;
            }

            string systemDirectory = Environment.GetFolderPath(Environment.SpecialFolder.System);
            string powerShell = Path.Combine(systemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
            if (!File.Exists(powerShell))
            {
                ShowError("Windows PowerShell is unavailable. Nothing was installed.");
                return 12;
            }

            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = powerShell;
            startInfo.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File "
                + QuoteArgument(installerScript)
                + " -AcceptVerifiedUnsignedRuntime";
            startInfo.WorkingDirectory = supportRoot;
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = false;

            try
            {
                using (Process installer = Process.Start(startInfo))
                {
                    if (installer == null)
                    {
                        ShowError("Windows could not start the verified Wellbeing Companion installer. Nothing was installed.");
                        return 13;
                    }
                    installer.WaitForExit();
                    if (installer.ExitCode != 0)
                    {
                        ShowError(
                            "Wellbeing Companion setup did not complete. The installer returned code "
                            + installer.ExitCode
                            + ". Review the visible installer message before trying a repaired package."
                        );
                        return installer.ExitCode;
                    }
                }
            }
            catch (Exception error)
            {
                ShowError("Wellbeing Companion setup could not start: " + error.Message + " Nothing was installed.");
                return 14;
            }

            MessageBox.Show(
                "Wellbeing Companion was installed. Open it from the Desktop or Start menu shortcut.",
                ProductName + " setup",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information
            );
            return 0;
        }

        private static bool IsStrictChildPath(string parent, string candidate)
        {
            string parentPrefix = parent.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            return candidate.StartsWith(parentPrefix, StringComparison.OrdinalIgnoreCase);
        }

        private static string QuoteArgument(string value)
        {
            if (value.IndexOf('"') >= 0)
            {
                throw new InvalidOperationException("The setup path contains an unsupported quote character.");
            }
            return "\"" + value + "\"";
        }

        private static void ShowError(string message)
        {
            MessageBox.Show(
                message,
                ProductName + " setup",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
    }
}
