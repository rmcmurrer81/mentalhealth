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
$interactiveUninstall = -not $PreserveData -and -not $RemoveAllData

if ($interactiveUninstall) {
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms

    $form = [Windows.Forms.Form]::new()
    $form.Text = 'Uninstall Wellbeing Companion'
    $form.ClientSize = [Drawing.Size]::new(560, 238)
    $form.StartPosition = [Windows.Forms.FormStartPosition]::CenterScreen
    $form.FormBorderStyle = [Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.ShowIcon = $false
    $form.BackColor = [Drawing.Color]::FromArgb(247, 249, 255)

    $heading = [Windows.Forms.Label]::new()
    $heading.Text = 'Uninstall Wellbeing Companion?'
    $heading.Font = [Drawing.Font]::new('Segoe UI', 15, [Drawing.FontStyle]::Bold)
    $heading.ForeColor = [Drawing.Color]::FromArgb(31, 29, 66)
    $heading.AutoSize = $true
    $heading.Location = [Drawing.Point]::new(24, 22)
    $form.Controls.Add($heading)

    $copy = [Windows.Forms.Label]::new()
    $copy.Text = 'Choose whether a future reinstall should remember your private conversations, memories, settings, and offline files.'
    $copy.Font = [Drawing.Font]::new('Segoe UI', 10)
    $copy.ForeColor = [Drawing.Color]::FromArgb(72, 69, 92)
    $copy.Location = [Drawing.Point]::new(26, 62)
    $copy.Size = [Drawing.Size]::new(508, 48)
    $form.Controls.Add($copy)

    $preserveButton = [Windows.Forms.Button]::new()
    $preserveButton.Text = 'Uninstall and keep my data'
    $preserveButton.DialogResult = [Windows.Forms.DialogResult]::Yes
    $preserveButton.Font = [Drawing.Font]::new('Segoe UI', 9, [Drawing.FontStyle]::Bold)
    $preserveButton.Location = [Drawing.Point]::new(26, 132)
    $preserveButton.Size = [Drawing.Size]::new(206, 40)
    $form.Controls.Add($preserveButton)

    $removeButton = [Windows.Forms.Button]::new()
    $removeButton.Text = 'Uninstall and delete all data'
    $removeButton.DialogResult = [Windows.Forms.DialogResult]::No
    $removeButton.Font = [Drawing.Font]::new('Segoe UI', 9)
    $removeButton.Location = [Drawing.Point]::new(240, 132)
    $removeButton.Size = [Drawing.Size]::new(206, 40)
    $form.Controls.Add($removeButton)

    $cancelButton = [Windows.Forms.Button]::new()
    $cancelButton.Text = 'Cancel'
    $cancelButton.DialogResult = [Windows.Forms.DialogResult]::Cancel
    $cancelButton.Location = [Drawing.Point]::new(454, 132)
    $cancelButton.Size = [Drawing.Size]::new(80, 40)
    $form.Controls.Add($cancelButton)

    $form.AcceptButton = $preserveButton
    $form.CancelButton = $cancelButton
    $choice = $form.ShowDialog()
    $form.Dispose()
    if ($choice -notin @([Windows.Forms.DialogResult]::Yes, [Windows.Forms.DialogResult]::No)) { return }
    $RemoveAllData = $choice -eq [Windows.Forms.DialogResult]::No
    $PreserveData = $choice -eq [Windows.Forms.DialogResult]::Yes
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
$uninstallArguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File `"$installedUninstaller`""
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
$expectedExecutablePath = [IO.Path]::GetFullPath($installedExecutable)
$ownedRunningProcesses = @()
foreach ($process in $running) {
    if ([string]::IsNullOrWhiteSpace([string]$process.ExecutablePath)) {
        throw "Cannot safely identify a running Wellbeing Companion process. Close it manually and retry. Nothing was removed. Process id: $($process.ProcessId)"
    }
    $processExecutablePath = [IO.Path]::GetFullPath([string]$process.ExecutablePath)
    if ($processExecutablePath.Equals($expectedExecutablePath, [StringComparison]::OrdinalIgnoreCase)) {
        $ownedRunningProcesses += $process
    }
}

# A normal uninstall closes only the exact executable owned by this verified install.
# It never stops a same-named process from another directory.
foreach ($process in $ownedRunningProcesses) {
    Stop-Process -Id ([int]$process.ProcessId) -ErrorAction Stop
}
foreach ($process in $ownedRunningProcesses) {
    try {
        Wait-Process -Id ([int]$process.ProcessId) -Timeout 8 -ErrorAction Stop
    } catch {
        Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
        Wait-Process -Id ([int]$process.ProcessId) -Timeout 4 -ErrorAction SilentlyContinue
    }
}

try {
    $stillRunning = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
        $_.Name -eq 'WellbeingCompanionWorkingTitle.exe' -and
        -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
        [IO.Path]::GetFullPath([string]$_.ExecutablePath).Equals($expectedExecutablePath, [StringComparison]::OrdinalIgnoreCase)
    })
} catch {
    throw "Cannot safely confirm Wellbeing Companion closed after requesting shutdown. Nothing was removed. $($_.Exception.Message)"
}
if ($stillRunning.Count -gt 0) { throw 'Wellbeing Companion did not close cleanly, so uninstall stopped before removing files.' }

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

if ($interactiveUninstall) {
    [Windows.Forms.MessageBox]::Show(
        'Wellbeing Companion was uninstalled.',
        'Uninstall complete',
        [Windows.Forms.MessageBoxButtons]::OK,
        [Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
}

[pscustomobject]@{
    Status = 'Uninstalled'
    PrivateDataPreserved = [bool]$PreserveData
    ReinstallCanRecoverPrivateData = [bool]$PreserveData
}
