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
$expectedElectronVersion = '43.4.1'
$expectedElectronArchiveSha256 = 'C2EF9A5F65472C34D14BD3E67B7D14E66B0C01F124ABA45263D6A4232160E13A'
$expectedOfficialElectronExecutableSha256 = 'E885FFC2A09DAB4C14DE706E3662A5929D1E65EA4EA347C56FD0964640EB923B'
$electronArchivePath = Join-Path $releaseRoot "cache\electron-v$expectedElectronVersion-win32-x64.zip"

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

foreach ($required in @($electronArchivePath, $executablePath, $buildReceiptPath, $setupZip, $sidecarPath, $packageReceiptPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required package artifact is missing: $required" }
}

$buildReceipt = Get-Content -Raw -LiteralPath $buildReceiptPath -Encoding UTF8 | ConvertFrom-Json
if ($buildReceipt.schema -ne 1 -or $buildReceipt.product -ne 'Wellbeing companion working-title desktop shell') { throw 'The build receipt identity is invalid.' }
$signature = Get-AuthenticodeSignature -LiteralPath $executablePath
$executableHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $executablePath).Hash.ToUpperInvariant()
if ($signature.Status.ToString() -ne [string]$buildReceipt.executableSignatureStatus -or $signature.Status -notin @('Valid', 'NotSigned')) { throw 'Executable signature state does not match its receipt.' }
if ($executableHash -ne ([string]$buildReceipt.executableSha256).ToUpperInvariant()) { throw 'Executable hash does not match its receipt.' }
$actualElectronArchiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $electronArchivePath).Hash.ToUpperInvariant()
if ([string]$buildReceipt.electronVersion -ne $expectedElectronVersion -or
    ([string]$buildReceipt.electronArchiveSha256).ToUpperInvariant() -ne $expectedElectronArchiveSha256 -or
    $actualElectronArchiveHash -ne $expectedElectronArchiveSha256) {
    throw 'The pinned official Electron release archive provenance is invalid.'
}
$releaseSecurity = $buildReceipt.releaseSecurity
if (-not $releaseSecurity -or -not $releaseSecurity.officialElectronArchive -or -not $releaseSecurity.officialElectronHost -or -not $releaseSecurity.selectedRuntimeHost) {
    throw 'The build receipt is missing the release-security provenance boundary.'
}
if (([string]$releaseSecurity.officialElectronArchive.sha256).ToUpperInvariant() -ne $expectedElectronArchiveSha256 -or
    ([string]$releaseSecurity.officialElectronArchive.expectedSha256).ToUpperInvariant() -ne $expectedElectronArchiveSha256 -or
    ([string]$releaseSecurity.officialElectronHost.sha256).ToUpperInvariant() -ne $expectedOfficialElectronExecutableSha256 -or
    ([string]$releaseSecurity.officialElectronHost.expectedSha256).ToUpperInvariant() -ne $expectedOfficialElectronExecutableSha256 -or
    [string]$releaseSecurity.officialElectronHost.authenticodeStatus -ne 'NotSigned') {
    throw 'The official Electron host hash or upstream Authenticode state is invalid.'
}
$selectedRuntime = $releaseSecurity.selectedRuntimeHost
if (-not [bool]$selectedRuntime.byteIdentityPreserved -or
    [bool]$selectedRuntime.resourceMutationApplied -or
    -not [bool]$selectedRuntime.fileRenameApplied -or
    [bool]$selectedRuntime.renameChangedBytes -or
    ([string]$selectedRuntime.sourceSha256).ToUpperInvariant() -ne $executableHash -or
    ([string]$selectedRuntime.packagedSha256).ToUpperInvariant() -ne $executableHash -or
    [string]$selectedRuntime.authenticodeStatus -ne $signature.Status.ToString() -or
    [bool]$releaseSecurity.normalSecurityBypassUsed -or
    [bool]$releaseSecurity.publicReleaseTrusted -or
    [bool]$releaseSecurity.setupLauncherSeparatelySigned) {
    throw 'The selected Electron runtime was not preserved byte-for-byte under the declared release-security boundary.'
}
if ([string]$selectedRuntime.source -eq 'official-electron-release-archive') {
    if ($executableHash -ne $expectedOfficialElectronExecutableSha256 -or $signature.Status -ne 'NotSigned' -or [bool]$releaseSecurity.runtimeAuthenticodeValid) {
        throw 'The packaged official Electron host does not match the pinned unsigned upstream bytes.'
    }
} elseif ([string]$selectedRuntime.source -eq 'caller-supplied-hash-and-signer-bound-publisher-runtime') {
    if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or -not [bool]$releaseSecurity.runtimeAuthenticodeValid -or
        [string]::IsNullOrWhiteSpace([string]$selectedRuntime.expectedPublisherRuntimeSha256) -or
        [string]::IsNullOrWhiteSpace([string]$selectedRuntime.expectedPublisherSignerThumbprint) -or
        ([string]$selectedRuntime.expectedPublisherRuntimeSha256).ToUpperInvariant() -ne $executableHash -or
        ([string]$selectedRuntime.expectedPublisherSignerThumbprint).ToUpperInvariant() -ne $signature.SignerCertificate.Thumbprint.ToUpperInvariant() -or
        ([string]$selectedRuntime.signerThumbprint).ToUpperInvariant() -ne $signature.SignerCertificate.Thumbprint.ToUpperInvariant()) {
        throw 'The publisher runtime is not bound to its declared exact hash and signer thumbprint.'
    }
} else {
    throw 'The selected Electron runtime source is not recognized.'
}
Assert-FileRecords -Root (Join-Path $unpackedRoot 'resources\app') -Records @($buildReceipt.integrity.files) -ExcludedRelativePaths @()

