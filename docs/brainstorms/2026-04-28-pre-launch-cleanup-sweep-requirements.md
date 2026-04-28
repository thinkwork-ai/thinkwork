---
date: 2026-04-28
topic: pre-launch-cleanup-sweep
---

# Pre-launch cleanup sweep

## Problem Frame

The repo has shipped ~22 PRs against the v1 agent-architecture plan ("Plan 008"), several Tier-1 retirement decisions (external provider-as-task-connector, `setAgentSkills` mutation, `parseSkillYaml` alias), and a parallel Pi runtime substrate — all in the last 4-6 weeks. Several of those decisions left behind plumbing, deprecated callers, or inert handlers that were correct to leave in place at merge time but are now ready to remove. Before launch, we want a sweep that retires the known-stale surfaces so we ship a smaller, clearer codebase rather than carrying deprecated paths forward.

This brainstorm captures the approved cleanup slate. Each requirement below becomes its own `/ce-plan` invocation; this doc is the prioritized work register, not a single implementation plan.

---

## Requirements

**Tier 1 — Dead or stale code (immediate, small, isolated)**

- R1. **Delete `genui-refresh-legacy.ts`.** Resolver file at `packages/api/src/graphql/resolvers/messages/genui-refresh-legacy.ts` (~70 LOC) has zero importers in the repo. Verified via repo-wide grep for `genui-refresh-legacy`, `GENUI_REFRESH_MAP`, and `genuiRefreshLegacy` — no hits. Delete the file and any test fixtures referencing it.

- R2. **Remove external provider-as-task-connector terraform plumbing.** The task-connector surface was retired 2026-04-20; external provider-as-MCP-server stays. Remove the `task_system_tasks_api_url` variable definitions and `task_system_tasks_API_URL` env injection across `terraform/examples/greenfield/main.tf:151,295`, `terraform/modules/app/lambda-api/{handlers.tf:63,67, variables.tf:249}`, and `terraform/modules/thinkwork/{main.tf:219, variables.tf:359}`. Confirm no Lambda handler still reads the env var before removing.

- R3. **Replace stale `eric@maniflow.ai` reference in EAS config.** `apps/mobile/eas.json:48` points at the retired `maniflow.ai` Apple Developer email. Update to the current thinkwork-domain contact and verify the EAS build still resolves the right Apple team.

- R4. **Retire `parseSkillYaml` alias.** Per plan `2026-04-24-009 §U2`, the alias at `packages/skill-catalog/scripts/census.ts:216` was scheduled for removal one PR cycle after introduction; that window has passed. Delete the alias and update any internal callers to `parseSkillFrontmatter`.

