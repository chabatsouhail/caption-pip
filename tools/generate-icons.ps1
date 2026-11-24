param()

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$projectRoot = Split-Path -Parent $PSScriptRoot
$iconDirectory = Join-Path $projectRoot "icons"
New-Item -ItemType Directory -Path $iconDirectory -Force | Out-Null

# Custom Caption PiP mark on Tabler's native 24x24 grid. The CC letterforms use
# the exact IconBadgeCc geometry, enlarged inside the bottom-right PiP badge.
$outerGeometryData = "M21,10 L21,5 A2,2 0 0 0 19,3 L5,3 A2,2 0 0 0 3,5 L3,19 A2,2 0 0 0 5,21 L7,21"
$outerGeometry = [System.Windows.Media.Geometry]::Parse($outerGeometryData)
$outerGeometry.Freeze()

$badgeGeometry = [System.Windows.Media.RectangleGeometry]::new(
  [System.Windows.Rect]::new(8.5, 11.5, 13.5, 10.5),
  3,
  3
)

$ccTransform = [System.Windows.Media.MatrixTransform]::new(0.75, 0, 0, 0.75, 6.25, 7.75)
$ccLeftSource = [System.Windows.Media.Geometry]::Parse("M10,10.5 A1.5,1.5 0 0 0 7,10.5 L7,13.5 A1.5,1.5 0 0 0 10,13.5")
$ccRightSource = [System.Windows.Media.Geometry]::Parse("M17,10.5 A1.5,1.5 0 0 0 14,10.5 L14,13.5 A1.5,1.5 0 0 0 17,13.5")
$ccLeftGeometry = $ccLeftSource.Clone()
$ccRightGeometry = $ccRightSource.Clone()
$ccLeftGeometry.Transform = $ccTransform
$ccRightGeometry.Transform = $ccTransform
$cutoutPen = [System.Windows.Media.Pen]::new([System.Windows.Media.Brushes]::Black, 1.5)
$cutoutPen.StartLineCap = [System.Windows.Media.PenLineCap]::Round
$cutoutPen.EndLineCap = [System.Windows.Media.PenLineCap]::Round
$cutoutPen.LineJoin = [System.Windows.Media.PenLineJoin]::Round
$ccLeftCutout = $ccLeftGeometry.GetWidenedPathGeometry($cutoutPen)
$ccRightCutout = $ccRightGeometry.GetWidenedPathGeometry($cutoutPen)
$ccCutouts = [System.Windows.Media.Geometry]::Combine(
  $ccLeftCutout,
  $ccRightCutout,
  [System.Windows.Media.GeometryCombineMode]::Union,
  $null
)
$captionBadgeGeometry = [System.Windows.Media.Geometry]::Combine(
  $badgeGeometry,
  $ccCutouts,
  [System.Windows.Media.GeometryCombineMode]::Exclude,
  $null
)
$captionBadgeGeometry.Freeze()

$iconVariants = @(
  @{
    Directory = $iconDirectory
    Color = [System.Windows.Media.Color]::FromArgb(255, 52, 54, 63)
  },
  @{
    Directory = Join-Path $iconDirectory "dark"
    Color = [System.Windows.Media.Colors]::White
  }
)

foreach ($variant in $iconVariants) {
  $variantDirectory = $variant.Directory
  New-Item -ItemType Directory -Path $variantDirectory -Force | Out-Null
  $iconBrush = [System.Windows.Media.SolidColorBrush]::new($variant.Color)
  $iconBrush.Freeze()
  $outerPen = [System.Windows.Media.Pen]::new($iconBrush, 2)
  $outerPen.StartLineCap = [System.Windows.Media.PenLineCap]::Round
  $outerPen.EndLineCap = [System.Windows.Media.PenLineCap]::Round
  $outerPen.LineJoin = [System.Windows.Media.PenLineJoin]::Round
  $outerPen.Freeze()

  foreach ($size in @(16, 32, 48, 128)) {
    # Use nearly all of Chrome's icon slot while retaining a slim optical margin.
    $glyphScaleX = ($size / 24.0) * 1.15
    $glyphScaleY = ($size / 24.0) * 1.15
    $glyphOffsetX = ($size - 24 * $glyphScaleX) / 2
    $glyphOffsetY = ($size - 24 * $glyphScaleY) / 2
    $transform = [System.Windows.Media.MatrixTransform]::new(
      $glyphScaleX,
      0,
      0,
      $glyphScaleY,
      $glyphOffsetX,
      $glyphOffsetY
    )

    $visual = [System.Windows.Media.DrawingVisual]::new()
    $drawing = $visual.RenderOpen()
    $drawing.PushTransform($transform)
    $drawing.DrawGeometry($null, $outerPen, $outerGeometry)
    $drawing.DrawGeometry($iconBrush, $null, $captionBadgeGeometry)
    $drawing.Pop()
    $drawing.Close()

    $bitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new(
      $size,
      $size,
      96,
      96,
      [System.Windows.Media.PixelFormats]::Pbgra32
    )
    $bitmap.Render($visual)

    $encoder = [System.Windows.Media.Imaging.PngBitmapEncoder]::new()
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $outputPath = Join-Path $variantDirectory "icon-$size.png"
    $stream = [System.IO.File]::Open($outputPath, [System.IO.FileMode]::Create)
    try {
      $encoder.Save($stream)
    } finally {
      $stream.Dispose()
    }
  }
}

Write-Host "Generated custom Caption PiP toolbar icons for light and dark themes in $iconDirectory"