$packagedAppRoot = Join-Path $unpackedRoot 'resources\app'
$packagedVoiceBridge = Join-Path $packagedAppRoot 'desktop\chatterbox-local-voice.cjs'
$packagedVoiceHost = Join-Path $packagedAppRoot 'desktop\chatterbox-voice-host.py'
$packagedVoiceProbe = Join-Path $packagedAppRoot 'desktop\packaged-voice-probe.cjs'
$packagedSpeechBridge = Join-Path $packagedAppRoot 'desktop\local-speech.cjs'
$packagedSpeechHost = Join-Path $packagedAppRoot 'desktop\local-speech-host.py'
$packagedSpeechProbe = Join-Path $packagedAppRoot 'desktop\packaged-speech-probe.cjs'
$packagedFemaleReference = Join-Path $packagedAppRoot 'web\voice-previews\calm-female-approved.wav'
$packagedMaleReference = Join-Path $packagedAppRoot 'web\voice-previews\warm-male-approved.wav'
$forbiddenPackagedSprite = Join-Path $packagedAppRoot 'web\companion-warm-plum-speech-sprite-v3.png'
$forbiddenPackagedSpriteMetadata = Join-Path $packagedAppRoot 'web\companion-warm-plum-speech-sprite-v3.json'
foreach ($voiceAsset in @($packagedVoiceBridge, $packagedVoiceHost, $packagedVoiceProbe, $packagedSpeechBridge, $packagedSpeechHost, $packagedSpeechProbe, $packagedFemaleReference, $packagedMaleReference)) {
    if (-not (Test-Path -LiteralPath $voiceAsset -PathType Leaf)) { throw "The exact package is missing a bounded local-voice asset: $voiceAsset" }
}
if ((Test-Path -LiteralPath $forbiddenPackagedSprite) -or (Test-Path -LiteralPath $forbiddenPackagedSpriteMetadata)) {
    throw 'The exact orb candidate still contains the forbidden companion sprite or frame metadata.'
}
$femaleReferenceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $packagedFemaleReference).Hash.ToLowerInvariant()
$maleReferenceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $packagedMaleReference).Hash.ToLowerInvariant()
if ($femaleReferenceHash -ne 'c3e3682817476212c990969901028758fbbde1eb4eb8c97153ef878b3939b33a' -or
    $maleReferenceHash -ne '0a8cdb8178bf56a6aa2442cca496dcf87a76b52e8eb0743488dc5f0e8c8a8a8e') {
    throw 'The exact package synthetic voice-reference hashes do not match the reviewed provenance records.'
}
$packagedVoiceBridgeSource = Get-Content -Raw -LiteralPath $packagedVoiceBridge -Encoding UTF8
$packagedVoiceHostSource = Get-Content -Raw -LiteralPath $packagedVoiceHost -Encoding UTF8
$packagedVoiceProbeSource = Get-Content -Raw -LiteralPath $packagedVoiceProbe -Encoding UTF8
$packagedSpeechBridgeSource = Get-Content -Raw -LiteralPath $packagedSpeechBridge -Encoding UTF8
$packagedSpeechHostSource = Get-Content -Raw -LiteralPath $packagedSpeechHost -Encoding UTF8
$packagedSpeechProbeSource = Get-Content -Raw -LiteralPath $packagedSpeechProbe -Encoding UTF8
if ($packagedVoiceBridgeSource -notmatch "host: '127\.0\.0\.1'" -or
    $packagedVoiceBridgeSource -notmatch "shell: false" -or
    $packagedVoiceBridgeSource -notmatch "HF_HUB_OFFLINE: '1'" -or
    $packagedVoiceBridgeSource -notmatch "TRANSFORMERS_OFFLINE: '1'" -or
    $packagedVoiceHostSource -notmatch 'ThreadingHTTPServer\(\("127\.0\.0\.1", 0\)' -or
    $packagedVoiceHostSource -notmatch 'WELLBEING_VOICE_AUTH_TOKEN' -or
    $packagedVoiceHostSource -notmatch 'winsound\.SND_ASYNC' -or
    $packagedVoiceHostSource -notmatch 'wellbeing\.local-voice\.cancel-result\.v1' -or
    $packagedVoiceProbeSource -notmatch 'Exact checksum-verified setup ZIP payload' -or
    $packagedVoiceProbeSource -notmatch 'playbackConfirmed: true' -or
    $packagedVoiceProbeSource -notmatch 'actualPlaybackEventObserved: true' -or
    $packagedVoiceProbeSource -notmatch 'cancellationAcknowledged: true' -or
    $packagedVoiceProbeSource -notmatch "activePhase !== 'playing'") {
    throw 'The exact package local-voice host is missing its loopback, authentication, or offline-only boundary.'
}
$hostPlaybackStart = $packagedVoiceHostSource.IndexOf('duration_seconds =', [StringComparison]::Ordinal)
$hostPlaybackEnd = $packagedVoiceHostSource.IndexOf('deadline =', $hostPlaybackStart, [StringComparison]::Ordinal)
if ($hostPlaybackStart -lt 0 -or $hostPlaybackEnd -le $hostPlaybackStart) {
    throw 'The exact package local-voice host is missing its bounded playback lifecycle.'
}
$hostPlaybackLifecycle = $packagedVoiceHostSource.Substring($hostPlaybackStart, $hostPlaybackEnd - $hostPlaybackStart)
$hostPlaybackCall = $hostPlaybackLifecycle.IndexOf('winsound.PlaySound(', [StringComparison]::Ordinal)
$hostCancellationRecheck = $hostPlaybackLifecycle.IndexOf('if request_generation != self.generation():', $hostPlaybackCall, [StringComparison]::Ordinal)
$hostTimingNotification = $hostPlaybackLifecycle.IndexOf('print(PLAYBACK_PREFIX', $hostCancellationRecheck, [StringComparison]::Ordinal)
if ($hostPlaybackCall -lt 0 -or $hostCancellationRecheck -le $hostPlaybackCall -or $hostTimingNotification -le $hostCancellationRecheck) {
    throw 'The exact package local-voice host announces mouth timing before Windows accepts playback or before cancellation is rechecked.'
}
if ($packagedSpeechBridgeSource -notmatch "host: '127\.0\.0\.1'" -or
    $packagedSpeechBridgeSource -notmatch "shell: false" -or
    $packagedSpeechBridgeSource -notmatch "HF_HUB_OFFLINE: '1'" -or
    $packagedSpeechBridgeSource -notmatch "TRANSFORMERS_OFFLINE: '1'" -or
    $packagedSpeechHostSource -notmatch 'ThreadingHTTPServer\(\("127\.0\.0\.1", 0\)' -or
    $packagedSpeechHostSource -notmatch 'WELLBEING_ASR_AUTH_TOKEN' -or
    $packagedSpeechHostSource -notmatch 'io\.BytesIO\(audio\)' -or
    $packagedSpeechHostSource -notmatch 'rawAudioPersisted": False' -or
    $packagedSpeechProbeSource -notmatch 'fixedSyntheticPackagedAudioOnly: true' -or
    $packagedSpeechProbeSource -notmatch 'transcriptTextRetainedInReceipt: false') {
    throw 'The exact package local-speech host is missing its loopback, bearer-authenticated, memory-only, or offline-cache boundary.'
}
$bundledModelFiles = @(Get-ChildItem -LiteralPath $packagedAppRoot -File -Recurse | Where-Object {
    $_.Name -in @('conds.pt', 's3gen.safetensors', 't3_cfg.safetensors', 've.safetensors')
})
if ($bundledModelFiles.Count -ne 0) { throw 'The exact package unexpectedly bundles the external multi-gigabyte Chatterbox model cache.' }
$localVoiceProviderAssets = [ordered]@{
    adapterPath = 'resources/app/desktop/chatterbox-local-voice.cjs'
    hostPath = 'resources/app/desktop/chatterbox-voice-host.py'
    ownerProbePath = 'resources/app/desktop/packaged-voice-probe.cjs'
    exactPackageAudibleProbeAvailable = $true
    muteCancellationProbeAvailable = $true
    loopbackOnly = $true
    perProcessAuthenticationRequired = $true
    offlineEnvironmentRequired = $true
    modelBundled = $false
    syntheticReferences = @(
        [ordered]@{ profile = 'soft-feminine'; path = 'resources/app/web/voice-previews/calm-female-approved.wav'; sha256 = $femaleReferenceHash.ToUpperInvariant() },
        [ordered]@{ profile = 'calm-masculine'; path = 'resources/app/web/voice-previews/warm-male-approved.wav'; sha256 = $maleReferenceHash.ToUpperInvariant() }
    )
}
$localSpeechProviderAssets = [ordered]@{
    adapterPath = 'resources/app/desktop/local-speech.cjs'
    hostPath = 'resources/app/desktop/local-speech-host.py'
    fixedSyntheticProbePath = 'resources/app/desktop/packaged-speech-probe.cjs'
    exactPackageTranscriptionProbeAvailable = $true
    loopbackOnly = $true
    perProcessAuthenticationRequired = $true
    offlineCacheRequired = $true
    rawAudioPersisted = $false
    modelBundled = $false
    fixedSyntheticAudio = [ordered]@{ path = 'resources/app/web/voice-previews/calm-female-approved.wav'; sha256 = $femaleReferenceHash.ToUpperInvariant() }
}

