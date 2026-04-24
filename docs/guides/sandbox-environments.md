# AgentCore Code Sandbox — operator runbook

Per-tenant AgentCore Code Interpreter substrate for the `execute_code`
Strands tool. This runbook covers the first-30-days ops surface:
toggling policy, debugging the two named failure modes, and reading
the residual-threats list so incident response understands what the
substrate does and does not promise.

## Architecture in one page

```
Dispatcher (chat-agent-invoke / wakeup-processor)
    ↓  checkSandboxPreflight → ready | disabled | provisioning | not-requested
    ↓  applySandboxPayloadFields → invokePayload.sandbox_interpreter_id + sandbox_environment
    ↓
Strands container (invocation_env → os.environ.SANDBOX_*)
    ↓  server.py sees SANDBOX_INTERPRETER_ID → registers execute_code
    ↓
Agent calls execute_code(code)
    ↓  POST /api/sandbox/quota/check-and-increment  (circuit breaker)
    ↓  StartCodeInterpreterSession                  (per-turn)
    ↓  executeCode(preamble)                        (sitecustomize readiness check only)
    ↓  executeCode(user_code)                       (actual agent work)
    ↓  POST /api/sandbox/invocations                (audit row)
    ↓
Turn end: StopCodeInterpreterSession
```

`execute_code` is a pure-compute primitive. The preamble confirms the
stdio redactor is installed, then user code runs. The session does not
carry per-user OAuth credentials — agents that need OAuth-ed work call
composable-skill connector scripts.

## Toggling tenant policy

### Enable/disable sandbox for a tenant

```graphql
mutation {
  updateTenantPolicy(
    tenantId: "..."
    input: { sandboxEnabled: true }
  ) {
    id sandboxEnabled complianceTier
  }
}
```

- Caller's email must be in the `THINKWORK_PLATFORM_OPERATOR_EMAILS`
  env on the graphql-http Lambda.
- Change is atomic — writes the tenant row and inserts a
  `tenant_policy_events` audit row in one transaction.
- **`sandboxEnabled=true` on a non-`standard` compliance tier is
  rejected** with a specific error (app invariant + DB compound CHECK).

### Change compliance tier

```graphql
mutation {
  updateTenantPolicy(
    tenantId: "..."
    input: { complianceTier: "regulated" }
  ) { id sandboxEnabled complianceTier }
}
```

- Non-standard tier **coerces `sandboxEnabled` off** in the same
  transaction, producing paired audit rows (one `compliance_tier`
  event + one `sandbox_enabled` event).
- Raw-SQL attempts to bypass the coercion hit the compound CHECK and
  roll back.

### Audit trail

```sql
SELECT event_type, before_value, after_value, actor_user_id, created_at
FROM tenant_policy_events
WHERE tenant_id = '...'
ORDER BY created_at DESC
LIMIT 20;
```

Append-only table; no retention sweep. Regulators can subpoena this
directly.

## Debugging the two named failure modes

### 1. `SandboxProvisioning`

Agent calls `execute_code` and gets back `ok: false`, `error:
"SandboxProvisioning"`.

**Cause:** tenant has `sandbox_enabled=true` but the per-tenant
Code Interpreter IDs on `tenants.sandbox_interpreter_{public,internal}_id`
are null. Either provisioning is in flight or a prior provisioning
invocation errored.

**Triage:**

```sql
SELECT id, sandbox_enabled, sandbox_interpreter_public_id, sandbox_interpreter_internal_id
FROM tenants
WHERE id = '...';
```

- Both null + `sandbox_enabled=true` → provisioning Lambda never
  completed. Re-run:
  ```bash
  aws lambda invoke --function-name thinkwork-dev-agentcore-admin \
    --payload '{"body":"{\"tenant_id\":\"...\"}","headers":{"authorization":"Bearer $AGENTCORE_ADMIN_TOKEN"},"rawPath":"/provision-tenant-sandbox","requestContext":{"http":{"method":"POST","path":"/provision-tenant-sandbox"}}}' \
    --cli-binary-format raw-in-base64-out /tmp/out.json
  ```
- One null + one populated → partial provisioning. Re-run is
  idempotent (list-then-create + clientToken pattern).
- When the tenant-provisioning Lambda terraform resource lands, the
  scheduled reconciler will do this on its own.

### 2. `SandboxCapExceeded`

Agent gets `ok: false`, `error: "SandboxCapExceeded"`, `error_message`
carries `dimension` + `resets_at`.

**Cause:** the circuit breaker fired. One of:

| dimension | reset |
|---|---|
| `tenant_daily` | tomorrow 00:00 UTC |
| `agent_hourly` | top of the next UTC hour |
| `unknown` | `+60s` (deadlock fallback) |

**Triage:**

```sql
-- tenant-daily
SELECT * FROM sandbox_tenant_daily_counters
WHERE tenant_id = '...' AND utc_date = CURRENT_DATE;

-- agent-hourly
SELECT * FROM sandbox_agent_hourly_counters
WHERE tenant_id = '...' AND agent_id = '...'
  AND utc_hour = date_trunc('hour', NOW());
```

