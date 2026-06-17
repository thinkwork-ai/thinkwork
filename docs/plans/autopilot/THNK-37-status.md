---
issue: THNK-37
title: "feat: GitHub-backed plugin catalog"
updated: 2026-06-17
dispatcher: dispatcher:THNK-37:InProgress:Codex
project_context: ThinkWork / Enterprise Agent OS
---

# THNK-37 Autopilot Status

## Current U1 Catalog Provenance Slice

- Started from fresh `origin/main` at
  `070f58e845e8a2f778c91843f2d30d0fdd50fced` in branch
  `codex/thnk-37-u1-catalog-provenance`.
- Read the merged plan artifact
  `docs/plans/2026-06-17-002-feat-github-backed-plugin-catalog-plan.md`,
  Linear issue `THNK-37`, issue comments, labels/statuses, attachments,
  returned relations, and the plugin source-boundary solution note before
  implementation.
- Moved Linear THNK-37 from `Ready to Work` to `In Progress` when
  implementation began, preserving the `Codex` routing label.
- Added optional signed catalog source provenance:
  `repository`, `ref`, and `commitSha`.
- Kept provenance optional so bundled fallback catalogs remain valid while the
  GitHub-hosted signed artifact can carry source metadata.
- Extended catalog build plumbing so publishers can pass source provenance
  explicitly or inherit it from GitHub Actions environment variables.
- Added tests proving source provenance verifies, invalid provenance is
  rejected, and tampered provenance covered by the signature fails closed.

### Verification

- `pnpm --filter @thinkwork/plugin-catalog test` passed.
- `pnpm --filter @thinkwork/plugin-catalog typecheck` passed.
- `git diff --check` passed.
- Formatting: `pnpm dlx prettier --write ...` on touched files because the
  root `prettier` binary is not installed as a workspace dependency.
