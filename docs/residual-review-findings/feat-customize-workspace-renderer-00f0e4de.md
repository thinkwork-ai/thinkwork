# Residual Review Findings — feat/customize-workspace-renderer (00f0e4de)

Run artifact: `/tmp/compound-engineering/ce-code-review/20260509-172038-202493cf/`
Reviewers: 11 (correctness, testing, maintainability, project-standards, agent-native, learnings, security, performance, reliability, adversarial, kieran-typescript)
Verdict: Ready with fixes (autofixes applied; residuals below)

## Residual Review Findings

### High — Should fix in a follow-up

- **R1 — Single-toggle stale AGENTS.md when renderer fails (no retry / no DLQ / no reconciler).** The helper logs and returns; the binding write commits but AGENTS.md stays stale until a future toggle for the same agent. A user who enables Slack once during an S3 blip gets a permanent skew unless an unrelated trigger re-renders. **Fix path:** add an SQS DLQ on renderer failure with a periodic reconciler, or surface failures via a periodic per-agent `regen-all-workspace-maps` cron job. Reviewer: reliability-rel-1.

- **R2 — Concurrent-render race overwrites a fresh AGENTS.md.** Two near-simultaneous toggles race the read-then-write S3 sequence: renderer A reads pre-B state, B writes through, A's delayed write overwrites with stale content. Worst-case observed: one toggle's binding doesn't appear in AGENTS.md until the next toggle re-renders. **Fix path:** S3 PutObject `If-Match` ETag precondition + retry-on-mismatch (read-render-write loop), or a per-agent in-process mutex during render. Reviewers: adversarial-1, reliability-rel-4.

### Medium — Fix when adjacent work touches the surface

- **R3 — Surface `workspaceMapStatus` field on the 6 mutation responses.** Today the helper swallows renderer failures silently from the response perspective; smoke gates have to scrape CloudWatch for `regenerateWorkspaceMap failed`. Returning `{ workspaceMapRendered: boolean, reason: string | null }` on each Customize mutation lets PR #838-style smoke pinning verify the renderer fired. Reviewer: adversarial-4.

- **R4 — S3 client lacks explicit timeout; cold-start S3 + 30s Lambda budget.** Renderer fires 6+ S3 round trips. Cold start + slow region + manifest regen could push p99 close to the 30s graphql-http Lambda timeout (terraform/modules/app/lambda-api/handlers.tf:427). **Fix path:** add `requestHandler` timeout to the S3Client construction (e.g., 5s per operation), and audit the Lambda timeout for the new sync path. Reviewers: reliability-rel-3, rel-7.

- **R5 — Schedule precedence: `default_schedule ?? routine_schedule` makes catalog default beat row-level schedule.** Today both values are equal because enableWorkflow seeds the row from the catalog. If a per-routine override mutation later lands, the renderer silently reverts AGENTS.md to the catalog default rather than honoring the user's edit. **Fix path:** invert precedence to `routine_schedule ?? default_schedule` once override mutations exist, OR keep current precedence and treat catalog as authoritative (document explicitly). Reviewer: correctness-1.

- **R6 — Sequential workspace folder CONTEXT.md reads + 5 sequential independent DB queries.** ~150-500ms unnecessary latency. **Fix path:** Promise.all on per-workspace CONTEXT.md fetches and on the 5 independent (skills, KBs, connectors, routines, skill_catalog) queries. Reviewers: performance-2, performance-3.

### Low / advisory follow-ups

- **R7 — Helper signature reshape.** `renderWorkspaceAfterCustomize(resolverName, agentId, computerId)` requires every caller to compute `computer.primary_agent_id ?? computer.migrated_from_agent_id ?? null` first. Reshape to take the Computer row and own the fallback. Removes 6× duplication. Reviewer: maintainability-M1.

- **R8 — Renderer god-module split.** `workspace-map-generator.ts` is 738 lines; `regenerateWorkspaceMap` is a 320-line procedural function with phases 1-10. Split into per-projection helpers (`projectConnectors` / `projectWorkflows` / `projectSkills` / `projectKnowledgeBases`). Not blocking; flag for the next Customize surface. Reviewer: maintainability-M3.

- **R9 — Agent vocabulary gap.** `packages/workspace-defaults/files/CAPABILITIES.md` doesn't document the new `## Connectors` / `## Workflows` sections. The agent receives them in its prompt but has no documented vocabulary that says what they are. **Fix path:** add a short "Customization Surface" subsection to CAPABILITIES.md naming the two sections. Reviewer: agent-native-F1.

- **R10 — Customize-driven AGENTS.md mutations bypass governance audit.** SOC2 Type 1 expects governance-file edits to be auditable. The renderer writes S3 directly; `packages/api/workspace-files.ts` (the audit-emit path) is bypassed. **Fix path:** emit a `workspace.customize_render` audit event when `agentsMapChanged`, OR route renderer writes through workspace-files.ts. Reviewer: agent-native-F2.

- **R11 — `loadCustomizeContext` extraction.** Six near-identical resolver bodies (auth + Computer lookup + requireTenantMember + agentId fallback) totaling ~150 LOC of repetition. Plan-deferred from U6; flagged again here. The next Customize surface should be the trigger to extract. Reviewer: kieran-typescript-M6.

## Already-mitigated / Advisory (no action needed)

- ORDER BY missing → autofix #1 added asc(...) to all 4 list queries; idempotent compare now reliable.
- Auto-resolve missing tenant scope → autofix #2 added eq(computers.tenant_id, agent.tenant_id) + ORDER BY id + LIMIT 1.
- Markdown / prompt injection via unescaped `|` / newlines in catalog text → autofix #3 added escTableCell() helper applied to all 4 table renderers.
- Helper test gap → autofix #4 added 4-test render-workspace-after-customize.test.ts.
- 5 of 6 mutation tests missing "fires renderer" assertion → autofix #5 added explicit assertions on every wire-up.
- BUILTIN_TOOL_SLUGS hardcoded subset → autofix #6 imports the constant + iterates.
- CloudWatch filter break → autofix #7 renamed log message to match legacy `regenerateWorkspaceMap failed` shape.
- derive-agent-skills feedback loop concern → confirmed non-existent (derive only parses `skills/<slug>/SKILL.md`, not AGENTS.md content).
- Module re-import cost → mitigated by Node module cache; ~50ms once per Lambda warm container.
- Built-in filter defense in depth → confirmed at both renderer (workspace-map-generator.ts) and derive paths (derive-agent-skills.ts).
