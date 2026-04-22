# sandbox-pilot

Reference template exercising the full AgentCore Code Sandbox path
end-to-end. Operators assign this to a dogfood agent when validating a
new stage's sandbox substrate.

## What it demonstrates

1. **Typed skill** (`run_pilot`) pulls the last 30 days of `skill_runs`
   via Thinkwork's GraphQL using `THINKWORK_API_SECRET`.
2. **Sandbox tool** (`execute_code`) joins the rows with a GitHub issue
   body the agent fetches ad-hoc, produces a pandas chart, uploads to
   S3, and posts the URL to Slack.
3. **OAuth plumbing** — `GITHUB_ACCESS_TOKEN` and `SLACK_ACCESS_TOKEN`
   land in `os.environ` inside the sandbox via the preamble (plan
   Unit 8). The pilot never handles raw tokens itself.
4. **End-to-end redaction** — any `print(os.environ['GITHUB_ACCESS_TOKEN'])`
   from inside `execute_code` redacts through `sitecustomize.py` before
   stdout flushes to CloudWatch.

## Template-level sandbox opt-in

The template wrapping this skill must set `sandbox` on
`agent_templates`:

```yaml
sandbox:
  environment: default-public
  required_connections:
    - github
    - slack
```

Per plan Unit 3 / Unit 9, the dispatcher reads this at invocation time,
runs the pre-flight (tenant policy + interpreter-ready +
required_connections), writes per-invocation secrets (Unit 8), and sets
`SANDBOX_INTERPRETER_ID` on the container env so `execute_code`
registers.

## Sample prompt

```
Run the sandbox pilot: use execute_code to pandas-summarise the
skill_runs I just fetched, plot a bar chart of counts by skill_id,
save it as /tmp/pilot.png, upload to S3 with boto3, and post the
public URL to #bot-lab via Slack's chat.postMessage. Report ok when
you see the message in Slack.
```

The agent should produce one `execute_code` call that:

- uses `pandas` (pre-installed in the default-public base image)
- writes to `/tmp/` (ephemeral, wiped at turn end)
- uses `boto3` with the sandbox IAM role's S3 grants
- posts via `requests.post("https://slack.com/api/chat.postMessage", ...)` using `os.environ["SLACK_ACCESS_TOKEN"]`

## What to check after the turn

| Signal | Where |
|---|---|
| Agent turn completed | Thinkwork admin UI — thread shows assistant reply |
| Sandbox session stopped cleanly | CloudWatch `/aws/bedrock-agentcore/runtimes/*`: one StartSession + StopSession pair |
| Audit row written | `SELECT * FROM sandbox_invocations WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT 1;` — carries duration_ms, byte counts, `exit_status='ok'`, `executed_code_hash` |
| Quota counters incremented | `SELECT invocations_count FROM sandbox_tenant_daily_counters WHERE tenant_id = $1 AND utc_date = CURRENT_DATE;` |
| No tokens in CloudWatch | Search the runtime log group for `ghp_` / `xoxb-` / `Authorization: Bearer` — every match should already read `<redacted>` |

## Failure modes to exercise in dev

- **`sandbox_enabled = false`** on the tenant → agent gets `SandboxDisabled` and can't call execute_code.
- **`compliance_tier = 'regulated'`** → `updateTenantPolicy` coerces sandbox off; DB CHECK prevents raw-SQL bypass.
- **Missing GitHub connection** on the user → pre-flight returns `missing-connection`; tool not registered.
- **`SANDBOX_TENANT_DAILY_CAP=1`** → second call returns `SandboxCapExceeded` with `dimension='tenant_daily'`.

Full triage steps for each are in [`docs/guides/sandbox-environments.md`](../../../docs/guides/sandbox-environments.md).
