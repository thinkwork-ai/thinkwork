# AGENTS.md — shared fixture for U4 (TS) + (Py) skipped-row parity

This fixture exercises the parser's row-level skip surfaces (Plan
2026-04-25-004 U4): reserved-name `goTo` and invalid-path `goTo`. Both
TS and Py parsers run a parity test against this exact text. If you
change the table below, both fixture-parity tests will fail until both
parsers are updated; that is by design — the warnings + skipped_rows
shape contract should never silently drift.

## Routing

| Task              | Go to       | Read                  | Skills            |
| ----------------- | ----------- | --------------------- | ----------------- |
| Hidden memory     | memory/     | memory/CONTEXT.md     | leak-private      |
| Bad path          | Not A Path  | bad/CONTEXT.md        | bogus             |
| Real specialist   | expenses/   | expenses/CONTEXT.md   | approve-receipt   |
