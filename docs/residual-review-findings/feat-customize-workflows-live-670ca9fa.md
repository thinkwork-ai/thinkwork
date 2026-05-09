# Residual Review Findings — feat/customize-workflows-live (670ca9fa)

Run artifact: `/tmp/compound-engineering/ce-code-review/20260509-151507-9018e48a/`
Reviewers: 12 (correctness, testing, maintainability, project-standards, agent-native, learnings, data-migrations, api-contract, security, kieran-typescript, adversarial, deployment-verification)
Verdict: Ready with fixes (autofixes applied; residuals below)

## Residual Review Findings

### P1 — Should fix in a follow-up

- **R1 — `packages/api/src/graphql/resolvers/customize/enableWorkflow.mutation.ts:121-128` — Verify ON CONFLICT `targetWhere` predicate matches the partial-index predicate at runtime.** Postgres requires the ON CONFLICT WHERE clause to match the partial index predicate (`agent_id IS NOT NULL AND catalog_slug IS NOT NULL`) exactly, or the resolver throws 42P10 at runtime. Unit tests mock the upsert and can't catch this; add a live-Postgres integration test that asserts `enableWorkflow` round-trips against a real `routines` row. Reviewers: testing, correctness-005, adversarial-ADV-007.

### P2 — Fix when adjacent work touches the surface

- **R2 — `packages/api/src/graphql/resolvers/customize/enableWorkflow.mutation.ts` + `tenant_workflow_catalog` schema — Engine partition mismatch.** `tenant_workflow_catalog` has no `engine` column, so all enableWorkflow inserts default to `engine='legacy_python'` regardless of catalog intent. Step Functions–shaped catalog rows produce non-functional routines (no `state_machine_arn`, no `current_version`). Decision needed: add `engine` (+ optional `state_machine_arn` template) to catalog, or constrain Customize to legacy_python only and surface that in the catalog UI. Reviewer: adversarial-ADV-002.

- **R3 — `packages/api/src/graphql/resolvers/customize/enableWorkflow.mutation.ts:121-128` — ON CONFLICT preserves stale config on re-enable.** Re-enabling a workflow flips `status='active'` but never refreshes `name`/`description`/`schedule`/`config` from the catalog. If a tenant edits the catalog row between two users' enable events, the second user gets stale defaults. Decision needed: refresh fields on re-enable, or pin "first enable wins" as the user-state-preservation contract. Reviewer: adversarial-ADV-005.

- **R4 — Agent-native parity for Customize mutations.** No MCP tool today lets the agent enable/disable its own catalog-backed workflows (or connectors / skills — same gap U4 + U5 left). Closing this requires (a) an `enable_workflow` / `disable_workflow` MCP tool in `packages/lambda/admin-ops-mcp.ts`, and (b) loosening the resolver authz from `owner_user_id=caller.userId` to allow the agent's apikey caller path to act on its own Computer. Counterargument: keeping enablement as an explicit human consent event is defensible product. File a planning question. Reviewer: agent-native W1, W2.

- **R6 — `apps/computer/src/components/customize/use-customize-mutations.ts` — `useToggleMutation` same-key reentrancy gap.** Rapid Connect→Disable on the same slug fires two concurrent server calls; the first finally-block clears `pending` while the second is still in flight. Final state depends on which reply lands last. Add a same-key in-flight guard (skip if already pending). Reviewer: adversarial-ADV-006.

- **R7 — `packages/api/src/graphql/resolvers/customize/*.mutation.ts` (6 files) — Extract `loadCallerComputer` helper.** The auth + Computer-load preamble is now duplicated across 6 mutations (plan deferred this until U6 made it the third call site; that threshold is now). Extract a shared helper. Plan-deferred-to-follow-up; track as a small refactor PR. Reviewer: maintainability-4, kieran-K6.

### P3 — Advisory / nice-to-have

- **R5 — `packages/database-pg/graphql/types/routines.graphql` + `packages/admin-ops/src/routines.ts` — Expose `Routine.catalogSlug`.** New column is invisible to existing routines queries; if MCP routine listings (R4) ship, agents can't tell catalog-backed routines from user-authored ones. Reviewer: agent-native W3.

## Already-mitigated / Advisory (no action needed)

- Backfill collision recovery path was an open concern; resolved by removing the backfill entirely (autofix #6). 0081 now only adds a column + index — no UPDATE that could fail mid-transaction.
- Cross-tenant attack surface verified clean by security review. `requireTenantMember` + Computer-ownership predicate is the right gate (U4/U5 precedent).
- Hand-rolled migration markers verified compliant by project-standards reviewer.
- Computer archive doesn't pause active routines (adversarial-ADV-003) — observed by the triggers reconciler, deferred to U7 workspace renderer.
