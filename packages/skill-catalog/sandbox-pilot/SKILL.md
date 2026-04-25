---
name: sandbox-pilot
display_name: Sandbox Pilot (flagship demo)
description: >
  Reference template exercising the full AgentCore Code Sandbox path —
  pulls skill_runs from Thinkwork's GraphQL, summarises them with
  pandas via execute_code, and uploads a chart to S3 using the
  sandbox's per-tenant IAM role. Use for dogfood validation when
  onboarding a new tenant to the sandbox substrate.
category: reference
version: "1.0.0"
author: thinkwork
icon: beaker
tags: [sandbox, pilot, reference, dogfood]
execution: script
scripts:
  - name: run_pilot
    path: scripts/pilot.py
    description: "Runs the sandbox-pilot flagship demo end-to-end."
triggers:
  - "run the sandbox pilot"
  - "sandbox smoke test"
  - "sandbox flagship demo"
requires_env:
  - THINKWORK_API_URL
  - THINKWORK_API_SECRET
---

# sandbox-pilot

Reference template exercising the full AgentCore Code Sandbox path
end-to-end. Operators assign this to a dogfood agent when validating a
new stage's sandbox substrate.

## What it demonstrates

1. **Typed skill** (`run_pilot`) pulls the last 30 days of `skill_runs`
   via Thinkwork's GraphQL using `THINKWORK_API_SECRET`.
2. **Sandbox tool** (`execute_code`) summarises the rows with pandas,
   produces a bar chart, and uploads the PNG to S3 via the sandbox's
   per-tenant IAM role. Output is a presigned URL the agent reports in
   its reply.
3. **Per-tenant IAM** — no per-user OAuth tokens inside the sandbox.
   The S3 `PutObject` runs under the AgentCore session role, which
   carries exactly the tenant's own bucket grant. Agents that need
   OAuth-ed work (Slack post, GitHub issue) call a composable-skill
   connector script, not `execute_code`.
4. **Stdio redaction** — any accidental `print` of a token-shaped
   string still redacts through `sitecustomize.py` before stdout
   flushes to CloudWatch. The preamble is now a one-line readiness
   check, not a credential loader.

## Template-level sandbox opt-in

The template wrapping this skill sets `sandbox` on `agent_templates`:

```yaml
sandbox:
  environment: default-public
```

The dispatcher reads this at invocation time, runs the pre-flight
(tenant policy + interpreter-ready), and sets `SANDBOX_INTERPRETER_ID`
on the container env so `execute_code` registers.

## Sample prompt

```
Run the sandbox pilot: use execute_code to pandas-summarise the
skill_runs I just fetched, plot a bar chart of counts by skill_id,
save it as /tmp/pilot.png, upload to S3 with boto3, and return a
presigned URL for the uploaded chart in your reply.
```

The agent should produce one `execute_code` call that:

- uses `pandas` (pre-installed in the default-public base image)
- writes to `/tmp/` (ephemeral, wiped at turn end)
- uses `boto3` with the sandbox IAM role's S3 grants
- prints the presigned URL as the tool's stdout; the agent quotes it
  in its reply

## What to check after the turn

| Signal | Where |
|---|---|
| Agent turn completed | Thinkwork admin UI — thread shows assistant reply with the S3 URL |
| Sandbox session stopped cleanly | CloudWatch `/aws/bedrock-agentcore/runtimes/*`: one StartSession + StopSession pair |
| Audit row written | `SELECT * FROM sandbox_invocations WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT 1;` — carries duration_ms, byte counts, `exit_status='ok'`, `executed_code_hash` |
| Quota counters incremented | `SELECT invocations_count FROM sandbox_tenant_daily_counters WHERE tenant_id = $1 AND utc_date = CURRENT_DATE;` |
| No tokens in CloudWatch | Search the runtime log group for `ghp_` / `xoxb-` / `Authorization: Bearer` — every match should already read `<redacted>` |

## Failure modes to exercise in dev

- **`sandbox_enabled = false`** on the tenant → the dispatcher does not register `execute_code` for the turn; the agent simply responds that it cannot run code.
- **`compliance_tier = 'regulated'`** → `updateTenantPolicy` coerces sandbox off; DB CHECK prevents raw-SQL bypass.
- **Interpreter IDs null** on the tenant → pre-flight returns `provisioning`; agent gets `SandboxProvisioning`.
- **`SANDBOX_TENANT_DAILY_CAP=1`** → second call returns `SandboxCapExceeded` with `dimension='tenant_daily'`.

Full triage steps for each are in [`docs/guides/sandbox-environments.md`](../../../docs/guides/sandbox-environments.md).