CloudWatch has every breach as a structured log line starting with
`[sandbox-quota] SandboxCapExceeded`. Query in Insights:

```
fields @timestamp, @message
| filter @message like /SandboxCapExceeded/
| stats count() by dimension
```

**Raising caps** — set SSM parameter
`/thinkwork/{stage}/sandbox/caps/{tenant_daily,agent_hourly}` and
redeploy the sandbox-quota-check Lambda (or wait for SSM-to-env
refresh). The handler reads `SANDBOX_TENANT_DAILY_CAP` /
`SANDBOX_AGENT_HOURLY_CAP`; `cap=0` is a legitimate kill-switch.

**Revisit trigger**: raise to 2000/day if any tenant hits the cap
**≥3 times in a week**, or after 30 days of production data.

## Investigating a specific invocation

Every `execute_code` call writes one `sandbox_invocations` row:

```sql
SELECT *
FROM sandbox_invocations
WHERE tenant_id = '...'
  AND started_at >= NOW() - INTERVAL '1 hour'
ORDER BY started_at DESC;
```

Key columns:

- `exit_status` — `ok | error | timeout | oom | cap_exceeded | provisioning`
- `duration_ms` — total tool-call wall-clock
- `stdout_bytes` / `stderr_bytes` — **raw pre-truncation** sizes;
  content lives in CloudWatch
- `stdout_truncated` / `stderr_truncated` — true when output exceeded
  the 256 KB / 32 KB caps
- `executed_code_hash` — SHA-256 of user code; lets you correlate
  repeat invocations of the same code across tenants
- `session_id` — join key for `/aws/bedrock-agentcore/runtimes/*` logs
- `failure_reason` — populated when `ok=false`; carries the tool-level
  error message

Retention: 30 days by default, 180-day ceiling enforced by a CHECK.

## Named v2 hardening tracks

The substrate ships with these residuals explicit. They are **not
bugs**.

| Track | Class | Mitigation plan |
|---|---|---|
| **T2** — malicious `pip install` | runtime `pip install` has no allowlist; typo-squatted / compromised packages execute at import time with access to whatever data the session reads | v2 private PyPI mirror + install allowlist |
| **T3** — PHI/PII handling | sandbox isn't HIPAA-certified; regulated-tenant default is `sandbox_enabled = false` | v2 regulated-tenant-specific environment with per-log-group encryption + shorter retention |
| **Stdout-bypass** class | `os.write(fd, ...)`, subprocess inheriting fds, C-extension writes, `multiprocessing` workers, split-writes | CloudWatch subscription-filter backstop covers the subset whose values match known OAuth prefixes (in case an agent *prints* a token fetched from an API response); primary stdio redactor in `sitecustomize.py` covers everything flowing through Python's normal print path |

## Stdio redactor invariant — honestly scoped

The sandbox guarantees: **no value matching a known OAuth prefix
(`ghp_`, `xoxb-`, `ya29.`, `Authorization: Bearer`, JWT triples) reaches
a persisted log via Python's stdio, and a CloudWatch subscription-filter
backstop catches matches that slip past the primary wrapper.**

**Explicitly out of scope** (named residuals, not gaps):

- Direct `os.write(fd, ...)` writes
- `subprocess.run(['env'])`, `subprocess.run(['cat', '/proc/self/environ'])`
- C extensions writing to fd 1 directly
- `multiprocessing` workers in fresh Python processes (the redactor's
  session state is empty there)
- Adversarial split-writes fragmenting a token across more bytes than
  the rolling-buffer window

When investigating a "how did a token leak" incident, **check the
residual list first**. If the leak matches a named residual class, the
incident is expected. If it doesn't match any named class, that's a
real regression.

## What to monitor in CloudWatch

| Query | Signal |
|---|---|
| `filter @message like /SandboxCapExceeded/` | Revisit-trigger signal |
| `filter @message like /sandbox tool registered/` | Pre-flight decided to register per turn |
| `filter @message like /sandbox pre-flight/` | Pre-flight decision log (status field) |
| `filter @message like /StopSession failed/` | AgentCore session cleanup issues |

Dashboard candidates for v1.1:

- Sandbox invocations per tenant per day (from `sandbox_invocations`)
- `exit_status` distribution
- Truncation rate (`stdout_truncated = true` fraction)
- Cap-breach rate per tenant per week

## When to call platform security

- Any `SandboxError` accompanied by a known-shape OAuth prefix in a
  CloudWatch message that the primary wrapper **did not redact**
  (matches any string starting with `ghp_`, `ghs_`, `gho_`, `xoxb-`,
  `xoxp-`, `ya29.`, or a JWT triple) — regression in the
  `sitecustomize.py` scrubber.
- A `compliance_tier` change executed by an actor not in the
  `THINKWORK_PLATFORM_OPERATOR_EMAILS` allowlist — app-gate bypass
  attempt; `tenant_policy_events` source would read `sql`.
- Orphan Code Interpreters reaching > 200 (20% of the AgentCore
  1000-per-account quota) — open the quota increase ticket + verify
  orphan GC is running daily.
