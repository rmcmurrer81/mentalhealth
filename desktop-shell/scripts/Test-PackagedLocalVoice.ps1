[CmdletBinding()]
param(
    [Parameter()]
    [string]$SetupZip = '',

    [Parameter()]
    [string]$ResultPath = ''
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$projectRoot = Split-Path -Parent $PSScriptRoot
$packageVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$releaseRoot = Join-Path $projectRoot 'release'
if ([string]::IsNullOrWhiteSpace($SetupZip)) {
    $SetupZip = Join-Path $releaseRoot "Wellbeing-Companion-Working-Title-Setup-$packageVersion-win32-x64.zip"
}
$setupZipFull = [IO.Path]::GetFullPath($SetupZip)
if (-not (Test-Path -LiteralPath $setupZipFull -PathType Leaf)) { throw "The setup ZIP is missing: $setupZipFull" }
$sidecarPath = "$setupZipFull.sha256.txt"
if (-not (Test-Path -LiteralPath $sidecarPath -PathType Leaf)) { throw "The setup ZIP checksum sidecar is missing: $sidecarPath" }
$setupHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $setupZipFull).Hash.ToUpperInvariant()
$expectedSidecar = "$setupHash  $([IO.Path]::GetFileName($setupZipFull))"
if ((Get-Content -LiteralPath $sidecarPath -Raw -Encoding UTF8).Trim() -ne $expectedSidecar) {
    throw 'The setup ZIP checksum does not match its sidecar.'
}

if ([string]::IsNullOrWhiteSpace($ResultPath)) {
    $ResultPath = Join-Path $projectRoot "verification\PACKAGED-LOCAL-VOICE-PROBE-$packageVersion.json"
}
$resultFull = [IO.Path]::GetFullPath($ResultPath)
if (Test-Path -LiteralPath $resultFull) { throw "The probe result already exists: $resultFull" }

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("wbv-{0}" -f [Guid]::NewGuid().ToString('N').Substring(0, 8))
$runtimeRoot = Join-Path $temporaryRoot 'voice-runtime'
$extractRoot = $temporaryRoot
$temporaryRootFull = [IO.Path]::GetFullPath($temporaryRoot).TrimEnd('\')
if (-not $temporaryRootFull.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The generated voice-probe root escaped the system temporary directory.'
}

$priorElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
try {
    New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
    Expand-Archive -LiteralPath $setupZipFull -DestinationPath $extractRoot -Force
    $setupRoot = Join-Path $extractRoot "Wellbeing-Companion-Working-Title-Setup-$packageVersion"
    $payloadRoot = Join-Path $setupRoot 'Payload'
    $executablePath = Join-Path $payloadRoot 'WellbeingCompanionWorkingTitle.exe'
    $probePath = Join-Path $payloadRoot 'resources\app\desktop\packaged-voice-probe.cjs'
    foreach ($required in @($executablePath, $probePath, (Join-Path $payloadRoot 'BUILD-RECEIPT.json'))) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "The exact package is missing a required voice-probe file: $required" }
    }
    $env:ELECTRON_RUN_AS_NODE = '1'
    $probeStdout = Join-Path $temporaryRoot 'probe.stdout.log'
    $probeStderr = Join-Path $temporaryRoot 'probe.stderr.log'
    $probeProcess = Start-Process -FilePath $executablePath -ArgumentList @(
        $probePath,
        "--result=$resultFull",
        "--runtime-root=$runtimeRoot",
        "--setup-sha256=$setupHash"
    ) -WorkingDirectory $payloadRoot -WindowStyle Hidden -RedirectStandardOutput $probeStdout -RedirectStandardError $probeStderr -Wait -PassThru
    if ($probeProcess.ExitCode -ne 0) {
        $diagnostic = if (Test-Path -LiteralPath $probeStderr -PathType Leaf) {
            (Get-Content -LiteralPath $probeStderr -Raw -Encoding UTF8).Trim()
        } else { 'No bounded probe diagnostic was produced.' }
        if ($diagnostic.Length -gt 600) { $diagnostic = $diagnostic.Substring(0, 600) }
        throw "The exact packaged local-voice probe failed with exit code $($probeProcess.ExitCode): $diagnostic"
    }
    if (-not (Test-Path -LiteralPath $resultFull -PathType Leaf)) { throw 'The exact packaged local-voice probe did not write its receipt.' }
    $receipt = Get-Content -LiteralPath $resultFull -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($receipt.status -ne 'PASS' -or
        $receipt.setupZipSha256 -ne $setupHash -or
        $receipt.packageVersion -ne $packageVersion -or
        $receipt.playback.actualPlaybackEventObserved -ne $true -or
        $receipt.playback.timingBasis -ne 'generated-waveform-amplitude-plus-text-class-heuristic' -or
        $receipt.mute.actualPlaybackEventObservedBeforeMute -ne $true -or
        $receipt.mute.cancelledPhase -ne 'playing' -or
        $receipt.mute.playbackConfirmed -ne $false) {
        throw 'The exact packaged local-voice probe receipt is invalid.'
    }
    Write-Output "PACKAGED_LOCAL_VOICE_PROBE_PASS $resultFull"
} finally {
    if ($null -eq $priorElectronRunAsNode) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
    else { $env:ELECTRON_RUN_AS_NODE = $priorElectronRunAsNode }
    if (Test-Path -LiteralPath $temporaryRootFull) {
        Remove-Item -LiteralPath $temporaryRootFull -Recurse -Force
    }
}
