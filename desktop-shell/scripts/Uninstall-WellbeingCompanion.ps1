[CmdletBinding()]
param(
    [Parameter()]
    [switch]$PreserveData,

    [Parameter()]
    [switch]$RemoveAllData
)

$ErrorActionPreference = 'Stop'
$productId = 'com.kiralabs.wellbeing-companion-working-title'
if ($PreserveData -and $RemoveAllData) { throw 'Choose either PreserveData or RemoveAllData, not both.' }

if (-not $PreserveData -and -not $RemoveAllData) {
    $choice = $Host.UI.PromptForChoice(
        'Uninstall Wellbeing Companion',
        'Remove the wellbeing companion. What should happen to private memories, conversation history, settings, and offline files?',
        @(
            [Management.Automation.Host.ChoiceDescription]::new('&Preserve private local data', 'Default: removes the program and shortcuts but keeps private memories, conversation history, settings, and offline files for a future reinstall.'),
            [Management.Automation.Host.ChoiceDescription]::new('Remove &all companion data', 'Permanently removes the program, private memories, conversation history, settings, and offline files.'),
            [Management.Automation.Host.ChoiceDescription]::new('&Cancel', 'Leaves Wellbeing Companion installed.')
        ),
        0
    )
    if ($choice -eq 2) { return }
    $RemoveAllData = $choice -eq 1
    $PreserveData = $choice -eq 0
}

