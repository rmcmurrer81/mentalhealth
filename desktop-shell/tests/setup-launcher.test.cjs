'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sourcePath = path.join(__dirname, '..', 'installer', 'Setup-WellbeingCompanion.cs');
const source = fs.readFileSync(sourcePath, 'utf8');

test('double-click setup launcher targets the sealed support installer instead of opening PowerShell source', () => {
  assert.match(source, /SupportDirectoryName = "Support"/);
  assert.match(source, /InstallerScriptName = "Install-WellbeingCompanion\.ps1"/);
  assert.match(source, /Environment\.SpecialFolder\.System/);
  assert.match(source, /WindowsPowerShell/);
  assert.match(source, /-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File/);
  assert.match(source, /-AcceptVerifiedUnsignedRuntime/);
  assert.match(source, /Process\.Start\(startInfo\)/);
  assert.match(source, /installer\.WaitForExit\(\)/);
});

test('setup launcher uses meaningful wizard pages without custom warning or completion popups', () => {
  assert.match(source, /class SetupWizard : Form/);
  assert.match(source, /Welcome/);
  assert.match(source, /Ready to install/);
  assert.match(source, /ProgressBarStyle\.Marquee/);
  assert.match(source, /Setup complete/);
  assert.match(source, /Open Wellbeing Companion after setup/);
  assert.match(source, /First launch/);
  assert.match(source, /Choose your name, voice, theme, and microphone preference inside the app/);
  assert.match(source, /Verified local installer/);
  assert.match(source, /Text = "WC"/);
  assert.doesNotMatch(source, /Text = "✦"/);
  assert.doesNotMatch(source, /MessageBox\.Show/);
  assert.doesNotMatch(source, /owner-test|not publisher-signed/i);
});

test('setup launcher refuses missing or escaped support paths and surfaces failure', () => {
  assert.match(source, /IsStrictChildPath\(setupRoot, supportRoot\)/);
  assert.match(source, /IsStrictChildPath\(supportRoot, installerScript\)/);
  assert.match(source, /!Directory\.Exists\(supportRoot\) \|\| !File\.Exists\(installerScript\)/);
  assert.match(source, /UseShellExecute = false/);
  assert.match(source, /CreateNoWindow = true/);
  assert.match(source, /ShowInlineFailure/);
  assert.match(source, /BackgroundWorker/);
  assert.match(source, /installer\.ExitCode == 0/);
  assert.match(source, /new InstallResult\(installer\.ExitCode/);
  assert.match(source, /Nothing was installed/);
});
