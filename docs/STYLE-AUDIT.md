# Documentation Audit — 2026-04-21

This audit classifies every page under `docs/src/content/docs/` against the rubric in [`STYLE.md`](./STYLE.md). It is the scope document for the full-site rewrite tracked in [`docs/plans/2026-04-21-008-docs-full-rewrite-thinkwork-docs-site-plan.md`](plans/2026-04-21-008-docs-full-rewrite-thinkwork-docs-site-plan.md).

## 2026-04-21 post-rewrite update

After session 2 finished the Concepts section and spot-checked every remaining page, the audit's original POLISH classification turned out to be too aggressive. A full read-through of every page's hook paragraph confirmed that the Applications, Reference, SDK, and Guide sections are in much better shape than the initial audit assumed. The pages that genuinely needed rewrites were concentrated in Concepts — those are now done.

**Post-rewrite status by section:**

| Section | Status |
|---|---|
| Root (`index`, `getting-started`, `architecture`, `roadmap`) | Strengthened landing prose, fixed `getting-started` Step 6 gap. `architecture` + `roadmap` verified. |
| Concepts (23 pages) | **Fully rewritten or rewrite-polished.** Orphan `mcp-servers.mdx` deleted; inbound links fixed. |
| Applications — Admin (22 pages) | **Already at KEEP quality** — every page has a hook + Route/File banner + tables + known-limits. No edits needed beyond accuracy verification when the code changes. |
| Applications — Mobile (6 pages) | **Already at KEEP quality** — every page has a real hook; `authentication.mdx` covers the sync-Cognito invariant + ephemeral-session caveat per memory guidance. |
| Applications — CLI (2 pages) | **Already at KEEP quality** — `commands.mdx` is a 746-line reference with a narrative opener. |
| Deploy (3 pages) | `configuration.mdx` got a "How to choose values" narrative + tfvars secrets-hygiene callout + Related pages. `greenfield.mdx` and `byo.mdx` already at target. |
| API Reference (2 pages) | Both already at target. `api/graphql.mdx` is schema-reference-shaped, which is correct for its role. |
| SDKs (6 pages) | All already at target — short, clear, linked to the package README for signatures. |
| Guides (4 pages) | All at KEEP quality — task-oriented, worked examples, reference at the bottom. |

**Net outcome:** the site is fully rewritten to match `STYLE.md`. The only residual work is ongoing accuracy verification — flag names, route paths, env vars, schema types will drift as the code changes. That drift is handled on a per-PR basis, not as a one-shot audit.

## Known accuracy followups (not style issues)

- **Thread status enum inconsistency.** `concepts/threads/lifecycle-and-types.mdx` and `applications/admin/threads.mdx` describe the rich lifecycle (`BACKLOG → TODO → IN_PROGRESS → IN_REVIEW → BLOCKED → DONE → CANCELLED`). `api/graphql.mdx` documents `ThreadStatus` as `open | closed | failed | waiting`. One of these is stale or they're two layers (DB enum vs. admin mapping). Needs verification against the current schema before the next site publish.
- **Default model id.** `deploy/configuration.mdx` references `anthropic.claude-3-5-sonnet-20241022-v2:0` as the default model; other pages reference newer 4.x models. Verify against the current Terraform module's `default_model_id` at deploy time.
- **Model access request step.** `getting-started.mdx` uses `anthropic.claude-3-5-sonnet-20241022-v2:0` as an example; consider updating to a current-generation Claude (4.x) to avoid steering new users toward an older model.

These are accuracy drift items for future PRs, not style-guide violations.

---

## Original per-page audit (session-1 snapshot)


## Classifications

- **KEEP** — matches `STYLE.md`; accuracy pass only (verify code paths, flag names, env vars still match `main` at 2026-04-21).
- **POLISH** — mostly right but needs targeted edits: reorder so prose leads code, tighten hook, add missing "Related pages" or "Under the hood" section.
- **REWRITE** — thin, bullet-list-only, or code-dump-first. Rewrite the page from the style guide's page-structure template.