$packagedWebRoot = Join-Path $unpackedRoot 'resources\app\web'
$webFiles = Get-ChildItem -LiteralPath $packagedWebRoot -File -Recurse
foreach ($file in $webFiles) {
    if ($file.Extension -in @('.js', '.css', '.html')) {
        $content = Get-Content -Raw -LiteralPath $file.FullName
        if ($content -match '(?i)https?://(?:fonts\.|fonts\.googleapis|fonts\.gstatic|cdn\.)') {
            throw "The packaged offline UI contains an automatic external asset URL: $($file.FullName)"
        }
    }
}
$manifestPath = Join-Path $packagedWebRoot 'manifest.webmanifest'
$serviceWorkerPath = Join-Path $packagedWebRoot 'sw.js'
$pwaIconPaths = @(
    (Join-Path $packagedWebRoot 'pwa\icon-180.png'),
    (Join-Path $packagedWebRoot 'pwa\icon-192.png'),
    (Join-Path $packagedWebRoot 'pwa\icon-512.png'),
    (Join-Path $packagedWebRoot 'pwa\icon-maskable-512.png')
)
foreach ($pwaFile in @($manifestPath, $serviceWorkerPath) + $pwaIconPaths) {
    if (-not (Test-Path -LiteralPath $pwaFile -PathType Leaf)) { throw "The exact package is missing an installable-PWA asset: $pwaFile" }
}
$manifest = Get-Content -Raw -LiteralPath $manifestPath -Encoding UTF8 | ConvertFrom-Json
if ($manifest.id -ne '/' -or $manifest.scope -ne '/' -or $manifest.start_url -ne '/?layout=full&pwa=1' -or $manifest.display -ne 'standalone' -or
    @($manifest.icons | Where-Object { $_.src -eq '/pwa/icon-512.png' -and $_.sizes -eq '512x512' -and $_.purpose -eq 'any' }).Count -ne 1 -or
    @($manifest.icons | Where-Object { $_.src -eq '/pwa/icon-maskable-512.png' -and $_.sizes -eq '512x512' -and $_.purpose -eq 'maskable' }).Count -ne 1) {
    throw 'The exact package PWA manifest is not the reviewed standalone application contract.'
}
$serviceWorkerSource = Get-Content -Raw -LiteralPath $serviceWorkerPath -Encoding UTF8
$precacheMatch = [regex]::Match($serviceWorkerSource, 'const PRECACHE_URLS = Object\.freeze\((\[[\s\S]*?\])\);')
if (-not $precacheMatch.Success) { throw 'The exact package service worker does not expose its exact precache closure.' }
$precacheValue = $precacheMatch.Groups[1].Value | ConvertFrom-Json
$precacheUrls = @()
foreach ($precacheUrl in $precacheValue) { $precacheUrls += [string]$precacheUrl }
if ($precacheUrls.Count -ne (@($precacheUrls | Select-Object -Unique)).Count -or
    $serviceWorkerSource -notmatch 'CACHE_PREFIX = "wellbeing-companion-shell-"' -or
    $serviceWorkerSource -notmatch 'NETWORK_ONLY_PREFIXES' -or
    $serviceWorkerSource -notmatch 'cache\.match\(request, \{ ignoreSearch: true \}\)') {
    throw 'The exact package service worker is missing its versioned, network-only, or cache-first static boundary.'
}
foreach ($webFile in $webFiles) {
    $relativeWebPath = $webFile.FullName.Substring(([IO.Path]::GetFullPath($packagedWebRoot).TrimEnd('\')).Length + 1).Replace('\', '/')
    if ($relativeWebPath -eq 'sw.js' -or $relativeWebPath.EndsWith('.map', [StringComparison]::OrdinalIgnoreCase)) { continue }
    if ($precacheUrls -notcontains "/$relativeWebPath") { throw "The exact package service worker omits an emitted build asset: $relativeWebPath" }
}
$packagedBundles = @(Get-ChildItem -LiteralPath (Join-Path $packagedWebRoot 'assets') -File | Where-Object { $_.Extension -in @('.js', '.css') })
if (@($packagedBundles | Where-Object Extension -eq '.js').Count -lt 1 -or @($packagedBundles | Where-Object Extension -eq '.css').Count -lt 1) {
    throw 'The exact package is missing its hashed JavaScript or CSS application bundle.'
}
$packagedJavaScript = ($packagedBundles | Where-Object Extension -eq '.js' | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName -Encoding UTF8 }) -join "`n"
if ($packagedJavaScript -notmatch 'beforeinstallprompt' -or
    $packagedJavaScript -notmatch 'Install in its own app window' -or
    $packagedJavaScript -notmatch 'wellbeing:pwa-offline-ready' -or
    $packagedJavaScript -notmatch 'reactive-css-orb-2d' -or
    $packagedJavaScript -notmatch 'sanitized-playback-amplitude-envelope' -or
    $packagedJavaScript -notmatch 'fail-temporary-orb-no-live-mesh') {
    throw 'The exact packaged client is missing the reviewed PWA install control or honest temporary-orb contract.'
}
$pwaInstallabilityEvidence = [ordered]@{
    manifestPath = 'resources/app/web/manifest.webmanifest'
    serviceWorkerPath = 'resources/app/web/sw.js'
    standalone = $true
    startUrl = '/?layout=full&pwa=1'
    exactPrecacheUrlCount = $precacheUrls.Count
    emittedBuildClosureComplete = $true
    hashedJavaScript = @($packagedBundles | Where-Object Extension -eq '.js' | ForEach-Object { "resources/app/web/assets/$($_.Name)" })
    hashedCss = @($packagedBundles | Where-Object Extension -eq '.css' | ForEach-Object { "resources/app/web/assets/$($_.Name)" })
    installControlPresent = $true
    nativeBridgePreserved = $true
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
    $launcherHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $setupLauncherPath).Hash.ToUpperInvariant()
    $launcherSignature = Get-AuthenticodeSignature -LiteralPath $setupLauncherPath
    if ($launcherSignature.Status -notin @('Valid', 'NotSigned')) { throw 'The setup launcher has an unexpected Authenticode state.' }
    $setupReleaseSecurity = $setupReceipt.releaseSecurity
    $packageReleaseSecurity = $packageReceipt.releaseSecurity
    if (-not $setupReleaseSecurity -or -not $packageReleaseSecurity -or
        ([string]$setupReleaseSecurity.runtimeSha256).ToUpperInvariant() -ne $executableHash -or
        [string]$setupReleaseSecurity.runtimeSignatureStatus -ne $signature.Status.ToString() -or
        -not [bool]$setupReleaseSecurity.runtimeByteIdentityPreserved -or
        [bool]$setupReleaseSecurity.runtimeResourceMutationApplied -or
        ([string]$setupReleaseSecurity.setupLauncherSha256).ToUpperInvariant() -ne $launcherHash -or
        [string]$setupReleaseSecurity.setupLauncherSignatureStatus -ne $launcherSignature.Status.ToString() -or
        [bool]$setupReleaseSecurity.normalSecurityBypassUsed -or
        [string]$packageReleaseSecurity.runtimeSignatureStatus -ne $signature.Status.ToString() -or
        -not [bool]$packageReleaseSecurity.runtimeByteIdentityPreserved -or
        [string]$packageReleaseSecurity.setupLauncherSignatureStatus -ne $launcherSignature.Status.ToString() -or
        [bool]$packageReleaseSecurity.normalSecurityBypassUsed -or
        [bool]$packageReleaseSecurity.publicReleaseTrusted -ne [bool]($signature.Status -eq 'Valid' -and $launcherSignature.Status -eq 'Valid')) {
        throw 'The setup and package release-security receipts do not match the exact runtime and launcher.'
    }
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
$companionVisual = $smoke.rendererProbe.companionVisual
if (-not $companionVisual.orbPresent -or $companionVisual.renderer -ne 'reactive-css-orb-2d' -or $companionVisual.presentation -ne 'temporary-orb-not-3d-character' -or $companionVisual.visualKind -ne 'temporary-orb-2d' -or $companionVisual.imageSwapPath -ne 'none' -or $companionVisual.spriteFrameSwap -ne 'false' -or $companionVisual.speechTiming -ne 'sanitized-playback-amplitude-envelope' -or $companionVisual.motionMode -ne 'smooth-state-transitions-plus-voice-reactive-core' -or $companionVisual.voiceReactiveCore -ne 'sanitized-playback-energy-only' -or $companionVisual.stableCenter -ne 'true' -or $companionVisual.rawAudioAccess -ne 'none' -or $companionVisual.true3dAcceptance -ne 'fail-temporary-orb-no-live-mesh' -or $companionVisual.webglScene -ne 'false' -or [int]$companionVisual.liveMeshCount -ne 0 -or [int]$companionVisual.meshRenderCalls -ne 0 -or [int]$companionVisual.motionTick -lt 15 -or $companionVisual.oldSpritePathMounted -or -not $companionVisual.accessibleStatus -or -not $companionVisual.runtimeObserved) { throw 'The packaged temporary orb did not prove stable runtime state, voice-reactive-core evidence, accessible status, sprite-path exclusion, and an explicit failing true-3D gate.' }
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
    scope = 'Exact executable and upstream Electron provenance, Authenticode states, authored resources, setup ZIP/sidecar/receipts, and one bounded actual packaged-process smoke.'
    exclusions = @(
        'This verification receipt excludes itself to avoid self-hash recursion. configuredSecurity records requested settings rather than independently proving Chromium internals.',
        'Windows builds 26200-26399 use a disclosed Electron child-process compatibility boundary: GPU and renderer process sandboxes are disabled while context isolation remains enabled, Node integration and webviews remain disabled, navigation remains fixed to 127.0.0.1, and external renderer requests remain blocked.'
    )
    artifacts = [ordered]@{
        executable = [ordered]@{ path = 'release/win-unpacked/WellbeingCompanionWorkingTitle.exe'; bytes = [long](Get-Item -LiteralPath $executablePath).Length; sha256 = $executableHash; signatureStatus = $signature.Status.ToString(); signerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }; signerThumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint.ToUpperInvariant() } else { $null } }
        buildReceipt = [ordered]@{ path = 'release/win-unpacked/BUILD-RECEIPT.json'; bytes = [long](Get-Item -LiteralPath $buildReceiptPath).Length; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $buildReceiptPath).Hash.ToUpperInvariant() }
        setupZip = [ordered]@{ path = "release/$([IO.Path]::GetFileName($setupZip))"; bytes = [long](Get-Item -LiteralPath $setupZip).Length; sha256 = $setupHash }
        setupSidecar = [ordered]@{ path = "release/$([IO.Path]::GetFileName($sidecarPath))"; bytes = [long](Get-Item -LiteralPath $sidecarPath).Length; sha256 = $sidecarHash }
        packageReceipt = [ordered]@{ path = "release/$([IO.Path]::GetFileName($packageReceiptPath))"; bytes = [long](Get-Item -LiteralPath $packageReceiptPath).Length; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $packageReceiptPath).Hash.ToUpperInvariant() }
        smokeReceipt = [ordered]@{ path = 'wellbeing-companion-desktop.smoke.json'; bytes = [long](Get-Item -LiteralPath $smokePath).Length; sha256 = $smokeHash }
        setupLauncher = [ordered]@{ path = "setup/SETUP-WELLBEING-COMPANION.exe"; bytes = [long]$launcherItem.Length; sha256 = $launcherHash; signatureStatus = $launcherSignature.Status.ToString(); signerSubject = if ($launcherSignature.SignerCertificate) { $launcherSignature.SignerCertificate.Subject } else { $null }; signerThumbprint = if ($launcherSignature.SignerCertificate) { $launcherSignature.SignerCertificate.Thumbprint.ToUpperInvariant() } else { $null } }
    }
    releaseSecurityEvidence = [ordered]@{
        officialElectronVersion = $expectedElectronVersion
        officialElectronArchiveSha256 = $actualElectronArchiveHash
        officialElectronExecutableSha256 = $expectedOfficialElectronExecutableSha256
        officialElectronExecutableSignatureStatus = [string]$releaseSecurity.officialElectronHost.authenticodeStatus
        selectedRuntimeSource = [string]$selectedRuntime.source
        runtimeSha256 = $executableHash
        runtimeSignatureStatus = $signature.Status.ToString()
        runtimeSignerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
        runtimeSignerThumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint.ToUpperInvariant() } else { $null }
        runtimeByteIdentityPreserved = [bool]$selectedRuntime.byteIdentityPreserved
        resourceMutationApplied = [bool]$selectedRuntime.resourceMutationApplied
        fileRenameApplied = [bool]$selectedRuntime.fileRenameApplied
        renameChangedBytes = [bool]$selectedRuntime.renameChangedBytes
        setupLauncherSha256 = $launcherHash
        setupLauncherSignatureStatus = $launcherSignature.Status.ToString()
        setupLauncherSignerSubject = if ($launcherSignature.SignerCertificate) { $launcherSignature.SignerCertificate.Subject } else { $null }
        normalSecurityBypassUsed = $false
        publicReleaseTrusted = [bool]($signature.Status -eq 'Valid' -and $launcherSignature.Status -eq 'Valid')
        publicReleaseHoldReason = if ($signature.Status -eq 'Valid' -and $launcherSignature.Status -eq 'Valid') { $null } else { 'The exact runtime and setup launcher do not both have valid publisher Authenticode chains. Microsoft Store signing of an accepted MSIX or an external publisher signing identity is required for normal public distribution.' }
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
    localSpeechProviderAssets = $localSpeechProviderAssets
    pwaInstallability = $pwaInstallabilityEvidence
    temporaryOrbVisual = [ordered]@{ renderer = 'reactive-css-orb-2d'; presentation = 'temporary-orb-not-3d-character'; spriteAssetPackaged = $false; imageSwapPath = 'none'; true3dAcceptance = 'FAIL'; true3dReason = 'No live WebGL mesh or licensed owner GLB is present in this orb candidate.' }
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
    RuntimeSource = [string]$selectedRuntime.source
    RuntimeByteIdentityPreserved = [bool]$selectedRuntime.byteIdentityPreserved
    RuntimeResourceMutationApplied = [bool]$selectedRuntime.resourceMutationApplied
    OfficialElectronHostSignatureStatus = [string]$releaseSecurity.officialElectronHost.authenticodeStatus
    SetupLauncherSignatureStatus = $launcherSignature.Status
    PublicReleaseTrusted = [bool]($signature.Status -eq 'Valid' -and $launcherSignature.Status -eq 'Valid')
    NormalSecurityBypassUsed = $false
    SetupZip = $setupZip
    SetupZipSha256 = $setupHash
    SmokeStatus = $smoke.status
    WindowCreated = $smoke.windowCreated
    TrayCreated = $smoke.trayCreated
    RendererLoaded = $smoke.rendererLoaded
    OfflineRuntime = $smoke.bundledRuntimeEvidence
    PermissionBoundary = $smoke.permissionBoundary
    PwaInstallability = $pwaInstallabilityEvidence
    SmokeExecutionSource = 'checksum-verified extracted setup payload'
    VerificationReceipt = $verificationPath
    RunId = $RunId
}
