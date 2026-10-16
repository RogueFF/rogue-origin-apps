# Grove mail fixtures

Real Grove emails go here as `real-<kind>-<date>.txt` (the plain-text body as
the Apps Script poller forwards it: subject on the first line as
`Subject: …`, a blank line, then the body). Strip nothing but the signature
block. The parser is tuned against these; the `synthetic-*.txt` files are
placeholders that stand in until a real one lands and must not be the only
evidence a rule is right.

The test (`tests/grove-mail-parser.test.mjs`) runs every `real-*.txt` it finds
against the expectations in `expected.json` (key = file name), so adding a
fixture is: drop the file, add its line to `expected.json`.
