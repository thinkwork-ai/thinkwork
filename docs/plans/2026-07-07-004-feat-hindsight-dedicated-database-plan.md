# Hindsight gets its own database (`thinkwork_hindsight`) — THINK-220

**Status:** planned
**Linear:** THINK-220
**Context:** docs/solutions/tooling-decisions/hindsight-upstream-issue-draft-nonpublic-schema-2026-07-07.md, docs/solutions/tooling-decisions/hindsight-084-upgrade-validation-2026-07-06.md

## Problem

Hindsight 0.8.4 runs with `HINDSIGHT_API_DATABASE_SCHEMA=hindsight` inside the
shared `thinkwork` Aurora database. Retain, recall, and per-retain
consolidation respect that setting; the **background maintenance loop's
discovery queries do not** — they assume `public` and no-op every cycle:

- `banks_needing_consolidation()` — banks that stop receiving retains are
  never re-consolidated (per-retain consolidation covers *active* banks only)
- mental-model cron discovery — unused by us today, but dead
- expired-row sweep — TTL'd rows are never deleted → unbounded table growth

We are **not** forking or patching Hindsight (parked THINK-201 P2b decision
stands). Instead: give Hindsight its own database, `thinkwork_hindsight`, on
the **same Aurora cluster**, where its schema is `public` and every upstream
code path works as designed. Same instance, no new infrastructure tier, no
Hindsight code changes — the config becomes the vanilla one upstream tests.

## Feasibility (verified 2026-07-07)

Postgres cannot query across databases in one statement, so the split only
works if no SQL joins `hindsight.*` to thinkwork `public.*` tables. Audit
result: **none do**. The single correlation point — the observation promotion
gate matching proofs to shared threads
(`packages/api/src/lib/knowledge-graph/observation-promotion-gate.ts`) —
fetches each side separately and joins in application code.

Two existing seams make the repoint cheap:

- `packages/database-pg/src/db.ts` builds its pool from a connection string
  with the database name from `DATABASE_NAME` config (default `thinkwork`).
  A second singleton with a different database name is a small, well-trodden
  addition (`ledger-db.ts` precedent for shipping additional clients from
  this package).
- The Pi provider's direct SQL tier already parameterizes the database on
  RDS Data API calls: `database: options.dbName || "thinkwork"`
  (`hindsight-memory-provider.ts:694`). The dedicated-DB switch is env only.

## Inventory: every direct `hindsight.*` reader/writer

All of these run against the thinkwork DB pool today and must move to the
new client with `hindsight.` → `public.` qualifiers:

