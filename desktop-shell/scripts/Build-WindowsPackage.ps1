[CmdletBinding()]
param(
    [Parameter()]
    [ValidateSet('43.4.1')]
    [string]$ElectronVersion = '43.4.1',

    [Parameter()]
    [string]$PublisherSignedExecutable,

    [Parameter()]
    [AllowEmptyString()]
    [ValidatePattern('^$|^[A-Fa-f0-9]{64}$')]
    [string]$PublisherSignedExecutableSha256 = '',

    [Parameter()]
    [AllowEmptyString()]
    [ValidatePattern('^$|^[A-Fa-f0-9]{40}$')]
    [string]$PublisherSignerThumbprint = ''
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Split-Path -Parent $projectRoot
$packageVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$releaseRoot = Join-Path $projectRoot 'release'
$cacheRoot = Join-Path $releaseRoot 'cache'
$finalRoot = Join-Path $releaseRoot 'win-unpacked'
$stagingRoot = Join-Path $releaseRoot ("build-$PID")
$temporarySetupParent = Join-Path ([IO.Path]::GetTempPath()) ("wellbeing-setup-{0}" -f [Guid]::NewGuid().ToString('N'))
$setupRoot = Join-Path $temporarySetupParent "Wellbeing-Companion-Working-Title-Setup-$packageVersion"
$archiveName = "electron-v$ElectronVersion-win32-x64.zip"
$archivePath = Join-Path $cacheRoot $archiveName
$releaseUrl = "https://github.com/electron/electron/releases/download/v$ElectronVersion/$archiveName"
$knownArchiveHashes = @{
    '43.4.1' = 'C2EF9A5F65472C34D14BD3E67B7D14E66B0C01F124ABA45263D6A4232160E13A'
}
$knownOfficialExecutableHashes = @{
    '43.4.1' = 'E885FFC2A09DAB4C14DE706E3662A5929D1E65EA4EA347C56FD0964640EB923B'
}
$webDistRoot = Join-Path $sourceRoot 'dist'
$webIndex = Join-Path $webDistRoot 'index.html'
$iconSource = Join-Path $projectRoot 'desktop\assets\WellbeingCompanionWorkingTitle.ico'
$setupLauncherSource = Join-Path $projectRoot 'installer\Setup-WellbeingCompanion.cs'
$csharpCompiler = Join-Path ([Environment]::GetFolderPath('Windows')) 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

function Assert-GeneratedPath {
    param([Parameter(Mandatory)] [string]$Base, [Parameter(Mandatory)] [string]$Candidate)
    $baseFull = [IO.Path]::GetFullPath($Base).TrimEnd('\')
    $candidateFull = [IO.Path]::GetFullPath($Candidate).TrimEnd('\')
    if (-not $candidateFull.StartsWith("$baseFull\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing a generated path outside its expected root: $candidateFull"
    }
    return $candidateFull
}

function Assert-NoReparsePointTree {
    param([Parameter(Mandatory)] [string]$Root)
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return }
    foreach ($entry in Get-ChildItem -LiteralPath $Root -Force -Recurse) {
        if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing to package a reparse point: $($entry.FullName)"
        }
    }
}

function Get-ManifestRecord {
    param([Parameter(Mandatory)] [string]$Root, [Parameter(Mandatory)] [string]$FilePath)
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $fileFull = [IO.Path]::GetFullPath($FilePath)
    if (-not $fileFull.StartsWith("$rootFull\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to manifest a file outside its package root: $fileFull"
    }
    $item = Get-Item -LiteralPath $fileFull -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing to manifest a directory or reparse point: $fileFull"
    }
    [ordered]@{
        path = $fileFull.Substring($rootFull.Length + 1).Replace('\', '/')
        bytes = [long]$item.Length
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $fileFull).Hash.ToUpperInvariant()
    }
}

function Get-TreeManifest {
    param([Parameter(Mandatory)] [string]$Root, [Parameter(Mandatory)] [string[]]$ExcludedRelativePaths)
    $excluded = @{}
    foreach ($relative in $ExcludedRelativePaths) { $excluded[$relative.Replace('\', '/').ToLowerInvariant()] = $true }
    $records = @()
    foreach ($file in Get-ChildItem -LiteralPath $Root -File -Recurse | Sort-Object FullName) {
        $record = Get-ManifestRecord -Root $Root -FilePath $file.FullName
        if (-not $excluded.ContainsKey(([string]$record.path).ToLowerInvariant())) { $records += $record }
    }
    return @($records)
}

function Assert-ArchivePathBudget {
    param(
        [Parameter(Mandatory)] [string]$ArchivePath,
        [Parameter(Mandatory)] [string]$DestinationRoot,
        [Parameter(Mandatory)] [int]$MaximumEntryCharacters,
        [Parameter(Mandatory)] [int]$MaximumDestinationCharacters
    )
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $destinationFull = [IO.Path]::GetFullPath($DestinationRoot).TrimEnd('\')
    $maximumEntry = 0
    $maximumDestination = 0
    $entryCount = 0
    $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        foreach ($entry in $archive.Entries) {
            $normalized = ([string]$entry.FullName).Replace('\', '/')
            if ([string]::IsNullOrWhiteSpace($normalized) -or
                $normalized.StartsWith('/', [StringComparison]::Ordinal) -or
                [IO.Path]::IsPathRooted($normalized.Replace('/', '\')) -or
                $normalized -match '(^|/)\.\.(/|$)' -or
                $normalized.Contains(':')) {
                throw "Wellbeing Companion setup archive contains an unsafe entry: $normalized"
            }
            foreach ($component in @($normalized.Split('/', [StringSplitOptions]::RemoveEmptyEntries))) {
                if ($component.Length -gt 255) { throw "Wellbeing Companion setup archive contains a component over 255 characters: $normalized" }
            }
            $candidate = [IO.Path]::GetFullPath((Join-Path $destinationFull $normalized.Replace('/', '\')))
            if (-not $candidate.StartsWith("$destinationFull\", [StringComparison]::OrdinalIgnoreCase)) {
                throw "Wellbeing Companion setup archive entry escaped the extraction root: $normalized"
            }
            $entryCount += 1
            $maximumEntry = [Math]::Max($maximumEntry, $normalized.Length)
            $maximumDestination = [Math]::Max($maximumDestination, $candidate.Length)
        }
    } finally {
        $archive.Dispose()
    }
    if ($maximumEntry -gt $MaximumEntryCharacters) {
        throw "Wellbeing Companion setup archive exceeds the stock-Explorer entry budget ($maximumEntry > $MaximumEntryCharacters)."
    }
    if ($maximumDestination -gt $MaximumDestinationCharacters) {
        throw "Wellbeing Companion setup archive exceeds the realistic Desktop destination budget ($maximumDestination > $MaximumDestinationCharacters)."
    }
    return [ordered]@{
        entryCount = $entryCount
        maximumEntryCharacters = $maximumEntry
        testedDestinationRoot = $destinationFull
        maximumDestinationCharacters = $maximumDestination
        enforcedEntryLimit = $MaximumEntryCharacters
        enforcedDestinationLimit = $MaximumDestinationCharacters
        legacyMaxPathSafetyMargin = 260 - $maximumDestination
    }
}

if ($PublisherSignedExecutable) {
    if ([string]::IsNullOrWhiteSpace($PublisherSignedExecutableSha256) -or [string]::IsNullOrWhiteSpace($PublisherSignerThumbprint)) {
        throw 'A publisher-signed runtime requires both PublisherSignedExecutableSha256 and PublisherSignerThumbprint.'
    }
    if (-not (Test-Path -LiteralPath $PublisherSignedExecutable -PathType Leaf)) {
        throw "The publisher-signed runtime does not exist: $PublisherSignedExecutable"
    }
} elseif (-not [string]::IsNullOrWhiteSpace($PublisherSignedExecutableSha256) -or -not [string]::IsNullOrWhiteSpace($PublisherSignerThumbprint)) {
    throw 'PublisherSignedExecutableSha256 and PublisherSignerThumbprint are valid only with PublisherSignedExecutable.'
}

if (-not (Test-Path -LiteralPath $webIndex -PathType Leaf)) {
    throw "The production Vite build is missing: $webIndex. Run pnpm build first."
}
foreach ($requiredSetupInput in @($iconSource, $setupLauncherSource, $csharpCompiler)) {
    if (-not (Test-Path -LiteralPath $requiredSetupInput -PathType Leaf)) {
        throw "The Wellbeing Companion setup launcher input is missing: $requiredSetupInput"
    }
}
Assert-NoReparsePointTree -Root $webDistRoot
& (Join-Path $PSScriptRoot 'New-BrandAssets.ps1') | Out-Null
New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null

if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
    $globalCacheRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'electron\Cache'
    $cachedArchive = Get-ChildItem -LiteralPath $globalCacheRoot -Filter $archiveName -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cachedArchive) { Copy-Item -LiteralPath $cachedArchive.FullName -Destination $archivePath }
    else { Invoke-WebRequest -UseBasicParsing -Uri $releaseUrl -OutFile $archivePath }
}

$actualArchiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToUpperInvariant()
$expectedArchiveHash = $knownArchiveHashes[$ElectronVersion]
if ($actualArchiveHash -ne $expectedArchiveHash) {
    throw "Electron archive checksum mismatch. Expected $expectedArchiveHash but received $actualArchiveHash."
}

$null = Assert-GeneratedPath -Base $releaseRoot -Candidate $stagingRoot
$null = Assert-GeneratedPath -Base ([IO.Path]::GetTempPath()) -Candidate $temporarySetupParent
foreach ($generatedPath in @($stagingRoot, $temporarySetupParent)) {
    if (Test-Path -LiteralPath $generatedPath) { Remove-Item -LiteralPath $generatedPath -Recurse -Force }
}
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
New-Item -ItemType Directory -Path $temporarySetupParent -Force | Out-Null
Expand-Archive -LiteralPath $archivePath -DestinationPath $stagingRoot -Force

$upstreamExecutable = Join-Path $stagingRoot 'electron.exe'
$upstreamSignature = Get-AuthenticodeSignature -LiteralPath $upstreamExecutable
$officialUpstreamSignature = $upstreamSignature
$upstreamExecutableBytes = [long](Get-Item -LiteralPath $upstreamExecutable).Length
$upstreamExecutableHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $upstreamExecutable).Hash.ToUpperInvariant()
$expectedOfficialExecutableHash = $knownOfficialExecutableHashes[$ElectronVersion]
if ($upstreamExecutableHash -ne $expectedOfficialExecutableHash) {
    throw "Official Electron executable checksum mismatch. Expected $expectedOfficialExecutableHash but received $upstreamExecutableHash."
}
$runtimeSource = 'official-electron-release-archive'
$selectedRuntimeSourceHash = $upstreamExecutableHash
$expectedPublisherRuntimeHash = $null
$expectedPublisherSignerThumbprint = $null
if ($PublisherSignedExecutable) {
    if ([string]::IsNullOrWhiteSpace($PublisherSignedExecutableSha256) -or [string]::IsNullOrWhiteSpace($PublisherSignerThumbprint)) {
        throw 'A publisher-signed runtime requires both PublisherSignedExecutableSha256 and PublisherSignerThumbprint.'
    }
    $signedRuntime = (Resolve-Path -LiteralPath $PublisherSignedExecutable).Path
    $signedRuntimeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $signedRuntime).Hash.ToUpperInvariant()
    $expectedPublisherRuntimeHash = $PublisherSignedExecutableSha256.ToUpperInvariant()
    if ($signedRuntimeHash -ne $expectedPublisherRuntimeHash) {
        throw "The supplied publisher runtime does not match PublisherSignedExecutableSha256. Expected $expectedPublisherRuntimeHash but received $signedRuntimeHash."
    }
    $signedSignature = Get-AuthenticodeSignature -LiteralPath $signedRuntime
    if ($signedSignature.Status -ne 'Valid') { throw "The supplied publisher runtime is not Authenticode-valid (status: $($signedSignature.Status))." }
    if (-not $signedSignature.SignerCertificate) { throw 'The supplied publisher runtime has no signer certificate.' }
    $expectedPublisherSignerThumbprint = $PublisherSignerThumbprint.ToUpperInvariant()
    $actualPublisherSignerThumbprint = $signedSignature.SignerCertificate.Thumbprint.ToUpperInvariant()
    if ($actualPublisherSignerThumbprint -ne $expectedPublisherSignerThumbprint) {
        throw "The supplied publisher runtime signer does not match PublisherSignerThumbprint. Expected $expectedPublisherSignerThumbprint but received $actualPublisherSignerThumbprint."
    }
    $signedVersion = (Get-Item -LiteralPath $signedRuntime).VersionInfo.ProductVersion
    $signedDescription = (Get-Item -LiteralPath $signedRuntime).VersionInfo.FileDescription
    if (-not $signedVersion.StartsWith($ElectronVersion, [StringComparison]::OrdinalIgnoreCase) -or $signedDescription.IndexOf('Electron', [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw "The supplied publisher runtime is not Electron $ElectronVersion."
    }
    Copy-Item -LiteralPath $signedRuntime -Destination $upstreamExecutable -Force
    $upstreamSignature = Get-AuthenticodeSignature -LiteralPath $upstreamExecutable
    $runtimeSource = 'caller-supplied-hash-and-signer-bound-publisher-runtime'
    $selectedRuntimeSourceHash = $signedRuntimeHash
} elseif (-not [string]::IsNullOrWhiteSpace($PublisherSignedExecutableSha256) -or -not [string]::IsNullOrWhiteSpace($PublisherSignerThumbprint)) {
    throw 'PublisherSignedExecutableSha256 and PublisherSignerThumbprint are valid only with PublisherSignedExecutable.'
}
if ($upstreamSignature.Status -notin @('Valid', 'NotSigned')) {
    throw "The Electron executable has an unexpected signature state: $($upstreamSignature.Status)."
}
$companionExecutable = Join-Path $stagingRoot 'WellbeingCompanionWorkingTitle.exe'
Move-Item -LiteralPath $upstreamExecutable -Destination $companionExecutable
$renamedSignature = Get-AuthenticodeSignature -LiteralPath $companionExecutable
if ($renamedSignature.Status.ToString() -ne $upstreamSignature.Status.ToString()) { throw 'Renaming Electron unexpectedly changed its signature state.' }
$renamedExecutableHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $companionExecutable).Hash.ToUpperInvariant()
if ($renamedExecutableHash -ne $selectedRuntimeSourceHash) { throw 'Renaming Electron unexpectedly changed its bytes.' }
$runtimeByteIdentityPreserved = $true

$defaultApp = Join-Path $stagingRoot 'resources\default_app.asar'
if (Test-Path -LiteralPath $defaultApp -PathType Leaf) { Remove-Item -LiteralPath $defaultApp -Force }
$appResourceRoot = Join-Path $stagingRoot 'resources\app'
New-Item -ItemType Directory -Path $appResourceRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'desktop') -Destination $appResourceRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $appResourceRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination (Join-Path $appResourceRoot 'DESKTOP-README.md')
Copy-Item -LiteralPath (Join-Path $sourceRoot 'README.md') -Destination (Join-Path $appResourceRoot 'PRODUCT-README.md')
Copy-Item -LiteralPath $webDistRoot -Destination (Join-Path $appResourceRoot 'web') -Recurse

$authoredFiles = @()
foreach ($file in Get-ChildItem -LiteralPath $appResourceRoot -File -Recurse | Sort-Object FullName) {
    $authoredFiles += Get-ManifestRecord -Root $appResourceRoot -FilePath $file.FullName
}
$receipt = [ordered]@{
    schema = 1
    product = 'Wellbeing companion working-title desktop shell'
    packageVersion = $packageVersion
    electronVersion = $ElectronVersion
    electronArchiveSha256 = $actualArchiveHash
    executableSha256 = $renamedExecutableHash
    executableSignatureStatus = $renamedSignature.Status.ToString()
    executableSigner = if ($renamedSignature.SignerCertificate) { $renamedSignature.SignerCertificate.Subject } else { $null }
    archiveHashSource = "https://github.com/electron/electron/releases/download/v$ElectronVersion/SHASUMS256.txt"
    publisherBoundary = if ($renamedSignature.Status -eq 'Valid') {
        'Caller supplied an exact SHA-256- and signer-thumbprint-bound Authenticode-valid Electron runtime. This authenticates the runtime signer only; the setup launcher and final distribution container require their own verified signing boundary.'
    } else {
        'The pinned official Electron release archive and its electron.exe were hash verified and the runtime was preserved byte-for-byte through rename, but that upstream executable is itself Authenticode NotSigned. Avoiding resource mutation cannot create a Microsoft or Electron trust chain. The setup notes disclose this state and Windows may still show its own reputation or Smart App Control warning. Publisher or Microsoft Store package signing remains required for public release.'
    }
    releaseSecurity = [ordered]@{
        officialElectronArchive = [ordered]@{
            fileName = $archiveName
            sha256 = $actualArchiveHash
            expectedSha256 = $expectedArchiveHash
            hashSource = "https://github.com/electron/electron/releases/download/v$ElectronVersion/SHASUMS256.txt"
        }
        officialElectronHost = [ordered]@{
            fileName = 'electron.exe'
            bytes = $upstreamExecutableBytes
            sha256 = $upstreamExecutableHash
            expectedSha256 = $expectedOfficialExecutableHash
            authenticodeStatus = $officialUpstreamSignature.Status.ToString()
            signerSubject = if ($officialUpstreamSignature.SignerCertificate) { $officialUpstreamSignature.SignerCertificate.Subject } else { $null }
            signerThumbprint = if ($officialUpstreamSignature.SignerCertificate) { $officialUpstreamSignature.SignerCertificate.Thumbprint.ToUpperInvariant() } else { $null }
        }
        selectedRuntimeHost = [ordered]@{
            source = $runtimeSource
            sourceSha256 = $selectedRuntimeSourceHash
            packagedFileName = 'WellbeingCompanionWorkingTitle.exe'
            packagedSha256 = $renamedExecutableHash
            byteIdentityPreserved = $runtimeByteIdentityPreserved
            resourceMutationApplied = $false
            fileRenameApplied = $true
            renameChangedBytes = $false
            authenticodeStatus = $renamedSignature.Status.ToString()
            signerSubject = if ($renamedSignature.SignerCertificate) { $renamedSignature.SignerCertificate.Subject } else { $null }
            signerThumbprint = if ($renamedSignature.SignerCertificate) { $renamedSignature.SignerCertificate.Thumbprint.ToUpperInvariant() } else { $null }
            expectedPublisherRuntimeSha256 = $expectedPublisherRuntimeHash
            expectedPublisherSignerThumbprint = $expectedPublisherSignerThumbprint
        }
        runtimeAuthenticodeValid = [bool]($renamedSignature.Status -eq 'Valid')
        publicReleaseTrusted = $false
        setupLauncherSeparatelySigned = $false
        normalSecurityBypassUsed = $false
    }
    bundledWebRuntime = $true
    bundledRuntimeOrigin = 'http://127.0.0.1:43724/'
    bundledRuntimeModules = @('node:http static server', 'Vite-bundled React client')
    offlineBoundary = 'The deterministic conversation, memory, reminders, vault, built assets, optional Chatterbox output, and installed faster-whisper speech input run locally. Voice/speech hosts bind ephemeral authenticated loopback ports and require existing offline caches. Optional Ollama is separate, fixed to 127.0.0.1:11434, and steady-only.'
    permissionBoundary = 'Microphone is armed only after explicit hands-free IPC and native confirmation; bounded audio is transcribed locally in memory and discarded after the turn. Camera, display capture, device permissions, downloads, and non-loopback renderer requests are denied.'
    childProcessCompatibilityBoundary = 'On Windows builds 26200-26399, Electron 43 uses a disclosed GPU and renderer process-sandbox compatibility path after repeated child-process launch failures. Context isolation stays enabled, Node integration and webviews stay disabled, and renderer navigation remains fixed to 127.0.0.1.'
    integrity = [ordered]@{
        algorithm = 'SHA-256'
        scope = 'Every regular authored file below resources/app.'
        exclusions = @('BUILD-RECEIPT.json is outside this authored-file scope to avoid self-hash recursion. Electron support files are bound by the setup receipt.')
        files = @($authoredFiles)
    }
}
$receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $stagingRoot 'BUILD-RECEIPT.json') -Encoding utf8

$null = Assert-GeneratedPath -Base $releaseRoot -Candidate $finalRoot
if (Test-Path -LiteralPath $finalRoot) { Remove-Item -LiteralPath $finalRoot -Recurse -Force }
Move-Item -LiteralPath $stagingRoot -Destination $finalRoot

New-Item -ItemType Directory -Path $setupRoot -Force | Out-Null
$payloadRoot = Join-Path $setupRoot 'Payload'
Copy-Item -LiteralPath $finalRoot -Destination $payloadRoot -Recurse
$supportRoot = Join-Path $setupRoot 'Support'
New-Item -ItemType Directory -Path $supportRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install-WellbeingCompanion.ps1') -Destination $supportRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Uninstall-WellbeingCompanion.ps1') -Destination $supportRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination (Join-Path $setupRoot 'README.txt')
$setupLauncherPath = Join-Path $setupRoot 'SETUP-WELLBEING-COMPANION.exe'
& $csharpCompiler /nologo /target:winexe /optimize+ /platform:anycpu /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/win32icon:$iconSource" "/out:$setupLauncherPath" $setupLauncherSource
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $setupLauncherPath -PathType Leaf)) {
    throw 'Wellbeing Companion could not compile the double-click Windows setup launcher.'
}
$setupLauncherSignature = Get-AuthenticodeSignature -LiteralPath $setupLauncherPath
if ($setupLauncherSignature.Status -notin @('Valid', 'NotSigned')) {
    throw "The setup launcher has an unexpected signature state: $($setupLauncherSignature.Status)."
}

$setupReceiptPath = Join-Path $setupRoot 'SETUP-RECEIPT.json'
$setupFiles = Get-TreeManifest -Root $setupRoot -ExcludedRelativePaths @('SETUP-RECEIPT.json')
$setupReceipt = [ordered]@{
    schema = 1
    product = 'Wellbeing companion working-title Windows setup'
    packageVersion = $packageVersion
    algorithm = 'SHA-256'
    scope = 'Every regular file in the extracted setup directory except SETUP-RECEIPT.json itself.'
    exclusions = @('SETUP-RECEIPT.json is excluded to avoid self-hash recursion. The external ZIP, sidecar, and package receipt are produced after this receipt is sealed.')
    releaseSecurity = [ordered]@{
        runtimeSha256 = $renamedExecutableHash
        runtimeSignatureStatus = $renamedSignature.Status.ToString()
        runtimeSignerSubject = if ($renamedSignature.SignerCertificate) { $renamedSignature.SignerCertificate.Subject } else { $null }
        runtimeByteIdentityPreserved = $runtimeByteIdentityPreserved
        runtimeResourceMutationApplied = $false
        setupLauncherSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $setupLauncherPath).Hash.ToUpperInvariant()
        setupLauncherSignatureStatus = $setupLauncherSignature.Status.ToString()
        setupLauncherSignerSubject = if ($setupLauncherSignature.SignerCertificate) { $setupLauncherSignature.SignerCertificate.Subject } else { $null }
        normalSecurityBypassUsed = $false
    }
    files = @($setupFiles)
}
$setupReceipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $setupReceiptPath -Encoding utf8
$setupReceiptHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $setupReceiptPath).Hash.ToUpperInvariant()

$setupZip = Join-Path $releaseRoot "Wellbeing-Companion-Working-Title-Setup-$packageVersion-win32-x64.zip"
if (Test-Path -LiteralPath $setupZip -PathType Leaf) { Remove-Item -LiteralPath $setupZip -Force }
Compress-Archive -LiteralPath $setupRoot -DestinationPath $setupZip -CompressionLevel Optimal
$realisticDesktopRoot = "C:\Users\WellbeingOwner\Desktop\Wellbeing-Companion-Owner-Acceptance-$packageVersion\Extracted-Package"
$pathBudget = Assert-ArchivePathBudget -ArchivePath $setupZip -DestinationRoot $realisticDesktopRoot -MaximumEntryCharacters 140 -MaximumDestinationCharacters 220
$setupHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $setupZip).Hash.ToUpperInvariant()
$sidecarPath = "$setupZip.sha256.txt"
"$setupHash  $([IO.Path]::GetFileName($setupZip))" | Set-Content -LiteralPath $sidecarPath -Encoding ascii
$sidecarHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sidecarPath).Hash.ToUpperInvariant()
$packageReceiptPath = "$setupZip.receipt.json"
$packageReceipt = [ordered]@{
    schema = 1
    product = 'Wellbeing companion working-title Windows setup archive'
    packageVersion = $packageVersion
    algorithm = 'SHA-256'
    scope = 'The final ZIP bytes, its external SHA-256 sidecar, and the sealed setup receipt embedded in the ZIP.'
    exclusions = @('This external package receipt excludes itself to avoid self-hash recursion.')
    explorerPathBudget = $pathBudget
    releaseSecurity = [ordered]@{
        runtimeSignatureStatus = $renamedSignature.Status.ToString()
        runtimeByteIdentityPreserved = $runtimeByteIdentityPreserved
        setupLauncherSignatureStatus = $setupLauncherSignature.Status.ToString()
        normalSecurityBypassUsed = $false
        publicReleaseTrusted = [bool]($renamedSignature.Status -eq 'Valid' -and $setupLauncherSignature.Status -eq 'Valid')
    }
    artifacts = @(
        [ordered]@{ path = [IO.Path]::GetFileName($setupZip); bytes = [long](Get-Item -LiteralPath $setupZip).Length; sha256 = $setupHash },
        [ordered]@{ path = [IO.Path]::GetFileName($sidecarPath); bytes = [long](Get-Item -LiteralPath $sidecarPath).Length; sha256 = $sidecarHash },
        [ordered]@{ path = "Wellbeing-Companion-Working-Title-Setup-$packageVersion/SETUP-RECEIPT.json"; bytes = [long](Get-Item -LiteralPath $setupReceiptPath).Length; sha256 = $setupReceiptHash }
    )
}
$packageReceipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $packageReceiptPath -Encoding utf8
Remove-Item -LiteralPath $temporarySetupParent -Recurse -Force

[pscustomobject]@{
    Executable = Join-Path $finalRoot 'WellbeingCompanionWorkingTitle.exe'
    SignatureStatus = $renamedSignature.Status
    Signer = if ($renamedSignature.SignerCertificate) { $renamedSignature.SignerCertificate.Subject } else { $null }
    RuntimeSource = $runtimeSource
    RuntimeByteIdentityPreserved = $runtimeByteIdentityPreserved
    RuntimeResourceMutationApplied = $false
    OfficialElectronHostSignatureStatus = $officialUpstreamSignature.Status
    SetupLauncherSignatureStatus = $setupLauncherSignature.Status
    NormalSecurityBypassUsed = $false
    InstallerZip = $setupZip
    InstallerZipSha256 = $setupHash
    InstallerSidecar = $sidecarPath
    PackageReceipt = $packageReceiptPath
}
