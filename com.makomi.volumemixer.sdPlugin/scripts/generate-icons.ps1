Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot

function New-Canvas($size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    return @{ Bitmap = $bmp; Graphics = $g }
}

function New-Brush($color) {
    return New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($color))
}

function New-Pen($color, $width) {
    $pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml($color)), $width
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    return $pen
}

function Draw-Base($g, $size, $accentA, $accentB) {
    $pad = $size * 0.08
    $rect = New-Object System.Drawing.RectangleF $pad, $pad, ($size - 2 * $pad), ($size - 2 * $pad)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect,
        ([System.Drawing.ColorTranslator]::FromHtml($accentA)),
        ([System.Drawing.ColorTranslator]::FromHtml($accentB)),
        45
    $g.FillEllipse($brush, $rect)
    $brush.Dispose()

    $ring = New-Pen "#ffffff" ($size * 0.045)
    $ring.Color = [System.Drawing.Color]::FromArgb(42, 255, 255, 255)
    $g.DrawEllipse($ring, $rect)
    $ring.Dispose()
}

function Draw-Speaker($g, $size) {
    $white = New-Brush "#f7fbff"
    $pen = New-Pen "#f7fbff" ($size * 0.065)
    $body = @(
        [System.Drawing.PointF]::new($size * 0.27, $size * 0.47),
        [System.Drawing.PointF]::new($size * 0.38, $size * 0.47),
        [System.Drawing.PointF]::new($size * 0.53, $size * 0.34),
        [System.Drawing.PointF]::new($size * 0.53, $size * 0.66),
        [System.Drawing.PointF]::new($size * 0.38, $size * 0.53),
        [System.Drawing.PointF]::new($size * 0.27, $size * 0.53)
    )
    $g.FillPolygon($white, $body)
    $g.DrawArc($pen, $size * 0.49, $size * 0.36, $size * 0.26, $size * 0.28, -45, 90)
    $g.DrawArc($pen, $size * 0.55, $size * 0.26, $size * 0.32, $size * 0.48, -45, 90)
    $white.Dispose()
    $pen.Dispose()
}

function Draw-Sliders($g, $size) {
    $line = New-Pen "#f7fbff" ($size * 0.055)
    $knob = New-Brush "#f7fbff"
    foreach ($x in @(0.31, 0.50, 0.69)) {
        $g.DrawLine($line, $size * $x, $size * 0.28, $size * $x, $size * 0.72)
    }
    $g.FillEllipse($knob, $size * 0.24, $size * 0.40, $size * 0.14, $size * 0.14)
    $g.FillEllipse($knob, $size * 0.43, $size * 0.56, $size * 0.14, $size * 0.14)
    $g.FillEllipse($knob, $size * 0.62, $size * 0.34, $size * 0.14, $size * 0.14)
    $line.Dispose()
    $knob.Dispose()
}

function Draw-WindowFocus($g, $size) {
    $pen = New-Pen "#f7fbff" ($size * 0.055)
    $fill = New-Brush "#f7fbff"
    $rect = New-Object System.Drawing.RectangleF ($size * 0.24), ($size * 0.30), ($size * 0.52), ($size * 0.38)
    $g.DrawRectangle($pen, $rect.X, $rect.Y, $rect.Width, $rect.Height)
    $g.DrawLine($pen, $size * 0.24, $size * 0.42, $size * 0.76, $size * 0.42)
    $g.FillEllipse($fill, $size * 0.30, $size * 0.345, $size * 0.045, $size * 0.045)
    $g.FillEllipse($fill, $size * 0.39, $size * 0.345, $size * 0.045, $size * 0.045)
    $g.FillEllipse($fill, $size * 0.48, $size * 0.345, $size * 0.045, $size * 0.045)
    $g.DrawLine($pen, $size * 0.66, $size * 0.21, $size * 0.81, $size * 0.21)
    $g.DrawLine($pen, $size * 0.81, $size * 0.21, $size * 0.81, $size * 0.36)
    $pen.Dispose()
    $fill.Dispose()
}

function Save-Icon($relativePath, $size, $kind) {
    $canvas = New-Canvas $size
    $g = $canvas.Graphics
    switch ($kind) {
        "plugin" {
            Draw-Base $g $size "#176fe8" "#08c3b6"
            Draw-Speaker $g $size
            Draw-Sliders $g $size
        }
        "category" {
            Draw-Base $g $size "#176fe8" "#08c3b6"
            Draw-Speaker $g $size
        }
        "app" {
            Draw-Base $g $size "#1f75ff" "#00b8d9"
            Draw-Sliders $g $size
        }
        "active" {
            Draw-Base $g $size "#7b61ff" "#17c3b2"
            Draw-WindowFocus $g $size
        }
    }

    $path = Join-Path $root $relativePath
    $canvas.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $canvas.Bitmap.Dispose()
}

Save-Icon "imgs\plugin.png" 72 "plugin"
Save-Icon "imgs\plugin@2x.png" 144 "plugin"
Save-Icon "imgs\category.png" 28 "category"
Save-Icon "imgs\category@2x.png" 56 "category"

Save-Icon "imgs\actions\AppVolume\action.png" 72 "app"
Save-Icon "imgs\actions\AppVolume\action@2x.png" 144 "app"
Save-Icon "imgs\actions\AppVolume\key.png" 72 "app"
Save-Icon "imgs\actions\AppVolume\key@2x.png" 144 "app"

Save-Icon "imgs\actions\ActiveWindow\action.png" 72 "active"
Save-Icon "imgs\actions\ActiveWindow\action@2x.png" 144 "active"
Save-Icon "imgs\actions\ActiveWindow\key.png" 72 "active"
Save-Icon "imgs\actions\ActiveWindow\key@2x.png" 144 "active"
