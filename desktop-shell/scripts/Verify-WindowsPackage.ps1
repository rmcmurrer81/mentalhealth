[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9._-]{1,80}$')]
    [string]$RunId = '',

    [string]$ExtractionBaseRoot = ''
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot 'release'
$packageVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$unpackedRoot = Join-Path $releaseRoot 'win-unpacked'
$executablePath = Join-Path $unpackedRoot 'WellbeingCompanionWorkingTitle.exe'
$buildReceiptPath = Join-Path $unpackedRoot 'BUILD-RECEIPT.json'
$setupZip = Join-Path $releaseRoot "Wellbeing-Companion-Working-Title-Setup-$packageVersion-win32-x64.zip"
$sidecarPath = "$setupZip.sha256.txt"
$packageReceiptPath = "$setupZip.receipt.json"
$smokePath = Join-Path $projectRoot 'wellbeing-companion-desktop.smoke.json'
$verificationRoot = Join-Path $projectRoot 'verification'
$verificationPath = Join-Path $verificationRoot 'DESKTOP-PACKAGE-VERIFICATION.json'
$stdoutPath = Join-Path $releaseRoot 'smoke.stdout.log'
$stderrPath = Join-Path $releaseRoot 'smoke.stderr.log'
$extractBaseRoot = if ([string]::IsNullOrWhiteSpace($ExtractionBaseRoot)) {
    [IO.Path]::GetTempPath()
} else {
    if (-not [IO.Path]::IsPathRooted($ExtractionBaseRoot)) { throw 'ExtractionBaseRoot must be an absolute path.' }
    [IO.Path]::GetFullPath($ExtractionBaseRoot)
}
$extractRoot = Join-Path $extractBaseRoot ("wellbeing-verify-{0}" -f [Guid]::NewGuid().ToString('N'))
$smokeUserData = Join-Path $extractRoot 'smoke-isolated-user-data'
$smokeExecutablePath = $null
if ([string]::IsNullOrWhiteSpace($RunId)) {
    $RunId = "single-{0}-{1}" -f (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ'), [Guid]::NewGuid().ToString('N').Substring(0, 8)
}
$verifiedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
$windowsBuild = [Environment]::OSVersion.Version.Build
$affectedWindowsBuild = $windowsBuild -ge 26200 -and $windowsBuild -le 26399

function Assert-GeneratedPath {
    param([Parameter(Mandatory)] [string]$Base, [Parameter(Mandatory)] [string]$Candidate)
    $baseFull = [IO.Path]::GetFullPath($Base).TrimEnd('\')
    $candidateFull = [IO.Path]::GetFullPath($Candidate).TrimEnd('\')
    if (-not $candidateFull.StartsWith("$baseFull\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing a generated path outside its expected root: $candidateFull"
    }
}

function Get-SafeManifestPath {
    param([Parameter(Mandatory)] [string]$Root, [Parameter(Mandatory)] [string]$RelativePath)
    if ([string]::IsNullOrWhiteSpace($RelativePath) -or [IO.Path]::IsPathRooted($RelativePath)) { throw "Unsafe manifest path: $RelativePath" }
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $candidate = [IO.Path]::GetFullPath((Join-Path $rootFull $RelativePath.Replace('/', '\')))
    if (-not $candidate.StartsWith("$rootFull\", [StringComparison]::OrdinalIgnoreCase)) { throw "Manifest path escaped package root: $RelativePath" }
    return $candidate
}

function Assert-FileRecords {
    param(
        [Parameter(Mandatory)] [string]$Root,
        [Parameter(Mandatory)] [object[]]$Records,
        [Parameter(Mandatory)] [AllowEmptyCollection()] [string[]]$ExcludedRelativePaths
    )
    $recorded = @{}
    foreach ($record in @($Records)) {
        $relative = ([string]$record.path).Replace('\', '/')
        $key = $relative.ToLowerInvariant()
        if ($recorded.ContainsKey($key)) { throw "Duplicate manifest path: $relative" }
        $recorded[$key] = $true
        $fullPath = Get-SafeManifestPath -Root $Root -RelativePath $relative
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "Missing manifest file: $relative" }
        $item = Get-Item -LiteralPath $fullPath -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Manifest file is a reparse point: $relative" }
        if ([long]$record.bytes -ne [long]$item.Length) { throw "Manifest byte mismatch: $relative" }
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $fullPath).Hash.ToUpperInvariant() -ne ([string]$record.sha256).ToUpperInvariant()) { throw "Manifest hash mismatch: $relative" }
    }
    $excluded = @{}
    foreach ($relative in $ExcludedRelativePaths) { $excluded[$relative.Replace('\', '/').ToLowerInvariant()] = $true }
    $actual = @()
    foreach ($file in Get-ChildItem -LiteralPath $Root -File -Recurse | Sort-Object FullName) {
        $relative = $file.FullName.Substring(([IO.Path]::GetFullPath($Root).TrimEnd('\')).Length + 1).Replace('\', '/')
        if (-not $excluded.ContainsKey($relative.ToLowerInvariant())) { $actual += $relative.ToLowerInvariant() }
    }
    $recordedPaths = @($recorded.Keys | Sort-Object)
    $actualPaths = @($actual | Sort-Object -Unique)
    if ($recordedPaths.Count -ne $actualPaths.Count -or (Compare-Object -ReferenceObject $actualPaths -DifferenceObject $recordedPaths)) {
        throw 'Manifest scope does not exactly match the package tree.'
    }
}

foreach ($required in @($executablePath, $buildReceiptPath, $setupZip, $sidecarPath, $packageReceiptPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required package artifact is missing: $required" }
}

$buildReceipt = Get-Content -Raw -LiteralPath $buildReceiptPath -Encoding UTF8 | ConvertFrom-Json
if ($buildReceipt.schema -ne 1 -or $buildReceipt.product -ne 'Wellbeing companion working-title desktop shell') { throw 'The build receipt identity is invalid.' }
$signature = Get-AuthenticodeSignature -LiteralPath $executablePath
$executableHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $executablePath).Hash.ToUpperInvariant()
if ($signature.Status.ToString() -ne [string]$buildReceipt.executableSignatureStatus -or $signature.Status -notin @('Valid', 'NotSigned')) { throw 'Executable signature state does not match its receipt.' }
if ($executableHash -ne ([string]$buildReceipt.executableSha256).ToUpperInvariant()) { throw 'Executable hash does not match its receipt.' }
Assert-FileRecords -Root (Join-Path $unpackedRoot 'resources\app') -Records @($buildReceipt.integrity.files) -ExcludedRelativePaths @()

$packagedAppRoot = Join-Path $unpackedRoot 'resources\app'
$packagedVoiceBridge = Join-Path $packagedAppRoot 'desktop\chatterbox-local-voice.cjs'
$packagedVoiceHost = Join-Path $packagedAppRoot 'desktop\chatterbox-voice-host.py'
$packagedFemaleReference = Join-Path $packagedAppRoot 'web\voice-previews\calm-female-approved.wav'
$packagedMaleReference = Join-Path $packagedAppRoot 'web\voice-previews\warm-male-approved.wav'
foreach ($voiceAsset in @($packagedVoiceBridge, $packagedVoiceHost, $packagedFemaleReference, $packagedMaleReference)) {
    if (-not (Test-Path -LiteralPath $voiceAsset -PathType Leaf)) { throw "The exact package is missing a bounded local-voice asset: $voiceAsset" }
}
$femaleReferenceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $packagedFemaleReference).Hash.ToLowerInvariant()
$maleReferenceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $packagedMaleReference).Hash.ToLowerInvariant()
if ($femaleReferenceHash -ne 'c3e3682817476212c990969901028758fbbde1eb4eb8c97153ef878b3939b33a' -or
    $maleReferenceHash -ne '0a8cdb8178bf56a6aa2442cca496dcf87a76b52e8eb0743488dc5f0e8c8a8a8e') {
    throw 'The exact package synthetic voice-reference hashes do not match the reviewed provenance records.'
}
$packagedVoiceBridgeSource = Get-Content -Raw -LiteralPath $packagedVoiceBridge -Encoding UTF8
$packagedVoiceHostSource = Get-Content -Raw -LiteralPath $packagedVoiceHost -Encoding UTF8
if ($packagedVoiceBridgeSource -notmatch "host: '127\.0\.0\.1'" -or
    $packagedVoiceBridgeSource -notmatch "shell: false" -or
    $packagedVoiceBridgeSource -notmatch "HF_HUB_OFFLINE: '1'" -or
    $packagedVoiceBridgeSource -notmatch "TRANSFORMERS_OFFLINE: '1'" -or
    $packagedVoiceHostSource -notmatch 'ThreadingHTTPServer\(\("127\.0\.0\.1", 0\)' -or
    $packagedVoiceHostSource -notmatch 'WELLBEING_VOICE_AUTH_TOKEN') {
    throw 'The exact package local-voice host is missing its loopback, authentication, or offline-only boundary.'
}
$bundledModelFiles = @(Get-ChildItem -LiteralPath $packagedAppRoot -File -Recurse | Where-Object {
    $_.Name -in @('conds.pt', 's3gen.safetensors', 't3_cfg.safetensors', 've.safetensors')
})
if ($bundledModelFiles.Count -ne 0) { throw 'The exact package unexpectedly bundles the external multi-gigabyte Chatterbox model cache.' }
$localVoiceProviderAssets = [ordered]@{
    adapterPath = 'resources/app/desktop/chatterbox-local-voice.cjs'
    hostPath = 'resources/app/desktop/chatterbox-voice-host.py'
    loopbackOnly = $true
    perProcessAuthenticationRequired = $true
    offlineEnvironmentRequired = $true
    modelBundled = $false
    syntheticReferences = @(
        [ordered]@{ profile = 'soft-feminine'; path = 'resources/app/web/voice-previews/calm-female-approved.wav'; sha256 = $femaleReferenceHash.ToUpperInvariant() },
        [ordered]@{ profile = 'calm-masculine'; path = 'resources/app/web/voice-previews/warm-male-approved.wav'; sha256 = $maleReferenceHash.ToUpperInvariant() }
    )
}

$webFiles = Get-ChildItem -LiteralPath (Join-Path $unpackedRoot 'resources\app\web') -File -Recurse
foreach ($file in $webFiles) {
    if ($file.Extension -in @('.js', '.css', '.html')) {
        $content = Get-Content -Raw -LiteralPath $file.FullName
        if ($content -match '(?i)https?://(?:fonts\.|fonts\.googleapis|fonts\.gstatic|cdn\.)') {
            throw "The packaged offline UI contains an automatic external asset URL: $($file.FullName)"
        }
    }
}

$setupHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $setupZip).Hash.ToUpperInvariant()
$sidecarLine = (Get-Content -LiteralPath $sidecarPath -Raw).Trim()
$expectedSidecar = "$setupHash  $([IO.Path]::GetFileName($setupZip))"
if ($sidecarLine -ne $expectedSidecar) { throw 'The setup ZIP sidecar is invalid.' }
$sidecarHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sidecarPath).Hash.ToUpperInvariant()
$packageReceipt = Get-Content -Raw -LiteralPath $packageReceiptPath -Encoding UTF8 | ConvertFrom-Json
if ($packageReceipt.product -ne 'Wellbeing companion working-title Windows setup archive') { throw 'The external package receipt identity is invalid.' }
$zipRecord = @($packageReceipt.artifacts | Where-Object { $_.path -eq [IO.Path]::GetFileName($setupZip) })
$sidecarRecord = @($packageReceipt.artifacts | Where-Object { $_.path -eq [IO.Path]::GetFileName($sidecarPath) })
if ($zipRecord.Count -ne 1 -or [string]$zipRecord[0].sha256 -ne $setupHash -or [long]$zipRecord[0].bytes -ne [long](Get-Item -LiteralPath $setupZip).Length) { throw 'The external ZIP receipt is invalid.' }
if ($sidecarRecord.Count -ne 1 -or [string]$sidecarRecord[0].sha256 -ne $sidecarHash -or [long]$sidecarRecord[0].bytes -ne [long](Get-Item -LiteralPath $sidecarPath).Length) { throw 'The external sidecar receipt is invalid.' }

Assert-GeneratedPath -Base $extractBaseRoot -Candidate $extractRoot
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
try {
    Expand-Archive -LiteralPath $setupZip -DestinationPath $extractRoot -Force
    $setupRoot = Join-Path $extractRoot "Wellbeing-Companion-Working-Title-Setup-$packageVersion"
    $setupReceiptPath = Join-Path $setupRoot 'SETUP-RECEIPT.json'
    if (-not (Test-Path -LiteralPath $setupReceiptPath -PathType Leaf)) { throw 'The embedded setup receipt is missing.' }
    $setupReceipt = Get-Content -Raw -LiteralPath $setupReceiptPath -Encoding UTF8 | ConvertFrom-Json
    if ($setupReceipt.product -ne 'Wellbeing companion working-title Windows setup') { throw 'The embedded setup receipt identity is invalid.' }
    Assert-FileRecords -Root $setupRoot -Records @($setupReceipt.files) -ExcludedRelativePaths @('SETUP-RECEIPT.json')
    $embeddedRecord = @($packageReceipt.artifacts | Where-Object { $_.path -eq "Wellbeing-Companion-Working-Title-Setup-$packageVersion/SETUP-RECEIPT.json" })
    $embeddedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $setupReceiptPath).Hash.ToUpperInvariant()
    if ($embeddedRecord.Count -ne 1 -or [string]$embeddedRecord[0].sha256 -ne $embeddedHash -or [long]$embeddedRecord[0].bytes -ne [long](Get-Item -LiteralPath $setupReceiptPath).Length) { throw 'The embedded setup receipt is not bound by the package receipt.' }
    $setupLauncherPath = Join-Path $setupRoot 'SETUP-WELLBEING-COMPANION.exe'
    $supportInstallerPath = Join-Path $setupRoot 'Support\Install-WellbeingCompanion.ps1'
    $supportUninstallerPath = Join-Path $setupRoot 'Support\Uninstall-WellbeingCompanion.ps1'
    foreach ($requiredSetupFile in @($setupLauncherPath, $supportInstallerPath, $supportUninstallerPath)) {
        if (-not (Test-Path -LiteralPath $requiredSetupFile -PathType Leaf)) { throw "The setup launcher layout is incomplete: $requiredSetupFile" }
    }
    if (@(Get-ChildItem -LiteralPath $setupRoot -File -Filter '*.ps1').Count -ne 0) { throw 'The setup root exposes a PowerShell script instead of only the double-click launcher.' }
    $expectedRootFiles = @('README.txt', 'SETUP-RECEIPT.json', 'SETUP-WELLBEING-COMPANION.exe')
    $actualRootFiles = @(Get-ChildItem -LiteralPath $setupRoot -File | ForEach-Object Name | Sort-Object)
    if ($actualRootFiles.Count -ne $expectedRootFiles.Count -or (Compare-Object -ReferenceObject @($expectedRootFiles | Sort-Object) -DifferenceObject $actualRootFiles)) {
        throw 'The setup root file layout is not the bounded double-click layout.'
    }
    $launcherItem = Get-Item -LiteralPath $setupLauncherPath -Force
    if ($launcherItem.Length -lt 5000) { throw 'The compiled setup launcher is unexpectedly small.' }
    $launcherHeader = [IO.File]::ReadAllBytes($setupLauncherPath)
    if ($launcherHeader.Length -lt 2 -or $launcherHeader[0] -ne 0x4d -or $launcherHeader[1] -ne 0x5a) { throw 'The setup launcher is not a Windows PE executable.' }
    $verifyOnlyResult = @(& $supportInstallerPath -VerifyOnly -AcceptVerifiedUnsignedRuntime)
    if ($verifyOnlyResult.Count -ne 1 -or $verifyOnlyResult[0].Status -ne 'VerifiedOnly' -or $verifyOnlyResult[0].RealUserProfileMutated) {
        throw 'The setup installer did not complete its no-mutation verification-only path.'
    }
    $smokeExecutablePath = Join-Path $setupRoot 'Payload\WellbeingCompanionWorkingTitle.exe'
    if (-not (Test-Path -LiteralPath $smokeExecutablePath -PathType Leaf)) { throw 'The exact extracted setup payload does not contain the packaged executable.' }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $smokeExecutablePath).Hash.ToUpperInvariant() -ne $executableHash) { throw 'The exact extracted smoke executable does not match the sealed executable hash.' }
} catch {
    if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }
    throw
}

Assert-GeneratedPath -Base $extractRoot -Candidate $smokeUserData
foreach ($generated in @($smokePath, $stdoutPath, $stderrPath)) {
    if (Test-Path -LiteralPath $generated) { Remove-Item -LiteralPath $generated -Recurse -Force }
}
New-Item -ItemType Directory -Path $smokeUserData -Force | Out-Null
$previousSmokeData = $env:COMPANION_SMOKE_USER_DATA
$previousSmokeResult = $env:COMPANION_SMOKE_RESULT
$processExitCode = $null
$env:COMPANION_SMOKE_USER_DATA = $smokeUserData
$env:COMPANION_SMOKE_RESULT = $smokePath
try {
    $process = Start-Process -FilePath $smokeExecutablePath -ArgumentList @('--smoke-test', "--smoke-result=$smokePath") -WorkingDirectory (Split-Path -Parent $smokeExecutablePath) -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    if (-not $process.WaitForExit(25000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw 'The bounded packaged-process smoke timed out.'
    }
    $process.WaitForExit()
    $process.Refresh()
    if (-not [string]::IsNullOrWhiteSpace([string]$process.ExitCode)) { $processExitCode = [int]$process.ExitCode }
    if ($null -ne $processExitCode -and $processExitCode -ne 0) {
        $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -Raw -LiteralPath $stderrPath } else { '' }
        throw "The packaged-process smoke failed with exit code $processExitCode. $stderr"
    }
} finally {
    $env:COMPANION_SMOKE_USER_DATA = $previousSmokeData
    $env:COMPANION_SMOKE_RESULT = $previousSmokeResult
}
if (-not (Test-Path -LiteralPath $smokePath -PathType Leaf)) { throw 'The packaged smoke receipt was not created.' }
$smoke = Get-Content -Raw -LiteralPath $smokePath -Encoding UTF8 | ConvertFrom-Json
if ($smoke.status -ne 'ok' -or -not $smoke.electronProcess -or -not $smoke.windowCreated -or -not $smoke.trayCreated -or -not $smoke.rendererLoaded) { throw 'The real packaged process did not prove its window, tray, and renderer.' }
$emDash = [char]0x2014
$expectedAppName = "Wellbeing Companion ${emDash} Working Title"
if ($smoke.app -ne $expectedAppName -or $smoke.appUserModelId -ne 'com.kiralabs.wellbeing-companion-working-title' -or $smoke.nativeWindowTitle -ne $expectedAppName) { throw 'The packaged process did not prove its distinct application/window identity.' }
$brand = $smoke.brandIconEvidence
if (-not $brand.sourceExists -or [long]$brand.sourceBytes -lt 1000 -or $brand.decodedIconEmpty -or [int]$brand.decodedWidth -lt 32 -or [int]$brand.decodedHeight -lt 32 -or -not $brand.windowIconConfigured -or -not $brand.trayIconConfigured) { throw 'The packaged process did not prove its decoded custom window/tray icon.' }
if (-not $smoke.bundledRuntimeStarted -or -not $smoke.bundledRuntimeEvidence.ok -or $smoke.bundledRuntimeEvidence.status -ne 200 -or -not $smoke.bundledRuntimeEvidence.offlineReady -or $smoke.bundledRuntimeEvidence.externalModelConfigured) { throw 'The bundled offline runtime health evidence is invalid.' }
$runtimeWarmup = $smoke.runtimeWarmupEvidence
if (-not $runtimeWarmup.ok -or $runtimeWarmup.status -ne 200 -or $runtimeWarmup.service -ne 'wellbeing-companion-local' -or -not $runtimeWarmup.exactRendererSession) { throw 'The exact renderer session did not prove its pre-navigation loopback warmup.' }
$initialNavigation = $smoke.initialNavigationEvidence
if ([int]$initialNavigation.attempts -lt 1 -or [int]$initialNavigation.attempts -gt 25 -or [int]$initialNavigation.retries -ne ([int]$initialNavigation.attempts - 1) -or [int]$initialNavigation.retryDelayMs -ne 250 -or $initialNavigation.exhausted) { throw 'The bounded initial-navigation evidence is invalid.' }
if ($smoke.rendererProbe.requireType -ne 'undefined' -or $smoke.rendererProbe.processType -ne 'undefined' -or $smoke.rendererProbe.localStorageRoundTrip -ne 'round-trip-ok' -or -not $smoke.rendererProbe.workingTitlePresent) { throw 'The isolated renderer or local-storage evidence is invalid.' }
$companion3d = $smoke.rendererProbe.companion3d
if (-not $companion3d.canvasPresent -or $companion3d.renderer -ne 'webgl-3d-motion' -or $companion3d.model -ne 'procedural-articulated-3d' -or $companion3d.depthTest -ne 'enabled' -or $companion3d.hierarchy -ne 'head-parented-world-matrices' -or $companion3d.rendererLifecycle -ne 'mount-only-live-motion-ref' -or [int]$companion3d.motionTick -lt 15 -or -not $companion3d.waving -or -not $companion3d.movementObserved) { throw 'The packaged procedural 3D renderer did not prove a live articulated wave.' }
$textRecovery = $smoke.rendererProbe.handsFreeTextRecovery
$expectedTypedReply = "I won't label or diagnose you from a conversation. I can help you describe what you have noticed${emDash}when it started, what makes it better or worse, sleep, energy, and how it affects daily life${emDash}so you have a clearer record for a qualified clinician if you choose to speak with one."
$textRecoveryChecks = [ordered]@{
    bounded = [bool]$textRecovery.bounded
    permissionDecision = [string]$textRecovery.permissionDecision -eq 'denied-by-packaged-smoke-policy'
    denialObserved = [bool]$textRecovery.denialObserved
    statusAfterDenial = [string]$textRecovery.statusAfterDenial -eq 'Microphone permission was not granted. Text conversation remains available.'
    micReturnedOff = [bool]$textRecovery.micReturnedOff
    textareaEnabledAfterDenial = [bool]$textRecovery.textareaEnabledAfterDenial
    sendEnabledAfterDenial = [bool]$textRecovery.sendEnabledAfterDenial
    typedPrompt = [string]$textRecovery.typedPrompt -eq 'Please do not diagnose me.'
    expectedReply = [string]$textRecovery.expectedReply -eq $expectedTypedReply
    userTurnObserved = [bool]$textRecovery.userTurnObserved
    deterministicReplyObserved = [bool]$textRecovery.deterministicReplyObserved
    replyText = [string]$textRecovery.replyText -eq $expectedTypedReply
    modelReceipt = [string]$textRecovery.modelReceipt -match 'Deterministic safety response'
    textareaClearedAfterReply = [bool]$textRecovery.textareaClearedAfterReply
    composerUsableAfterReply = [bool]$textRecovery.composerUsableAfterReply
    completed = [bool]$textRecovery.completed
}
$failedTextRecoveryChecks = @($textRecoveryChecks.GetEnumerator() | Where-Object { -not $_.Value } | ForEach-Object { $_.Key })
if ($failedTextRecoveryChecks.Count -gt 0) {
    throw "The packaged renderer did not prove hands-free denial recovery into a completed deterministic typed reply. Failing fields: $($failedTextRecoveryChecks -join ', ')."
}
if ([bool]$smoke.configuredSecurity.sandbox -ne (-not $affectedWindowsBuild) -or -not $smoke.configuredSecurity.contextIsolation -or $smoke.configuredSecurity.nodeIntegration -or $smoke.configuredSecurity.webviewTag) { throw 'The configured renderer security evidence is invalid.' }
if ([int]$smoke.gpuSandboxCompatibility.windowsBuild -ne $windowsBuild -or
    [bool]$smoke.gpuSandboxCompatibility.affectedWindowsBuild -ne $affectedWindowsBuild -or
    [bool]$smoke.gpuSandboxCompatibility.disableGpuSandbox -ne $affectedWindowsBuild -or
    [bool]$smoke.gpuSandboxCompatibility.disableRendererSandbox -ne $affectedWindowsBuild -or
    [bool]$smoke.gpuSandboxCompatibility.rendererSandboxUnaffected -ne (-not $affectedWindowsBuild) -or
    [bool]$smoke.gpuSandboxCompatibility.forceGpuSandbox -or
    [int]$smoke.gpuSandboxCompatibility.startupSettleMs -ne $(if ($affectedWindowsBuild) { 500 } else { 0 })) {
    throw 'The packaged process did not disclose the exact bounded Windows child-process compatibility state.'
}
if ($affectedWindowsBuild -and [string]::IsNullOrWhiteSpace([string]$smoke.gpuSandboxCompatibility.reason)) {
    throw 'The active Windows child-process compatibility path did not disclose a reason.'
}
if (-not $smoke.permissionBoundary.microphoneRequiresExplicitHandsFreeIpc -or $smoke.permissionBoundary.microphoneApprovedAtStartup -or $smoke.permissionBoundary.microphoneArmedAtStartup -or $smoke.permissionBoundary.microphoneApprovedAfterDeniedInteraction -or $smoke.permissionBoundary.microphoneArmedAfterDeniedInteraction -or [int]$smoke.permissionBoundary.handsFreePermissionRequestsDuringSmoke -ne 1 -or $smoke.permissionBoundary.smokeHandsFreeDecision -ne 'denied' -or $smoke.permissionBoundary.cameraAllowed -or $smoke.permissionBoundary.displayCaptureAllowed -or $smoke.permissionBoundary.devicePermissionsAllowed) { throw 'The packaged permission boundary evidence is invalid.' }
if ($smoke.localModelBoundary.endpoint -ne 'http://127.0.0.1:11434' -or -not $smoke.localModelBoundary.steadyOnly -or $smoke.localModelBoundary.externalNetwork -or $smoke.localModelBoundary.liveProbePerformed -or $smoke.localModelBoundary.defaultModel -ne 'llama3.1:8b') { throw 'The optional local-model boundary evidence is invalid.' }
$localVoiceMethods = @($smoke.localVoiceBoundary.ipcMethods)
if ($localVoiceMethods.Count -ne 3 -or $localVoiceMethods[0] -ne 'status' -or $localVoiceMethods[1] -ne 'speak' -or $localVoiceMethods[2] -ne 'cancel' -or $smoke.localVoiceBoundary.providerConfigured -or $smoke.localVoiceBoundary.providerReady -or $smoke.localVoiceBoundary.playbackVerified -or $smoke.localVoiceBoundary.systemVoiceFallback -or $smoke.localVoiceBoundary.liveProbePerformed) { throw 'The fail-closed local-voice boundary evidence is invalid.' }
if ($smoke.sessionPolicy.mode -ne 'direct' -or -not $smoke.sessionPolicy.externalRendererRequestsBlocked -or $smoke.sessionPolicy.fixedOrigin -ne 'http://127.0.0.1:43724/') { throw 'The fixed local session policy evidence is invalid.' }

$tamperProbePath = Join-Path $setupRoot 'README.txt'
$tamperProbeOriginal = [IO.File]::ReadAllBytes($tamperProbePath)
$tamperRejected = $false
try {
    [IO.File]::AppendAllText($tamperProbePath, "`r`nTAMPER-PROBE")
    try {
        & $supportInstallerPath -VerifyOnly -AcceptVerifiedUnsignedRuntime | Out-Null
    } catch {
        $tamperRejected = $true
    }
} finally {
    [IO.File]::WriteAllBytes($tamperProbePath, $tamperProbeOriginal)
}
if (-not $tamperRejected) { throw 'The verification-only installer accepted a receipt-bound file after tampering.' }

New-Item -ItemType Directory -Path $verificationRoot -Force | Out-Null
$smokeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $smokePath).Hash.ToUpperInvariant()
$verification = [ordered]@{
    schema = 1
    product = 'Wellbeing companion working-title Windows package verification'
    runId = $RunId
    verifiedAtUtc = $verifiedAtUtc
    algorithm = 'SHA-256'
    scope = 'Exact executable, authored resources, setup ZIP/sidecar/receipts, and one bounded actual packaged-process smoke.'
    exclusions = @(
        'This verification receipt excludes itself to avoid self-hash recursion. configuredSecurity records requested settings rather than independently proving Chromium internals.',
        'Windows builds 26200-26399 use a disclosed Electron child-process compatibility boundary: GPU and renderer process sandboxes are disabled while context isolation remains enabled, Node integration and webviews remain disabled, navigation remains fixed to 127.0.0.1, and external renderer requests remain blocked.'
    )
    artifacts = [ordered]@{
        executable = [ordered]@{ path = 'release/win-unpacked/WellbeingCompanionWorkingTitle.exe'; bytes = [long](Get-Item -LiteralPath $executablePath).Length; sha256 = $executableHash; signatureStatus = $signature.Status.ToString() }
        buildReceipt = [ordered]@{ path = 'release/win-unpacked/BUILD-RECEIPT.json'; bytes = [long](Get-Item -LiteralPath $buildReceiptPath).Length; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $buildReceiptPath).Hash.ToUpperInvariant() }
        setupZip = [ordered]@{ path = "release/$([IO.Path]::GetFileName($setupZip))"; bytes = [long](Get-Item -LiteralPath $setupZip).Length; sha256 = $setupHash }
        setupSidecar = [ordered]@{ path = "release/$([IO.Path]::GetFileName($sidecarPath))"; bytes = [long](Get-Item -LiteralPath $sidecarPath).Length; sha256 = $sidecarHash }
        packageReceipt = [ordered]@{ path = "release/$([IO.Path]::GetFileName($packageReceiptPath))"; bytes = [long](Get-Item -LiteralPath $packageReceiptPath).Length; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $packageReceiptPath).Hash.ToUpperInvariant() }
        smokeReceipt = [ordered]@{ path = 'wellbeing-companion-desktop.smoke.json'; bytes = [long](Get-Item -LiteralPath $smokePath).Length; sha256 = $smokeHash }
        setupLauncher = [ordered]@{ path = "setup/SETUP-WELLBEING-COMPANION.exe"; bytes = [long]$launcherItem.Length; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $setupLauncherPath).Hash.ToUpperInvariant(); signatureStatus = (Get-AuthenticodeSignature -LiteralPath $setupLauncherPath).Status.ToString() }
    }
    setupLauncherEvidence = [ordered]@{
        doubleClickExecutablePresent = $true
        powerShellHiddenUnderSupport = $true
        noRootPowerShellScripts = $true
        verifyOnlyPassedWithoutProfileMutation = $true
        receiptBoundTamperRejected = $tamperRejected
        extractionRootCharacters = [int]$extractRoot.Length
    }
    localVoiceProviderAssets = $localVoiceProviderAssets
    smokeEvidence = [ordered]@{
        actualProcessStarted = $true
        executionSource = 'Exact executable extracted from the checksum-verified setup ZIP into a temporary normal-ACL root; the installer was not executed.'
        actualInstallerExecuted = $false
        launcherExitCodeReported = $processExitCode
        successReceiptRequiredWhenLauncherExitCodeUnavailable = $true
        actualWindowCreated = [bool]$smoke.windowCreated
        actualTrayCreated = [bool]$smoke.trayCreated
        actualRendererLoaded = [bool]$smoke.rendererLoaded
        rendererProbe = $smoke.rendererProbe
        bundledRuntimeEvidence = $smoke.bundledRuntimeEvidence
        runtimeWarmupEvidence = $smoke.runtimeWarmupEvidence
        initialNavigationEvidence = $smoke.initialNavigationEvidence
        permissionBoundary = $smoke.permissionBoundary
        localModelBoundary = $smoke.localModelBoundary
        localVoiceBoundary = $smoke.localVoiceBoundary
        sessionPolicy = $smoke.sessionPolicy
        configuredSecurity = $smoke.configuredSecurity
        gpuSandboxCompatibility = $smoke.gpuSandboxCompatibility
    }
}
$verification | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $verificationPath -Encoding utf8
if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }

[pscustomobject]@{
    Executable = $executablePath
    SignatureStatus = $signature.Status
    SetupZip = $setupZip
    SetupZipSha256 = $setupHash
    SmokeStatus = $smoke.status
    WindowCreated = $smoke.windowCreated
    TrayCreated = $smoke.trayCreated
    RendererLoaded = $smoke.rendererLoaded
    OfflineRuntime = $smoke.bundledRuntimeEvidence
    PermissionBoundary = $smoke.permissionBoundary
    SmokeExecutionSource = 'checksum-verified extracted setup payload'
    VerificationReceipt = $verificationPath
    RunId = $RunId
}
