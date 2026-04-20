---
title: "feat: Add `thinkwork wiki` CLI commands for compile + rebuild"
type: feat
status: active
date: 2026-04-19
---

# feat: Add `thinkwork wiki` CLI commands for compile + rebuild

## Overview

Today the wiki (compounding-memory) compile pipeline is driven three ways: automatically by `memory_retain`, manually from the admin UI's "Compile now" button, and via the `bootstrap_import` worker. Operators (mainly you) currently have no ergonomic way to trigger a compile or rebuild from a terminal — you either pop open the admin app and click, or invoke the mutation with `curl`. This plan adds a `thinkwork wiki` command family to `apps/cli` with the same tenant/agent/interactive-prompt ergonomics as `thinkwork agent`, `thinkwork eval`, and friends.

v1 ships three subcommands — `compile`, `rebuild`, `status` — backed by the existing `compileWikiNow` and `resetWikiCursor` mutations plus a minor backend extension to let the CLI pass a per-run Bedrock model override. Rebuild is split out from compile so the destructive path (`resetWikiCursor(force=true)`) can carry a confirm prompt without polluting the happy path.

## Problem Frame

Operator needs:
- Kick a wiki compile for one agent, several agents, or "every agent in this tenant" from a terminal.
- Rebuild (archive-and-recompile) a specific agent's wiki when the compiler output is known-bad or after a schema change.
- Spike a different Bedrock model for a single compile without redeploying the Lambda or exporting `BEDROCK_MODEL_ID`.
- Watch the resulting job(s) progress without switching to CloudWatch or the admin UI.

The existing GraphQL surface already covers the state mutations (`compileWikiNow`, `resetWikiCursor`); the Lambda handler at `packages/api/src/handlers/wiki-compile.ts:17` already accepts `modelId` in its invocation payload but the `compileWikiNow` resolver does not yet forward one. The gap is entirely in the client (CLI) plus a narrow mutation-argument widening to thread `modelId` through.

## Requirements Trace

- R1. `thinkwork wiki compile` enqueues a compile job for a target `(tenantId, ownerId)` and exits with the job id (non-interactive: exit 0 on enqueued, exit 1 on auth/resolution errors).
- R2. `--tenant <slug>` flag bypasses the tenant picker; `--agent <id>` flag bypasses the agent picker; both picker flows prompt only when TTY.
- R3. When no `--agent` is passed in TTY mode, operator picks from `allTenantAgents(tenantId)` plus a synthetic `All agents` choice that fans out to one compile per agent.
- R4. `--model <id>` overrides `BEDROCK_MODEL_ID` for this run only. Default behavior (no flag) preserves current server-side default.
- R5. `thinkwork wiki rebuild` prompts for confirmation (unless `--yes`), calls `resetWikiCursor(force=true)`, then enqueues a compile for the same scope. Same tenant/agent resolution as `compile`.
- R6. `thinkwork wiki status` shows the most recent compile jobs for the selected scope (by default last 10; `--limit`). Supports `--watch` to poll until terminal, mirroring `thinkwork eval watch`.
- R7. Every subcommand honors the global `--json` flag and emits structured JSON (`{ ok, jobIds, scope }`) on stdout, warnings on stderr — same contract as every other phase-2+ command.
- R8. Admin-only surface: the underlying resolvers already enforce `assertCanAdminWikiScope`. The CLI surfaces a clean "not authorized" message rather than a raw GraphQL error payload.

## Scope Boundaries

- CLI surface only — no admin UI work, no mobile work.
- No new mutation. `compileWikiNow` is widened (adds optional `modelId: String`) but the resolver name, shape, and semantics stay the same. `resetWikiCursor` is unchanged.
- No new background pipeline. Fan-out for "All agents" happens client-side from the CLI — the server still sees one mutation call per agent.
- No change to dedupe semantics. "All agents" just enqueues N dedupe-keyed jobs; concurrent mid-flight duplicates are still collapsed server-side per the existing `onConflictDoNothing` path in `packages/api/src/lib/wiki/repository.ts:255`.
- No subcommand for journal import — `bootstrapJournalImport` is a separate operator workflow and out of scope here.
- No lint / export subcommands in v1 (deferred below).

### Deferred to Separate Tasks

- `thinkwork wiki lint [--agent]` and `thinkwork wiki export`: follow-up PR once the compile/rebuild shape settles.
- Switch `compileWikiNow` from fire-and-forget `InvocationType: Event` to `RequestResponse` with surfaced errors — tracked by memory `feedback_avoid_fire_and_forget_lambda_invokes`; behavior is unchanged by this plan but should be followed up because user-driven CLI invocations make the fire-and-forget weakness much more visible.
- Persisting `model_id` on `wiki_compile_jobs` so a polling worker pickup (not the Event-invoke) still honors the override. See "Risks & Dependencies" for the v1 acceptance of this edge case.

## Context & Research

### Relevant Code and Patterns

