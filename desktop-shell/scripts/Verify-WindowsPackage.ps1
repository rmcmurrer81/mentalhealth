[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot 'release'
$packageVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$unpackedRoot = Join-Path $releaseRoot 'win-unpacked'
$executablePath = Join-Path $unpackedRoot 'WellbeingCompanionWorkingTitle.exe'
$buildReceiptPath = Join-Path $unpackedRoot 'BUILD-RECEIPT.json'
$setupZip = Join-Path $releaseRoot "Wellbeing-Companion-Working-Title-Setup-$packageVersion-win32-x64.zip"
$sidecarPath = "$setupZip.sha256.txt"
$packageReceiptPath = "$setupZip.receipt.json"
$smokePath = Join-Path $projectRoot 'wellbeing-companion-desktop.smoke.json'
$verificationRoot = Join-Path $projectRoot 'verification'
$verificationPath = Join-Path $verificationRoot 'DESKTOP-PACKAGE-VERIFICATION.json'
$smokeUserData = Join-Path $releaseRoot 'smoke-isolated-user-data'
$stdoutPath = Join-Path $releaseRoot 'smoke.stdout.log'
$stderrPath = Join-Path $releaseRoot 'smoke.stderr.log'
$extractRoot = Join-Path ([IO.Path]::GetTempPath()) ("wellbeing-verify-{0}" -f [Guid]::NewGuid().ToString('N'))

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

$buildReceipt = Get-Content -Raw -LiteralPath $buildReceiptPath | ConvertFrom-Json
if ($buildReceipt.schema -ne 1 -or $buildReceipt.product -ne 'Wellbeing companion working-title desktop shell') { throw 'The build receipt identity is invalid.' }
$signature = Get-AuthenticodeSignature -LiteralPath $executablePath
$executableHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $executablePath).Hash.ToUpperInvariant()
if ($signature.Status.ToString() -ne [string]$buildReceipt.executableSignatureStatus -or $signature.Status -notin @('Valid', 'NotSigned')) { throw 'Executable signature state does not match its receipt.' }
if ($executableHash -ne ([string]$buildReceipt.executableSha256).ToUpperInvariant()) { throw 'Executable hash does not match its receipt.' }
Assert-FileRecords -Root (Join-Path $unpackedRoot 'resources\app') -Records @($buildReceipt.integrity.files) -ExcludedRelativePaths @()

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
$packageReceipt = Get-Content -Raw -LiteralPath $packageReceiptPath | ConvertFrom-Json
if ($packageReceipt.product -ne 'Wellbeing companion working-title Windows setup archive') { throw 'The external package receipt identity is invalid.' }
$zipRecord = @($packageReceipt.artifacts | Where-Object { $_.path -eq [IO.Path]::GetFileName($setupZip) })
$sidecarRecord = @($packageReceipt.artifacts | Where-Object { $_.path -eq [IO.Path]::GetFileName($sidecarPath) })
if ($zipRecord.Count -ne 1 -or [string]$zipRecord[0].sha256 -ne $setupHash -or [long]$zipRecord[0].bytes -ne [long](Get-Item -LiteralPath $setupZip).Length) { throw 'The external ZIP receipt is invalid.' }
if ($sidecarRecord.Count -ne 1 -or [string]$sidecarRecord[0].sha256 -ne $sidecarHash -or [long]$sidecarRecord[0].bytes -ne [long](Get-Item -LiteralPath $sidecarPath).Length) { throw 'The external sidecar receipt is invalid.' }

