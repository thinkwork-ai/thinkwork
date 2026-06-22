# OKF Wiki Navigator E2E Verification

This runbook verifies the THNK-63 OKF Wiki Navigator path end to end. It is the
operator checklist for proving materialization, EFS hydration, Pi read-only
traversal, durable trace evidence, and retrieval comparison before any default
routing cutover.

## What This Proves

- The OKF materializer publishes a complete tenant bundle from canonical
  ThinkWork state.
- The EFS refresh hydrates the tenant current view from the canonical S3 bundle.
- Pi reaches OKF through Context Engine tools, not raw EFS, S3, graph, Cognee,
  Neptune, or ontology-admin access.
- Retrieved markdown is treated as untrusted source data and trace evidence is
  sanitized.
- Operators can compare DB wiki, OKF traversal, hybrid DB+OKF, raw memory, and
  knowledge graph retrieval in one report.

## Dry Run

Dry-run is safe and does not mutate a stage:

```bash
node scripts/smoke/okf-wiki-navigator-smoke.mjs
```

The dry-run prints the required live variables, optional variables, selected
corpus cases, provider ids, criteria ids, and the live checks the script will
perform.

## Live Mode

Live mode mutates the target stage by materializing OKF, hydrating the EFS
current view, creating Pi thread turns, and writing a retrieval comparison
report.

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

Optional controls:

| Variable                  | Purpose                                       |
| ------------------------- | --------------------------------------------- |
| `SMOKE_OKF_CASE_IDS`      | Comma-separated corpus case ids to run        |
| `SMOKE_OKF_CASE_LIMIT`    | Limit the number of corpus cases              |
| `SMOKE_OKF_CONTEXT_LIMIT` | Limit Context Engine hits per provider call   |
| `SMOKE_OKF_EVENT_LIMIT`   | Limit durable trace events queried for a turn |
| `SMOKE_OKF_REPORT_FILE`   | Write the report to a stable path             |
| `SMOKE_TIMEOUT_MS`        | Override the live smoke timeout               |
| `SMOKE_POLL_INTERVAL_MS`  | Override polling interval for async evidence  |

## Pass Criteria

The smoke passes only when:

- `okf-materialize` publishes a non-empty bundle for the tenant.
- `okf-efs-refresh` writes the tenant current view.
- At least one Pi thread uses `wiki_*` OKF tools.
- The persisted turn usage includes sanitized `okf_wiki_trace` evidence.
- Durable `wiki_context_trace` events are queryable for the turn.
- The report contains rows for all five providers: `db_wiki`,
  `okf_navigator`, `hybrid_db_okf`, `raw_memory`, and `knowledge_graph`.
- The report covers all seven criteria: relevance, citation correctness,
  freshness, latency, trace completeness, prompt-injection isolation, and
  failure posture.
- The hybrid row cites both `db_wiki` and `okf_navigator` evidence when it is
  successful.

Raw memory and knowledge graph may report `empty`, `skipped`, or `degraded` if
the target tenant lacks those providers; the report must still show their
status so operators can distinguish missing substrate from retrieval quality.

## Review The Report

The report path is printed on success. Set `SMOKE_OKF_REPORT_FILE` to choose a
stable location.

Review these fields before using the report as cutover evidence:

- `summary.hardRequiredProviderFailures` is `0`.
- Each case records one status per provider.
- OKF rows contain traversal trace evidence without raw storage paths or source
  ids.
- Hybrid evidence lists both DB wiki and OKF navigator sources.
- Prompt-injection cases show bounded source handling rather than policy
  expansion.
- Latency and freshness are acceptable for the target query class.

The report is evidence for review and follow-up routing decisions, not an
automatic default-routing cutover.

## Failure Handling

- Materializer failure: inspect the Lambda payload, source counts, and bundle
  manifest posture. Do not route traffic to OKF until a complete bundle exists.
- EFS refresh failure: rebuild the current view from the last known-good S3
  bundle. Treat EFS as a serving cache, not canonical state.
- Pi tool failure: confirm Context Engine runtime policy enables wiki tools and
  that Pi did not receive raw backend credentials.
- Trace failure: keep routing on DB wiki / Brain retrieval until
  `okf_wiki_trace` and durable `wiki_context_trace` evidence are present.
- Provider comparison failure: record the failed provider status and keep the
  result as no-cutover evidence.

## Rollback

Use the least disruptive rollback:

1. Disable OKF navigator runtime config or tool policy.
2. Stop materializer or EFS-refresh schedules if publication is producing bad
   bundles.
3. Point the current bundle back to the last known-good S3 version.
4. Rebuild EFS current view from S3.
5. Leave DB wiki / Brain routing unchanged until a new comparison report passes.

Never manually mutate production data outside the normal ThinkWork
merge/deploy/operate pipeline while running this verification.
