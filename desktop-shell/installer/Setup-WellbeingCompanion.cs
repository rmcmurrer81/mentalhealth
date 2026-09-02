using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

namespace WellbeingCompanionSetup
{
    internal static class Program
    {
        [STAThread]
        private static int Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (SetupWizard wizard = new SetupWizard())
            {
                Application.Run(wizard);
                return wizard.ExitCode;
            }
        }
    }

    internal sealed class SetupWizard : Form
    {
        private const string ProductDisplayName = "Wellbeing Companion (Working Title)";
        private const string SupportDirectoryName = "Support";
        private const string InstallerScriptName = "Install-WellbeingCompanion.ps1";
        private const string InstalledExecutableName = "WellbeingCompanionWorkingTitle.exe";

        private readonly Panel content = new Panel();
        private readonly Label title = new Label();
        private readonly Label copy = new Label();
        private readonly Label detail = new Label();
        private readonly ProgressBar progress = new ProgressBar();
        private readonly CheckBox launchAfterSetup = new CheckBox();
        private readonly Button back = new Button();
        private readonly Button next = new Button();
        private readonly Button cancel = new Button();
        private readonly BackgroundWorker installerWorker = new BackgroundWorker();
        private readonly string setupRoot;
        private readonly string supportRoot;
        private readonly string installerScript;
        private readonly string installRoot;
        private int page;
        private bool installing;
        private bool installed;

        internal int ExitCode { get; private set; }

        internal SetupWizard()
        {
            Text = ProductDisplayName + " Setup";
            ClientSize = new Size(680, 470);
            MinimumSize = new Size(680, 470);
            MaximumSize = new Size(680, 470);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            BackColor = Color.FromArgb(245, 247, 255);
            Font = new Font("Segoe UI", 9.75F, FontStyle.Regular, GraphicsUnit.Point);

            setupRoot = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            supportRoot = Path.GetFullPath(Path.Combine(setupRoot, SupportDirectoryName));
            installerScript = Path.GetFullPath(Path.Combine(supportRoot, InstallerScriptName));
            installRoot = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs",
                "WellbeingCompanionWorkingTitle"
            );

            BuildChrome();
            installerWorker.DoWork += RunInstaller;
            installerWorker.RunWorkerCompleted += InstallerCompleted;
            FormClosing += OnFormClosing;
            ShowPage(0);
        }

        private void BuildChrome()
        {
            Panel brand = new Panel { Dock = DockStyle.Top, Height = 88, BackColor = Color.FromArgb(35, 19, 88) };
            Label brandMark = new Label {
                Text = "WC", AutoSize = false, TextAlign = ContentAlignment.MiddleCenter,
                Bounds = new Rectangle(26, 18, 52, 52), ForeColor = Color.White,
                BackColor = Color.FromArgb(55, 93, 185), Font = new Font("Segoe UI", 12F, FontStyle.Bold)
            };
            Label brandName = new Label {
                Text = "WELLBEING COMPANION\r\nVerified local installer", AutoSize = false,
                Bounds = new Rectangle(94, 22, 430, 52), ForeColor = Color.White,
                Font = new Font("Segoe UI", 10F, FontStyle.Bold)
            };
            brand.Controls.Add(brandMark);
            brand.Controls.Add(brandName);
            Controls.Add(brand);

            content.Bounds = new Rectangle(0, 88, 680, 316);
            content.BackColor = Color.FromArgb(250, 251, 255);
            Controls.Add(content);

            title.Bounds = new Rectangle(42, 30, 592, 46);
            title.Font = new Font("Segoe UI", 21F, FontStyle.Bold);
            title.ForeColor = Color.FromArgb(33, 28, 72);
            content.Controls.Add(title);
            copy.Bounds = new Rectangle(44, 90, 585, 62);
            copy.Font = new Font("Segoe UI", 10F, FontStyle.Regular);
            copy.ForeColor = Color.FromArgb(65, 69, 105);
            content.Controls.Add(copy);
            detail.Bounds = new Rectangle(44, 158, 585, 105);
            detail.Font = new Font("Segoe UI", 9.5F, FontStyle.Regular);
            detail.ForeColor = Color.FromArgb(76, 79, 111);
            detail.BorderStyle = BorderStyle.FixedSingle;
            detail.Padding = new Padding(13);
            detail.BackColor = Color.White;
            content.Controls.Add(detail);
            progress.Bounds = new Rectangle(44, 180, 585, 20);
            progress.Style = ProgressBarStyle.Marquee;
            progress.MarqueeAnimationSpeed = 24;
            progress.Visible = false;
            content.Controls.Add(progress);
            launchAfterSetup.Bounds = new Rectangle(44, 224, 585, 30);
            launchAfterSetup.Text = "Open Wellbeing Companion after setup";
            launchAfterSetup.Checked = true;
            launchAfterSetup.Visible = false;
            content.Controls.Add(launchAfterSetup);

            Panel footer = new Panel { Dock = DockStyle.Bottom, Height = 66, BackColor = Color.FromArgb(237, 240, 250) };
            back.Text = "Back";
            back.Bounds = new Rectangle(356, 16, 92, 34);
            back.Click += delegate { if (!installing && page > 0) ShowPage(page == 3 ? 1 : page - 1); };
            next.Text = "Next";
            next.Bounds = new Rectangle(454, 16, 106, 34);
            next.BackColor = Color.FromArgb(85, 48, 142);
            next.ForeColor = Color.White;
            next.FlatStyle = FlatStyle.Flat;
            next.Click += NextClicked;
            cancel.Text = "Cancel";
            cancel.Bounds = new Rectangle(566, 16, 84, 34);
            cancel.Click += delegate { Close(); };
            footer.Controls.Add(back);
            footer.Controls.Add(next);
            footer.Controls.Add(cancel);
            Controls.Add(footer);
            AcceptButton = next;
            CancelButton = cancel;
        }

        private void ShowPage(int target)
        {
            page = target;
            progress.Visible = false;
            launchAfterSetup.Visible = false;
            detail.Visible = true;
            detail.ForeColor = Color.FromArgb(76, 79, 111);
            detail.BackColor = Color.White;
            back.Enabled = page > 0 && !installing;
            cancel.Enabled = !installing;
            cancel.Visible = true;
            next.Enabled = !installing;

            if (page == 0)
            {
                title.Text = "Welcome";
                copy.Text = "This wizard installs the private local Wellbeing Companion for your Windows account.";
                detail.Text = "Setup verifies the sealed package receipt before copying files. Conversation data stays in your Windows profile and is preserved by default if you reinstall or uninstall.\r\n\r\nNo account or cloud sign-in is required.";
                next.Text = "Next";
            }
            else if (page == 1)
            {
                title.Text = "Ready to install";
                copy.Text = "Review where the app and shortcuts will be placed.";
                detail.Text = "Install location\r\n" + installRoot
                    + "\r\n\r\nShortcuts\r\nDesktop and Start menu\r\n\r\nFirst launch\r\nChoose your name, voice, theme, and microphone preference inside the app.";
                next.Text = "Install";
            }
            else if (page == 2)
            {
                title.Text = "Installing";
                copy.Text = "Verifying the sealed receipt and copying Wellbeing Companion…";
                detail.Visible = false;
                progress.Visible = true;
                back.Enabled = false;
                next.Enabled = false;
                cancel.Enabled = false;
            }
            else
            {
                title.Text = installed ? "Setup complete" : "Setup needs attention";
                copy.Text = installed
                    ? "Wellbeing Companion is installed and ready for first-run choices."
                    : "No completed installation was reported. Review the message below, then go back and try again with a repaired package.";
                launchAfterSetup.Visible = installed;
                next.Enabled = true;
                next.Text = installed ? "Finish" : "Close";
                back.Enabled = !installed;
                cancel.Visible = false;
            }
        }

        private void NextClicked(object sender, EventArgs eventArgs)
        {
            if (page == 0) { ShowPage(1); return; }
            if (page == 1) { BeginInstall(); return; }
            if (page == 3)
            {
                if (installed && launchAfterSetup.Checked) LaunchInstalledApp();
                Close();
            }
        }

        private void BeginInstall()
        {
            if (!IsStrictChildPath(setupRoot, supportRoot) || !IsStrictChildPath(supportRoot, installerScript))
            {
                ShowInlineFailure("The setup support path is not safe. Nothing was installed.", 10);
                return;
            }
            if (!Directory.Exists(supportRoot) || !File.Exists(installerScript))
            {
                ShowInlineFailure("Setup is incomplete. Extract the entire replacement package and run this wizard again. Nothing was installed.", 11);
                return;
            }
            installing = true;
            ShowPage(2);
            installerWorker.RunWorkerAsync();
        }

        private void RunInstaller(object sender, DoWorkEventArgs eventArgs)
        {
            string systemDirectory = Environment.GetFolderPath(Environment.SpecialFolder.System);
            string powerShell = Path.Combine(systemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
            if (!File.Exists(powerShell)) { eventArgs.Result = new InstallResult(12, "Windows PowerShell is unavailable. Nothing was installed."); return; }
            try
            {
                ProcessStartInfo startInfo = new ProcessStartInfo();
                startInfo.FileName = powerShell;
                startInfo.Arguments = "-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "
                    + QuoteArgument(installerScript) + " -AcceptVerifiedUnsignedRuntime";
                startInfo.WorkingDirectory = supportRoot;
                startInfo.UseShellExecute = false;
                startInfo.CreateNoWindow = true;
                using (Process installer = Process.Start(startInfo))
                {
                    if (installer == null) { eventArgs.Result = new InstallResult(13, "Windows could not start the verified installer. Nothing was installed."); return; }
                    installer.WaitForExit();
                    eventArgs.Result = installer.ExitCode == 0
                        ? new InstallResult(0, "Program files and shortcuts were verified and installed. Your existing private data, if any, was preserved.")
                        : new InstallResult(installer.ExitCode, "Setup returned code " + installer.ExitCode + ". Nothing is reported as complete.");
                }
            }
            catch (Exception error)
            {
                eventArgs.Result = new InstallResult(14, "Setup could not continue: " + error.Message + " Nothing was installed.");
            }
        }

        private void InstallerCompleted(object sender, RunWorkerCompletedEventArgs eventArgs)
        {
            installing = false;
            InstallResult result = eventArgs.Result as InstallResult;
            if (eventArgs.Error != null) result = new InstallResult(14, "Setup could not continue: " + eventArgs.Error.Message + " Nothing was installed.");
            if (result == null) result = new InstallResult(14, "Setup ended without a result. Nothing is reported as complete.");
            ExitCode = result.Code;
            installed = result.Code == 0;
            ShowPage(3);
            detail.Text = result.Message;
            if (!installed)
            {
                detail.ForeColor = Color.FromArgb(119, 45, 53);
                detail.BackColor = Color.FromArgb(255, 240, 242);
            }
        }

        private void ShowInlineFailure(string message, int code)
        {
            ExitCode = code;
            installed = false;
            ShowPage(3);
            detail.Text = message;
            detail.ForeColor = Color.FromArgb(119, 45, 53);
            detail.BackColor = Color.FromArgb(255, 240, 242);
        }

        private void LaunchInstalledApp()
        {
            string executable = Path.Combine(installRoot, InstalledExecutableName);
            if (!File.Exists(executable)) return;
            try { Process.Start(new ProcessStartInfo { FileName = executable, WorkingDirectory = installRoot, UseShellExecute = true }); }
            catch { /* The finish page already reports installation; shortcuts remain available. */ }
        }

        private void OnFormClosing(object sender, FormClosingEventArgs eventArgs)
        {
            if (installing) eventArgs.Cancel = true;
        }

        private static bool IsStrictChildPath(string parent, string candidate)
        {
            string parentPrefix = parent.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            return candidate.StartsWith(parentPrefix, StringComparison.OrdinalIgnoreCase);
        }

        private static string QuoteArgument(string value)
        {
            if (value.IndexOf('"') >= 0) throw new InvalidOperationException("The setup path contains an unsupported quote character.");
            return "\"" + value + "\"";
        }

        private sealed class InstallResult
        {
            internal readonly int Code;
            internal readonly string Message;
            internal InstallResult(int code, string message) { Code = code; Message = message; }
        }
    }
}