Assert-GeneratedPath -Base ([IO.Path]::GetTempPath()) -Candidate $extractRoot
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
try {
    Expand-Archive -LiteralPath $setupZip -DestinationPath $extractRoot -Force
    $setupRoot = Join-Path $extractRoot "Wellbeing-Companion-Working-Title-Setup-$packageVersion"
    $setupReceiptPath = Join-Path $setupRoot 'SETUP-RECEIPT.json'
    if (-not (Test-Path -LiteralPath $setupReceiptPath -PathType Leaf)) { throw 'The embedded setup receipt is missing.' }
    $setupReceipt = Get-Content -Raw -LiteralPath $setupReceiptPath | ConvertFrom-Json
    if ($setupReceipt.product -ne 'Wellbeing companion working-title Windows setup') { throw 'The embedded setup receipt identity is invalid.' }
    Assert-FileRecords -Root $setupRoot -Records @($setupReceipt.files) -ExcludedRelativePaths @('SETUP-RECEIPT.json')
    $embeddedRecord = @($packageReceipt.artifacts | Where-Object { $_.path -eq "Wellbeing-Companion-Working-Title-Setup-$packageVersion/SETUP-RECEIPT.json" })
    $embeddedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $setupReceiptPath).Hash.ToUpperInvariant()
    if ($embeddedRecord.Count -ne 1 -or [string]$embeddedRecord[0].sha256 -ne $embeddedHash -or [long]$embeddedRecord[0].bytes -ne [long](Get-Item -LiteralPath $setupReceiptPath).Length) { throw 'The embedded setup receipt is not bound by the package receipt.' }
} finally {
    if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }
}

