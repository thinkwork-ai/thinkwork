# Residual Review Findings — feat/admin-mcp-separation-u1u2

**Branch:** `feat/admin-mcp-separation-u1u2`
**Run artifact:** `/tmp/compound-engineering/ce-code-review/20260505-140054-1453c035/`
**Plan:** `docs/plans/2026-05-05-001-refactor-admin-ops-mcp-separation-plan.md`
**Source PR-review run context:** `mode:autofix base:origin/main`, 12 reviewers dispatched (correctness, security, adversarial, data-migrations, reliability, api-contract, kieran-typescript, testing, maintainability, project-standards, agent-native, learnings).

Six P0/high-confidence findings were autofixed in commit `fix(review): apply autofix feedback`. The items below are residual `gated_auto`/`manual`/`advisory` findings that the autofix policy did not apply. Each is scoped to a follow-up plan unit (most fall under U3-U9 of the same plan) or flagged as a deferred improvement.

## P1 — Should Fix in U6 / U7

- **`as McpRow[]` cast suppresses type checking.** `packages/api/src/lib/mcp-configs.ts:332,365`. Drizzle's typed `.select(...)` already produces a row shape; the cast hides drift if a future column rename or projection edit happens. Replace with `satisfies` or share a `mcpProjection` const between the two queries and derive `McpRow` via `Awaited<ReturnType<...>>[number]`. Cited by `kieran-typescript` (P1 conf 80) and `maintainability` (P1 conf 70).
- **Tenant-id boundary missing on resolver query.** `packages/api/src/lib/mcp-configs.ts:355,392`. Both registries filter by `agent_id` only — relies on upstream agent→tenant correctness. If U7's admin-write path lands a bug that inserts `agent_admin_mcp_servers` rows with mismatched `tenant_id`, cross-tenant admin-tool leakage becomes possible. Add `eq(agentAdminMcpServers.tenant_id, agentTenantId)` when the agent's tenant is loaded upstream. Cited by `correctness` (P2 conf 60), `security` (advisory).
- **OAuth refresh has no concurrency protection.** `resolveMcpAuth` performs read-then-write on `user_mcp_tokens` + Secrets Manager with no advisory lock or CAS guard. Two concurrent invocations both attempt refresh; the second's 4xx triggers `status='expired'` even though the first refresh just succeeded. Pre-existing on `origin/main` but the U2 admin-MCP fan-out raises traffic. Acquire a Postgres advisory lock keyed on `(user_id, mcp_server_id)` and re-read `expires_at` after locking; narrow the `status='expired'` path to OAuth `invalid_grant` errors only. Cited by `reliability` (rel-001, P1 conf 70).

## P2 — Defer to follow-up plan units

