# Lessons

## 2026-10-16 — the Edit tool writes CRLF here, and page-source tests assume LF

**What happened:** after editing `src/pages/supersack-entry.html` and the salida
handlers with the Edit tool, three tests in `tests/supersack-scans.test.mjs`
failed. They regex the page source with `\n  }\n`, and the edited files had
become CRLF (1,920 CRs in the form). Nothing in the diff explained it.

**Rule:** after any Edit/Write on this repo, run `grep -c $'\r' <file>`; if it
is not 0, `sed -i 's/\r$//' <file>` before running the suite. Page-source
tests here (`tests/supersack-scans.test.mjs`, `tests/harvest-salida.test.mjs`)
match on `\n`, so a CRLF file fails them for reasons unrelated to the change.

## 2026-10-16 — Bash heredocs with quotes fail; use Write, then run the file

Confirmed again (`Dev/CLAUDE.md` already says so). A Python heredoc with
quoted replacement strings died with "unexpected EOF". Write the script with
the Write tool to the scratchpad and run it, or use the Edit tool directly.

## 2026-10-16 — a design can miss a side effect the old path had

The close-day design covered the D1 row and the allocation but not the two
Shopify trim pools the old form fed (biomass and trim, in grams). Caught only
by reading the form's submit path during the build. **Rule:** when replacing
an entry path, list every external write the old path makes (grep for
`fetch(` in its submit handler) before writing the design's data-flow section.
