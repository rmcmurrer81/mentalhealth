[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executablePath = Join-Path $projectRoot 'release\win-unpacked\WellbeingCompanionWorkingTitle.exe'
if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
    throw "The unpacked development executable does not exist: $executablePath"
}
Start-Process -FilePath $executablePath -WorkingDirectory (Split-Path -Parent $executablePath) -WindowStyle Hidden