Assert-GeneratedPath -Base $releaseRoot -Candidate $smokeUserData
foreach ($generated in @($smokeUserData, $smokePath, $stdoutPath, $stderrPath)) {
    if (Test-Path -LiteralPath $generated) { Remove-Item -LiteralPath $generated -Recurse -Force }
}
New-Item -ItemType Directory -Path $smokeUserData -Force | Out-Null
$previousSmokeData = $env:COMPANION_SMOKE_USER_DATA
$previousSmokeResult = $env:COMPANION_SMOKE_RESULT
$processExitCode = $null
$env:COMPANION_SMOKE_USER_DATA = $smokeUserData
$env:COMPANION_SMOKE_RESULT = $smokePath
try {
    $process = Start-Process -FilePath $executablePath -ArgumentList @('--smoke-test', "--smoke-result=$smokePath") -WorkingDirectory (Split-Path -Parent $executablePath) -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
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
$smoke = Get-Content -Raw -LiteralPath $smokePath | ConvertFrom-Json
if ($smoke.status -ne 'ok' -or -not $smoke.electronProcess -or -not $smoke.windowCreated -or -not $smoke.trayCreated -or -not $smoke.rendererLoaded) { throw 'The real packaged process did not prove its window, tray, and renderer.' }
if (-not $smoke.bundledRuntimeStarted -or -not $smoke.bundledRuntimeEvidence.ok -or $smoke.bundledRuntimeEvidence.status -ne 200 -or -not $smoke.bundledRuntimeEvidence.offlineReady -or $smoke.bundledRuntimeEvidence.externalModelConfigured) { throw 'The bundled offline runtime health evidence is invalid.' }
if ($smoke.rendererProbe.requireType -ne 'undefined' -or $smoke.rendererProbe.processType -ne 'undefined' -or $smoke.rendererProbe.localStorageRoundTrip -ne 'round-trip-ok' -or -not $smoke.rendererProbe.workingTitlePresent) { throw 'The isolated renderer or local-storage evidence is invalid.' }
if (-not $smoke.configuredSecurity.sandbox -or -not $smoke.configuredSecurity.contextIsolation -or $smoke.configuredSecurity.nodeIntegration -or $smoke.configuredSecurity.webviewTag) { throw 'The configured renderer security evidence is invalid.' }
if (-not $smoke.permissionBoundary.microphoneRequiresExplicitHandsFreeIpc -or $smoke.permissionBoundary.microphoneApprovedAtStartup -or $smoke.permissionBoundary.microphoneArmedAtStartup -or $smoke.permissionBoundary.cameraAllowed -or $smoke.permissionBoundary.displayCaptureAllowed -or $smoke.permissionBoundary.devicePermissionsAllowed) { throw 'The packaged permission boundary evidence is invalid.' }
if ($smoke.localModelBoundary.endpoint -ne 'http://127.0.0.1:11434' -or -not $smoke.localModelBoundary.steadyOnly -or $smoke.localModelBoundary.externalNetwork -or $smoke.localModelBoundary.liveProbePerformed -or $smoke.localModelBoundary.defaultModel -ne 'llama3.1:8b') { throw 'The optional local-model boundary evidence is invalid.' }
$localVoiceMethods = @($smoke.localVoiceBoundary.ipcMethods)
if ($localVoiceMethods.Count -ne 3 -or $localVoiceMethods[0] -ne 'status' -or $localVoiceMethods[1] -ne 'speak' -or $localVoiceMethods[2] -ne 'cancel' -or $smoke.localVoiceBoundary.providerConfigured -or $smoke.localVoiceBoundary.providerReady -or $smoke.localVoiceBoundary.playbackVerified -or $smoke.localVoiceBoundary.systemVoiceFallback -or $smoke.localVoiceBoundary.liveProbePerformed) { throw 'The fail-closed local-voice boundary evidence is invalid.' }
if ($smoke.sessionPolicy.mode -ne 'direct' -or -not $smoke.sessionPolicy.externalRendererRequestsBlocked -or $smoke.sessionPolicy.fixedOrigin -ne 'http://127.0.0.1:43724/') { throw 'The fixed local session policy evidence is invalid.' }

New-Item -ItemType Directory -Path $verificationRoot -Force | Out-Null
$smokeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $smokePath).Hash.ToUpperInvariant()
$verification = [ordered]@{
    schema = 1
    product = 'Wellbeing companion working-title Windows package verification'
    algorithm = 'SHA-256'
    scope = 'Exact executable, authored resources, setup ZIP/sidecar/receipts, and one bounded actual packaged-process smoke.'
    exclusions = @('This verification receipt excludes itself to avoid self-hash recursion. configuredSecurity records requested settings rather than independently proving Chromium internals.')
    artifacts = [ordered]@{
        executable = [ordered]@{ path = 'release/win-unpacked/WellbeingCompanionWorkingTitle.exe'; bytes = [long](Get-Item -LiteralPath $executablePath).Length; sha256 = $executableHash; signatureStatus = $signature.Status.ToString() }
        buildReceipt = [ordered]@{ path = 'release/win-unpacked/BUILD-RECEIPT.json'; bytes = [long](Get-Item -LiteralPath $buildReceiptPath).Length; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $buildReceiptPath).Hash.ToUpperInvariant() }
        setupZip = [ordered]@{ path = "release/$([IO.Path]::GetFileName($setupZip))"; bytes = [long](Get-Item -LiteralPath $setupZip).Length; sha256 = $setupHash }
        setupSidecar = [ordered]@{ path = "release/$([IO.Path]::GetFileName($sidecarPath))"; bytes = [long](Get-Item -LiteralPath $sidecarPath).Length; sha256 = $sidecarHash }
        packageReceipt = [ordered]@{ path = "release/$([IO.Path]::GetFileName($packageReceiptPath))"; bytes = [long](Get-Item -LiteralPath $packageReceiptPath).Length; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $packageReceiptPath).Hash.ToUpperInvariant() }
        smokeReceipt = [ordered]@{ path = 'wellbeing-companion-desktop.smoke.json'; bytes = [long](Get-Item -LiteralPath $smokePath).Length; sha256 = $smokeHash }
    }
    smokeEvidence = [ordered]@{
        actualProcessStarted = $true
        launcherExitCodeReported = $processExitCode
        successReceiptRequiredWhenLauncherExitCodeUnavailable = $true
        actualWindowCreated = [bool]$smoke.windowCreated
        actualTrayCreated = [bool]$smoke.trayCreated
        actualRendererLoaded = [bool]$smoke.rendererLoaded
        rendererProbe = $smoke.rendererProbe
        bundledRuntimeEvidence = $smoke.bundledRuntimeEvidence
        permissionBoundary = $smoke.permissionBoundary
        localModelBoundary = $smoke.localModelBoundary
        localVoiceBoundary = $smoke.localVoiceBoundary
        sessionPolicy = $smoke.sessionPolicy
        configuredSecurity = $smoke.configuredSecurity
        gpuSandboxCompatibility = $smoke.gpuSandboxCompatibility
    }
}
$verification | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $verificationPath -Encoding utf8

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
    VerificationReceipt = $verificationPath
}
