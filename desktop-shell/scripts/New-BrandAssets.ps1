[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$assetRoot = Join-Path $projectRoot 'desktop\assets'
New-Item -ItemType Directory -Path $assetRoot -Force | Out-Null

function New-RoundedRectanglePath {
    param([float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Radius)
    $diameter = $Radius * 2
    $path = [Drawing.Drawing2D.GraphicsPath]::new()
    $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
    $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
    $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-CompanionBitmap {
    param([Parameter(Mandatory)] [int]$Size)
    $bitmap = [Drawing.Bitmap]::new($Size, $Size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.Clear([Drawing.Color]::Transparent)
        $scale = $Size / 64.0
        $background = New-RoundedRectanglePath -X 0 -Y 0 -Width $Size -Height $Size -Radius (15 * $scale)
        $backgroundBrush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#392043'))
        try { $graphics.FillPath($backgroundBrush, $background) } finally { $backgroundBrush.Dispose(); $background.Dispose() }

        $haloBrush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#f7d9e9'))
        try { $graphics.FillEllipse($haloBrush, 10 * $scale, 10 * $scale, 44 * $scale, 44 * $scale) } finally { $haloBrush.Dispose() }

        $lanternPath = New-RoundedRectanglePath -X (21 * $scale) -Y (20 * $scale) -Width (22 * $scale) -Height (27 * $scale) -Radius (7 * $scale)
        $lanternBrush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#9b4f8d'))
        try { $graphics.FillPath($lanternBrush, $lanternPath) } finally { $lanternBrush.Dispose(); $lanternPath.Dispose() }

        $lightBrush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#fff5bf'))
        try { $graphics.FillEllipse($lightBrush, 27 * $scale, 27 * $scale, 10 * $scale, 10 * $scale) } finally { $lightBrush.Dispose() }

        $linePen = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#5d2a62'), [Math]::Max(1, 3 * $scale))
        try {
            $linePen.StartCap = [Drawing.Drawing2D.LineCap]::Round
            $linePen.EndCap = [Drawing.Drawing2D.LineCap]::Round
            $graphics.DrawArc($linePen, 24 * $scale, 12 * $scale, 16 * $scale, 17 * $scale, 190, 160)
            $graphics.DrawLine($linePen, 24 * $scale, 50 * $scale, 40 * $scale, 50 * $scale)
        } finally { $linePen.Dispose() }

        $sparkBrush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#6ad6d1'))
        try {
            $graphics.FillEllipse($sparkBrush, 47 * $scale, 13 * $scale, 5 * $scale, 5 * $scale)
            $graphics.FillEllipse($sparkBrush, 13 * $scale, 43 * $scale, 4 * $scale, 4 * $scale)
        } finally { $sparkBrush.Dispose() }
    } finally { $graphics.Dispose() }
    return $bitmap
}

$pngPath = Join-Path $assetRoot 'wellbeing-companion-icon.png'
$pngBitmap = New-CompanionBitmap -Size 512
try { $pngBitmap.Save($pngPath, [Drawing.Imaging.ImageFormat]::Png) } finally { $pngBitmap.Dispose() }

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = foreach ($size in $sizes) {
    $bitmap = New-CompanionBitmap -Size $size
    $stream = [IO.MemoryStream]::new()
    try {
        $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
        [pscustomobject]@{ Size = $size; Bytes = $stream.ToArray() }
    } finally {
        $stream.Dispose()
        $bitmap.Dispose()
    }
}

$icoPath = Join-Path $assetRoot 'WellbeingCompanionWorkingTitle.ico'
$file = [IO.File]::Open($icoPath, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
$writer = [IO.BinaryWriter]::new($file)
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$images.Count)
    $offset = 6 + (16 * $images.Count)
    foreach ($image in $images) {
        $dimensionByte = if ($image.Size -eq 256) { 0 } else { $image.Size }
        $writer.Write([byte]$dimensionByte)
        $writer.Write([byte]$dimensionByte)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$image.Bytes.Length)
        $writer.Write([uint32]$offset)
        $offset += $image.Bytes.Length
    }
    foreach ($image in $images) { $writer.Write([byte[]]$image.Bytes) }
} finally {
    $writer.Dispose()
    $file.Dispose()
}

[pscustomobject]@{
    Png = $pngPath
    PngSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $pngPath).Hash
    Ico = $icoPath
    IcoSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $icoPath).Hash
    Sizes = $sizes -join ', '
}