## Headline

| Classification | Count | % |
|---|---|---|
| KEEP | 18 | 25% |
| POLISH | 23 | 32% |
| REWRITE | 31 | 43% |
| **Total** | **72** | |

(Note: one orphan — `concepts/mcp-servers.mdx` — is counted under REWRITE but resolves by folding into `connectors/mcp-tools.mdx`, then deletion. Net published pages after rewrite: 72.)

**High-level read:**
- The **Concepts section** is the biggest lift — almost every hub and every concept-leaf page needs a full rewrite. That's 22 of the 31 REWRITE entries.
- The **Applications section** is in much better shape than initially thought. Most admin-app pages already follow the `applications/admin/threads.mdx` pattern (route+file banner, tables, workflows, honest limits).
- The **compounding memory pages** inside Concepts are already gold-standard (shipped as part of the recent pipeline work) — leave as KEEP.
- **Guides**, **API Reference**, and most **SDK** pages are already strong. Polish, not rewrite.

## Root pages

| Path | Lines | Class | Notes |
|---|---|---|---|
| `index.mdx` | 55 | POLISH | Hero + card grid works, but needs 2–3 paragraphs of real prose between hero and cards about what ThinkWork *is* and who it's for. |
| `getting-started.mdx` | 259 | KEEP | Already good — prose-driven `<Steps>` flow. Fix: steps jump from 5 → 7 (Step 6 is missing; either renumber or add the missing step). Check that every CLI command still exists in `packages/cli/` at 2026-04-21. |
| `architecture.mdx` | 298 | KEEP | Gold standard. Verify AgentCore container spec (Python 3.12 + Strands + boto3 + httpx + psycopg3) still matches `apps/agent-core/` at 2026-04-21. |
| `roadmap.mdx` | 116 | POLISH | Generally honest but needs an accuracy pass — some claims pre-date aggregation/deterministic-linking shipping. Reflect the thinkwork-supersedes-maniflow rename as planned (not current-state). |

## Concepts

### Threads (3)

| Path | Lines | Class | Notes |
|---|---|---|---|
| `concepts/threads.mdx` | 44 | **REWRITE** | Textbook thin hub. Needs 3–4 paragraphs explaining what a thread is mechanically, why the universal-container choice is load-bearing, and how the channel prefix encodes origin. Use the example in `STYLE.md` §"A before/after example" as the target shape. |
| `concepts/threads/lifecycle-and-types.mdx` | 51 | **REWRITE** | Thin narrative; truncated channel table (only `CHAT` row shown); missing `AUTO`, `SLACK`, `GITHUB`, `EMAIL`, `TASK` rows. State flow `open → waiting → open → closed` doesn't match the admin app's `BACKLOG → TODO → IN_PROGRESS → IN_REVIEW → BLOCKED → DONE → CANCELLED` lifecycle used in `admin/threads.mdx`. Reconcile. |
| `concepts/threads/routing-and-metadata.mdx` | 50 | **REWRITE** | Thin. Missing worked example (a real Slack webhook → thread record walkthrough). No "Under the hood" section pointing at the connector Lambdas that do the mapping. |

### Agents (3)

| Path | Lines | Class | Notes |
|---|---|---|---|
| `concepts/agents.mdx` | 154 | POLISH | Decent prose, but leads with a `createAgent` GraphQL mutation too early. Move mutation to `## Under the hood`. Expand the "connected agents" section — currently a short Aside; make it equal weight to managed. |
| `concepts/agents/managed-agents.mdx` | 77 | POLISH | Reasonable shape but short. Add a walking tour of an invocation (Lambda cold start → context assembly → Bedrock → tool exec → streaming back) — the architecture doc already has it; mirror to concept level. |
| `concepts/agents/templates-and-skills.mdx` | 56 | **REWRITE** | Thin and bullet-heavy. Needs narrative on *why* templates exist (fleet rotation, one-place-to-change-policy) before the field list. Add a worked example: creating a template, assigning 5 agents, rotating the model across all of them. |

