<#
.SYNOPSIS
  Print one pre-rendered tag image to a 4x2 label printer, 1:1, no scaling.

.DESCRIPTION
  This is the half of the print agent that touches Windows. It takes a PNG that
  is already exactly the right number of printer dots and pushes it through the
  driver with System.Drawing.Printing.PrintDocument.

  WHY NOT CHROME --kiosk-printing: the crew's phone is not the machine with the
  printer, so there is no browser here to drive. And the whole reason the agent
  exists is that a browser print dialog is what iOS cannot give us.

  WHY A PRE-RENDERED IMAGE: the tag is an HTML design tuned edge-to-edge at
  203 dpi. Re-laying it out here would mean a second renderer to keep in sync.
  Playwright renders the real page at deviceScaleFactor 203/96, so 4x2 inches
  lands on exactly 812 x 406 dots, and this script only has to not resize it.

  Proven technique, 2026-09-10, on the Zebra ZP 450 (the ad-hoc proof was never
  saved as a script — this is that technique written down).

.PARAMETER ImagePath
  PNG to print. Should already be <dpi*4> x <dpi*2> dots.

.PARAMETER PrinterName
  Exact Windows queue name, e.g. 'Rollo X1040' or 'Zebra ZP 450'.

.EXAMPLE
  .\print-image.ps1 -ImagePath tag.png -PrinterName 'Rollo X1040'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $ImagePath,
  [Parameter(Mandatory = $true)] [string] $PrinterName,
  # Hundredths of an inch — .NET PaperSize units. 400 x 200 = 4" x 2".
  [int] $PaperWidth  = 400,
  [int] $PaperHeight = 200
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $ImagePath)) {
  throw "Image not found: $ImagePath"
}

$image = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $ImagePath))
$doc = New-Object System.Drawing.Printing.PrintDocument
try {
  $doc.PrinterSettings.PrinterName = $PrinterName
  if (-not $doc.PrinterSettings.IsValid) {
    throw "Printer queue not found or not ready: '$PrinterName'"
  }

  $doc.DefaultPageSettings.PaperSize =
    New-Object System.Drawing.Printing.PaperSize('Tag4x2', $PaperWidth, $PaperHeight)

  # Zero margins. The tag is designed edge-to-edge (@page margin: 0) and has no
  # spare room — any margin here crops printed text, exactly the failure that
  # makes iOS unusable for this tag in the first place.
  $doc.DefaultPageSettings.Margins =
    New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $doc.OriginAtMargins = $false

  $doc.add_PrintPage({
    param($sender, $e)
    # NearestNeighbor, never smoothing: this is 1-bit thermal output. Any
    # interpolation turns crisp black-on-white QR modules and small type into
    # grey edges that the printer then has to threshold — which is how a
    # scannable QR becomes an unscannable one.
    $e.Graphics.InterpolationMode =
      [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $e.Graphics.PixelOffsetMode =
      [System.Drawing.Drawing2D.PixelOffsetMode]::Half

    # Fill the physical page exactly. The image is already the right dot count,
    # so this is a 1:1 blit, not a resize.
    $rect = New-Object System.Drawing.Rectangle(
      0, 0, $e.PageBounds.Width, $e.PageBounds.Height)
    $e.Graphics.DrawImage($image, $rect)
    $e.HasMorePages = $false
  })

  $doc.Print()
  Write-Output "printed"
}
finally {
  $doc.Dispose()
  $image.Dispose()
}
