# AGENTS.md — shared fixture for U6 (TS) + U7 (Py) parser parity

This file is the single source of truth for the U6 / U7 routing-table
parser shape contract (Plan §008). Both parsers run their tests against
this exact text. If you change the table below, the two parser fixture
tests will fail until the matching parser code is updated; that is by
design — the shape contract should never silently drift.

## Who I am

A delegator agent for testing the AGENTS.md routing-table parser.

## Routing

| Task             | Go to       | Read                  | Skills                       |
| ---------------- | ----------- | --------------------- | ---------------------------- |
| Expense receipts | expenses/   | expenses/CONTEXT.md   | approve-receipt,tag-vendor   |
| Recruiting       | recruiting/ | recruiting/CONTEXT.md | score-candidate              |
| Legal review     | legal/      | legal/CONTEXT.md      | review-contract              |

## Naming conventions

- Sub-agent folders are short, lowercase, hyphenated.
- `memory/` and `skills/` are reserved at any depth — never sub-agents.