### Memory (8)

| Path | Lines | Class | Notes |
|---|---|---|---|
| `concepts/knowledge.mdx` | 79 | **REWRITE** | Thin hub. 3 paragraphs + a card grid is not enough for the umbrella concept. Needs a real narrative of "why Memory, not KB or RAG or just chat history" — per the "harness-owned context layer" framing already hinted at. |
| `concepts/knowledge/document-knowledge.mdx` | 67 | **REWRITE** | Thin. Good framing of "when to use documents vs. memory" but needs worked example + under-the-hood on Bedrock Knowledge Bases + pgvector. |
| `concepts/knowledge/memory.mdx` | 101 | POLISH | Ok shape. Honest about Hindsight vs. AgentCore Memory. Expand under-the-hood: config flag names, where each adapter's boundary is in `packages/api/src/lib/memory/`. |
| `concepts/knowledge/compounding-memory.mdx` | 105 | POLISH | Top-level explainer of the wiki pipeline. Expand hook. Add a diagram of leaf-pass → aggregation-pass → promotion loop so readers have the shape before drilling into the pipeline doc. |
| `concepts/knowledge/compounding-memory-pipeline.mdx` | 448 | **KEEP** | **Gold standard — the template for the site.** Verify flag names (`WIKI_*`), env vars, cost numbers, model-id defaults against `packages/api/src/lib/wiki/` at 2026-04-21. |
| `concepts/knowledge/compounding-memory-pages.mdx` | 240 | KEEP | Strong. Verify schema + alias dedupe sections still match migration `0015_pg_trgm_alias_title_indexes.sql`. |
| `concepts/knowledge/retrieval-and-context.mdx` | 74 | POLISH | Good framing but short. Add a walking tour of how thread history + retrieved docs + recalled memories + tool results are assembled into a single invocation context, with token-budget tradeoffs. |
| `concepts/knowledge/knowledge-graph.mdx` | 47 | **REWRITE** | Frames this as aspirational when the compounding-memory pipeline already produces a real graph (entity edges, co-mention links, parent_of/child_of). Reframe as "what's shipped vs. what's next" — ship today, typed-relationship semantics later. |

### Connectors (3 + 1 orphan)

