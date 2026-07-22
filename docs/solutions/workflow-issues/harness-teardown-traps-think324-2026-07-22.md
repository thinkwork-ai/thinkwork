# Harness teardown traps (THINK-324, 2026-07-21/22)

Durable lessons from retiring the managed harness (PRs #4004–#4024) and
standing up the Pi governance plane (tool-execution ledger, signed-turn
identity). Each of these cost a failed deploy or a live debugging session;
none is obvious from the code alone.

## 1. A local `thinkwork plan` destroy list lies unless you replicate the pipeline's vars

The main checkout's `terraform/examples/greenfield/terraform.tfvars` is stale
by design (deploys go through CI). The pipeline passes many enables via
`-var` flags and GHA vars instead (`enable_capability_broker=true` is
hardcoded in deploy.yml; `TWENTY_PROVISIONED=true` is a GHA var). A local
plan against the stale tfvars showed ~66 FALSE destroys — including the
Twenty OAuth client secret, SES zones, www redirect, capability broker —
that would never happen in CI.

**Rule:** before trusting a local destroy list, export the pipeline's
`TF_VAR_*`s for every subsystem that appears in the destroys (read them out
of deploy.yml's `TF_VAR_ARGS` + `gh variable list`). A destroy that survives
that replication is real; one that disappears was a tfvars artifact.

## 2. deploy.yml applies some migrations by hardcoded filename

Deleting a hand-rolled `drizzle/*.sql` file removes it from the drift gate —
but deploy.yml ALSO psql-applies specific migrations by literal path in
mid-workflow steps (the "parity schema" step at ~line 809 applied
`0264_harness_tool_execution_ledger.sql` directly). Deleting the file
without sweeping deploy.yml failed every deploy (`psql: No such file`).

**Rule:** any migration-file deletion must grep `.github/workflows/*.yml`
for the filename. Also note: migration numbers are NOT unique —
`0261/0262/0264` each exist twice (auth files vs the deleted harness files) —
grep for the full filename, not the number.

## 3. Empty-string composition breaks AgentCore Identity reconciliation

Hardcoding `oauth_issuer = ""` on the identity module collapsed the proof
return URL to a bare `/complete`, and the Twenty reconciliation passes the
combined `allowedResourceOauth2ReturnUrls` list to `UpdateWorkloadIdentity`,
whose URL-pattern validation (`\w+:(/?/?)[^\s]+`) rejects scheme-less
entries — the destructive apply failed AFTER the destroys had run. Fix:
`compact()` the list so an unconfigured half contributes nothing (#4008).

**Rule:** when a terraform module keeps running with one half disabled via
empty-string inputs, audit every list/interpolation the surviving half
builds from those inputs.

## 4. Fire-and-forget evidence events race their own ordering

The tool-execution ledger's `started`/terminal POSTs are both
fire-and-forget. On an 8ms tool call the terminal POST arrived 53ms BEFORE
its own started POST; the DB correlation trigger correctly skipped the
orphan terminal, silently degrading fast-tool evidence to started-only.
Fix: chain each terminal POST behind the same tool-call's started promise
(#4024) — the chain never rejects because the poster swallows failures, so
the never-blocks-the-turn contract holds.

**Rule:** paired append-only events with DB-enforced ordering need
producer-side per-key serialization, not just idempotency keys.

## 5. Model-side server tools never reach the runtime's tool seam

A "use your web search tool" turn on a direct-Anthropic-API model executed
the search server-side: zero `runtime.tool_execution` phases, zero ledger
rows, a correct answer. Anything the provider hosts (server-side web
search) is invisible to the agent loop's `session.subscribe` seam by
construction. Ledger/observability coverage claims must scope to "tools
that execute through the Pi loop" (built-ins, extensions, MCP).

## 6. Pi chat turns run on the Lambda, not the AgentCore runtime

Debugging note that keeps re-surprising: web chat dispatch resolves to the
`thinkwork-<stage>-agentcore-pi` **Lambda** (custom log group
`/thinkwork/<stage>/agentcore-pi` — not `/aws/lambda/...`). The AgentCore
runtime log groups (`/aws/bedrock-agentcore/runtimes/thinkwork_<stage>_pi-*`)
show only container boots for these turns.

## 7. New tables trip the analyst semantic-model gate

Any new table with a sensitive-looking column name (`credential_*`,
`secret*`, …) fails `database-pg`'s suite until it's covered in
`src/analyst/semantic-model.ts` (denylist or audited-safe) AND the
generated artifacts are refreshed: `npx tsx scripts/generate-analyst-schema.ts`
rewrites `generated/analyst/SCHEMA.md` plus the grant/RLS sections inside
migrations `0227`/`0230` — which then need re-applying to dev with the new
migration.

## Deferred to the TEI/McPherson rollout (do NOT do early)

Full removal of the `enable_agentcore_multiplayer_proof` variable plane
(greenfield/module declarations, deploy.yml `-var`s, the three GHA vars,
runner.py passthrough + legacy-bundle checks) is coupled to customer
release advancement: the deployment-control-plane runner must keep
tolerating PINNED pre-#4007 customer bundles whose terraform still declares
those vars. Strip the plumbing only once TEI and McPherson run post-#4007
releases. Until then the flag is inert (`false` fallback everywhere;
`twenty_enabled` short-circuits on `twenty_provisioned`).
