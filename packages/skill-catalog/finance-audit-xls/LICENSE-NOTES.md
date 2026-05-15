# LICENSE-NOTES — finance-audit-xls

This skill's `SKILL.md` is adapted from upstream Apache-2.0 content.

## Upstream

- **Repository:** [`anthropic/financial-services`](https://github.com/anthropics/financial-services)
- **License:** Apache License 2.0 ([SPDX: `Apache-2.0`](https://spdx.org/licenses/Apache-2.0.html))
- **Source path:** `plugins/agent-plugins/earnings-reviewer/skills/audit-xls/SKILL.md`
- **Source commit:** `ac4c5b4c917931b989620d3c226d88eda164f596` (main, 2026-05-15)
- **Upstream LICENSE file:** https://github.com/anthropics/financial-services/blob/main/LICENSE

## Compatibility

The Thinkwork repository is also licensed Apache-2.0. Apache-2.0 →
Apache-2.0 inclusion is compatible. We preserve the upstream copyright
notice and license terms as required by Apache-2.0 §4.

## Adaptations

- Frontmatter rewritten to Thinkwork's schema.
- Scope tightened from {selection / sheet / model} to **workbook-only**
  (pilot uploads single files; the multi-scope picker is unnecessary
  noise for this audience).
- DCF / LBO / merger model-type-specific bug sections removed (out of
  pilot scope per the finance analysis pilot plan, U5).
- Added explicit attached-file-path instructions for the Thinkwork
  staging convention.
- Logic & reasonableness flag thresholds tightened toward typical
  prospect-statement size (>50% growth flag vs upstream's >100%).

The formula-level checks, structural review, and 3-statement integrity
checks (BS balance, cash tie-out, CF sum, D&A match) are preserved
substantively from upstream.

## Notice

Per Apache-2.0 §4(c), a copy of the upstream LICENSE remains accessible
at the upstream URL above. No `NOTICE` file was distributed by upstream
at the time of lift (`ac4c5b4c`).
