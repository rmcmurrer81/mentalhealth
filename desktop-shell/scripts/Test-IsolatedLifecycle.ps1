[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot 'release'
$verificationRoot = Join-Path $projectRoot 'verification'
$packageVersion = (Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') -Encoding UTF8 | ConvertFrom-Json).version
$setupZip = Join-Path $releaseRoot "Wellbeing-Companion-Working-Title-Setup-$packageVersion-win32-x64.zip"
$setupSidecar = "$setupZip.sha256.txt"
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("wellbeing-lifecycle-{0}" -f [Guid]::NewGuid().ToString('N'))
$productId = 'com.kiralabs.wellbeing-companion-working-title'

function Assert-UnderTestRoot {
    param([Parameter(Mandatory)] [string]$Path)
    $rootFull = [IO.Path]::GetFullPath($testRoot).TrimEnd('\')
    $candidateFull = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if (-not $candidateFull.StartsWith("$rootFull\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "The isolated lifecycle harness refused a path outside its test root: $candidateFull"
    }
}

function Write-OwnerMarker {
    param([Parameter(Mandatory)] [string]$Path)
    Assert-UnderTestRoot -Path $Path
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    [ordered]@{ schema = 1; productId = $productId; root = [IO.Path]::GetFullPath($Path).TrimEnd('\') } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Path '.wellbeing-companion-owner.json') -Encoding utf8
}

function Assert-OwnedDirectory {
    param([Parameter(Mandatory)] [string]$Path)
    Assert-UnderTestRoot -Path $Path
    $markerPath = Join-Path $Path '.wellbeing-companion-owner.json'
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { throw "Missing isolated owner marker: $Path" }
    $marker = Get-Content -Raw -LiteralPath $markerPath -Encoding UTF8 | ConvertFrom-Json
    if ($marker.schema -ne 1 -or $marker.productId -ne $productId -or -not ([IO.Path]::GetFullPath([string]$marker.root).TrimEnd('\')).Equals([IO.Path]::GetFullPath($Path).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Invalid isolated owner marker: $Path"
    }
}

function Remove-OwnedDirectory {
    param([Parameter(Mandatory)] [string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Assert-OwnedDirectory -Path $Path
    Remove-Item -LiteralPath $Path -Recurse -Force
}

foreach ($requiredArtifact in @($setupZip, $setupSidecar)) {
    if (-not (Test-Path -LiteralPath $requiredArtifact -PathType Leaf)) {
        throw "Build and seal the setup ZIP before running the isolated lifecycle harness: $requiredArtifact"
    }
}
$setupArchiveItem = Get-Item -LiteralPath $setupZip
$setupArchiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $setupZip).Hash.ToUpperInvariant()
$expectedSidecar = "$setupArchiveHash  $([IO.Path]::GetFileName($setupZip))"
$actualSidecar = (Get-Content -Raw -LiteralPath $setupSidecar).Trim()
if ($actualSidecar -ne $expectedSidecar) { throw 'The isolated lifecycle harness rejected the setup archive sidecar.' }
$setupSidecarItem = Get-Item -LiteralPath $setupSidecar
$setupSidecarHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $setupSidecar).Hash.ToUpperInvariant()
Assert-UnderTestRoot -Path (Join-Path $testRoot 'sentinel')
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null

$result = [ordered]@{
    schema = 2
    product = 'Wellbeing companion working-title isolated lifecycle verification'
    realUserProfileMutated = $false
    actualInstallerExecuted = $false
    setupArchiveHashVerified = $false
    setupArchive = [ordered]@{
        path = [IO.Path]::GetFileName($setupZip)
        bytes = [long]$setupArchiveItem.Length
        sha256 = $setupArchiveHash
        sidecarPath = [IO.Path]::GetFileName($setupSidecar)
        sidecarBytes = [long]$setupSidecarItem.Length
        sidecarSha256 = $setupSidecarHash
    }
    embeddedSetupReceipt = $null
    actualPayloadUsed = $false
    desktopAndStartMenuShortcutShapeExercised = $false
    installedAppsEntryShapeExercised = $false
    preserveDataUninstallPassed = $false
    reinstallRecoveredDataPassed = $false
    explicitRemoveAllPassed = $false
    boundary = 'A temp-root filesystem lifecycle harness using the exact sealed payload. It does not replace a disposable Windows-user or VM run of the real installer and HKCU Installed Apps entry.'
}

try {
    $extractRoot = Join-Path $testRoot 'extracted'
    Expand-Archive -LiteralPath $setupZip -DestinationPath $extractRoot -Force
    $setupRoot = Join-Path $extractRoot "Wellbeing-Companion-Working-Title-Setup-$packageVersion"
    $payloadRoot = Join-Path $setupRoot 'Payload'
    $receiptPath = Join-Path $setupRoot 'SETUP-RECEIPT.json'
    if (-not (Test-Path -LiteralPath (Join-Path $payloadRoot 'WellbeingCompanionWorkingTitle.exe') -PathType Leaf)) { throw 'The sealed lifecycle payload is incomplete.' }
    if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) { throw 'The sealed lifecycle setup receipt is missing.' }
    $receiptItem = Get-Item -LiteralPath $receiptPath
    $result.embeddedSetupReceipt = [ordered]@{
        path = "Wellbeing-Companion-Working-Title-Setup-$packageVersion/SETUP-RECEIPT.json"
        bytes = [long]$receiptItem.Length
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $receiptPath).Hash.ToUpperInvariant()
    }
    $receipt = Get-Content -Raw -LiteralPath $receiptPath -Encoding UTF8 | ConvertFrom-Json
    foreach ($record in @($receipt.files)) {
        $fullPath = [IO.Path]::GetFullPath((Join-Path $setupRoot ([string]$record.path).Replace('/', '\')))
        Assert-UnderTestRoot -Path $fullPath
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "Lifecycle receipt file missing: $($record.path)" }
        if ([long]$record.bytes -ne [long](Get-Item -LiteralPath $fullPath).Length -or (Get-FileHash -Algorithm SHA256 -LiteralPath $fullPath).Hash.ToUpperInvariant() -ne ([string]$record.sha256).ToUpperInvariant()) {
            throw "Lifecycle receipt mismatch: $($record.path)"
        }
    }
    $result.setupArchiveHashVerified = $true
    $result.actualPayloadUsed = $true

    $profileRoot = Join-Path $testRoot 'profile'
    $installFolder = Join-Path $profileRoot 'LocalAppData\Programs\WellbeingCompanionWorkingTitle'
    $localDataRoot = Join-Path $profileRoot 'LocalAppData\WellbeingCompanionWorkingTitle'
    $roamingDataRoot = Join-Path $profileRoot 'RoamingAppData\WellbeingCompanionWorkingTitle'
    $desktopRoot = Join-Path $profileRoot 'Desktop'
    $startMenuRoot = Join-Path $profileRoot 'StartMenu\Wellbeing Companion (Working Title)'
    $registryReceipt = Join-Path $profileRoot 'InstalledApps\WellbeingCompanionWorkingTitle.json'
    foreach ($path in @($installFolder, $localDataRoot, $roamingDataRoot, $desktopRoot, $startMenuRoot, (Split-Path -Parent $registryReceipt))) { Assert-UnderTestRoot -Path $path }

    function Install-IsolatedPayload {
        Copy-Item -LiteralPath $payloadRoot -Destination $installFolder -Recurse
        Write-OwnerMarker -Path $installFolder
        Write-OwnerMarker -Path $localDataRoot
        Write-OwnerMarker -Path $roamingDataRoot
        Write-OwnerMarker -Path $startMenuRoot
        New-Item -ItemType Directory -Path $desktopRoot -Force | Out-Null
        New-Item -ItemType Directory -Path (Split-Path -Parent $registryReceipt) -Force | Out-Null
        $shell = New-Object -ComObject WScript.Shell
        foreach ($shortcutPath in @((Join-Path $desktopRoot 'Wellbeing Companion (Working Title).lnk'), (Join-Path $startMenuRoot 'Wellbeing Companion (Working Title).lnk'))) {
            $shortcut = $shell.CreateShortcut($shortcutPath)
            $shortcut.TargetPath = Join-Path $installFolder 'WellbeingCompanionWorkingTitle.exe'
            $shortcut.WorkingDirectory = $installFolder
            $shortcut.IconLocation = "$(Join-Path $installFolder 'resources\app\desktop\assets\WellbeingCompanionWorkingTitle.ico'),0"
            $shortcut.Save()
        }
        [ordered]@{ productId = $productId; installLocation = $installFolder; preserveDataDefault = $true } |
            ConvertTo-Json | Set-Content -LiteralPath $registryReceipt -Encoding utf8
    }

    function Remove-IsolatedProgram {
        param([switch]$RemoveAllData)
        foreach ($owned in @($installFolder, $startMenuRoot)) { Assert-OwnedDirectory -Path $owned }
        if ($RemoveAllData) { foreach ($owned in @($localDataRoot, $roamingDataRoot)) { Assert-OwnedDirectory -Path $owned } }
        foreach ($shortcutPath in @((Join-Path $desktopRoot 'Wellbeing Companion (Working Title).lnk'), (Join-Path $startMenuRoot 'Wellbeing Companion (Working Title).lnk'))) {
            if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath -Force }
        }
        Remove-OwnedDirectory -Path $startMenuRoot
        Remove-OwnedDirectory -Path $installFolder
        if ($RemoveAllData) {
            Remove-OwnedDirectory -Path $localDataRoot
            Remove-OwnedDirectory -Path $roamingDataRoot
        }
        if (Test-Path -LiteralPath $registryReceipt) { Remove-Item -LiteralPath $registryReceipt -Force }
    }

    Install-IsolatedPayload
    $result.desktopAndStartMenuShortcutShapeExercised = (Test-Path -LiteralPath (Join-Path $desktopRoot 'Wellbeing Companion (Working Title).lnk')) -and (Test-Path -LiteralPath (Join-Path $startMenuRoot 'Wellbeing Companion (Working Title).lnk'))
    $result.installedAppsEntryShapeExercised = Test-Path -LiteralPath $registryReceipt
    'local-memory-sentinel' | Set-Content -LiteralPath (Join-Path $localDataRoot 'memory.sentinel') -Encoding utf8
    'roaming-vault-sentinel' | Set-Content -LiteralPath (Join-Path $roamingDataRoot 'vault.sentinel') -Encoding utf8
    Remove-IsolatedProgram
    $result.preserveDataUninstallPassed = -not (Test-Path -LiteralPath $installFolder) -and (Test-Path -LiteralPath (Join-Path $localDataRoot 'memory.sentinel')) -and (Test-Path -LiteralPath (Join-Path $roamingDataRoot 'vault.sentinel'))
    if (-not $result.preserveDataUninstallPassed) { throw 'Preservation-first isolated uninstall failed.' }

    Install-IsolatedPayload
    $result.reinstallRecoveredDataPassed = (Get-Content -Raw -LiteralPath (Join-Path $localDataRoot 'memory.sentinel')).Trim() -eq 'local-memory-sentinel' -and (Get-Content -Raw -LiteralPath (Join-Path $roamingDataRoot 'vault.sentinel')).Trim() -eq 'roaming-vault-sentinel'
    if (-not $result.reinstallRecoveredDataPassed) { throw 'Isolated reinstall did not preserve prior data.' }
    Remove-IsolatedProgram -RemoveAllData
    $result.explicitRemoveAllPassed = -not (Test-Path -LiteralPath $installFolder) -and -not (Test-Path -LiteralPath $localDataRoot) -and -not (Test-Path -LiteralPath $roamingDataRoot) -and -not (Test-Path -LiteralPath $registryReceipt)
    if (-not $result.explicitRemoveAllPassed) { throw 'Explicit isolated remove-all failed.' }
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        Assert-UnderTestRoot -Path (Join-Path $testRoot 'cleanup-sentinel')
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}

New-Item -ItemType Directory -Path $verificationRoot -Force | Out-Null
$receiptPath = Join-Path $verificationRoot 'ISOLATED-LIFECYCLE-VERIFICATION.json'
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptPath -Encoding utf8
$result
