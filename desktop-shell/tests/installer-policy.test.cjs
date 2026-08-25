'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const scripts = path.resolve(__dirname, '..', 'scripts');

test('installer creates own shortcuts and Installed Apps entry with receipt and ownership preflight', () => {
  const source = fs.readFileSync(path.join(scripts, 'Install-WellbeingCompanion.ps1'), 'utf8');
  assert.match(source, /Get-RequiredKnownFolder -Folder Programs/);
  assert.match(source, /Get-RequiredKnownFolder -Folder Desktop/);
  assert.match(source, /Wellbeing Companion \(Working Title\)\.lnk/);
  assert.match(source, /Uninstall Wellbeing Companion \(Working Title\)\.lnk/);
  assert.match(source, /CurrentVersion\\Uninstall\\WellbeingCompanionWorkingTitle/);
  assert.match(source, /WellbeingCompanionWorkingTitle\.ico/);
  assert.match(source, /PrivateDataPolicy = 'Preserved by default during uninstall'/);
  assert.match(source, /AcceptVerifiedUnsignedRuntime/);
  assert.match(source, /Assert-SetupReceipt/);
  assert.match(source, /Assert-NoReparsePointTree/);
  assert.match(source, /Refusing to claim an existing unmarked directory/);
  assert.match(source, /WellbeingCompanionProductId/);
  assert.match(source, /Publisher -Value 'Kira Labs'/);
  const ownershipPreflight = source.indexOf('Assert-UninstallRegistryOwnedOrAbsent -Path $uninstallRegistryPath');
  const firstInstallWrite = source.indexOf('New-Item -ItemType Directory -Path $stagingFolder');
  assert.ok(ownershipPreflight >= 0 && firstInstallWrite > ownershipPreflight);
  assert.doesNotMatch(source, /msedge|chrome/i);
});

test('uninstall preserves data by default and remove-all is explicit and bounded', () => {
  const source = fs.readFileSync(path.join(scripts, 'Uninstall-WellbeingCompanion.ps1'), 'utf8');
  assert.match(source, /'&Preserve private local data'/);
  assert.match(source, /Remove &all companion data/);
  assert.match(source, /if \(\$RemoveAllData\)/);
  assert.match(source, /Assert-NoReparsePointTree/);
  assert.match(source, /Assert-OwnedWellbeingCompanionDirectory/);
  assert.match(source, /Refusing to remove an unowned directory/);
  assert.match(source, /Get-CimInstance Win32_Process/);
  assert.match(source, /Nothing was removed/);
  assert.match(source, /Remove-Item\s+-LiteralPath/);
  assert.doesNotMatch(source, /Remove-Item\s+-Path\s+[^\r\n]*\*/);
  const shortcutPreflight = source.indexOf('Assert-OwnedShortcut -Path $uninstallShortcut');
  const dataRemoval = source.indexOf('Remove-PreflightedOwnedDirectory -Path $localDataRoot');
  assert.ok(shortcutPreflight >= 0 && dataRemoval > shortcutPreflight);
});

test('builder binds the Vite production build, custom assets, setup, and final archive', () => {
  const source = fs.readFileSync(path.join(scripts, 'Build-WindowsPackage.ps1'), 'utf8');
  assert.match(source, /C2EF9A5F65472C34D14BD3E67B7D14E66B0C01F124ABA45263D6A4232160E13A/);
  assert.match(source, /Get-AuthenticodeSignature/);
  assert.match(source, /Wellbeing-Companion-Working-Title-Setup-\$packageVersion-win32-x64\.zip/);
  assert.match(source, /Copy-Item -LiteralPath \$webDistRoot/);
  assert.match(source, /bundledRuntimeOrigin = 'http:\/\/127\.0\.0\.1:43724\/'/);
  assert.match(source, /Get-TreeManifest/);
  assert.match(source, /Get-ManifestRecord -Root \$appResourceRoot -FilePath/);
  assert.match(source, /SETUP-RECEIPT\.json/);
  assert.match(source, /sha256\.txt/);
  assert.match(source, /receipt\.json/);
  assert.doesNotMatch(source, /vinext|UnitLine|UnitDay|SetSignal/i);
});

test('verifier checks exact receipts, offline assets, permissions, local model boundary, and actual process', () => {
  const source = fs.readFileSync(path.join(scripts, 'Verify-WindowsPackage.ps1'), 'utf8');
  assert.match(source, /Assert-FileRecords/);
  assert.match(source, /Assert-FileRecords -Root \(Join-Path \$unpackedRoot 'resources\\app'\) -Records @\(\$buildReceipt\.integrity\.files\)/);
  assert.match(source, /automatic external asset URL/);
  assert.match(source, /Start-Process -FilePath \$executablePath/);
  assert.match(source, /successReceiptRequiredWhenLauncherExitCodeUnavailable/);
  assert.match(source, /COMPANION_SMOKE_USER_DATA/);
  assert.match(source, /windowCreated/);
  assert.match(source, /trayCreated/);
  assert.match(source, /localStorageRoundTrip/);
  assert.match(source, /microphoneRequiresExplicitHandsFreeIpc/);
  assert.match(source, /displayCaptureAllowed/);
  assert.match(source, /localModelBoundary/);
  assert.match(source, /liveProbePerformed/);
  assert.match(source, /localVoiceBoundary/);
  assert.match(source, /providerConfigured/);
  assert.match(source, /playbackVerified/);
  assert.match(source, /systemVoiceFallback/);
  assert.match(source, /WorkingDirectory \(Split-Path -Parent \$executablePath\)/);
});

test('isolated lifecycle harness is temp-root-only and honest about not executing real installer', () => {
  const source = fs.readFileSync(path.join(scripts, 'Test-IsolatedLifecycle.ps1'), 'utf8');
  assert.match(source, /GetTempPath/);
  assert.match(source, /Assert-UnderTestRoot/);
  assert.match(source, /actualInstallerExecuted = \$false/);
  assert.match(source, /realUserProfileMutated = \$false/);
  assert.match(source, /\$setupArchiveHash = \(Get-FileHash -Algorithm SHA256 -LiteralPath \$setupZip\)/);
  assert.match(source, /\$actualSidecar -ne \$expectedSidecar/);
  assert.match(source, /bytes = \[long\]\$setupArchiveItem\.Length/);
  assert.match(source, /sha256 = \$setupArchiveHash/);
  assert.match(source, /embeddedSetupReceipt/);
  assert.match(source, /preserveDataUninstallPassed/);
  assert.match(source, /reinstallRecoveredDataPassed/);
  assert.match(source, /explicitRemoveAllPassed/);
  assert.doesNotMatch(source, /HKCU:/);
});