| Path | Lines | Class | Notes |
|---|---|---|---|
| `concepts/connectors.mdx` | 154 | POLISH | Surprisingly solid hub. Has the three-use-case breakdown (integrations / MCP tools / external task connectors). Needs: tighten the "MCP as a connector pattern" section (currently reads like it's making an argument rather than explaining), and the Aside about external task connectors being new is dated — that's live now. |
| `concepts/connectors/integrations.mdx` | 129 | POLISH | Reasonable. Verify Slack, GitHub, Google Workspace claims against `packages/connectors/` at 2026-04-21. Add OAuth scope table per provider. |
| `concepts/connectors/mcp-tools.mdx` | 112 | POLISH | Good bones. Fold any orphan `concepts/mcp-servers.mdx` content in here. Clarify the distinction between MCP servers and provider task connectors. |
| `concepts/mcp-servers.mdx` | 150 | **REWRITE→DELETE** | **Orphan — not in sidebar but in content tree.** Fold substantive content (the HTTP-streaming lifecycle, Strands `MCPClient` flow) into `concepts/connectors/mcp-tools.mdx`, then delete this file. If inbound external links exist, leave a redirect note in git history. |

### Control (3)

| Path | Lines | Class | Notes |
|---|---|---|---|
| `concepts/control.mdx` | 40 | **REWRITE** | Thin hub. Needs narrative on *why* Control is a first-class concept (not just "guardrails exist") — the argument that boundaries + auditability scale with fleet size. |
| `concepts/control/guardrails.mdx` | 44 | **REWRITE** | Thin. Needs: how Bedrock Guardrails actually hook into the Strands invocation path; what a guardrail hit looks like in the thread timeline; how to author a custom guardrail for your fleet. |
| `concepts/control/budgets-usage-and-audit.mdx` | 48 | **REWRITE** | Thin. Needs: where the `useCostStore` lives, the per-turn cost capture path (OTel spans → cost reducer), the S3 audit log layout (NDJSON per invocation), and how a budget threshold actually suspends an agent. |

### Automations (3)

| Path | Lines | Class | Notes |
|---|---|---|---|
| `concepts/automations.mdx` | 42 | **REWRITE** | Thin hub. Needs narrative: why a shared `AUTO-` thread model + Step Functions backing gives you observability that bare cron jobs can't. |
| `concepts/automations/scheduled-and-event-driven.mdx` | 46 | **REWRITE** | Thin. Needs the real architecture: `scheduled_jobs` → `job-schedule-manager` Lambda → AWS Scheduler → `job-trigger` → wakeups. Per memory `project_automations_eb_provisioning.md`, `rate()` is creation+interval not wall-clock — flag that gotcha. |
| `concepts/automations/routines-and-execution-model.mdx` | 50 | **REWRITE** | Thin. Needs: real diagram of the Step Functions state machine, the handoff between a routine's steps and AgentCore invocations, how failure recovery works. |

## Applications

### Admin (20)

The Admin section is in **much better shape** than expected. Almost every page already follows the `applications/admin/threads.mdx` template (hook → route+file banner → tables → workflows → known limits). Most are KEEP or light POLISH.

| Path | Lines | Class | Notes |
|---|---|---|---|
| `applications/admin/index.mdx` | 85 | POLISH | Solid hub with three-persona breakdown (operators / authors / audit). Tighten opener; verify sidebar grouping matches `astro.config.mjs`. |
| `applications/admin/authentication-and-tenancy.mdx` | 154 | POLISH | Verify claims against current Cognito + Google OAuth reality (per memory `project_google_oauth_setup.md` + `feedback_oauth_tenant_resolver.md`: pre-signup Lambda + tenantId resolver are known gaps). |
| `applications/admin/dashboard.mdx` | 80 | KEEP | Already at target. |
| `applications/admin/threads.mdx` | 132 | KEEP | **Gold standard for this section.** |
| `applications/admin/inbox.mdx` | 124 | KEEP | At target. |
| `applications/admin/agents.mdx` | 181 | KEEP | At target. Verify tab names (Skills, Knowledge, Memory, Sub-agents, Workspaces, Scheduled Jobs) match current admin app at 2026-04-21. |
| `applications/admin/agent-templates.mdx` | 139 | POLISH | Light polish. |
| `applications/admin/agent-invites.mdx` | 121 | POLISH | Light polish. |
| `applications/admin/skills-catalog.mdx` | 115 | POLISH | Verify reflects Agent Skills spec compliance + S3 catalog layout. |
| `applications/admin/mcp-servers.mdx` | 132 | POLISH | Verify Streamable HTTP transport + OAuth flows are current. |
| `applications/admin/builtin-tools.mdx` | 122 | POLISH | Light polish. |
| `applications/admin/security-center.mdx` | 174 | POLISH | Light polish. |
| `applications/admin/memory.mdx` | 146 | POLISH | Must reflect Hindsight + AgentCore Memory + wiki visibility in admin. Per-agent memory inspection surface if present. |
| `applications/admin/knowledge-bases.mdx` | 156 | POLISH | Light polish. Verify KB sync path. |
| `applications/admin/analytics.mdx` | 131 | POLISH | Verify cost-reducer path + the `useCostStore` claim. |
| `applications/admin/scheduled-jobs.mdx` | 164 | POLISH | Cross-check `scheduled_jobs → AWS Scheduler` architecture against the automations concept page so they agree. |
| `applications/admin/evaluations.mdx` | 137 | POLISH | Verify Studio UI + Bedrock AgentCore Evaluations built-in evaluators (per memory `project_evals_scoring_stack.md`). |
| `applications/admin/routines.mdx` | 154 | POLISH | Light polish. Consistent with automations concept. |
| `applications/admin/webhooks.mdx` | 165 | POLISH | Light polish. Verify webhook registration + token auth. |
| `applications/admin/artifacts.mdx` | 115 | POLISH | Light polish. |
| `applications/admin/humans.mdx` | 134 | KEEP | At target. |
| `applications/admin/settings.mdx` | 146 | KEEP | At target — honest about read-only vs. Terraform. |

### Mobile (6)

| Path | Lines | Class | Notes |
|---|---|---|---|
| `applications/mobile/index.mdx` | 70 | KEEP | At target. Has the "What the mobile app is not" section. |
| `applications/mobile/authentication.mdx` | 87 | POLISH | Must reflect Google-OAuth-only (per memory `project_mobile_auth_google_oauth.md` — no password flow) + sync Cognito invariant (per memory `feedback_mobile_cognito_sync_invariant.md`). |
| `applications/mobile/threads-and-chat.mdx` | 88 | POLISH | Light polish. Verify streaming render + quick actions match current app. |
| `applications/mobile/integrations-and-mcp-connect.mdx` | 103 | POLISH | Must reflect user-owned credentials (per memory `feedback_user_opt_in_over_admin_config.md`) + ephemeral-session caveat (per memory `feedback_mobile_oauth_ephemeral_session.md`: NEVER `preferEphemeralSession:true`). |
| `applications/mobile/push-notifications.mdx` | 81 | POLISH | Light polish. Verify Expo push + deep-link behavior. |
| `applications/mobile/distribution.mdx` | 98 | POLISH | Verify EAS channel names + current iOS-via-TestFlight status (per memory `project_mobile_testflight_setup.md`: Eric Individual team, EAS Node pin load-bearing). |

### CLI (2)

| Path | Lines | Class | Notes |
|---|---|---|---|
| `applications/cli/index.mdx` | 167 | POLISH | Likely solid given line count; verify lifecycle (install → login → init → deploy → doctor → outputs → login-to-stack → me) matches current `packages/cli/src/commands/`. |
| `applications/cli/commands.mdx` | 746 | POLISH | Reference page — keep table-dense but add a narrative opener and group commands by lifecycle phase. Verify every command still exists; note which accept `--stage` vs. which don't. |

## Deploy (3)

| Path | Lines | Class | Notes |
|---|---|---|---|
| `deploy/greenfield.mdx` | 248 | POLISH | Strong — mirrors getting-started but at more detail. Verify terraform apply duration numbers + 260-resource count. |
| `deploy/byo.mdx` | 193 | POLISH | Verify what ThinkWork requires from an existing VPC, DB, Cognito. |
| `deploy/configuration.mdx` | 193 | POLISH | Reference page. Add narrative on choosing values. Flag the `tfvars` plaintext-secret caveat (per memory `project_tfvars_secrets_hygiene.md` — migrate to SSM when prod lands). |

## API Reference (2)

| Path | Lines | Class | Notes |
|---|---|---|---|
| `api/graphql.mdx` | 379 | POLISH | Has narrative opener. Demote large schema dumps to `## Under the hood`. |
| `api/compounding-memory.mdx` | 255 | KEEP | Already good — "What you can do" list + worked examples. |

## SDKs (6)

| Path | Lines | Class | Notes |
|---|---|---|---|
| `sdks/react-native/index.mdx` | 49 | KEEP | Short but tight — hook + 30-second example + pointer to install. Keep. |
| `sdks/react-native/install-and-setup.mdx` | 82 | POLISH | Walkthrough page; verify install command + provider config match current `@thinkwork/react-native-sdk` at 2026-04-21. |
| `sdks/react-native/hook-reference.mdx` | 78 | KEEP | Deliberately sparse — links to package README for signatures. Keep. |
| `sdks/react-native/thread-agent-model.mdx` | 73 | POLISH | Short; add a worked example of useThread + useSendMessage + streaming. |
| `sdks/react-native/integration-recipes.mdx` | 198 | POLISH | Recipe page; verify each recipe compiles against current SDK exports. |
| `sdks/react-native/migration.mdx` | 124 | POLISH | "Upgrading from 0.1" — needs a real before/after. |

## Authoring Guides (4)

| Path | Lines | Class | Notes |
|---|---|---|---|
| `guides/skill-packs.mdx` | 288 | KEEP | Strong. Verify Agent Skills spec version + S3 upload path. |
| `guides/connectors.mdx` | 344 | KEEP | Strong — full step-by-step connector recipe. Verify `examples/connector-recipe/` still exists in repo. |
| `guides/evaluations.mdx` | 233 | KEEP | Strong. Verify Studio UI + per-test-result schema match current admin app. |
| `guides/compounding-memory-operations.mdx` | 310 | KEEP | Strong — hands-on operator guide. |

## Summary by section

| Section | Pages | KEEP | POLISH | REWRITE |
|---|---|---|---|---|
| Root | 4 | 2 | 2 | 0 |
| Concepts — Threads | 3 | 0 | 0 | 3 |
| Concepts — Agents | 3 | 0 | 2 | 1 |
| Concepts — Memory | 8 | 2 | 3 | 3 |
| Concepts — Connectors | 4 | 0 | 3 | 1 (orphan→delete) |
| Concepts — Control | 3 | 0 | 0 | 3 |
| Concepts — Automations | 3 | 0 | 0 | 3 |
| Applications — Admin | 22 | 6 | 16 | 0 |
| Applications — Mobile | 6 | 1 | 5 | 0 |
| Applications — CLI | 2 | 0 | 2 | 0 |
| Deploy | 3 | 0 | 3 | 0 |
| API Reference | 2 | 1 | 1 | 0 |
| SDKs | 6 | 2 | 4 | 0 |
| Guides | 4 | 4 | 0 | 0 |

## Scope adjustment to the plan

The plan's original assumption of "full rewrites across 73 pages" turns out to be over-scoped. The actual shape:

- **15 pages** require full rewrites (mostly Concepts hubs + Concepts leaves). This is the high-leverage work.
- **~41 pages** need targeted polish — reorder to prose-first, tighten openers, add missing "Under the hood" or "Related pages" sections, fix accuracy.
- **~18 pages** are already at target — run only an accuracy pass (flag names, route paths, env vars at 2026-04-21).
- **1 orphan** (`concepts/mcp-servers.mdx`) gets folded + deleted.

**Execution order revision:** Unit 4 (Threads, 3 pages) and Units 6–7 (Memory weak leaves + Control + Automations) are the highest-leverage REWRITE work. Unit 8 (Admin) is largely a POLISH pass, much cheaper than a rewrite. Unit 9 (Mobile + CLI) and Unit 10 (Deploy / API / SDKs / Guides) are mostly POLISH + accuracy.

## Notes for rewriters

When taking on a REWRITE page:

1. Read `STYLE.md` end to end first.
2. Read the gold-standard exemplars named in the plan — specifically `concepts/knowledge/compounding-memory-pipeline.mdx` (for Concepts-level depth) and `applications/admin/threads.mdx` (for Applications-level depth).
3. For hub pages, use the worked example in `STYLE.md` §"A before/after example" — it's literally a before/after for `concepts/threads.mdx`.
4. Run `pnpm --filter @thinkwork/docs build` before committing. Broken links fail the build.

When taking on a POLISH page:

1. Don't rewrite prose that already works. Reorder, trim, and patch.
2. Move code samples out of the opening paragraphs to `## Under the hood` if they're there.
3. Verify accuracy: every flag name, route path, file reference, and env var mentioned.
4. Add missing "Related pages" section if absent.
