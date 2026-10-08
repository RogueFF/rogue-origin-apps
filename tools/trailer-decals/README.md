# Trailer decals (4x6 thermal)

Seven 4x6 in labels, T1-T7, for the Zebra ZP 450 (203 dpi). Each carries the
live decal link `/t/<n>` — the same target as the app's print sheet
(`?action=print_codes&packet=trailers`).

```
node tools/trailer-decals/make-zpl.mjs > decals.zpl        # all six (or: ... make-zpl.mjs 3 for one)
powershell -File tools/trailer-decals/send-raw.ps1 -Path decals.zpl
```

The ZPL sets its own 4x6 size and is sent RAW, so the queue's saved 4x2
supersack-tag paper size is untouched. Check the queue is empty first
(`Get-PrintJob -PrinterName 'Zebra ZP 450'`): anything stuck prints ahead of
these, onto 4x6 stock.

The QR is drawn from `workers/src/lib/qr.js` as solid boxes, 19 dots a module
(about 3.1 in). `--grid <n>` prints the placement as JSON for a decode check.

ZP 450 labels are direct thermal: sun and heat darken them. Cover each decal
with clear packing tape or a laminate before it goes on a trailer.
