# Gera os ícones PNG da Estante: fundo terracota, três lombadas de livro sobre uma prateleira.
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot 'icons'
New-Item -ItemType Directory -Force $out | Out-Null

function C($a, $r, $g, $b) { [System.Drawing.Color]::FromArgb($a, $r, $g, $b) }

function RoundRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-Icon([int]$s, [string]$path, [double]$pad) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF 0, 0), (New-Object System.Drawing.PointF $s, $s), (C 255 196 98 58), (C 255 140 58 30)
  $g.FillRectangle($bg, 0, 0, $s, $s)

  # área útil (pad = margem de segurança p/ ícone maskable)
  $u = $s * (1 - 2 * $pad); $o = $s * $pad
  $shelfY = $o + 0.74 * $u
  $books = @(
    @{ x = 0.20; w = 0.15; h = 0.50; c = (C 255 247 239 226) },
    @{ x = 0.37; w = 0.13; h = 0.42; c = (C 255 236 200 150) },
    @{ x = 0.52; w = 0.16; h = 0.55; c = (C 255 247 239 226) }
  )
  foreach ($b in $books) {
    $bx = $o + $b.x * $u; $bw = $b.w * $u; $bh = $b.h * $u
    $rect = RoundRect ([single]$bx) ([single]($shelfY - $bh)) ([single]$bw) ([single]$bh) ([single](0.025 * $u))
    $g.FillPath((New-Object System.Drawing.SolidBrush $b.c), $rect)
    # faixas da lombada
    $band = New-Object System.Drawing.SolidBrush (C 255 160 70 38)
    $g.FillRectangle($band, [single]($bx + 0.2 * $bw), [single]($shelfY - $bh + 0.16 * $bh), [single](0.6 * $bw), [single](0.035 * $u))
    $g.FillRectangle($band, [single]($bx + 0.2 * $bw), [single]($shelfY - 0.2 * $bh), [single](0.6 * $bw), [single](0.035 * $u))
  }
  # livro inclinado
  $st = $g.Save()
  $g.TranslateTransform([single]($o + 0.84 * $u), [single]$shelfY)
  $g.RotateTransform(-16)
  $lean = RoundRect ([single](-0.13 * $u)) ([single](-0.47 * $u)) ([single](0.13 * $u)) ([single](0.47 * $u)) ([single](0.025 * $u))
  $g.FillPath((New-Object System.Drawing.SolidBrush (C 255 236 200 150)), $lean)
  $g.Restore($st)
  # prateleira
  $shelf = RoundRect ([single]($o + 0.10 * $u)) ([single]$shelfY) ([single](0.80 * $u)) ([single](0.06 * $u)) ([single](0.02 * $u))
  $g.FillPath((New-Object System.Drawing.SolidBrush (C 255 250 244 234)), $shelf)

  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

New-Icon 180 (Join-Path $out 'icon-180.png') 0.06
New-Icon 192 (Join-Path $out 'icon-192.png') 0.06
New-Icon 512 (Join-Path $out 'icon-512.png') 0.06
New-Icon 512 (Join-Path $out 'icon-maskable-512.png') 0.16
Write-Host 'Ícones gerados em' $out