| File | What it does |
| --- | --- |
| `packages/api/src/lib/memory/hindsight-bank-merge.ts` | bank merge machinery (~40 statements — the big one) |
| `packages/api/src/graphql/resolvers/memory/memoryGraph.query.ts` | entities/co-occurrence graph for the Memory UI |
| `packages/api/src/lib/memory/adapters/hindsight-adapter.ts` | adapter-level SQL |
| `packages/api/src/lib/knowledge-graph/observation-promotion-gate.ts` | proof rows (hindsight side of the two-step join) |
| `packages/api/src/lib/knowledge-graph/observations-source.ts` | observation feed for KG extraction |
| `packages/api/src/lib/wiki/link-backfill.ts` | wiki link backfill reads |
| `packages/api/src/lib/ontology/suggestions.ts` | ontology suggestion reads |
| `packages/api/src/lib/brain/dream/{runner,applier,planner}.ts` | dream pipeline (inert in prod, still compiles against the schema) |
| `packages/api/src/handlers/memory-retain.ts` | `countExtractedUnitsForThread` fail-loud readback (#3485) |
| `packages/agentcore-pi/.../hindsight-memory-provider.ts` | high-confidence-fact recall tier + `recordMemoryAccess` (RDS Data API) |

Also affected, not code: the memory-eval harness compose file (local
Hindsight uses its own Postgres — confirm it already runs schema=public, in
which case the harness gets *more* representative, not less) and any operator
psql runbooks that reference `hindsight.*` on the thinkwork DB.

## Design decisions

- **Database name:** `thinkwork_hindsight`, same cluster, same
  `thinkwork_admin` credentials (the existing
  `thinkwork-${stage}-db-credentials` secret is cluster-scoped, not
  database-scoped). No new secret.
- **Client seam:** `getHindsightDb()` exported from
  `@thinkwork/database-pg`, mirroring `getDb()` but with the database name
  from `HINDSIGHT_DATABASE_NAME`. **The same env var doubles as the cutover
  flag:** unset ⇒ helper returns the primary client and query text keeps the
  `hindsight.` prefix; set ⇒ dedicated pool and `public.` prefix. One
  `hindsightSchemaPrefix()` helper keeps the query text switch in one place —
  callsites never branch. Ship-inert: code lands fully tested with the env
  var unset everywhere.
- **Pi provider:** `dbName` option already exists — wire it to
  `HINDSIGHT_DATABASE_NAME` in the runtime env; same prefix helper for its
  one SQL string.
- **Hindsight service:** `DATABASE_URL` points at `thinkwork_hindsight`;
  `HINDSIGHT_API_DATABASE_SCHEMA` removed entirely (upstream default =
  `public`). This is the vanilla upstream configuration.

## Phases

### Phase 1 — dual-target code, ship inert (PR to main)

1. `packages/database-pg`: `getHindsightDb()` + `hindsightSchemaPrefix()`.
2. Rewrite the inventory files to use both helpers. Behavior with
   `HINDSIGHT_DATABASE_NAME` unset is byte-identical to today (tests assert
   this).
3. Unit tests for both modes; full `pnpm --filter @thinkwork/api test` +
   agentcore-pi suite.

### Phase 2 — provision + terraform (PR to main, still inert)

1. Create `thinkwork_hindsight` database on the dev cluster (bootstrap SQL —
   `CREATE DATABASE` can't run in a terraform-managed transaction; follow
   the runbook pattern and record it as a hand-rolled step with a
   drift-reporter marker if we add any DDL beyond the bare database).
2. Terraform: `hindsight-memory` module gains a `database_name` variable
   (default `thinkwork` until cutover); `lambda-api` handlers +
   `agentcore-pi` runtime env gain `HINDSIGHT_DATABASE_NAME` wiring, **left
   unset** at this phase. Watch the graphql-http 4KB env ceiling — one short
   var name, should be fine.

### Phase 3 — migration rehearsal (no PR; scratch resources)

1. `pg_dump -n hindsight` from dev → restore into a scratch database →
   `ALTER SCHEMA hindsight RENAME TO public`.
2. Point a scratch Hindsight 0.8.4 container at it with vanilla env.
3. **Acceptance test for the whole exercise:** maintenance loop logs show
   nonzero discovery — banks picked up for consolidation, expired rows swept.
   If discovery still no-ops on a vanilla-config copy, stop: the bug isn't
   what we think it is, and the migration buys nothing.
4. Verify pgvector extension, indexes, and row counts survive dump/restore.

### Phase 4 — dev cutover (operator window, ~15 min retain pause)

Ordering within the window:

1. Announce/accept a brief retain outage (retains fail loud since #3485 —
   they'll error, not silently drop; acceptable on dev).
2. Final `pg_dump -n hindsight` → restore into `thinkwork_hindsight` →
   rename schema to `public`.
3. Flip Hindsight service env (terraform apply: `database_name` +
   drop `HINDSIGHT_API_DATABASE_SCHEMA`) → new task revision.
4. Flip `HINDSIGHT_DATABASE_NAME` on lambda-api + agentcore-pi (terraform
   apply). AgentCore warm containers boot pre-injection — expect the 15-min
   reconciler to catch stragglers, or force a runtime restart.
5. Smoke: retain (unit count readback nonzero), recall (3 tiers), Memory
   graph UI, promotion gate run, bank merge dry-run, `recordMemoryAccess`
   increments.

### Phase 5 — soak + decommission

1. Watch one full maintenance cycle: discovery finds work; consolidation of
   an idle bank observed; expired-row sweep deletes something (seed a TTL row
   if none exists).
2. Old `hindsight.*` schema in the thinkwork DB: revoke writes immediately,
   keep ≥1 week as rollback anchor, then `DROP SCHEMA hindsight CASCADE`
   **with explicit approval** (deliberate exception to the only-touch-public
   rule; the Symphony schema remains untouchable).
3. Update `docs/solutions/tooling-decisions/hindsight-upstream-issue-draft-*`:
   the upstream issue becomes moot for us — mark it not-filed-by-choice with
   a pointer here.

### Phase 6 — customer stages

McPherson (and future stages) inherit via the deploy runner: the bootstrap
SQL + cutover must be automated in the runner's migration ledger, not
hand-run, before any customer stage upgrades past this change. Fresh stages
are trivial (no data to migrate — provision the DB empty and start there);
only stages with existing Hindsight data need the dump/restore path.

## Rollback

Any phase before decommission: unset `HINDSIGHT_DATABASE_NAME` and point the
Hindsight service back at the thinkwork DB + `hindsight` schema. The old
schema stays intact and current until Phase 5 revokes writes, and physically
present until the approved DROP. After cutover, writes land in the new DB
only — rolling back after real traffic means replaying the delta or accepting
loss; keep the window between cutover and confidence short.

## Risks

- **Missed callsite** — a `hindsight.*` query not in the inventory 500s
  post-cutover against the primary DB. Mitigation: Phase 1 makes the prefix
  helper the only legal way to write these queries; add a grep-based test
  that fails on any literal `hindsight.` in SQL outside the helper.
- **Env-flag drift** — api flipped but Pi not (or vice versa) reads stale
  data. Both flips are the same terraform apply; smoke covers both sides.
- **Dump/restore fidelity** — pgvector/index/extension gaps surface in
  Phase 3 rehearsal, not at cutover.
- **4KB env ceiling on graphql-http** — one short var; verified at Phase 2
  plan time.
