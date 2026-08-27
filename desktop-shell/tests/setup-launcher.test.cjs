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
  assert.match(source, /-NoLogo -NoProfile -ExecutionPolicy Bypass -File/);
  assert.match(source, /-AcceptVerifiedUnsignedRuntime/);
  assert.match(source, /Process\.Start\(startInfo\)/);
  assert.match(source, /installer\.WaitForExit\(\)/);
});

test('setup launcher makes the unsigned owner-test boundary explicit and cancel-first', () => {
  assert.match(source, /not publisher-signed/);
  assert.match(source, /verify the sealed package receipt/);
  assert.match(source, /MessageBoxButtons\.OKCancel/);
  assert.match(source, /MessageBoxDefaultButton\.Button2/);
  assert.match(source, /acknowledgement != DialogResult\.OK/);
});

test('setup launcher refuses missing or escaped support paths and surfaces failure', () => {
  assert.match(source, /IsStrictChildPath\(setupRoot, supportRoot\)/);
  assert.match(source, /IsStrictChildPath\(supportRoot, installerScript\)/);
  assert.match(source, /!Directory\.Exists\(supportRoot\) \|\| !File\.Exists\(installerScript\)/);
  assert.match(source, /UseShellExecute = false/);
  assert.match(source, /CreateNoWindow = false/);
  assert.match(source, /installer\.ExitCode != 0/);
  assert.match(source, /Nothing was installed/);
});
