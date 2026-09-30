# Send a ZPL file to a Windows printer queue as RAW, past the driver's page
# layout. The ZPL sets its own 4x6 size, so the queue's saved paper size (the
# ZP 450's is 4x2 for supersack tags) does not matter and is not changed.
#
#   powershell -File tools\trailer-decals\send-raw.ps1 -Path decals.zpl
#   powershell -File tools\trailer-decals\send-raw.ps1 -Path decals.zpl -Printer "Zebra ZP 450"
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Printer = 'Zebra ZP 450',
  [string]$DocName = 'Trailer decals'
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string name, out IntPtr h, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);
  public static int Send(string printer, byte[] data, string doc) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("OpenPrinter failed: " + Marshal.GetLastWin32Error());
    try {
      var di = new DOCINFO { pDocName = doc, pDataType = "RAW" };
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("StartDocPrinter failed: " + Marshal.GetLastWin32Error());
      try {
        if (!StartPagePrinter(h)) throw new Exception("StartPagePrinter failed: " + Marshal.GetLastWin32Error());
        int written;
        if (!WritePrinter(h, data, data.Length, out written)) throw new Exception("WritePrinter failed: " + Marshal.GetLastWin32Error());
        EndPagePrinter(h);
        return written;
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@

$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $Path))
$n = [RawPrint]::Send($Printer, $bytes, $DocName)
"Sent $n of $($bytes.Length) bytes to '$Printer'."
