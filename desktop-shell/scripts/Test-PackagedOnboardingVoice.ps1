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
    $ResultPath = Join-Path $projectRoot "verification\PACKAGED-ONBOARDING-VOICE-PROBE-$packageVersion.json"
}
$resultFull = [IO.Path]::GetFullPath($ResultPath)
if (Test-Path -LiteralPath $resultFull) { throw "The probe result already exists: $resultFull" }

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("wbo-{0}" -f [Guid]::NewGuid().ToString('N').Substring(0, 8))
$temporaryRootFull = [IO.Path]::GetFullPath($temporaryRoot).TrimEnd('\')
if (-not $temporaryRootFull.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The generated onboarding-probe root escaped the system temporary directory.'
}
$priorElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
try {
    New-Item -ItemType Directory -Path $temporaryRootFull -Force | Out-Null
    Expand-Archive -LiteralPath $setupZipFull -DestinationPath $temporaryRootFull -Force
    $setupRoot = Join-Path $temporaryRootFull "Wellbeing-Companion-Working-Title-Setup-$packageVersion"
    $payloadRoot = Join-Path $setupRoot 'Payload'
    $executablePath = Join-Path $payloadRoot 'WellbeingCompanionWorkingTitle.exe'
    foreach ($required in @($executablePath, (Join-Path $payloadRoot 'BUILD-RECEIPT.json'))) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "The exact package is missing a required onboarding-probe file: $required" }
    }
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    $probeResult = Join-Path $temporaryRootFull 'onboarding-result.json'
    $probeStdout = Join-Path $temporaryRootFull 'onboarding.stdout.log'
    $probeStderr = Join-Path $temporaryRootFull 'onboarding.stderr.log'
    $probeProcess = Start-Process -FilePath $executablePath -ArgumentList @(
        "--onboarding-voice-probe-result=$probeResult",
        "--onboarding-voice-probe-setup-sha256=$setupHash"
    ) -WorkingDirectory $payloadRoot -WindowStyle Hidden -RedirectStandardOutput $probeStdout -RedirectStandardError $probeStderr -PassThru
    if (-not $probeProcess.WaitForExit(240000)) {
        Stop-Process -Id $probeProcess.Id -Force -ErrorAction SilentlyContinue
        throw 'The exact packaged first-run voice probe exceeded four minutes.'
    }
    # Complete the parameterless wait after the bounded wait so redirected streams and
    # the native process handle are fully settled before ExitCode is inspected.
    $probeProcess.WaitForExit()
    $probeProcess.Refresh()
    $probeExitCode = $null
    if (-not [string]::IsNullOrWhiteSpace([string]$probeProcess.ExitCode)) {
        $probeExitCode = [int]$probeProcess.ExitCode
    }
    if ($null -ne $probeExitCode -and $probeExitCode -ne 0) {
        if (Test-Path -LiteralPath $probeResult -PathType Leaf) {
            New-Item -ItemType Directory -Path (Split-Path -Parent $resultFull) -Force | Out-Null
            if (-not (Test-Path -LiteralPath $resultFull)) { [IO.File]::Copy($probeResult, $resultFull, $false) }
        }
        $diagnostic = ''
        if (Test-Path -LiteralPath $probeStderr -PathType Leaf) {
            $diagnostic = [string](Get-Content -LiteralPath $probeStderr -Raw -Encoding UTF8)
        }
        if ([string]::IsNullOrWhiteSpace($diagnostic) -and (Test-Path -LiteralPath $probeStdout -PathType Leaf)) {
            $diagnostic = [string](Get-Content -LiteralPath $probeStdout -Raw -Encoding UTF8)
        }
        if ([string]::IsNullOrWhiteSpace($diagnostic)) { $diagnostic = 'No bounded probe diagnostic was produced.' }
        else { $diagnostic = $diagnostic.Trim() }
        if ($diagnostic.Length -gt 900) { $diagnostic = $diagnostic.Substring(0, 900) }
        throw "The exact packaged first-run voice probe failed with exit code $probeExitCode`: $diagnostic"
    }
    if (-not (Test-Path -LiteralPath $probeResult -PathType Leaf)) { throw 'The exact packaged first-run voice probe did not write its receipt.' }
    $receipt = Get-Content -LiteralPath $probeResult -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($receipt.status -ne 'PASS' -or
        $receipt.setupZipSha256 -ne $setupHash -or
        $receipt.packageVersion -ne $packageVersion -or
        $receipt.onboarding.mainReady -ne $true -or
        $receipt.onboarding.fullTurnComplete -ne $true -or
        $receipt.onboarding.fullTurnUnclipped -ne $true -or
        $receipt.onboarding.compactTurnComplete -ne $true -or
        $receipt.onboarding.compactTurnUnclipped -ne $true -or
        $receipt.onboarding.orbObserved -ne $true -or
        $receipt.onboarding.playbackTimedObserved -ne $true -or
        $receipt.onboarding.audioEnergyObserved -ne $true -or
        $receipt.onboarding.speakingObserved -ne $true -or
        $receipt.onboarding.stableCenterObserved -ne $true -or
        $receipt.onboarding.motionTickObserved -ne $true -or
        $receipt.onboarding.oldSpritePathMounted -ne $false -or
        $receipt.onboarding.renderer -ne 'reactive-css-orb-2d' -or
        $receipt.onboarding.presentation -ne 'temporary-orb-not-3d-character' -or
        $receipt.onboarding.imageSwapPath -ne 'none' -or
        $receipt.onboarding.spriteFrameSwap -ne 'false' -or
        $receipt.onboarding.true3dAcceptance -ne 'fail-temporary-orb-no-live-mesh' -or
        $receipt.playback.actualPlaybackEventObserved -ne $true -or
        $receipt.microphoneBoundary.handsFreePermissionRequests -ne 0 -or
        $receipt.microphoneBoundary.approvedForSession -ne $false -or
        $receipt.microphoneBoundary.armedAtCompletion -ne $false -or
        $receipt.truthBoundary.natural3dMotionClaimed -ne $false -or
        $receipt.truthBoundary.presentationType -ne 'honest-temporary-animated-orb' -or
        $receipt.truthBoundary.oldSpritePathMounted -ne $false -or
        $receipt.truthBoundary.true3dAcceptance -ne 'fail-temporary-orb-no-live-mesh') {
        throw 'The exact packaged first-run voice probe receipt is invalid.'
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $resultFull) -Force | Out-Null
    [IO.File]::Copy($probeResult, $resultFull, $false)
    Write-Output "PACKAGED_ONBOARDING_VOICE_PROBE_PASS $resultFull"
} finally {
    if ($null -eq $priorElectronRunAsNode) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
    else { $env:ELECTRON_RUN_AS_NODE = $priorElectronRunAsNode }
    if (Test-Path -LiteralPath $temporaryRootFull) {
        $removed = $false
        foreach ($attempt in 1..12) {
            try {
                Remove-Item -LiteralPath $temporaryRootFull -Recurse -Force -ErrorAction Stop
                $removed = $true
                break
            } catch {
                if ($attempt -lt 12) { Start-Sleep -Milliseconds 250 }
            }
        }
        if (-not $removed -and (Test-Path -LiteralPath $temporaryRootFull)) {
            Write-Warning 'The bounded onboarding-probe process released late; its validated temporary root could not yet be removed.'
        }
    }
}