- **U6: data migration of legacy `tenant_mcp_servers.admin-ops` rows.** Three rows currently live in tenant_mcp_servers (one per tenant); U6 will move them. Until then the runtime resolver's dedup-by-collision is the bridge.
- **U6 race risk: `mcp-admin-provision` still writes to `tenant_mcp_servers`.** `packages/api/src/handlers/mcp-admin-provision.ts:245-301`. During U6 cutover, an idempotent provision could create a tenant `admin-ops` row after U6 already migrated, producing dual rows with different rotated tokens. Either update mcp-admin-provision in U3 to write the new registry, or hold the rollout via a feature flag. Cited by `adversarial` (adv-003, medium conf 50).
- **U4: API guard rejecting admin-MCP attachments to non-admin templates.** Schema separation alone is not the boundary; the API handler that writes `agent_template_admin_mcp_servers` must check `template.is_admin = true`. Currently no row writers exist (intentional), but U4 must land this guard before any UI exposes the admin-MCP table. Cited by `adversarial` (adv-002), `security` (residual risk #2).
- **U4: deferred FK/CHECK enforcing admin-only attachment at the DB layer.** `packages/database-pg/drizzle/0065_admin_mcp_separation.sql:1496-1505`. `agent_template_admin_mcp_servers.template_id` has no FK to `agent_templates.id`, so cascade-delete behavior on template removal is undefined and there's no DB-level proof that attached templates carry `is_admin=true`. Add a deferred FK or trigger that joins to `agent_templates.is_admin`. Cited by `adversarial` (adv-006).
- **U3: `is_admin` payload field is informational, not enforced.** `packages/agentcore-strands/agent-container/container-sources/server.py:560` ignores the field; `packages/agentcore-flue/agent-container/src/server.ts:181` strips it. The audit-tag claim in the JSDoc holds for CloudWatch logs only. Either make the runtime gate on `is_admin` (admin tools require explicit per-turn assertion in the system prompt) or reframe the field as a "registry-of-origin tag" and pair with a separate auth-ledger. Cited by `adversarial` (adv-005, P2 conf 75), `agent-native` (observation 2).
- **U3: downstream propagation test for `is_admin`.** No test verifies `is_admin: true` survives chat-agent-invoke → AgentCore container payload → CloudWatch. Add when U3 ships the audit consumer. Cited by `testing` (testing-6), `kieran-typescript` (residual gap).

## P2 — Reliability hardening

- **Latency: sequential admin-then-tenant queries on every chat turn.** Could parallelize via `Promise.all` but adds failure-handling complexity. Optimization, not a defect. Cited by `reliability` (rel-008 advisory).
- **No `statement_timeout` on Drizzle queries.** A bad plan or row-lock conflict hangs the query and stalls every concurrent chat turn. Set `statement_timeout='5s'` on the pool's connect handler or via `SET LOCAL` at the start of `buildMcpConfigs`. Cited by `reliability` (rel-005, medium conf 60).
- **No feature-flag kill-switch for the admin-MCP query path.** Admin query fires unconditionally. If `admin_mcp_servers` acquires a slow plan, every chat turn pays. Gate behind `process.env.MCP_ADMIN_QUERY_ENABLED !== 'false'` (default enabled) for one-Lambda-update rollback. Cited by `reliability` (rel-007, low conf 55).
- **`SecretsManagerClient` constructed per call inside `resolveMcpAuth`.** No client reuse, no explicit timeout. Hoist to module scope and configure `NodeHttpHandler({ requestTimeout: 5000, connectionTimeout: 2000 })`. Cited by `reliability` (rel-003, low conf 65).
- **OAuth refresh side-effect ordering.** Secrets Manager `UpdateSecretCommand` writes new tokens BEFORE the DB `expires_at` update. If the DB write fails, the inner catch returns `parsed.access_token` (now the OLD token, with secret-manager already rotated). Move `return refreshData.access_token` outside the try block. Cited by `reliability` (rel-002, medium conf 80).

## P2 — Logging & observability

- **Hash-pin failures fire at warn level with no metric.** Indistinguishable from per-user-OAuth-not-completed at the same level. At 400+ agents the log volume drowns the signal. Emit hash mismatches as `error` with a CloudWatch metric dimension so an alarm can fire on rate. Cited by `adversarial` (adv-004, medium conf 75).
- **Deprecation warning rate not bounded.** During U2..U9 every (agent × admin-ops slug) collision per turn fires a warn. At steady state this dominates CloudWatch. Either downgrade to `info` or memoize emission per `(agent_id, slug)` per Lambda container. Cited by `reliability` (rel-006, low conf 80).
- **Admin-side query failure is logged at warn but not as a structured metric.** A transient DB error during the admin query causes admin tools to silently disappear from that turn. Currently emits a freeform `console.warn`. Add a structured marker `{event: 'admin_mcp_query_failed', tenant_id, agent_id}` so CloudWatch Insights / alarms can count it. Cited by `adversarial` (adv-001, P2 conf 75), `kieran-typescript` (residual).

## P3 — Defense in depth (low priority)

- **Trigger bypass via DELETE+INSERT, TRUNCATE, COPY, or replication.** The one-way-door trigger only fires on row-level UPDATE. Operators with raw SQL access can demote `is_admin` via DELETE+INSERT or `session_replication_role=replica`. Add an attach-time CHECK trigger on `agent_template_admin_mcp_servers` that verifies the referenced template's `is_admin=true`; document the trigger as best-effort. Cited by `adversarial` (adv-006, low conf 50).
- **`admin_mcp_servers.status` defaults to `'approved'` (grandfathering).** Tenant-MCP did the same, but admin-MCP is at higher trust level — should default to `'pending'` and require explicit approval. U3+ should set `status='approved'` only on rows that came from the `mcp-admin-provision` path. Cited by `adversarial` (adv-007, P2 conf 75).
- **`expires_at IS NULL` bypasses expiry check.** Pre-existing on `origin/main`. Cited by `correctness` (low conf 80).
- **`processRows` helper too generic a name.** Reads as boilerplate; a name like `applyHashGateAndAuth` or `materializeMcpConfigs` describes the intent. Cited by `maintainability` (maint-004, P2 conf 45).

## Testing gaps

- **Trigger logic untested at the DB.** The schema test regex-matches the migration SQL but does not execute it. A future change that flipped the `OLD/NEW` polarity would still pass the regex but block legitimate promotions. Add a `pg-mem` or test-container integration that runs the migration and asserts: (1) `UPDATE SET is_admin=false WHERE is_admin=true` raises; (2) `UPDATE SET is_admin=true WHERE is_admin=false` succeeds; (3) `UPDATE SET name='x'` does not raise.
- **No integration test exercises `bash scripts/db-migrate-manual.sh --dry-run` on the migration.** The marker-classification fix (commit `fix(review): apply autofix feedback`) was caught by review, not CI. Add a CI step that runs the dry-run reporter and fails on any UNVERIFIED.
- **No test for `tenant`-query throws case.** The merge test covers `admin throws + tenant succeeds`; no companion case asserts that tenant failures bubble up (the asymmetric error-isolation contract is intentional but should be locked in). Cited by `testing` (testing-1, P2 conf 70).
- **OAuth refresh failure paths untested.** `resolveMcpAuth`'s well-known fetch / OIDC discovery / refresh-POST / SecretsManager rotation paths have no direct tests in this PR. Cited by `kieran-typescript` (residual), `correctness` (testing gap).
- **No test for cross-tenant `agent_admin_mcp_servers` row leaking.** Add when U4 introduces the explicit `tenant_id` boundary on the resolver query.
