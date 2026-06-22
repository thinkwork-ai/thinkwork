# OKF Wiki Navigator E2E Verification

This runbook verifies THNK-63 U7: DB wiki, OKF traversal, hybrid DB+OKF, raw
memory, and knowledge graph retrieval are compared before any routing cutover.
Read `docs/src/content/docs/concepts/knowledge/okf-wiki-navigator.mdx` for the
projection and runtime boundary.

Dry-run is safe and does not mutate a stage:

```bash
node scripts/smoke/okf-wiki-navigator-smoke.mjs
```

Live mode mutates the target stage by materializing OKF, hydrating the EFS
current view, and creating Pi thread turns:

```bash
SMOKE_ENABLE_OKF_WIKI_NAVIGATOR=1 \
SMOKE_TENANT_ID=<tenant-id> \
SMOKE_TENANT_SLUG=<tenant-slug> \
SMOKE_AGENT_ID=<pi-agent-id> \
SMOKE_USER_ID=<operator-user-id> \
SMOKE_OKF_MATERIALIZE_LAMBDA=<okf-materialize-lambda-name> \
SMOKE_OKF_EFS_REFRESH_LAMBDA=<okf-efs-refresh-lambda-name> \
node scripts/smoke/okf-wiki-navigator-smoke.mjs
```

The script also needs GraphQL HTTP config and an API key. By default it reads
`apps/web/.env`; override with `OKF_SMOKE_ENV_FILE=/path/to/env` or set:

```bash
THINKWORK_GRAPHQL_URL=<graphql-http-url>
THINKWORK_GRAPHQL_API_KEY=<api-key>
```

For Context Engine baseline calls, set `THINKWORK_API_URL` or
`SMOKE_CONTEXT_ENGINE_URL` when the GraphQL URL cannot be rewritten to
`/mcp/context-engine`. `API_AUTH_SECRET` or `THINKWORK_API_SECRET` is preferred
for the service bearer; the script can fall back to the GraphQL API key in
stages where that is accepted by the MCP handler.

The smoke passes only when:

- `okf-materialize` publishes a non-empty bundle for the tenant.
- `okf-efs-refresh` writes the tenant current view.
- At least one Pi thread uses `wiki_*` OKF tools.
- The persisted turn usage includes sanitized `okf_wiki_trace` evidence.
- Durable `wiki_context_trace` events are queryable for the turn.
- The report contains rows for all five providers and all seven criteria.
- The hybrid row cites both `db_wiki` and `okf_navigator` evidence.

Raw memory and knowledge graph may report `empty`, `skipped`, or `degraded` if
the target tenant lacks those providers; the report must still show their
status so operators can distinguish missing substrate from retrieval quality.

The report path is printed on success. Set `SMOKE_OKF_REPORT_FILE` to choose a
stable location. The report is evidence for review and follow-up routing
decisions, not an automatic default-routing cutover.
