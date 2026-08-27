[CmdletBinding()]
param(
    [Parameter()]
    [switch]$SkipDesktop,

    [Parameter()]
    [switch]$AcceptVerifiedUnsignedRuntime,

    [Parameter()]
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$productId = 'com.kiralabs.wellbeing-companion-working-title'

function Get-RequiredKnownFolder {
    param([Parameter(Mandatory)] [Environment+SpecialFolder]$Folder)
    $value = [Environment]::GetFolderPath($Folder)
    if ([string]::IsNullOrWhiteSpace($value) -or -not [IO.Path]::IsPathRooted($value)) { throw "Windows did not return a safe path for $Folder." }
    return [IO.Path]::GetFullPath($value).TrimEnd('\')
}

function Assert-NotReparsePoint {
    param([Parameter(Mandatory)] [string]$Path)
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing to use a reparse-point WellbeingCompanion directory: $Path" }
    }
}

function Assert-NoReparsePointTree {
    param([Parameter(Mandatory)] [string]$Root)
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return }
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($Root)
    while ($pending.Count -gt 0) {
        $current = $pending.Pop()
        $item = Get-Item -LiteralPath $current -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing a WellbeingCompanion payload or directory reparse point: $current" }
        foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($current)) {
            $entryItem = Get-Item -LiteralPath $entry -Force
            if (($entryItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing a WellbeingCompanion tree containing a reparse point: $entry" }
            if ($entryItem.PSIsContainer) { $pending.Push($entry) }
        }
    }
}

function Get-SafeManifestPath {
    param([Parameter(Mandatory)] [string]$Root, [Parameter(Mandatory)] [string]$RelativePath)
    if ([string]::IsNullOrWhiteSpace($RelativePath) -or [IO.Path]::IsPathRooted($RelativePath)) {
        throw "Setup receipt contains an unsafe path: $RelativePath"
    }
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $candidate = [IO.Path]::GetFullPath((Join-Path $rootFull $RelativePath.Replace('/', '\')))
    if (-not $candidate.StartsWith("$rootFull\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Setup receipt path escaped its package root: $RelativePath"
    }
    return $candidate
}

function Assert-SetupReceipt {
    param([Parameter(Mandatory)] [string]$Root, [Parameter(Mandatory)] [string]$ReceiptPath)
    $setupReceipt = Get-Content -LiteralPath $ReceiptPath -Raw | ConvertFrom-Json
    if ($setupReceipt.schema -ne 1 -or $setupReceipt.product -ne 'Wellbeing companion working-title Windows setup' -or $setupReceipt.algorithm -ne 'SHA-256') {
        throw 'The WellbeingCompanion setup receipt is invalid.'
    }
    $recorded = @{}
    foreach ($record in @($setupReceipt.files)) {
        $relativePath = ([string]$record.path).Replace('\', '/')
        $key = $relativePath.ToLowerInvariant()
        if ($recorded.ContainsKey($key)) { throw "The setup receipt contains a duplicate path: $relativePath" }
        $recorded[$key] = $true
        $fullPath = Get-SafeManifestPath -Root $Root -RelativePath $relativePath
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "The setup package is missing a receipt-bound file: $relativePath" }
        $item = Get-Item -LiteralPath $fullPath -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "The setup package contains a receipt-bound reparse point: $relativePath" }
        if ([long]$record.bytes -ne [long]$item.Length) { throw "The setup package byte count does not match its receipt: $relativePath" }
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $fullPath).Hash.ToUpperInvariant() -ne ([string]$record.sha256).ToUpperInvariant()) {
            throw "The setup package SHA-256 does not match its receipt: $relativePath"
        }
    }
    $actual = @()
    foreach ($file in Get-ChildItem -LiteralPath $Root -File -Recurse | Sort-Object FullName) {
        $relativePath = $file.FullName.Substring(([IO.Path]::GetFullPath($Root).TrimEnd('\')).Length + 1).Replace('\', '/')
        if ($relativePath -ne 'SETUP-RECEIPT.json') { $actual += $relativePath.ToLowerInvariant() }
    }
    $recordedPaths = @($recorded.Keys | Sort-Object)
    $actualPaths = @($actual | Sort-Object -Unique)
    if ($actualPaths.Count -ne $recordedPaths.Count -or (Compare-Object -ReferenceObject $actualPaths -DifferenceObject $recordedPaths)) {
        throw 'The extracted setup file scope does not exactly match SETUP-RECEIPT.json.'
    }
}

function Assert-DirectoryClaimable {
    param([Parameter(Mandatory)] [string]$Path)
    Assert-NotReparsePoint -Path $Path
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return }
    $markerPath = Join-Path $Path '.wellbeing-companion-owner.json'
    if (Test-Path -LiteralPath $markerPath -PathType Leaf) {
        $existing = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        $markedRoot = [IO.Path]::GetFullPath([string]$existing.root).TrimEnd('\')
        if ($existing.schema -ne 1 -or $existing.productId -ne $productId -or -not $markedRoot.Equals([IO.Path]::GetFullPath($Path).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
            throw "The existing WellbeingCompanion ownership marker is invalid: $markerPath"
        }
        return
    }
    if (@(Get-ChildItem -LiteralPath $Path -Force).Count -gt 0) {
        throw "Refusing to claim an existing unmarked directory as WellbeingCompanion-owned: $Path"
    }
}

function Assert-ShortcutOwnedOrAbsent {
    param([Parameter(Mandatory)] [string]$Path, [Parameter(Mandatory)] [string]$ExpectedTarget)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Refusing to replace a non-file shortcut path: $Path" }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing to replace a reparse-point shortcut: $Path" }
    $shortcutShell = New-Object -ComObject WScript.Shell
    $shortcut = $shortcutShell.CreateShortcut($Path)
    $actualTarget = [IO.Path]::GetFullPath([string]$shortcut.TargetPath)
    if (-not $actualTarget.Equals([IO.Path]::GetFullPath($ExpectedTarget), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to replace a shortcut that is not owned by this WellbeingCompanion install: $Path"
    }
}

function Assert-UninstallRegistryOwnedOrAbsent {
    param([Parameter(Mandatory)] [string]$Path, [Parameter(Mandatory)] [string]$ExpectedInstallFolder)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $existing = Get-ItemProperty -LiteralPath $Path
    $existingInstall = [IO.Path]::GetFullPath([string]$existing.InstallLocation).TrimEnd('\')
    if ($existing.WellbeingCompanionProductId -ne $productId -or $existing.WellbeingCompanionOwnershipSchema -ne 1 -or
        -not $existingInstall.Equals([IO.Path]::GetFullPath($ExpectedInstallFolder).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to replace an uninstall registry key not provably owned by this WellbeingCompanion install: $Path"
    }
}

function Initialize-OwnedDirectory {
    param([Parameter(Mandatory)] [string]$Path)
    Assert-NotReparsePoint -Path $Path
    $directoryAlreadyExisted = Test-Path -LiteralPath $Path -PathType Container
    $markerPath = Join-Path $Path '.wellbeing-companion-owner.json'
    if ($directoryAlreadyExisted -and (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        $existing = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        $markedRoot = [IO.Path]::GetFullPath([string]$existing.root).TrimEnd('\')
        if ($existing.schema -ne 1 -or $existing.productId -ne $productId -or -not $markedRoot.Equals([IO.Path]::GetFullPath($Path).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
            throw "The existing WellbeingCompanion ownership marker is invalid: $markerPath"
        }
        return
    }
    if ($directoryAlreadyExisted -and @(Get-ChildItem -LiteralPath $Path -Force).Count -gt 0) {
        throw "Refusing to claim an existing unmarked directory as WellbeingCompanion-owned: $Path"
    }
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    [ordered]@{ schema = 1; productId = $productId; root = [IO.Path]::GetFullPath($Path).TrimEnd('\') } |
        ConvertTo-Json | Set-Content -LiteralPath $markerPath -Encoding utf8
}

$setupRoot = Split-Path -Parent $PSScriptRoot
$payloadRoot = Join-Path $setupRoot 'Payload'
$sourceExecutable = Join-Path $payloadRoot 'WellbeingCompanionWorkingTitle.exe'
$sourceReceipt = Join-Path $payloadRoot 'BUILD-RECEIPT.json'
$sourceUninstaller = Join-Path $PSScriptRoot 'Uninstall-WellbeingCompanion.ps1'
$setupReceiptPath = Join-Path $setupRoot 'SETUP-RECEIPT.json'
foreach ($requiredFile in @($sourceExecutable, $sourceReceipt, $sourceUninstaller, $setupReceiptPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) { throw "The WellbeingCompanion setup payload is incomplete: $requiredFile" }
}
Assert-NoReparsePointTree -Root $payloadRoot
Assert-SetupReceipt -Root $setupRoot -ReceiptPath $setupReceiptPath
$signature = Get-AuthenticodeSignature -LiteralPath $sourceExecutable
$receipt = Get-Content -LiteralPath $sourceReceipt -Raw | ConvertFrom-Json
if ($receipt.product -ne 'Wellbeing companion working-title desktop shell') { throw 'The wellbeing companion build receipt is invalid.' }
$actualExecutableHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourceExecutable).Hash.ToUpperInvariant()
if ($actualExecutableHash -ne ([string]$receipt.executableSha256).ToUpperInvariant()) { throw 'The WellbeingCompanion executable does not match its build receipt.' }
if ($signature.Status.ToString() -ne [string]$receipt.executableSignatureStatus -or $signature.Status -notin @('Valid', 'NotSigned')) {
    throw "The WellbeingCompanion runtime signature state does not match its build receipt (actual: $($signature.Status))."
}
if ($VerifyOnly) {
    [pscustomobject]@{
        Status = 'VerifiedOnly'
        SetupRoot = $setupRoot
        ExecutableSha256 = $actualExecutableHash
        SignatureStatus = $signature.Status.ToString()
        RealUserProfileMutated = $false
    }
    return
}
if ($signature.Status -eq 'NotSigned' -and -not $AcceptVerifiedUnsignedRuntime) {
    $choice = $Host.UI.PromptForChoice(
        'Unsigned WellbeingCompanion runtime',
        'This package matches its SHA-256 build receipt, but WellbeingCompanionWorkingTitle.exe is not Authenticode publisher-signed. Install this verified development build anyway?',
        @(
            [Management.Automation.Host.ChoiceDescription]::new('&Install verified development build', 'Installs the checksum-verified but unsigned runtime.'),
            [Management.Automation.Host.ChoiceDescription]::new('&Cancel', 'Leaves the computer unchanged.')
        ),
        1
    )
    if ($choice -ne 0) { return }
}

$localAppData = Get-RequiredKnownFolder -Folder LocalApplicationData
$roamingAppData = Get-RequiredKnownFolder -Folder ApplicationData
$programsRoot = Get-RequiredKnownFolder -Folder Programs
$desktopRoot = Get-RequiredKnownFolder -Folder Desktop
$installParent = Join-Path $localAppData 'Programs'
$installFolder = Join-Path $installParent 'WellbeingCompanionWorkingTitle'
$stagingFolder = Join-Path $installParent ("WellbeingCompanionWorkingTitle.install-{0}" -f $PID)
$localDataRoot = Join-Path $localAppData 'WellbeingCompanionWorkingTitle'
$roamingDataRoot = Join-Path $roamingAppData 'WellbeingCompanionWorkingTitle'
$startMenuFolder = Join-Path $programsRoot 'Wellbeing Companion (Working Title)'
$installedExecutable = Join-Path $installFolder 'WellbeingCompanionWorkingTitle.exe'
$desktopShortcut = Join-Path $desktopRoot 'Wellbeing Companion (Working Title).lnk'
$uninstallRegistryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WellbeingCompanionWorkingTitle'

foreach ($target in @($installFolder, $stagingFolder, $localDataRoot, $roamingDataRoot, $startMenuFolder)) { Assert-NotReparsePoint -Path $target }
if (Test-Path -LiteralPath $installFolder) { throw 'Wellbeing Companion is already installed. Uninstall the program first; preserved private local data will remain available.' }
if (Test-Path -LiteralPath $stagingFolder) { throw "Refusing to reuse an unexpected staging directory: $stagingFolder" }

# Ownership preflight finishes before the installer writes any program, data,
# shortcut, or registry state.
foreach ($claimableRoot in @($localDataRoot, $roamingDataRoot, $startMenuFolder)) { Assert-DirectoryClaimable -Path $claimableRoot }
if (-not $SkipDesktop) { Assert-ShortcutOwnedOrAbsent -Path $desktopShortcut -ExpectedTarget $installedExecutable }
Assert-UninstallRegistryOwnedOrAbsent -Path $uninstallRegistryPath -ExpectedInstallFolder $installFolder

New-Item -ItemType Directory -Path $stagingFolder -Force | Out-Null
foreach ($entry in Get-ChildItem -LiteralPath $payloadRoot -Force) { Copy-Item -LiteralPath $entry.FullName -Destination $stagingFolder -Recurse }
Copy-Item -LiteralPath $sourceUninstaller -Destination (Join-Path $stagingFolder 'Uninstall-WellbeingCompanion.ps1')
[ordered]@{ schema = 1; productId = $productId; root = [IO.Path]::GetFullPath($installFolder).TrimEnd('\') } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stagingFolder '.wellbeing-companion-owner.json') -Encoding utf8
Move-Item -LiteralPath $stagingFolder -Destination $installFolder

Initialize-OwnedDirectory -Path $localDataRoot
Initialize-OwnedDirectory -Path $roamingDataRoot
Initialize-OwnedDirectory -Path $startMenuFolder

$installedIcon = Join-Path $installFolder 'resources\app\desktop\assets\WellbeingCompanionWorkingTitle.ico'
$installedUninstaller = Join-Path $installFolder 'Uninstall-WellbeingCompanion.ps1'
if (-not (Test-Path -LiteralPath $installedIcon -PathType Leaf)) { throw 'The installed WellbeingCompanion icon is missing.' }

$shell = New-Object -ComObject WScript.Shell
$shortcutPaths = @(Join-Path $startMenuFolder 'Wellbeing Companion (Working Title).lnk')
if (-not $SkipDesktop) { $shortcutPaths += Join-Path $desktopRoot 'Wellbeing Companion (Working Title).lnk' }
foreach ($shortcutPath in $shortcutPaths) {
    if ($shortcutPath.Equals($desktopShortcut, [StringComparison]::OrdinalIgnoreCase)) {
        Assert-ShortcutOwnedOrAbsent -Path $desktopShortcut -ExpectedTarget $installedExecutable
    }
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $installedExecutable
    $shortcut.WorkingDirectory = $installFolder
    $shortcut.IconLocation = "$installedIcon,0"
    $shortcut.Description = 'Open the local-first wellbeing companion in its own desktop window'
    $shortcut.Save()
}

$systemRoot = Get-RequiredKnownFolder -Folder System
$powerShellPath = Join-Path $systemRoot 'WindowsPowerShell\v1.0\powershell.exe'
$uninstallShortcut = $shell.CreateShortcut((Join-Path $startMenuFolder 'Uninstall Wellbeing Companion (Working Title).lnk'))
$uninstallShortcut.TargetPath = $powerShellPath
$uninstallShortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File `"$installedUninstaller`""
$uninstallShortcut.WorkingDirectory = $systemRoot
$uninstallShortcut.IconLocation = "$installedIcon,0"
$uninstallShortcut.Description = 'Uninstall the wellbeing companion and choose whether to preserve private local data'
$uninstallShortcut.Save()

Assert-UninstallRegistryOwnedOrAbsent -Path $uninstallRegistryPath -ExpectedInstallFolder $installFolder
New-Item -Path $uninstallRegistryPath -Force | Out-Null
New-ItemProperty -Path $uninstallRegistryPath -Name WellbeingCompanionProductId -Value $productId -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallRegistryPath -Name WellbeingCompanionOwnershipSchema -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $uninstallRegistryPath -Name DisplayName -Value 'Wellbeing Companion — Working Title' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallRegistryPath -Name DisplayVersion -Value ([string]$receipt.packageVersion) -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallRegistryPath -Name Publisher -Value 'Kira Labs' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallRegistryPath -Name DisplayIcon -Value "`"$installedIcon`",0" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallRegistryPath -Name InstallLocation -Value $installFolder -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallRegistryPath -Name UninstallString -Value "`"$powerShellPath`" -NoProfile -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File `"$installedUninstaller`"" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallRegistryPath -Name QuietUninstallString -Value "`"$powerShellPath`" -NoProfile -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File `"$installedUninstaller`" -PreserveData" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallRegistryPath -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $uninstallRegistryPath -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null

[pscustomobject]@{
    Status = 'Installed'
    Executable = $installedExecutable
    StartMenuShortcut = Join-Path $startMenuFolder 'Wellbeing Companion (Working Title).lnk'
    DesktopShortcut = if ($SkipDesktop) { $null } else { Join-Path $desktopRoot 'Wellbeing Companion (Working Title).lnk' }
    PrivateDataPolicy = 'Preserved by default during uninstall'
    RoamingDataRoot = $roamingDataRoot
    LocalDataRoot = $localDataRoot
}