- R8. **Delete the Composable Skills documentation section.** The `execution: composition` runtime mode was retired in U6 of plan `2026-04-22-005` (PR #547). `packages/agentcore-strands/agent-container/container-sources/skill_md_parser.py:52` hardcodes `ALLOWED_EXECUTION_VALUES = ("script", "context")` and rejects composition with an audit error referencing U6; zero skills in `packages/skill-catalog/` use composition mode. The 3-page docs section overstates what survives. Touch points:
  - Delete `docs/src/content/docs/concepts/agents/composable-skills/{index,authoring,primitives}.mdx`
  - Remove the `Composable Skills` section from `docs/astro.config.mjs:107-124`
  - Move `docs/plans/2026-04-21-003-feat-composable-skills-with-learnings-plan.md` and `docs/plans/2026-04-22-005-feat-composable-skills-hardening-handoff-plan.md` to `docs/plans/archived/` so the U6 retirement audit trail survives
  - The 3 broken `/applications/admin/skill-runs/` links inside the deleted pages become moot — no separate fix needed
  - Run `pnpm --filter @thinkwork/docs build` before committing — broken links fail the build

- R9. **Rephrase "composable-skill connector script" prose.** Composition is retired, but "connector skills" remain a live design pattern (R13 of plan `2026-04-21-003`). The doubly-wrong phrasing leads readers to a deleted concept. Touch points:
  - `docs/src/content/docs/concepts/agents/code-sandbox.mdx` lines 12, 31, 148 — rephrase "composable-skill connector script" → "connector skill"
  - `packages/skill-catalog/sandbox-pilot/SKILL.md:46` — same rephrase
  - `packages/skill-catalog/customer-onboarding-reconciler/README.md` — drop the "composable-skills D7a/D7b webhook anchor" framing line; the rest of the README (reconciler contract description) stays unchanged

**Tier 2 — Plan 008 follow-ups (cross-package migrations)**

- R5. **Retire the `setAgentSkills` GraphQL mutation** (Plan §008 U21). The mutation has logged a `DEPRECATED` warning since `derive-agent-skills.ts` shipped, and `agent_skills` is now derived from `AGENTS.md` writes server-side. Touch points to migrate or delete:
  - `packages/database-pg/graphql/types/agents.graphql:246` — schema definition
  - `packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts` — resolver + DEPRECATED log
  - `packages/lambda/admin-ops-mcp.ts:348` — MCP caller
  - `apps/mobile/lib/graphql-queries.ts:140` — mobile mutation
  - `packages/admin-ops/src/agents.ts:144` — admin client wrapper
  - `packages/api/src/__tests__/graphql-contract.test.ts` — contract assertion
  - Tests asserting the DEPRECATED log can also be removed once the mutation is gone.
  Plan must include codegen regeneration in every consumer with a `codegen` script (admin, mobile, CLI, api).

- R6. **Retire the React Native SDK `userID` parameter.** Four hooks in `packages/react-native-sdk/src/hooks/{use-wiki-graph, use-wiki-page, use-mobile-memory-search, use-recent-wiki-pages}.ts` carry a `@deprecated` annotation on the legacy `userID` param, kept "during rollout." Plan must verify that the published SDK consumers (mobile app + any external consumers) have all migrated to `userId`, then drop the deprecated param signature in the next minor SDK version.

- R7. **Drop the `oauth_provider` column from `mcp-servers` schema.** `packages/database-pg/src/schema/mcp-servers.ts:7` marks the column as "kept for migration compat" pending RFC 9728 discovery rollout. Plan must confirm RFC 9728 discovery is fully deployed across stages, then ship a Drizzle migration to drop the column and sweep any remaining readers.

- R10. **Rename composition-named skill-runs GraphQL surface.** The feedback rollup is generic infrastructure but historically named after the composition runtime. Touch points:
  - Rename `packages/api/src/graphql/resolvers/skill-runs/compositionFeedbackSummary.query.ts` → `skillFeedbackSummary.query.ts`
  - Rename the GraphQL field `compositionFeedbackSummary` → `skillFeedbackSummary` in `packages/database-pg/graphql/types/*.graphql`
  - Update `apps/admin/src/lib/graphql-queries.ts:2299` and any other consumers
  - Update stale prose in `apps/admin/src/routes/_authed/_tenant/analytics/skill-runs/index.tsx` (lines 4, 174, 238) and `$runId.tsx` (lines 2-3) — "composition invocations" → "skill runs"
  - Regenerate codegen in admin + mobile + cli + api consumers
  - Plan must verify no external GraphQL clients consume `compositionFeedbackSummary` before the rename; if any exist, plan a deprecation alias window. Internal grep is the first check.

---

## Success Criteria

- After all ten cleanups land, a fresh repo grep for `task_system_tasks_api_url`, `setAgentSkills`, `parseSkillYaml`, `genui-refresh-legacy`, `oauth_provider` (in mcp-servers context), `composable-skill connector script`, and `compositionFeedbackSummary` returns zero hits outside of the two archived composable-skills plans (which retain the terms as historical audit trail).
- The four React Native SDK hooks expose a single param shape (`userId`); no parallel signatures remain.
- `apps/mobile/eas.json` carries no references to the retired `maniflow.ai` domain.
- Each cleanup ships as an independent PR so any single one can be reverted without dragging the others. CI stays green at every step.
- The admin and mobile UIs continue to manage agent skills via the AGENTS.md write path with no observable behavioral change to operators.

---

## Scope Boundaries

- **The `maniflow` infrastructure rename** (35 runtimes, 40+ Lambdas, 103 SSM parameters) is its own planned PRD per existing memory and is **not** included in this sweep. We are only fixing the stale email address here.
- **The Pi runtime substrate** (`packages/agentcore-pi`, related Terraform) is intentional parallel infrastructure — out of scope; do not propose collapsing it back into Strands.
- **The AgentCore-managed memory engine vs Hindsight duality** is deferred to "Outstanding Questions" — we are not deciding the fate of the unused branch in this sweep.
- **`promptfoo` in `packages/agent-tools` devDependencies** stays; it remains a dev-only eval utility distinct from the production AgentCore Evaluations stack.
- **General TODOs without explicit removal conditions** (e.g., `check-agent-health.ts:46` restart logic placeholder, `recipe-refresh.ts:20` MCP URL lookup) are future-feature work, not cleanup. Out of scope.
- **No new abstractions, refactors, or simplifications** beyond removing the named items. This is a delete sweep, not a rewrite.
- **The `skill_runs` audit table, admin observability UI, scheduled-jobs reconciler, and `triggered_by_run_id` reconciler-loop tracking** all stay — they are generic skill-run infrastructure, not composition-specific. Do not propose dropping these as part of R8–R10.
- **The `execution: composition` rejection tripwires** in `skill_md_parser.py` and `skill_resolver.py` stay — they prevent accidental re-introduction of the retired runtime mode. The associated audit tests (`test_skill_md_parser.py::test_execution_composition_rejected`, `test_skill_resolver.py::test_unparseable_local_logs_and_falls_through`) stay too.

---

## Key Decisions

- **One PR per cleanup item.** Each Tier 1 + Tier 2 requirement gets its own `/ce-plan` and its own PR. Bundling them risks tangled reverts and obscures which cleanup caused any post-deploy regression.
- **Tier 1 ships before Tier 2.** Tier 1 items are localized and verifiable in isolation; Tier 2 items require codegen regeneration and cross-package call-site sweeps. Sequencing Tier 1 first builds confidence in the sweep cadence and frees attention for the migrations.
- **No deprecation grace period for items that already had one.** R4 (`parseSkillYaml`), R5 (`setAgentSkills`), and R6 (SDK `userID`) each shipped with explicit deprecation notices when introduced; we do not add a second cycle.
- **Tier 3 items stay in this doc as Deferred Questions, not as silent backlog.** This keeps the sweep visible and finishable rather than open-ended.

---

## Dependencies / Assumptions

- All seven items can ship independently of each other. No cross-item ordering constraints beyond the Tier 1 → Tier 2 sequencing decision above.
- Assumes RFC 9728 discovery rollout for MCP servers is complete in dev, staging, and prod before R7 plans the column drop. Plan must verify, not assume.
- Assumes the published `@thinkwork/react-native-sdk` consumer base for R6 is limited to the in-repo mobile app plus any internal-only beta consumers. If external consumers exist, R6 needs a deprecation timeline rather than an immediate drop.
- Each cleanup PR follows the existing pre-commit gate (`pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`). No special CI work needed.

---

## Outstanding Questions

### Resolve Before Planning

_None._ All seven approved items are concrete enough to enter `/ce-plan` directly.

### Deferred to Planning

- [Affects R5][Technical] During R5 planning, confirm via CloudWatch logs (`/aws/lambda/thinkwork-${stage}-graphql-http`) that no caller hit `setAgentSkills` in the last 14 days before deleting the resolver. If recent calls exist, identify and migrate the caller in the same PR.
- [Affects R6][Needs research] Inventory external consumers of `@thinkwork/react-native-sdk` (npm download stats, internal usage tracking) before dropping the deprecated `userID` param. If any external consumer remains, hold R6 for a versioned major release.
- [Affects R7][Technical] Verify RFC 9728 OAuth discovery is the active path in production by checking live MCP server connect logs. If the legacy `oauth_provider` column is still being read in hot paths, R7 plans a backfill + dual-write window first.
- [Affects R8][Decision] Plan archive vs. delete: moving the two composable-skills plans to `docs/plans/archived/` preserves the U6 retirement audit trail; full deletion would lose context for future readers. Recommendation is archive, not delete. Confirm during planning.
- [Affects R10][Technical] Before the GraphQL field rename, grep external repos and the public CLI / mobile SDK for `compositionFeedbackSummary` consumers. If any external client reads it, R10 plans a deprecation alias (`compositionFeedbackSummary` returns the same shape as `skillFeedbackSummary`) for one minor version cycle.

### Tier 3 — Verification queue (revisit after Tier 1 + 2 lands)

These items were surfaced by the scan but need a 2-10 min verification before they can be approved or rejected. Triage in a follow-up brainstorm.

- **`manifest-log` Lambda handler** — registered in `scripts/build-lambdas.sh` but has no Terraform route. Did the U15 part 2 wiring PR ship? If yes, wire the route; if no, is the work still planned?
- **`enable_workspace_orchestration` Terraform gate** — defined in `terraform/modules/thinkwork/variables.tf` but no obvious runtime read. Leftover gate from an unshipped phase, or live wiring we missed?
- **AgentCore-managed memory engine branch** — both Hindsight and AgentCore-managed paths are wired behind `memory_engine` / `enable_hindsight`. Memory says we're committed to Hindsight. Decision: fully retire the AgentCore branch, or keep it as a documented fallback gate?
- **In-flight external task working-tree sweep (R2 implementation)** — the current uncommitted ~62 modified + 5 deleted files in the working tree appear to be the runtime/SKILL.md/docs side of R2 (rename `task_system_tasks_*`, delete the retired task-intake skill pack, retire prose). Confirm at PR time that this work also covers the terraform `task_system_tasks_api_url` plumbing R2 explicitly names; if not, that's a sibling follow-up PR.
- **Code comments referencing "composable-skills Unit 4"** — `packages/database-pg/src/schema/skill-runs.ts:101`, `packages/api/src/graphql/utils.ts:89`, `apps/admin/src/lib/graphql-queries.ts:2299`. Low value to remove (audit trail), but if R10 plan touches those files anyway, consider rewording to "skill-runs Unit 4".
- **`docs/STYLE-AUDIT.md` staleness** — the doc is mostly self-correcting (the 2026-04-21 post-rewrite section explicitly handles ongoing drift), and the in-flight external task sweep already updates the line 105 reference. No further action needed; flagged for completeness.

---

## Next Steps

-> `/ce-plan` for R8 (delete Composable Skills doc section) — smallest scoped item, no code touched, ships in one PR.

Tier 1 sequencing (any order after R8): R1, R2 (the in-flight external task sweep is part of this), R3, R4, R9. Tier 2 sequencing (one at a time): R5, R6, R7, R10. Revisit Tier 3 verification queue once Tier 1 + 2 are clear.
