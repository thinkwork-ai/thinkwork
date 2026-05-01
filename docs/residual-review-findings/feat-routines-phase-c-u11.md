# Residual Review Findings — feat/routines-phase-c-u11

**Plan**: docs/plans/2026-05-01-006-feat-routines-phase-c-authoring-plan.md (U11)
**Branch**: feat/routines-phase-c-u11
**Review**: self-review across standard lenses (correctness, security, testing, maintainability, project-standards)

No P0/P1 findings. The visibility-check helper is the load-bearing safety surface and has six pure-logic tests covering the matrix (owning-agent allow, other-agent reject, tenant-shared allow, cross-tenant reject including the tenant-shared case, not-found). Items below are P2/P3 polish.

## Residual findings

- **P2 [security/maintainability] visibility model is `agentId`-only**. The plan's design intent calls for a first-class `visibility: 'agent_private'` field plus an `owning_agent_id` column distinct from `agentId`. The current schema (`Routine.agentId`) carries both meanings: "this routine's owning agent" AND "this routine's primary execution agent". Conflating them works for v0 but blocks future shapes — e.g., a routine owned by an agent but invoked under a different agent's identity. Resolution: Phase E schema add for `visibility` enum + `owning_agent_id` column, with the v0 helper preserving `agentId` semantics by default.

- **P3 [testing] `buildAgentStampMarkdown` not unit-tested**. Pure helper that's exported. A small vitest covering "intent only", "intent + suggested steps", and "trims whitespace from intent" would close the gap.

- **P3 [testing] `notYetEnabled` and `routinesAgentToolsEnabled` not unit-tested**. The env-gate path is the entire reason the tools ship in this PR (inert pattern). A small test that flips `process.env.ROUTINES_AGENT_TOOLS_ENABLED` and asserts the right response shape would prove the gate works.

- **P3 [maintainability] placeholder ASL duplicated across surfaces**. The `Comment: "Draft routine — awaiting builder", StartAt: "NoOp", States: { NoOp: { Type: "Succeed" } }` shape now appears in three places: `apps/admin/src/routes/.../new.tsx` (admin form), `apps/mobile/app/routines/new.tsx` (mobile form), and `packages/admin-ops/src/routines.ts` (MCP create). A shared constant in `packages/database-pg/graphql/types/routines.graphql` adjacent code (or a new `packages/api/src/lib/routines/placeholders.ts`) would dedupe.

- **P3 [advisory] `intent` minimum length is `10` chars and arbitrary**. Reasonable starting point but a more sophisticated check (semantic content, not just length) belongs in the validator (Phase A U5) or the chat builder prompt (Phase C U10). Today's check just rejects `"do stuff"`.

## Deferred from U11

- **Visibility schema add** — `visibility` enum + `owning_agent_id` column on `routines` table + GraphQL surface. Phase E candidate.

- **AgentCore warm flush after merge** — per the plan execution note, the agent runtime needs a force-flush so `tools/list` returns the new tools. The inert env flag means flushing is decoupled from this PR's merge — the operator can flush whenever convenient and the agent still sees `not_yet_enabled` until both the flush AND `ROUTINES_AGENT_TOOLS_ENABLED=true` are set.

- **Integration test against dev** — the plan's verification clause (`tools/list` MCP call returns the new tools after warm flush; tools work end-to-end with env flag set) requires a live dev tenant and AgentCore runtime. Not in scope for U11's code-merge PR.
