# THNK-20 Autopilot Status

Linear issue: THNK-20 - U5a: Route first-party agent Brain reads through Context Engine
Parent: THNK-6 - ThinkWork Brain
Milestone: Company Brain dogfood proof

## Current Status

- Implementation branch: `codex/thnk-20-context-engine-brain-reads` (merged and remote branch deleted)
- Final ledger branch: `codex/thnk-20-final-status`
- Plan: `docs/plans/2026-06-14-002-feat-context-engine-brain-reads-plan.md`
- Linear state: moved from `Ready to Work` to `In Progress` on 2026-06-14 when implementation began; moved to `Verification` after PR #2455 opened; moved to `Done` after PR #2455 merged.
- Implementation grouping: one PR for THNK-20 because the issue has no child issues and the scope is one cohesive retrieval proof.

## Discovery

- Fetched THNK-20 with relations, labels, project, milestone, state history, attachments, documents, customer needs, and releases.
- Fetched THNK-20 comments. Only dispatcher/setup comment existed at discovery time.
- Fetched parent THNK-6 with relations, attached documents, comments, and milestone context.
- Fetched child issue list for THNK-6: THNK-17 and THNK-19 are Done; THNK-18 is Planning; THNK-20 is this unit.
- Fetched blockers THNK-17, THNK-19, and THNK-15. All are Done, so THNK-20 is not blocked by missing contract/artifact/plugin-shell context.
- Fetched THNK-15 documents: Company Brain premium plugin plan and brainstorm.
- Fetched THNK-6 documents: Company Brain physical substrate plan, requirements, and OKF decision.
- Fetched comments for THNK-6, THNK-15, THNK-17, and THNK-19.
- Fetched ThinkWork team statuses and Enterprise Agent OS project/milestone details.
- Searched repo for THNK-20, U5a, `query_brain_context`, Company Brain dogfood proof, THNK-6/15/17/19, Context Engine, and Brain artifact/provenance terms.

## Important Context

- THNK-20 acceptance focuses on first-party active/default Brain reads, not migration-aware U5b.
- Company Brain is the customer/product term. Context Engine is the runtime policy layer. Cognee is internal substrate evidence only.
- U1/THNK-17 added `brain.substrate_states`, launch/optional capability posture, migration state, redacted tenant status, and operator evidence.
- U3/THNK-19 added `brain.artifact_manifests` and canonical artifact/vault provenance with S3/source-id redaction.
- Existing `query_brain_context` already routes through the MCP Context Engine handler but currently relies on generic provider-family selection.

## Decisions

- Implement THNK-20 as one PR with internal plan units U1-U4.
- Keep reads behind Context Engine; do not add direct Cognee, Neptune, or S3 caller paths.
- Use active/default Brain pages plus substrate/artifact metadata for U5a. Production migration and external Brain MCP lifecycle remain deferred.
- Add prompt-injection fixtures at the Context Engine/MCP boundary instead of relying on documentation-only assurances.

## Progress Log

- 2026-06-14: Read `AGENTS.md` and Compound Engineering LFG/ce-plan/ce-work/Linear skill instructions.
- 2026-06-14: Fetched full Linear context for THNK-20, parent/dependencies, project, milestone, comments, statuses, and documents.
- 2026-06-14: Searched repo-local docs and code for THNK-20/U5a/Company Brain/Context Engine references.
- 2026-06-14: Created branch `codex/thnk-20-context-engine-brain-reads` from `origin/main`.
- 2026-06-14: Moved THNK-20 from `Ready to Work` to `In Progress`.
- 2026-06-14: Added THNK-20 implementation plan and this status doc.
- 2026-06-14: Added Company Brain Context Engine provider, Brain retrieval option parsing, untrusted source-data formatting, provider tests, MCP boundary tests, and read-only smoke/docs updates.
- 2026-06-14: Ran Compound Engineering code-review pass locally per repo subagent compatibility rules. Fixed one review finding: Brain search now normalizes terms and escapes SQL `ILIKE` wildcards so punctuation-only or wildcard-only queries cannot broaden to arbitrary active Brain pages.
- 2026-06-14: Opened PR #2455 and moved THNK-20 to `Verification`.
- 2026-06-14: CI passed for PR #2455; squash-merged to `main` as `590c0b0f9352312be6d133968c332a72a2d8005e`; remote implementation branch deleted.
- 2026-06-14: Moved THNK-20 to `Done`.

## Verification Log

- 2026-06-14: `pnpm install` completed; local `canvas` postinstall could not build under Node 25 because `pkg-config`/pixman is missing, but pnpm completed and API test/typecheck commands ran.
- 2026-06-14: `pnpm --filter @thinkwork/api test -- src/lib/context-engine/providers/company-brain.test.ts src/lib/context-engine/__tests__/service.test.ts src/handlers/mcp-context-engine.requester-context.test.ts` passed: 3 files, 14 tests.
- 2026-06-14: `pnpm --filter @thinkwork/api test -- src/lib/context-engine src/handlers/mcp-context-engine.requester-context.test.ts` passed: 15 files, 60 tests.
- 2026-06-14: `pnpm --filter @thinkwork/api typecheck` passed.
- 2026-06-14: `pnpm --filter @thinkwork/api lint` reported no lint script for the selected package.
- 2026-06-14: `git diff --check` passed.
- 2026-06-14: `node scripts/smoke/company-brain-context-engine-smoke.mjs` passed dry-run.
- 2026-06-14: `bash scripts/build-lambdas.sh mcp-context-engine` passed and built the MCP Context Engine Lambda artifact.

## PR / CI Log

- PR: https://github.com/thinkwork-ai/thinkwork/pull/2455
- Merge commit: `590c0b0f9352312be6d133968c332a72a2d8005e`
- CI: `cla`, `lint`, `test`, `typecheck`, and `verify` passed before merge.

## Blockers

- None currently.
