# LICENSE-NOTES — finance-3-statement-model

This skill's `SKILL.md` is adapted from upstream Apache-2.0 content.

## Upstream

- **Repository:** [`anthropic/financial-services`](https://github.com/anthropics/financial-services)
- **License:** Apache License 2.0 ([SPDX: `Apache-2.0`](https://spdx.org/licenses/Apache-2.0.html))
- **Source path:** `plugins/vertical-plugins/financial-analysis/skills/3-statement-model/SKILL.md`
- **Source commit:** `ac4c5b4c917931b989620d3c226d88eda164f596` (main, 2026-05-15)
- **Upstream LICENSE file:** https://github.com/anthropics/financial-services/blob/main/LICENSE

## Compatibility

The Thinkwork repository is also licensed Apache-2.0 (per `CLAUDE.md`'s "CI runs against Apache-2.0-licensed code" — see the repository's `LICENSE` for canonical terms). Apache-2.0 → Apache-2.0 inclusion is compatible. We preserve the upstream copyright notice and license terms as required by Apache-2.0 §4.

## Adaptations

- Frontmatter rewritten to Thinkwork's schema (`name` / `display_name` /
  `description` / `license` / `metadata.author` / `version` /
  `execution` / `allowed-tools` / `triggers`).
- Office-JS-specific guidance removed (Thinkwork agents read attached
  files via `file_read` against `/tmp/turn-<turnId>/attachments/`).
- DCF / LBO / comps / merger sections removed (out of pilot scope per
  the finance analysis pilot plan, U5).
- Added explicit attached-file-path instructions for the Thinkwork
  staging convention.
- Trimmed the "verify step-by-step" workflow to the 3-statement core.

The methodology (3-statement build order, integrity checks, common bugs)
is preserved substantively from upstream.

## Notice

Per Apache-2.0 §4(c), a copy of the upstream LICENSE remains accessible
at the upstream URL above. No `NOTICE` file was distributed by upstream
at the time of lift (`ac4c5b4c`).