function Get-RequiredKnownFolder {
    param([Parameter(Mandatory)] [Environment+SpecialFolder]$Folder)
    $value = [Environment]::GetFolderPath($Folder)
    if ([string]::IsNullOrWhiteSpace($value) -or -not [IO.Path]::IsPathRooted($value)) { throw "Windows did not return a safe path for $Folder." }
    return [IO.Path]::GetFullPath($value).TrimEnd('\')
}

function Get-ExactChild {
    param([Parameter(Mandatory)] [string]$BasePath, [Parameter(Mandatory)] [string]$RelativePath)
    $baseFull = [IO.Path]::GetFullPath($BasePath).TrimEnd('\')
    $candidate = [IO.Path]::GetFullPath((Join-Path $baseFull $RelativePath)).TrimEnd('\')
    if (-not $candidate.StartsWith("$baseFull\", [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing a path outside its exact known-folder root: $candidate" }
    return $candidate
}

function Assert-NoReparsePointTree {
    param([Parameter(Mandatory)] [string]$Root)
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return }
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($Root)
    while ($pending.Count -gt 0) {
        $current = $pending.Pop()
        $item = Get-Item -LiteralPath $current -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing to recursively remove a reparse point: $current" }
        foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($current)) {
            $entryItem = Get-Item -LiteralPath $entry -Force
            if (($entryItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing to recursively remove a tree containing a reparse point: $entry" }
            if ($entryItem.PSIsContainer) { $pending.Push($entry) }
        }
    }
}

function Assert-OwnedWellbeingCompanionDirectory {
    param([Parameter(Mandatory)] [string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return }
    Assert-NoReparsePointTree -Root $Path
    $markerPath = Join-Path $Path '.wellbeing-companion-owner.json'
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { throw "Refusing to remove an unowned directory without a WellbeingCompanion marker: $Path" }
    $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    $markedRoot = [IO.Path]::GetFullPath([string]$marker.root).TrimEnd('\')
    $actualRoot = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if ($marker.schema -ne 1 -or $marker.productId -ne $productId -or -not $markedRoot.Equals($actualRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a directory with an invalid WellbeingCompanion marker: $Path"
    }
}

function Assert-OwnedShortcut {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$ExpectedTarget,
        [Parameter()] [AllowEmptyString()] [string]$ExpectedArguments = ''
    )
    if (-not (Test-Path -LiteralPath $Path)) { return }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Refusing a non-file shortcut path: $Path" }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing a reparse-point shortcut: $Path" }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $actualTarget = [IO.Path]::GetFullPath([string]$shortcut.TargetPath)
    if (-not $actualTarget.Equals([IO.Path]::GetFullPath($ExpectedTarget), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a shortcut that no longer belongs to WellbeingCompanion: $Path"
    }
    if (-not ([string]$shortcut.Arguments).Equals($ExpectedArguments, [StringComparison]::Ordinal)) {
        throw "Refusing to remove a shortcut whose arguments no longer belong to WellbeingCompanion: $Path"
    }
}

function Remove-PreflightedShortcut {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$ExpectedTarget,
        [Parameter()] [AllowEmptyString()] [string]$ExpectedArguments = ''
    )
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Assert-OwnedShortcut -Path $Path -ExpectedTarget $ExpectedTarget -ExpectedArguments $ExpectedArguments
    Remove-Item -LiteralPath $Path -Force
}

function Assert-OwnedUninstallRegistryKey {
    param([Parameter(Mandatory)] [string]$Path, [Parameter(Mandatory)] [string]$ExpectedInstallFolder)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $existing = Get-ItemProperty -LiteralPath $Path
    $existingInstall = [IO.Path]::GetFullPath([string]$existing.InstallLocation).TrimEnd('\')
    if ($existing.WellbeingCompanionProductId -ne $productId -or $existing.WellbeingCompanionOwnershipSchema -ne 1 -or
        -not $existingInstall.Equals([IO.Path]::GetFullPath($ExpectedInstallFolder).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove an uninstall registry key not provably owned by this WellbeingCompanion install: $Path"
    }
}

function Remove-PreflightedOwnedDirectory {
    param([Parameter(Mandatory)] [string]$Path)
    if (Test-Path -LiteralPath $Path -PathType Container) {
        Assert-OwnedWellbeingCompanionDirectory -Path $Path
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
}

$localAppData = Get-RequiredKnownFolder -Folder LocalApplicationData
$roamingAppData = Get-RequiredKnownFolder -Folder ApplicationData
$programsRoot = Get-RequiredKnownFolder -Folder Programs
$desktopRoot = Get-RequiredKnownFolder -Folder Desktop
$systemRoot = Get-RequiredKnownFolder -Folder System
$installFolder = Get-ExactChild -BasePath (Join-Path $localAppData 'Programs') -RelativePath 'WellbeingCompanionWorkingTitle'
$localDataRoot = Get-ExactChild -BasePath $localAppData -RelativePath 'WellbeingCompanionWorkingTitle'
$roamingDataRoot = Get-ExactChild -BasePath $roamingAppData -RelativePath 'WellbeingCompanionWorkingTitle'
$startMenuFolder = Get-ExactChild -BasePath $programsRoot -RelativePath 'Wellbeing Companion (Working Title)'
$installedExecutable = Join-Path $installFolder 'WellbeingCompanionWorkingTitle.exe'
$installedUninstaller = Join-Path $installFolder 'Uninstall-WellbeingCompanion.ps1'
$desktopShortcut = Join-Path $desktopRoot 'Wellbeing Companion (Working Title).lnk'
$startMenuShortcut = Join-Path $startMenuFolder 'Wellbeing Companion (Working Title).lnk'
$uninstallShortcut = Join-Path $startMenuFolder 'Uninstall Wellbeing Companion (Working Title).lnk'
$powerShellPath = Join-Path $systemRoot 'WindowsPowerShell\v1.0\powershell.exe'
$uninstallArguments = "-NoProfile -ExecutionPolicy RemoteSigned -File `"$installedUninstaller`""
$uninstallRegistryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WellbeingCompanionWorkingTitle'

# Preflight every destructive target before changing any state.
Assert-OwnedWellbeingCompanionDirectory -Path $installFolder
Assert-OwnedWellbeingCompanionDirectory -Path $startMenuFolder
if ($RemoveAllData) {
    Assert-OwnedWellbeingCompanionDirectory -Path $localDataRoot
    Assert-OwnedWellbeingCompanionDirectory -Path $roamingDataRoot
}
Assert-OwnedShortcut -Path $desktopShortcut -ExpectedTarget $installedExecutable
Assert-OwnedShortcut -Path $startMenuShortcut -ExpectedTarget $installedExecutable
Assert-OwnedShortcut -Path $uninstallShortcut -ExpectedTarget $powerShellPath -ExpectedArguments $uninstallArguments
Assert-OwnedUninstallRegistryKey -Path $uninstallRegistryPath -ExpectedInstallFolder $installFolder
try {
    $running = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -eq 'WellbeingCompanionWorkingTitle.exe' })
} catch {
    throw "Cannot safely prove Wellbeing Companion is closed; uninstall is refusing to continue. Nothing was removed. $($_.Exception.Message)"
}
if ($running.Count -gt 0) { throw 'Close Wellbeing Companion completely before uninstalling. Nothing was removed.' }

if ($RemoveAllData) {
    Remove-PreflightedOwnedDirectory -Path $localDataRoot
    Remove-PreflightedOwnedDirectory -Path $roamingDataRoot
}

Remove-PreflightedShortcut -Path $desktopShortcut -ExpectedTarget $installedExecutable
Remove-PreflightedOwnedDirectory -Path $startMenuFolder
Set-Location -LiteralPath $systemRoot
Remove-PreflightedOwnedDirectory -Path $installFolder

# Installed Apps discovery is removed last so a partial failure retains a retry route.
if (Test-Path -LiteralPath $uninstallRegistryPath) {
    Assert-OwnedUninstallRegistryKey -Path $uninstallRegistryPath -ExpectedInstallFolder $installFolder
    Remove-Item -LiteralPath $uninstallRegistryPath -Recurse -Force
}

[pscustomobject]@{
    Status = 'Uninstalled'
    PrivateDataPreserved = [bool]$PreserveData
    ReinstallCanRecoverPrivateData = [bool]$PreserveData
}
