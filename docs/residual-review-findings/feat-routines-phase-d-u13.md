# Residual Review Findings — feat/routines-phase-d-u13

**Plan**: docs/plans/2026-05-01-007-feat-routines-phase-d-ui-plan.md (U13)
**Branch**: feat/routines-phase-d-u13
**Review**: self-review across standard lenses (correctness, testing, maintainability, project-standards, agent-native, security, reliability, kieran-typescript, adversarial)

No P0/P1 findings. The diff is presentation-layer + a thin form page; surface area is bounded. Items below are P3 polish.

## Residual findings

- **P2 [maintainability] step manifest is unreachable from the run-detail page**. `RoutineExecutionDetailQuery` returns the routine but not a pointer to the published `routine_asl_versions` row that backed *this* execution. The page falls back to deriving graph nodes from `routine_step_events` alone, which renders empty for a brand-new execution with no events yet (correct once any event lands). Resolution: add an `aslVersion: RoutineAslVersion` resolver field on `RoutineExecution` (the row already carries `version_arn`; surface the matching row id), then wire the existing `RoutineAslVersionDetailQuery` from this page. Tracked here so the schema add lands as a follow-up rather than expanding U13 scope.

- **P3 [testing] no unit tests for `ExecutionGraph` / `StepDetailPanel` / `MarkdownSummary`**. The exported `latestEventByNode`, `deriveNodes`, and `parseStepAnchor` helpers are pure functions worth a vitest suite — happy path + retry chatter collapse + manifest-empty fallback + step-anchor parsing edge cases. The plan's verification clause leans on manual dev-tenant checks; unit-level guardrails would catch regressions before they reach the dev stack.

- **P3 [adversarial] dynamic graph nodes (Map child executions) won't render**. When the manifest *is* present and a step event arrives with a `node_id` that isn't in the manifest (e.g., a Map iteration name like `ProcessEmail.0`), `deriveNodes` drops it. Map / Parallel branches that synthesize child node ids at runtime would be invisible to the operator. v0 plan §"Recipes" lists `map` but doesn't define how runtime Map child names surface; resolution either widens `deriveNodes` to include events-not-in-manifest as extra rows, or surfaces Map iterations as a parent row with a count.

- **P3 [reliability] 5s poll vs subscription**. The plan's "Implementation-Time Unknowns" section already accepts polling for U13. The next step (when AppSync subscription extends cleanly to `routine_step_events`) is `OnRoutineStepEventInserted` mirroring the existing `OnThreadTurnUpdatedSubscription` pattern. Polling at 5s is acceptable at 4-tenant scale.

- **P3 [advisory] python `View full output` link is plain-text S3 URI**. The plan calls for a presigned-URL flow so operators can click through. Deferred to a Phase E follow-up — admin operators with AWS console access can paste the URI in console for now.

## Deferred from U13 (per user pragmatic guidance)

- **Mobile parity** — `apps/mobile/app/routines/[id]/executions/[executionId].tsx` + `apps/mobile/components/routines/ExecutionGraphMobile.tsx`. User explicitly directed "ship admin first; mobile parity can land in a follow-up if scope blows up." Admin is the primary operator surface; mobile parity unblocks the customer-facing F1 flow but isn't load-bearing for the v1 demo.

- **Admin chat-builder chrome** — `apps/admin/src/components/routines/RoutineChatBuilder.tsx` and `/automations/routines/new` as a chat surface (not a form). Mobile's `createSession` / `sendToSession` are currently stubbed pending GraphQL migration (per Phase C U10's caveat). The thin form-based `/new` page shipped here is the right placeholder until chat infra lands; an admin chat duplicate before that would be cargo-cult UI.

- **Subscription wiring** for live step-event feed (replacing the 5s poll). Plan accepts polling for U13.

## Advisory

- **[learnings] markdown-anchor → graph-node pattern is genuinely novel**. The `#step-<nodeId>` anchor convention, with the `MarkdownSummary` component intercepting clicks and routing to the parent's step-selection handler, is a clean way to keep the agent-authored markdown summary in sync with the graph. Worth surfacing as a small `docs/solutions/architecture-patterns/` entry once it has been used in anger.