- `apps/cli/src/cli.ts` — command registry. New `registerWikiCommand(program)` import + call line lands here.
- `apps/cli/src/commands/eval.ts` + `apps/cli/src/commands/eval/` — canonical pattern for a subcommand family with its own `gql.ts`, `helpers.ts`, and per-command files. The wiki command should mirror this shape rather than a single fat `wiki.ts`, because it has 3 subcommands plus shared context-resolution.
- `apps/cli/src/commands/eval/helpers.ts` — `resolveEvalContext(opts)` is the best template for `resolveWikiContext(opts)`: stage + tenant resolution + Urql client, with `TenantBySlugDoc` fallback for flag-supplied slugs.
- `apps/cli/src/lib/resolve-tenant.ts` — tenant picker already exists and caches to the stage session; wiki commands should reuse it, not re-implement it.
- `apps/cli/src/lib/interactive.ts` — `requireTty`, `isInteractive`, `promptOrExit` are mandatory for consistent TTY vs non-TTY behavior. Any picker path must go through `promptOrExit`.
- `apps/cli/src/lib/resolve-identifier.ts` — UUID-or-slug-or-picker resolver. Use for `--agent` when the operator passes a name/slug instead of an id.
- `apps/cli/src/lib/output.ts` — `printJson`, `printKeyValue`, `isJsonMode`. Output shape.
- `apps/cli/src/commands/eval/run.ts` — best existing example of a TTY/non-TTY bifurcated command with multi-prompt flow. Watch it for the "missing flags fail fast in non-interactive sessions" pattern (lines ~40-60).
- `apps/cli/src/commands/eval/watch.ts` — template for the `--watch` poll loop in `status`.
- `packages/api/src/graphql/resolvers/wiki/compileWikiNow.mutation.ts` — will gain an optional `modelId` argument and thread it into the Lambda `InvokeCommand` payload. The handler at `packages/api/src/handlers/wiki-compile.ts:24` already reads `event.modelId`.
- `packages/database-pg/graphql/types/wiki.graphql:109` — the `compileWikiNow` mutation signature. Widen to `compileWikiNow(tenantId: ID!, ownerId: ID!, modelId: String): WikiCompileJob!`.
- `packages/database-pg/graphql/types/agents.graphql:198` — `allTenantAgents(tenantId, includeSystem, includeSubAgents)` is the right picker source. Fails closed for non-admins, which aligns with the admin-only nature of the mutation.
- `packages/database-pg/graphql/types/agents.graphql:203` — `modelCatalog: [ModelCatalogEntry!]!` feeds the `--model` picker when `--model` is omitted in TTY mode (optional; see Key Technical Decisions).

### Institutional Learnings

- **OAuth tenantId resolver** (`feedback_oauth_tenant_resolver`): not directly relevant to the CLI side (the CLI sends `tenantId` explicitly), but any backend change to `compileWikiNow` should keep using `assertCanAdminWikiScope` which already takes `tenantId` from args rather than relying on `ctx.auth.tenantId`. No regression risk as long as the modelId addition stays additive.
- **Avoid fire-and-forget Lambda invokes** (`feedback_avoid_fire_and_forget_lambda_invokes`): `compileWikiNow` today uses `InvocationType: Event` and catches errors into a `console.warn`. CLI users trigger this from a terminal where silent failures are painful. This plan does NOT fix it in v1 (out of scope), but calls it out as a known sharp edge — the CLI should distinguish "enqueued" from "compiled" and default to showing the operator how to `wiki status --watch` after enqueue.
- **Verify wire format empirically** (`feedback_verify_wire_format_empirically`): after widening the `compileWikiNow` mutation, run a real GraphQL request from the CLI against dev and log the response before writing the code that assumes the new argument shipped. Don't trust the codegen alone.
- **Worktree isolation** (`feedback_worktree_isolation`): land this in `.claude/worktrees/cli-wiki-commands/` off `origin/main`. The main checkout has the admin wiki graph plan (003) and multiple compounding-memory streams in flight.
- **GraphQL Lambda deploys via PR** (`feedback_graphql_deploy_via_pr`): the `compileWikiNow` resolver change deploys via merging to main, not `aws lambda update-function-code graphql-http` — same as every other resolver edit.

### External References

- `docs/architecture` and `packages/api/src/lib/wiki/compiler.ts` (`RunCompileJobOpts.modelId`, lines 120-128) document the per-call model override the pipeline already supports. The plumbing ends at the Lambda event payload — the CLI just needs the resolver to fill that field.

## Key Technical Decisions

