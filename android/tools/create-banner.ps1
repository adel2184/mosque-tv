param(
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\res\drawable\tv_banner.png')
)

# Development only: Windows GDI+ shapes the Arabic text using the local Tahoma font.
# The APK uses the generated PNG directly; it does not require this script or font.
Add-Type -AssemblyName System.Drawing
$bannerBitmap = [Drawing.Bitmap]::new(320, 180)
$bannerGraphics = [Drawing.Graphics]::FromImage($bannerBitmap)
$bannerGraphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$bannerGraphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$bannerResources = [Collections.Generic.List[IDisposable]]::new()

function New-BannerBrush([string]$Color) {
    $resource = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($Color))
    $bannerResources.Add($resource)
    return $resource
}

function New-BannerPen([string]$Color, [single]$Width) {
    $resource = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml($Color), $Width)
    $resource.StartCap = [Drawing.Drawing2D.LineCap]::Round
    $resource.EndCap = [Drawing.Drawing2D.LineCap]::Round
    $resource.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
    $bannerResources.Add($resource)
    return $resource
}

try {
    $bannerGraphics.Clear([Drawing.ColorTranslator]::FromHtml('#080F14'))
    $panelBrush = New-BannerBrush '#10231F'
    $goldBrush = New-BannerBrush '#D0BB83'
    $warmBrush = New-BannerBrush '#EDE8DA'
    $mutedBrush = New-BannerBrush '#A3B9AA'
    $quietBrush = New-BannerBrush '#7D9987'
    $edgePen = New-BannerPen '#344E40' 1
    $goldPen = New-BannerPen '#C5AF76' 3.5
    $bannerGraphics.FillRectangle($panelBrush, 8, 8, 304, 164)
    $bannerGraphics.DrawRectangle($edgePen, 8, 8, 303, 163)
    $bannerGraphics.DrawLine((New-BannerPen '#84754D' 1), 108, 131, 291, 131)

    $markState = $bannerGraphics.Save()
    $bannerGraphics.TranslateTransform(7, 42)
    $bannerGraphics.ScaleTransform(0.49, 0.49)
    $bannerGraphics.DrawLine($goldPen, 29, 153, 163, 153)
    $bannerGraphics.DrawLine($goldPen, 40, 145, 40, 76)
    $bannerGraphics.DrawLine($goldPen, 152, 145, 152, 76)
    $bannerGraphics.DrawLine($goldPen, 34, 72, 46, 72)
    $bannerGraphics.DrawLine($goldPen, 146, 72, 158, 72)
    $bannerGraphics.DrawLine($goldPen, 40, 66, 40, 48)
    $bannerGraphics.DrawLine($goldPen, 152, 66, 152, 48)
    $bannerGraphics.DrawLine($goldPen, 36, 44, 44, 44)
    $bannerGraphics.DrawLine($goldPen, 148, 44, 156, 44)
    $domePath = [Drawing.Drawing2D.GraphicsPath]::new()
    $bannerResources.Add($domePath)
    $domePath.AddLine(56, 145, 56, 101)
    $domePath.AddBezier(56, 101, 56, 78, 78, 64, 96, 45)
    $domePath.AddBezier(96, 45, 114, 64, 136, 78, 136, 101)
    $domePath.AddLine(136, 101, 136, 145)
    $bannerGraphics.DrawPath($goldPen, $domePath)
    $doorPath = [Drawing.Drawing2D.GraphicsPath]::new()
    $bannerResources.Add($doorPath)
    $doorPath.AddLine(79, 145, 79, 113)
    $doorPath.AddBezier(79, 113, 79, 101, 88, 94, 96, 87)
    $doorPath.AddBezier(96, 87, 104, 94, 113, 101, 113, 113)
    $doorPath.AddLine(113, 113, 113, 145)
    $bannerGraphics.DrawPath($goldPen, $doorPath)
    $bannerGraphics.DrawLine($goldPen, 96, 43, 96, 39)
    $moonPath = [Drawing.Drawing2D.GraphicsPath]::new()
    $bannerResources.Add($moonPath)
    $moonPath.AddBezier(102, 18, 91, 22, 89, 36, 101, 40)
    $moonPath.AddBezier(101, 40, 85, 41, 81, 26, 91, 19)
    $moonPath.AddBezier(91, 19, 95, 17, 98, 17, 102, 18)
    $moonPath.CloseFigure()
    $bannerGraphics.FillPath($goldBrush, $moonPath)
    $bannerGraphics.Restore($markState)

    $rtlFormat = [Drawing.StringFormat]::new()
    $bannerResources.Add($rtlFormat)
    $rtlFormat.FormatFlags = [Drawing.StringFormatFlags]::DirectionRightToLeft
    $rtlFormat.Alignment = [Drawing.StringAlignment]::Center
    $rtlFormat.LineAlignment = [Drawing.StringAlignment]::Center
    $titleFont = [Drawing.Font]::new('Tahoma', 27, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
    $subtitleFont = [Drawing.Font]::new('Tahoma', 16, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $footnoteFont = [Drawing.Font]::new('Tahoma', 11, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $bannerResources.Add($titleFont)
    $bannerResources.Add($subtitleFont)
    $bannerResources.Add($footnoteFont)
    $bannerGraphics.DrawString('شاشة الجامع', $titleFont, $warmBrush, [Drawing.RectangleF]::new(99, 37, 200, 53), $rtlFormat)
    $bannerGraphics.DrawString('جامع لطيفة الخالدي', $subtitleFont, $mutedBrush, [Drawing.RectangleF]::new(100, 94, 198, 29), $rtlFormat)
    $bannerGraphics.DrawString('دون اتصال بالإنترنت', $footnoteFont, $quietBrush, [Drawing.RectangleF]::new(102, 136, 194, 22), $rtlFormat)

    $bannerOutput = [IO.Path]::GetFullPath($OutputPath)
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($bannerOutput)) | Out-Null
    $bannerBitmap.Save($bannerOutput, [Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Generated 320x180 TV banner: $bannerOutput"
}
finally {
    foreach ($resource in $bannerResources) { $resource.Dispose() }
    $bannerGraphics.Dispose()
    $bannerBitmap.Dispose()
}
