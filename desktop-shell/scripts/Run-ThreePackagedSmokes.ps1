[CmdletBinding()]
param(
    [ValidateRange(3, 20)]
    [int]$RunCount = 3,

    [string]$ExtractionBaseRoot = ''
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot 'release'
$verificationRoot = Join-Path $projectRoot 'verification'
$historyRoot = Join-Path $verificationRoot 'packaged-smoke-runs'
$verifyScript = Join-Path $PSScriptRoot 'Verify-WindowsPackage.ps1'
$packageVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$setupZip = Join-Path $releaseRoot "Wellbeing-Companion-Working-Title-Setup-$packageVersion-win32-x64.zip"
$currentSmoke = Join-Path $projectRoot 'wellbeing-companion-desktop.smoke.json'
$currentVerification = Join-Path $verificationRoot 'DESKTOP-PACKAGE-VERIFICATION.json'
$currentStdout = Join-Path $releaseRoot 'smoke.stdout.log'
$currentStderr = Join-Path $releaseRoot 'smoke.stderr.log'
$runSetId = "{0}-{1}" -f (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ'), [Guid]::NewGuid().ToString('N').Substring(0, 8)
$runSetRoot = Join-Path $historyRoot $runSetId
$summaryFileName = if ($RunCount -eq 3) { 'THREE-RUN-SUMMARY.json' } else { 'REPEATED-RUN-SUMMARY.json' }
$summaryPath = Join-Path $runSetRoot $summaryFileName

function Assert-GeneratedPath {
    param([Parameter(Mandatory)] [string]$Base, [Parameter(Mandatory)] [string]$Candidate)
    $baseFull = [IO.Path]::GetFullPath($Base).TrimEnd('\')
    $candidateFull = [IO.Path]::GetFullPath($Candidate).TrimEnd('\')
    if (-not $candidateFull.StartsWith("$baseFull\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing an evidence path outside its expected root: $candidateFull"
    }
}

function Get-BoundedRelativePath {
    param([Parameter(Mandatory)] [string]$Base, [Parameter(Mandatory)] [string]$Candidate)
    $baseFull = [IO.Path]::GetFullPath($Base).TrimEnd('\')
    $candidateFull = [IO.Path]::GetFullPath($Candidate)
    if (-not $candidateFull.StartsWith("$baseFull\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to relativize an evidence path outside its expected root: $candidateFull"
    }
    return $candidateFull.Substring($baseFull.Length + 1)
}

function Test-IsFullyQualifiedLocalPath {
    param([AllowNull()] [object]$Value)
    if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace($Value)) { return $false }
    return $Value -match '(?i)^(?:[A-Z]:[\\/]|\\\\[^\\/\s]+[\\/][^\\/\s]+[\\/]?|file:\/\/[A-Z]:\/|file:\/\/\/[A-Z]:\/)'
}

function Get-ArtifactRecord {
    param([Parameter(Mandatory)] [string]$Path, [Parameter(Mandatory)] [string]$RelativePath)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing run artifact: $Path" }
    return [ordered]@{
        path = $RelativePath.Replace('\', '/')
        bytes = [long](Get-Item -LiteralPath $Path).Length
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant()
    }
}

function ConvertTo-ShareSafeValue {
    param([AllowNull()] [object]$Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [string] -or $Value -is [ValueType]) { return $Value }
    if ($Value -is [Collections.IDictionary]) {
        $copy = [ordered]@{}
        foreach ($key in $Value.Keys) {
            if ([string]$key -ieq 'isolatedUserData') { continue }
            $copy[[string]$key] = ConvertTo-ShareSafeValue -Value $Value[$key]
        }
        return $copy
    }
    if ($Value -is [pscustomobject]) {
        $copy = [ordered]@{}
        foreach ($property in $Value.PSObject.Properties) {
            if ($property.Name -ieq 'isolatedUserData') { continue }
            $copy[$property.Name] = ConvertTo-ShareSafeValue -Value $property.Value
        }
        return $copy
    }
    if ($Value -is [Collections.IEnumerable]) {
        return @($Value | ForEach-Object { ConvertTo-ShareSafeValue -Value $_ })
    }
    return $Value
}

function Assert-NoAbsoluteLocalPath {
    param([AllowNull()] [object]$Value, [string]$Trail = '$')
    if ($null -eq $Value -or $Value -is [ValueType]) { return }
    if ($Value -is [string]) {
        if ((Test-IsFullyQualifiedLocalPath -Value $Value) -or $Value -match '(?i)(?:^|[\s"(])(?:[A-Z]:[\\/]|\\\\[^\\/\s]+[\\/][^\\/\s]+|file:///[A-Z]:/)') {
            throw "Share-safe evidence contains an absolute local path at $Trail"
        }
        return
    }
    if ($Value -is [Collections.IDictionary]) {
        foreach ($key in $Value.Keys) { Assert-NoAbsoluteLocalPath -Value $Value[$key] -Trail "$Trail.$key" }
        return
    }
    if ($Value -is [pscustomobject]) {
        foreach ($property in $Value.PSObject.Properties) { Assert-NoAbsoluteLocalPath -Value $property.Value -Trail "$Trail.$($property.Name)" }
        return
    }
    if ($Value -is [Collections.IEnumerable]) {
        $index = 0
        foreach ($item in $Value) {
            Assert-NoAbsoluteLocalPath -Value $item -Trail "$Trail[$index]"
            $index++
        }
    }
}

if (-not (Test-Path -LiteralPath $verifyScript -PathType Leaf)) { throw "Verifier missing: $verifyScript" }
if (-not (Test-Path -LiteralPath $setupZip -PathType Leaf)) { throw "Setup archive missing: $setupZip" }
Assert-GeneratedPath -Base $verificationRoot -Candidate $runSetRoot
New-Item -ItemType Directory -Path $runSetRoot -Force | Out-Null

# The verifier intentionally replaces its current evidence paths. Preserve any
# preexisting files first, but label them local-only and never count them among
# the newly executed runs.
$preexistingRoot = Join-Path $runSetRoot 'preexisting-current-evidence-local-only'
$preexistingRecords = @()
$preexistingCandidates = @(
    [pscustomobject]@{ Source = $currentSmoke; Name = 'PACKAGED-SMOKE.raw.local.json' },
    [pscustomobject]@{ Source = $currentVerification; Name = 'PACKAGE-VERIFICATION.json' },
    [pscustomobject]@{ Source = $currentStdout; Name = 'smoke.stdout.log' },
    [pscustomobject]@{ Source = $currentStderr; Name = 'smoke.stderr.log' }
)
foreach ($candidate in $preexistingCandidates) {
    if (-not (Test-Path -LiteralPath $candidate.Source -PathType Leaf)) { continue }
    if (-not (Test-Path -LiteralPath $preexistingRoot -PathType Container)) {
        Assert-GeneratedPath -Base $runSetRoot -Candidate $preexistingRoot
        New-Item -ItemType Directory -Path $preexistingRoot | Out-Null
    }
    $destination = Join-Path $preexistingRoot $candidate.Name
    Copy-Item -LiteralPath $candidate.Source -Destination $destination
    $relative = Get-BoundedRelativePath -Base $verificationRoot -Candidate $destination
    $preexistingRecords += Get-ArtifactRecord -Path $destination -RelativePath $relative
}
$preexistingManifest = [ordered]@{
    schema = 1
    localOnly = $true
    countedAsNewRun = $false
    capturedBeforeFirstNewRun = $true
    artifacts = $preexistingRecords
}
Assert-NoAbsoluteLocalPath -Value $preexistingManifest
$preexistingManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runSetRoot 'PREEXISTING-EVIDENCE-MANIFEST.json') -Encoding utf8

$setupHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $setupZip).Hash.ToUpperInvariant()
$runRecords = @()
$failure = $null

try {
    for ($runNumber = 1; $runNumber -le $RunCount; $runNumber++) {
        $runId = "$runSetId-run-{0:d2}" -f $runNumber
        $runDirectory = Join-Path $runSetRoot ("run-{0:d2}" -f $runNumber)
        Assert-GeneratedPath -Base $runSetRoot -Candidate $runDirectory
        New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
        $startedAtUtc = (Get-Date).ToUniversalTime().ToString('o')

        if ([string]::IsNullOrWhiteSpace($ExtractionBaseRoot)) {
            & $verifyScript -RunId $runId | Out-Null
        } else {
            & $verifyScript -RunId $runId -ExtractionBaseRoot $ExtractionBaseRoot | Out-Null
        }

        foreach ($required in @($currentSmoke, $currentVerification, $currentStdout, $currentStderr)) {
            if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Verifier did not create required evidence: $required" }
        }

        $verification = Get-Content -LiteralPath $currentVerification -Raw -Encoding UTF8 | ConvertFrom-Json
        $smoke = Get-Content -LiteralPath $currentSmoke -Raw -Encoding UTF8 | ConvertFrom-Json
        if ([string]$verification.runId -ne $runId) { throw "Verification run ID mismatch for $runId" }
        if ([string]$verification.artifacts.setupZip.sha256 -ne $setupHash) { throw "Package hash changed during $runId" }
        if ([string]$smoke.status -ne 'ok') { throw "Smoke receipt was not successful for $runId" }

        $rawSmokeCopy = Join-Path $runDirectory 'PACKAGED-SMOKE.raw.local.json'
        $verificationCopy = Join-Path $runDirectory 'PACKAGE-VERIFICATION.json'
        $stdoutCopy = Join-Path $runDirectory 'smoke.stdout.log'
        $stderrCopy = Join-Path $runDirectory 'smoke.stderr.log'
        Copy-Item -LiteralPath $currentSmoke -Destination $rawSmokeCopy
        Copy-Item -LiteralPath $currentVerification -Destination $verificationCopy
        Copy-Item -LiteralPath $currentStdout -Destination $stdoutCopy
        Copy-Item -LiteralPath $currentStderr -Destination $stderrCopy

        # Keep the exact raw receipt locally for audit, but also create a share-safe
        # copy that cannot disclose the Windows account or temporary clean-room path.
        $shareSafeSmoke = ConvertTo-ShareSafeValue -Value $smoke
        Assert-NoAbsoluteLocalPath -Value $shareSafeSmoke
        $sanitizedSmokeCopy = Join-Path $runDirectory 'PACKAGED-SMOKE.sanitized.json'
        $shareSafeSmoke | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $sanitizedSmokeCopy -Encoding utf8

        $relativeRun = Get-BoundedRelativePath -Base $verificationRoot -Candidate $runDirectory
        $record = [ordered]@{
            runNumber = $runNumber
            runId = $runId
            startedAtUtc = $startedAtUtc
            completedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
            status = 'PASS'
            packageSha256 = $setupHash
            evidence = [ordered]@{
                rawSmokeLocal = Get-ArtifactRecord -Path $rawSmokeCopy -RelativePath (Join-Path $relativeRun 'PACKAGED-SMOKE.raw.local.json')
                sanitizedSmoke = Get-ArtifactRecord -Path $sanitizedSmokeCopy -RelativePath (Join-Path $relativeRun 'PACKAGED-SMOKE.sanitized.json')
                verification = Get-ArtifactRecord -Path $verificationCopy -RelativePath (Join-Path $relativeRun 'PACKAGE-VERIFICATION.json')
                stdout = Get-ArtifactRecord -Path $stdoutCopy -RelativePath (Join-Path $relativeRun 'smoke.stdout.log')
                stderr = Get-ArtifactRecord -Path $stderrCopy -RelativePath (Join-Path $relativeRun 'smoke.stderr.log')
            }
        }
        $recordPath = Join-Path $runDirectory 'RUN-RECEIPT.json'
        Assert-NoAbsoluteLocalPath -Value $record
        $record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $recordPath -Encoding utf8
        $runRecords += $record
    }
} catch {
    $failure = $_.Exception.Message
}

$distinctRunIds = @($runRecords.runId | Sort-Object -Unique)
$passed = $null -eq $failure -and $runRecords.Count -eq $RunCount -and $distinctRunIds.Count -eq $RunCount
$failureLocalRecord = $null
if ($null -ne $failure) {
    $failureLocalPath = Join-Path $runSetRoot 'FAILURE.raw.local.txt'
    Set-Content -LiteralPath $failureLocalPath -Value $failure -Encoding utf8
    $failureLocalRecord = Get-ArtifactRecord -Path $failureLocalPath -RelativePath (Get-BoundedRelativePath -Base $verificationRoot -Candidate $failureLocalPath)
}
$summary = [ordered]@{
    schema = 1
    product = 'Wellbeing companion repeated packaged-smoke evidence set'
    runSetId = $runSetId
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    status = if ($passed) { 'PASS' } else { 'INCOMPLETE' }
    requiredRuns = $RunCount
    retainedPassingRuns = $runRecords.Count
    distinctRunIds = $distinctRunIds.Count
    package = [ordered]@{
        path = "release/$([IO.Path]::GetFileName($setupZip))"
        bytes = [long](Get-Item -LiteralPath $setupZip).Length
        sha256 = $setupHash
    }
    privacy = [ordered]@{
        rawReceiptsAreLocalOnly = $true
        sanitizedReceiptsRemoveIsolatedUserDataAtEveryDepth = $true
        sanitizedReceiptsRejectAbsoluteLocalPaths = $true
        summaryRejectsAbsoluteLocalPaths = $true
        publishRawReceipts = $false
    }
    extractionBoundary = [ordered]@{
        customBaseUsed = -not [string]::IsNullOrWhiteSpace($ExtractionBaseRoot)
        baseCharacterCount = if ([string]::IsNullOrWhiteSpace($ExtractionBaseRoot)) { $null } else { [IO.Path]::GetFullPath($ExtractionBaseRoot).TrimEnd('\').Length }
        absoluteBaseExcludedFromShareSafeSummary = $true
    }
    preexistingEvidence = [ordered]@{
        localOnly = $true
        countedAsNewRun = $false
        artifacts = $preexistingRecords
    }
    failure = if ($null -eq $failure) { $null } else { 'RUN_FAILED_SEE_LOCAL_ONLY_FAILURE_EVIDENCE' }
    failureLocalEvidence = $failureLocalRecord
    runs = $runRecords
}
Assert-NoAbsoluteLocalPath -Value $summary
$summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $summaryPath -Encoding utf8

if (-not $passed) { throw "$RunCount-run packaged smoke did not complete. Evidence retained at $runSetRoot. $failure" }

[pscustomobject]@{
    Status = 'PASS'
    RunSetId = $runSetId
    SetupZipSha256 = $setupHash
    RetainedPassingRuns = $runRecords.Count
    SummaryReceipt = $summaryPath
}