- **Command shape: `thinkwork wiki <compile|rebuild|status>` with nested subcommands** — rather than a flat `thinkwork wiki [args]` with `--rebuild` as a flag on compile. Rationale: (1) rebuild is destructive and should require deliberate invocation, matching the split we have for `agent delete`, `kb delete`, and `template delete`; (2) status has a different set of flags (`--limit`, `--watch`) from compile/rebuild and is awkward to overload; (3) it opens the door for `lint` and `export` subcommands later without breaking the flat shape. Reviewer can push back on this — a flat form is possible, but every other CLI surface in this repo with 2+ actions uses nested subcommands.
- **File layout mirrors `eval/`** — `apps/cli/src/commands/wiki.ts` is a thin registrar that imports runners from `apps/cli/src/commands/wiki/{compile.ts,rebuild.ts,status.ts,helpers.ts,gql.ts}`. Rationale: consistency with the closest analogue (`eval`), which also does stage/tenant resolution + TTY prompts + GraphQL + JSON output. Avoids the 400+ line single-file shape of the stubbed `agent.ts`.
- **Widen `compileWikiNow` mutation to accept `modelId: String` (optional)** — rather than introducing a separate `compileWikiWithModel` mutation or stuffing the override into a generic `options: AWSJSON` field. Rationale: modelId is the only per-call override the compile pipeline currently supports, the compile handler already consumes it from the event payload, and keeping the mutation additive means mobile/admin clients don't need to change. Default resolution for the CLI: if `--model` is omitted, the mutation is called without `modelId`, server-side defaults still apply.
- **CLI side "All agents" is a client-side fan-out, not a server multi-scope endpoint** — `thinkwork wiki compile --all` loops over `allTenantAgents(tenantId, includeSubAgents=false, includeSystem=false)` and calls `compileWikiNow(tenantId, ownerId)` once per agent, collecting job ids. Rationale: dedupe is already idempotent server-side, agent counts per tenant are small (typically <20), and keeping the server surface narrow avoids a partially-failed multi-job shape (some succeed, some don't). If an individual enqueue fails the CLI surfaces a per-agent error line and continues; exit code is non-zero if any failed.
- **`rebuild` runs the two mutations back-to-back in the CLI, not a new server mutation** — `resetWikiCursor(tenantId, ownerId, force=true)` followed by `compileWikiNow(tenantId, ownerId, modelId?)`. Rationale: preserves the existing resolver semantics (reset is destructive and advisory-only; compile is the scheduling action); keeps blast radius tight; matches the admin UI's current behavior (two buttons, operator chooses). If either call fails, surface clearly (reset succeeded but compile failed → operator can retry compile; reset failed → nothing changed).
- **Interactive `--model` picker is opt-in, not default** — in TTY mode, if `--model` is omitted, the CLI does NOT prompt. Default = server default (`BEDROCK_MODEL_ID` env). Rationale: most compiles want the default model; prompting would slow the common case. Operators who want a non-default run must pass `--model` explicitly or run `thinkwork config models` to see options. This matches how `--model` behaves on `agent create` (optional override, no implicit prompt).
- **`status` uses the existing `WikiCompileJob` shape** — no new query. Read the most recent jobs directly from `wiki_compile_jobs` via a new lightweight query `wikiCompileJobs(tenantId: ID!, ownerId: ID, limit: Int = 10): [WikiCompileJob!]!` colocated in the wiki schema file. Rationale: `status` is useful but needs server read support that doesn't exist yet; the shape is a trivial repository method (`packages/api/src/lib/wiki/repository.ts` already queries `wikiCompileJobs` in several places). If this gets pushback as scope creep, move `status` to the deferred list and ship `compile` + `rebuild` in v1.
- **Authorization error handling** — `assertCanAdminWikiScope` throws `ForbiddenError`. The CLI catches GraphQL errors, maps the forbidden case to a human message ("Admin access to tenant <slug> is required for wiki operations. Ask your tenant owner to promote your membership.") and exits 2, not 1. Exit 1 reserved for resolution failures (no tenant, no agent).
- **Non-TTY behavior** — mirror `eval run`: when required context is missing and stdin is not a TTY, print a clear error listing missing flags and `process.exit(1)`. Never hang. `--all`, `--agent <id>`, `--tenant <slug>` are all valid ways to satisfy scope resolution non-interactively.

## Open Questions

### Resolved During Planning

- **Should "All agents" be a server or client fan-out?** Client. Server surface stays narrow; dedupe is idempotent; partial-failure reporting is cleaner client-side.
- **Should `rebuild` be a flag or a subcommand?** Subcommand, for destructive-path consistency with `delete` commands. (Recommendation surfaced to user; flag form documented as alternative.)
- **Does the Lambda already accept a per-call modelId?** Yes — `packages/api/src/handlers/wiki-compile.ts:24` reads `event.modelId` and the compiler's `RunCompileJobOpts.modelId` already threads it into planner + section-writer. The gap is only in the resolver→Lambda payload step.
- **Should `--model` validate against `modelCatalog`?** v1 passes the string through uninspected. The compiler already logs the model id used. If we need strict validation later, the `modelCatalog` query is available.

### Deferred to Implementation

- **Exact exit codes for partial-failure `--all`** — 0 if every enqueue succeeded, 1 if any failed. Per-agent errors are listed on stderr. Open: should a single 403/forbidden short-circuit the fan-out, or keep iterating? Lean short-circuit, but resolve in code when the error-shape is in front of the implementer.
- **Does `--watch` on `wiki status` reuse the `eval watch` polling interval (3s backoff → 30s)?** Probably, but worth confirming against the expected Lambda run length when implementing — compile jobs can take >1 minute when rebuilding large wikis.
- **Should the CLI print a helpful "scope is gated by `wiki_compile_enabled`" hint** when the server successfully enqueues but nothing happens because the flag is off? Only answerable after checking what the resolver returns in that case — `wikiCompileJobs` will show `status = "skipped"` or similar. Implementer should check and surface a one-liner if applicable.

## Output Structure

    apps/cli/src/commands/
        wiki.ts                     # new: thin registrar for wiki subcommands
        wiki/
            compile.ts              # new: thinkwork wiki compile
            rebuild.ts              # new: thinkwork wiki rebuild
            status.ts               # new: thinkwork wiki status
            helpers.ts              # new: resolveWikiContext, resolveAgentScope, shared types
            gql.ts                  # new: typed document nodes for mutations + queries

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
thinkwork wiki compile [--tenant <slug>] [--agent <id> | --all] [--model <id>] [--watch] [--json]
                       │
                       ▼
               resolveWikiContext  ── stage + tenant + urql client (mirrors resolveEvalContext)
                       │
                       ▼
               resolveAgentScope   ── returns { mode: "single" | "all", agentIds: string[] }
                       │                    mode=single: flag > picker (select over allTenantAgents + "All agents")
                       │                    mode=all:    --all flag OR "All agents" picker choice
                       ▼
             for each agentId:                      GraphQL: compileWikiNow(tenantId, ownerId, modelId)
               enqueue job ──────────────────────►  Resolver: threads modelId into Lambda invoke payload
                       │                            Lambda: runCompileJob(job, { modelId })
                       ▼
               optional --watch poll ───────────►   GraphQL: wikiCompileJobs(tenantId, ownerId, limit=1)
                                                    until status ∈ {completed, failed, cancelled}
```

```
thinkwork wiki rebuild [--tenant <slug>] [--agent <id>] [--model <id>] [--yes] [--json]
                       │
                       ▼
               (same scope resolution; --all is NOT supported — rebuild is per-agent)
                       │
                       ▼
           confirm destructive (skipped on --yes or --json)
                       │
                       ▼
     resetWikiCursor(tenantId, ownerId, force=true) ── archives active pages, clears cursor
                       │  on failure → surface error, exit 1, nothing enqueued
                       ▼
     compileWikiNow(tenantId, ownerId, modelId?) ── same as compile path
                       │
                       ▼
     optional --watch
```

## Implementation Units

- [ ] **Unit 1: Backend — widen `compileWikiNow` mutation to accept optional `modelId`**

**Goal:** Let the mutation thread a per-call Bedrock model override into the Lambda event payload so the CLI's `--model` flag actually reaches the compiler.

**Requirements:** R4

**Dependencies:** None

**Files:**
- Modify: `packages/database-pg/graphql/types/wiki.graphql`
- Modify: `packages/api/src/graphql/resolvers/wiki/compileWikiNow.mutation.ts`
- Test: `packages/api/src/__tests__/wiki-resolvers.test.ts`

**Approach:**
- Widen the mutation signature in `wiki.graphql` to `compileWikiNow(tenantId: ID!, ownerId: ID!, modelId: String): WikiCompileJob!`. Field stays nullable; omission preserves current behavior exactly.
- In the resolver, extend `CompileWikiNowArgs` with `modelId?: string | null`, and when present include it in the Lambda `InvokeCommand` payload (`{ jobId, modelId }`). The handler at `wiki-compile.ts:24` already consumes it.
- Do NOT persist `modelId` on the job row in v1 — the polling-fallback (Lambda invoke fails → worker claims job later) will fall back to the env default. Document this in a comment on the resolver and in the "Deferred to Separate Tasks" section above.
- Keep `assertCanAdminWikiScope(ctx, args)` unchanged — widening the args is additive, auth surface is identical.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/wiki/compileWikiNow.mutation.ts` — current shape; make minimal additive edits only.
- `packages/api/src/handlers/wiki-compile.ts:36-47` — proof that the handler already consumes `event.modelId` and forwards it to `runJobById` / `runCompileJob`.

**Test scenarios:**
- Happy path — call with `modelId: "anthropic.claude-sonnet-4-6-v1:0"`; assert the Lambda payload (mocked) contains `{ jobId, modelId: "anthropic.claude-sonnet-4-6-v1:0" }`.
- Happy path — call without `modelId`; assert the Lambda payload contains `{ jobId }` and no `modelId` key (not `modelId: null`).
- Edge case — `modelId` is an empty string; assert treated as "not provided" (send no `modelId` in payload) rather than forwarding `""` to the compiler.
- Error path — caller lacks admin permission for the scope; assert `assertCanAdminWikiScope` throws and no Lambda invoke is attempted.
- Integration — run the mutation against a dev tenant, inspect the resulting `wiki_compile_jobs` row + CloudWatch log for the compiler run's `modelId:` log line (per `feedback_verify_wire_format_empirically`).

**Verification:**
- Existing `compileWikiNow` callers (admin UI "Compile now" button, any integration tests) continue to pass unchanged.
- A direct GraphQL call with `modelId` produces a compile that logs the override in CloudWatch.

- [ ] **Unit 2: CLI — scaffold `thinkwork wiki` command family + `wikiContext` helpers**

**Goal:** Stand up the empty command tree and the shared context resolver that every subcommand needs.

**Requirements:** R1, R2, R7, R8

**Dependencies:** Unit 1 (the CLI needs the new mutation argument in codegen before implementing `--model` pass-through, but the scaffold can land before).

**Files:**
- Create: `apps/cli/src/commands/wiki.ts`
- Create: `apps/cli/src/commands/wiki/helpers.ts`
- Create: `apps/cli/src/commands/wiki/gql.ts`
- Modify: `apps/cli/src/cli.ts` (register the command)

**Approach:**
- `wiki.ts` mirrors `eval.ts`: declare the parent command + aliases, wire subcommands to runners imported from `./wiki/`.
- `helpers.ts` exports `resolveWikiContext(opts)` (mirror of `resolveEvalContext`), plus `resolveAgentScope(ctx, opts)` that returns `{ mode: "single" | "all", agentIds: string[] }` after applying flag/picker precedence. Include a typed `WikiCliOptions` interface with `stage, tenant, agent, all, model, json` fields.
- `resolveAgentScope` precedence: (1) `--agent <id>` resolves via `resolveIdentifier` over `allTenantAgents`, (2) `--all` → mode="all", (3) TTY → `select` with choices = `[{ name: "All agents (fan out)", value: "__all__" }, ...agents]`, (4) non-TTY with neither flag → `requireTty` error listing which flags to pass.
- `gql.ts` holds typed document nodes via the existing codegen helpers (see `apps/cli/src/commands/eval/gql.ts`). Start with `AllTenantAgentsDoc`, `CompileWikiNowDoc` (including the new `modelId` arg), `ResetWikiCursorDoc`, `WikiCompileJobsDoc` (added in Unit 5).
- The parent `wiki` command registers as `program.command("wiki").description("Compile and rebuild agent wiki pages (Compounding Memory).")`. No alias needed.

**Patterns to follow:**
- `apps/cli/src/commands/eval.ts` — registrar shape.
- `apps/cli/src/commands/eval/helpers.ts` — `resolveEvalContext` is the 1:1 template.
- `apps/cli/src/lib/resolve-identifier.ts` — for the `--agent` flag-accepts-name-or-id path.
- `apps/cli/src/lib/interactive.ts` — `requireTty`, `promptOrExit`.

**Test scenarios:**
- Happy path — `resolveWikiContext` with `--tenant acme` returns a context with the right `tenantId` (mock `TenantBySlugDoc`).
- Happy path — `resolveAgentScope` with `--agent <uuid>` returns `{ mode: "single", agentIds: [uuid] }` without calling `allTenantAgents`.
- Happy path — `resolveAgentScope` with `--all` returns `{ mode: "all", agentIds: [...all ids] }` via a mocked `allTenantAgents`.
- Edge case — `resolveAgentScope` with `--agent` passed as an agent name (not UUID) resolves via `allTenantAgents` lookup.
- Error path — non-TTY, no `--agent`, no `--all` → `requireTty` prints a clear error and exits 1.
- Integration — the registered command shows up in `thinkwork --help` and `thinkwork wiki --help` lists the three subcommands.

**Verification:**
- `pnpm -C apps/cli build` succeeds with the new imports.
- `thinkwork wiki --help` renders the subcommand summary.

- [ ] **Unit 3: CLI — `thinkwork wiki compile`**

**Goal:** Ship the primary action — enqueue a compile for one or many agents with optional model override.

**Requirements:** R1, R2, R3, R4, R7, R8

**Dependencies:** Unit 1 (mutation arg), Unit 2 (scaffold)

**Files:**
- Create: `apps/cli/src/commands/wiki/compile.ts`
- Modify: `apps/cli/src/commands/wiki.ts` (wire the subcommand)
- Test: `apps/cli/__tests__/commands/wiki/compile.test.ts`

**Approach:**
- Options: `--stage`, `--tenant`, `--agent <id>`, `--all`, `--model <id>`, `--watch`.
- Resolution order: `resolveWikiContext` → `resolveAgentScope` → per-agent loop calling `compileWikiNow`.
- Loop body: for each `agentId`, call `gqlMutate(client, CompileWikiNowDoc, { tenantId, ownerId: agentId, modelId: opts.model })`. Collect `{ agentId, jobId, error? }`.
- Human output: print a per-agent success line ("✔ agent-a  job=abc123") or error line ("✖ agent-b  forbidden"). Final line summarizes enqueued/failed counts.
- JSON output: `{ ok: failedCount === 0, scope: { tenantId, agentIds }, jobs: [{ agentId, jobId, status }], errors: [{ agentId, message }] }`.
- `--watch`: if single-agent, reuse the status-poll helper from Unit 5; if multi-agent, skip watch (surface a hint "--watch ignored for --all; use `thinkwork wiki status --watch` for individual jobs").
- Exit codes: 0 if all succeeded, 1 if any failed, 2 if scope resolution failed (no tenant/agent).
- Admin-forbidden errors: catch by error extension code or message pattern and print the operator-friendly "Admin access to tenant X required" message once (not per-agent, since the same error will repeat for every agent in `--all`).

**Patterns to follow:**
- `apps/cli/src/commands/eval/run.ts` — option bifurcation, TTY/non-TTY gating, spinner usage.
- `apps/cli/src/lib/output.ts` — `printJson`, `printKeyValue`, `logStderr`, `isJsonMode`.
- `apps/cli/src/ui.ts` — `printError`, `printSuccess`.

**Test scenarios:**
- Happy path — single agent, no model override: asserts `compileWikiNow` is called once with the expected args and no `modelId`.
- Happy path — single agent with `--model sonnet-4-6`: asserts `modelId` is forwarded in the mutation variables.
- Happy path — `--all` with 3 agents: asserts 3 mutations fire in sequence; JSON output includes 3 job entries.
- Happy path — `--json` mode on success: stdout is a single JSON object matching the documented shape; no text output.
- Edge case — `--all` with zero agents returned: exits 0 with a "no agents found" message on stderr; stdout JSON has `jobs: []`.
- Edge case — `--agent <name>` resolves via `allTenantAgents` name lookup (not UUID).
- Error path — forbidden error on first agent in `--all` mode: short-circuits with the operator-friendly message, exit 2, does not iterate remaining agents.
- Error path — mutation returns a per-agent error (e.g. compile flag disabled): other agents still run; final summary shows the failure; exit 1.
- Error path — non-TTY without `--agent` or `--all` and no cached tenant: exit 1 with clear missing-flag message.
- Integration — run the command against a dev stage and confirm a new `wiki_compile_jobs` row appears.

**Verification:**
- `thinkwork wiki compile --tenant demo --agent agt-xyz --json` returns a valid JSON blob with a non-null `jobId`.
- `thinkwork wiki compile --tenant demo --all` iterates every agent and prints one line each.

- [ ] **Unit 4: CLI — `thinkwork wiki rebuild`**

**Goal:** Ship the destructive path — archive all active pages for an agent, then enqueue a fresh compile.

**Requirements:** R5, R8

**Dependencies:** Unit 1, Unit 2, Unit 3 (for shared status-watch helper if `--watch` is supported)

**Files:**
- Create: `apps/cli/src/commands/wiki/rebuild.ts`
- Modify: `apps/cli/src/commands/wiki.ts`
- Modify: `apps/cli/src/commands/wiki/gql.ts` (add `ResetWikiCursorDoc`)
- Test: `apps/cli/__tests__/commands/wiki/rebuild.test.ts`

**Approach:**
- Options: `--stage`, `--tenant`, `--agent <id>`, `--model <id>`, `--yes`, `--watch`.
- **`--all` is intentionally not supported** — rebuilding every agent in a tenant in one shot is a footgun. Enforced with a commander-level check: if `opts.all` is truthy, print "rebuild does not support --all; rebuild one agent at a time" and exit 1.
- Flow: resolve context → resolve single agent scope → confirm (skip if `--yes` or `--json`) → `resetWikiCursor(tenantId, ownerId, force=true)` → on success, `compileWikiNow(tenantId, ownerId, modelId?)` → optionally watch.
- Confirmation prompt text: `"Rebuild wiki for <agentName>? This archives <N> active pages and recompiles from scratch."` Fetch page count before prompting (one lightweight query — reuse existing `wikiSearch` with `limit:1` + a count endpoint, OR skip the count and just say "all active pages for this agent").
- If `resetWikiCursor` fails, exit 1 without calling `compileWikiNow`. If `resetWikiCursor` succeeds but `compileWikiNow` fails, exit 1 with a clear message ("cursor reset succeeded (N pages archived), but compile enqueue failed: <err>. Retry with `thinkwork wiki compile --agent <id>`").
- JSON output: `{ ok, scope, pagesArchived, jobId? }`.

**Patterns to follow:**
- `apps/cli/src/commands/eval/delete.ts` (or another `--yes`-gated destructive command) for the confirm prompt shape.
- Unit 3's compile runner for the enqueue step.

**Test scenarios:**
- Happy path — `--yes` bypasses the prompt, both mutations fire in sequence; JSON output includes `pagesArchived` and `jobId`.
- Happy path — interactive confirm accepted; same outcome as `--yes`.
- Happy path — with `--model <id>`, the `modelId` is forwarded on the compile call, not on reset.
- Edge case — operator types "no" at the confirm → neither mutation runs; exit 0; stderr "Cancelled.".
- Edge case — interactive `--watch` after confirm declined: still exits cleanly without attempting the watch.
- Error path — `--all` flag passed: exit 1 with a clear message, no mutations fire.
- Error path — `resetWikiCursor` fails (e.g. not authorized): exit 1, no `compileWikiNow` call.
- Error path — reset succeeds, compile fails: exit 1 with the "retry with `thinkwork wiki compile`" hint; JSON includes `pagesArchived` but `jobId: null`.
- Integration — run against a dev agent with a non-zero number of active pages, verify `wiki_pages.status = 'archived'` afterward and a new job appears in `wiki_compile_jobs`.

**Verification:**
- After a successful rebuild, the agent's `wiki_pages` rows are all archived except those the fresh compile recreates.
- A rebuild without `--yes` in a non-TTY session exits 1 with a clear message rather than hanging on the confirm prompt.

- [ ] **Unit 5: Backend — add `wikiCompileJobs` query for CLI status**

**Goal:** Provide a narrow admin-scoped read of recent compile jobs so `wiki status` has something to render.

**Requirements:** R6

**Dependencies:** None (can ship in parallel with Unit 1)

**Files:**
- Modify: `packages/database-pg/graphql/types/wiki.graphql`
- Create: `packages/api/src/graphql/resolvers/wiki/wikiCompileJobs.query.ts`
- Modify: `packages/api/src/graphql/resolvers/wiki/index.ts` (export + wire the resolver)
- Modify: `packages/api/src/lib/wiki/repository.ts` (add `listCompileJobsForScope` method)
- Test: `packages/api/src/__tests__/wiki-resolvers.test.ts`

**Approach:**
- Schema: `wikiCompileJobs(tenantId: ID!, ownerId: ID, limit: Int = 10): [WikiCompileJob!]!`. `ownerId` is optional so the query can return tenant-wide activity when no agent is selected (useful for "what's going on?" queries); when provided, filters to that agent.
- Resolver uses `assertCanAdminWikiScope` (always by `tenantId`; `ownerId` optional — when absent, assert admin on the tenant as a whole).
- Repository method: `SELECT * FROM wiki_compile_jobs WHERE tenant_id = $1 [AND owner_id = $2] ORDER BY created_at DESC LIMIT $3`. Mirror existing query shapes already in `packages/api/src/lib/wiki/repository.ts`.
- Return the existing `WikiCompileJob` GraphQL shape unchanged.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/wiki/wikiPage.query.ts` — resolver file shape.
- `packages/api/src/graphql/resolvers/memory/recentWikiPages.query.ts` — scope auth pattern (but wiki admin, not read).
- Existing repository functions in `packages/api/src/lib/wiki/repository.ts:1347-1360` already select `wikiCompileJobs` — extend or re-use that code path.

**Test scenarios:**
- Happy path — `(tenantId, ownerId, limit=5)` returns the 5 most recent jobs for that scope in `created_at DESC` order.
- Happy path — `(tenantId, ownerId=null)` returns tenant-wide recent jobs across all agents.
- Edge case — empty result set returns `[]`, not null.
- Edge case — `limit` of 0 or negative is coerced to default or rejected cleanly (match other resolver conventions — check what `wikiSearch` does).
- Error path — caller lacks admin on tenant: `assertCanAdminWikiScope` throws forbidden; resolver does not query DB.
- Integration — end-to-end through the GraphQL HTTP route, verify the wire shape matches `WikiCompileJob` and `AWSJSON` for `metrics` round-trips as an object (per `feedback_verify_wire_format_empirically`).

**Verification:**
- A freshly enqueued job appears in the result within a second of the mutation completing.

- [ ] **Unit 6: CLI — `thinkwork wiki status`**

**Goal:** Show recent compile jobs for a tenant/agent, with optional `--watch` until the latest job reaches a terminal state.

**Requirements:** R6, R7

**Dependencies:** Unit 2 (scaffold), Unit 5 (backend query)

**Files:**
- Create: `apps/cli/src/commands/wiki/status.ts`
- Modify: `apps/cli/src/commands/wiki.ts`
- Modify: `apps/cli/src/commands/wiki/gql.ts` (add `WikiCompileJobsDoc`)
- Test: `apps/cli/__tests__/commands/wiki/status.test.ts`

**Approach:**
- Options: `--stage`, `--tenant`, `--agent <id>` (optional — absent means tenant-wide), `--limit <n>` (default 10), `--watch`, `--json`.
- Without `--watch`: one query, print a table (human) or a JSON array (`--json`). Table columns: `job-id-short | agent | status | trigger | attempt | started | duration | records | pages | cost`.
- With `--watch`: poll every 3s until the most-recent job's `status ∈ {completed, failed, cancelled}`, printing an updated last-row on each tick in human mode. Cap total watch time at 15 minutes (configurable via `--timeout`). In `--json` mode, `--watch` emits a single final JSON blob — don't stream incremental JSON.
- Agent-name column: when rendering multiple agents (tenant-wide call), resolve agent names via one batched `allTenantAgents` call upfront; do NOT per-row fetch.

**Patterns to follow:**
- `apps/cli/src/commands/eval/watch.ts` — polling loop + terminal-status check (`isTerminalStatus`).
- `apps/cli/src/commands/eval/list.ts` — table printing in human mode.
- `apps/cli/src/lib/output.ts` — `printJson`, `printKeyValue`.

**Test scenarios:**
- Happy path — no `--watch`, agent-scoped: prints up to `--limit` rows; JSON output matches the shape `{ ok: true, scope, jobs: [...] }`.
- Happy path — `--watch` with a job already in terminal state: returns immediately without polling.
- Happy path — `--watch` polls until status flips from `running` to `completed`; verify the number of GraphQL calls is bounded.
- Edge case — no jobs exist for the scope: human mode prints "No recent compile jobs for <scope>"; JSON mode returns `{ ok: true, jobs: [] }`.
- Edge case — `--watch` timeout reached before terminal status: exits with a non-zero code and a clear "watch timed out after 15m; job still in progress" message.
- Error path — tenant resolution fails: exit 1 with the shared `resolveWikiContext` error.
- Integration — run against a dev stage with an active agent, confirm that the job ids printed match the admin UI's compile-history list.

**Verification:**
- `thinkwork wiki status --tenant demo --agent agt-x --watch` runs to completion and exits 0 once the job settles.

- [ ] **Unit 7: Docs + help text**

**Goal:** Give the command discoverable examples and document the admin-only requirement.

**Requirements:** R8 (indirectly, via clear error UX + help text)

**Dependencies:** Units 3, 4, 6

**Files:**
- Modify: `apps/cli/README.md` (add a "Wiki" section under the command list)
- Modify: `docs/src/content/docs/` (new page or extend an existing admin/CLI page — check `docs/src/content/docs/applications/cli.md` or equivalent)
- Optionally: Modify: `apps/cli/src/commands/wiki/*.ts` to add `.addHelpText("after", examples)` blocks matching the pattern in `apps/cli/src/commands/agent.ts:28-40`.

**Approach:**
- README addition lists the three subcommands with a one-line summary and a single example each.
- Docs page explains the admin-only nature, points at `wiki_compile_enabled` tenant flag, links to the compiler architecture doc, and notes the `--model` override caveat (env-default fallback on polling pickup).
- Command help text includes the admin-permission hint and a reference to `thinkwork config models` for the `--model` values.

**Test scenarios:**
- Test expectation: none — documentation-only unit. Verification happens in review (the docs build passes, `thinkwork wiki compile --help` shows useful output).

**Verification:**
- `pnpm -C docs build` succeeds.
- `thinkwork wiki compile --help` includes the Examples section.

## System-Wide Impact

- **Interaction graph:** CLI → `compileWikiNow` resolver → Lambda `InvokeCommand` → `wiki-compile` Lambda → `runCompileJob`. Rebuild additionally touches `resetWikiCursor` → `wikiPages` bulk archive + `resetCursor`. Status adds a new read path CLI → `wikiCompileJobs` resolver → `wiki_compile_jobs` table. No new async components.
- **Error propagation:** admin-auth errors must reach the CLI as typed `FORBIDDEN` extensions; the CLI maps them to a single operator-friendly message. Per-agent fan-out surfaces errors inline but does not mask them behind a single success/fail bit — JSON output always includes a full `errors` array.
- **State lifecycle risks:** rebuild archives pages before enqueuing a compile; if the compile enqueue fails the operator sees an agent with zero active pages until they re-run `thinkwork wiki compile`. This is intentional (same risk the admin UI has today) but the CLI should say so loudly. No partial-archive risk — `resetCursor + update(...).where(status='active')` is a single SQL statement.
- **API surface parity:** `compileWikiNow` gains an optional field. Admin UI and mobile are not changed; the field is not breaking. `wikiCompileJobs` is a new query — no existing callers.
- **Integration coverage:** a real end-to-end run against dev (compile → Lambda → Postgres) is required per the verify-wire-format-empirically learning — unit mocks alone won't prove the `modelId` round-trip.
- **Unchanged invariants:** `wiki_compile_enabled` tenant gate (existing behavior unchanged — when off, the Lambda exits early); dedupe key behavior; the compile-cursor semantics; admin-auth assertion shape.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Fire-and-forget Lambda invoke hides compile failures from the CLI operator (violates `feedback_avoid_fire_and_forget_lambda_invokes`). | Out of scope to fix in v1; CLI surfaces the enqueued jobId loudly and nudges `--watch` / `thinkwork wiki status` as the real success signal. Follow-up PR to switch `compileWikiNow` to `RequestResponse` + surface Lambda errors. |
| `modelId` passed via Event invoke is lost if the invoke fails and a polling worker picks up the job (then default model is used silently). | Document in the resolver comment and CLI docs. Acceptable for v1 because failures on the Event invoke are rare and the consequence is "used default model", not data corruption. If this bites, add `wiki_compile_jobs.model_id` column in a follow-up migration. |
| Operator runs `thinkwork wiki rebuild --agent <id>` in a non-admin session and gets a cryptic GraphQL forbidden. | `assertCanAdminWikiScope` surfaces as a typed error; the CLI maps it to an operator-friendly "admin access required" message and exits 2 (distinct from 1 = resolution failure). |
| `--all` fan-out enqueues N jobs against a tenant with `wiki_compile_enabled = false`; operator sees N "success" lines but no compile runs. | After enqueue, check the returned job `status` — if the backend sets it to `skipped` (or similar when the flag is off), surface a clear warning. If the flag-off path silently succeeds at enqueue but no-ops in Lambda, open a separate bug — v1 CLI still shows the `jobId` honestly, and `wiki status` will reflect the no-op. |
| Rebuild's archive step runs but compile enqueue fails → agent has zero active pages. | CLI error message includes the exact retry command. `wiki_pages.status = 'archived'` is reversible (archived pages aren't deleted; a future compile recreates active versions). |
| CLI `--model` accepts any string and the operator typos a model id → compile Lambda fails partway through. | Accept the risk in v1; the compiler already logs the model id it used, and the failed job's `error` column surfaces the Bedrock `ValidationException`. Optional follow-up: validate against `modelCatalog` in the CLI before calling the mutation. |
| Worktree isolation: landing this alongside other in-flight wiki work on main may conflict in `compileWikiNow.mutation.ts` or `wiki.graphql`. | Per `feedback_worktree_isolation`, branch in `.claude/worktrees/cli-wiki-commands/` off `origin/main`; rebase onto `origin/main` before opening the PR. |

## Documentation / Operational Notes

- Update `apps/cli/README.md` with the new subcommands + one example each.
- Update the CLI docs page (under `docs/src/content/docs/`) with an admin-only callout and a short "When to use rebuild" section.
- No infra changes required. The wiki-compile Lambda already reads `modelId` from its event payload. No IAM additions — the `graphql-http` Lambda's existing `lambda:InvokeFunction` permission to `wiki-compile` is unchanged.
- Add a short CHANGELOG entry for the `compileWikiNow(modelId)` argument addition (additive; non-breaking).
- Rollout order: ship Unit 1 + Unit 5 (backend) first, then Units 2–6 (CLI) once codegen picks up the schema changes. Unit 7 docs can go in the same PR as the CLI units.

## Sources & References

- **Origin:** direct user request (no upstream `ce:brainstorm` requirements doc). Feature shape gathered from the prompt directly.
- Related code: `packages/api/src/graphql/resolvers/wiki/compileWikiNow.mutation.ts`, `packages/api/src/graphql/resolvers/wiki/resetWikiCursor.mutation.ts`, `packages/api/src/handlers/wiki-compile.ts`, `packages/api/src/lib/wiki/compiler.ts`, `apps/cli/src/commands/eval/helpers.ts`, `apps/cli/src/lib/resolve-tenant.ts`.
- Related schema: `packages/database-pg/graphql/types/wiki.graphql`, `packages/database-pg/graphql/types/agents.graphql`.
- Related prior plans: `plans/archived/wiki-compiler-memory-layer.md` (architecture anchor), `plans/2026-04-19-003-refactor-admin-wiki-graph-plan.md` (parallel wiki work), `plans/2026-04-19-001-feat-compounding-memory-refinement-plan.md`, `plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md`.
- Related memories: `feedback_avoid_fire_and_forget_lambda_invokes`, `feedback_verify_wire_format_empirically`, `feedback_worktree_isolation`, `feedback_oauth_tenant_resolver`, `feedback_graphql_deploy_via_pr`.
