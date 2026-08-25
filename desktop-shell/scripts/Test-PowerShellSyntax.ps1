[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$errors = @()
Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1' -File | ForEach-Object {
    $tokens = $null
    $parseErrors = $null
    [Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$parseErrors) | Out-Null
    foreach ($parseError in $parseErrors) {
        $errors += "{0}:{1}:{2} {3}" -f $_.Name, $parseError.Extent.StartLineNumber, $parseError.Extent.StartColumnNumber, $parseError.Message
    }
}
if ($errors.Count -gt 0) { throw ($errors -join [Environment]::NewLine) }
'WELLBEING_COMPANION_POWERSHELL_SYNTAX_OK'
