# ThinkWork Computer

End-user Computer surface for blank threads, Computer-owned thread history, generated app artifacts, approvals, and memory.

## Local Dev

Copy the ignored environment file from the main checkout before starting a worktree server:

```bash
cp /Users/ericodom/Projects/thinkwork/apps/computer/.env apps/computer/.env
```

Run the Vite dev server on a Cognito-allowed callback port:

```bash
pnpm --filter computer dev -- --host 127.0.0.1 --port 5180
```

Use `5174` instead when you need the admin-compatible callback port locally.

## Deployed Smoke

The plan-facing Computer v1 smoke command is:

```bash
scripts/smoke-computer.sh dev
```

It creates a real deployed Computer thread, subscribes to AppSync before sending a prompt, verifies live streamed chunks match the persisted assistant response and completed `computer_tasks` row, then checks the deployed Computer surface APIs for thread-table loading, approval round-trip, memory listing, and browser-evidence observability.

The same command also runs the applet pipeline smoke:

- saves or regenerates a stable smoke applet through the deployed API and asserts the `ok`, `validated`, and `persisted` pins
- verifies `/artifacts/$appId` serves the deployed Computer SPA shell
- invokes the saved applet's deterministic `refresh()` export and checks per-source statuses
- round-trips `saveAppletState` / `appletState`
- seeds the canonical LastMile CRM pipeline-risk applet and opens it through the applet route
- runs the CRM dashboard prompt smoke in dry-run mode; set `SMOKE_ENABLE_AGENT_APPLET_PROMPT=1` to exercise the live AgentCore/model path and require a newly linked applet

To run the optional live CRM dashboard prompt smoke:

```bash
SMOKE_ENABLE_AGENT_APPLET_PROMPT=1 scripts/smoke-computer.sh dev
```

The default prompt is `Build a simple CRM pipeline dashboard from the available CRM data.` Override it with `SMOKE_CRM_DASHBOARD_PROMPT` when running post-deploy acceptance prompts.

## AG-UI Spike Smoke

The experimental AG-UI Thread + Canvas route is available at:

```text
/agui/threads/<thread-id>
```

Use this real comparison prompt for live Computer turns:

```text
Build a CRM pipeline risk dashboard for LastMile opportunities, including stale activity, stage exposure, and the top risks to review.
```

For local visual verification without waiting on live AgentCore output, append the deterministic LastMile Canvas smoke flag:

```text
/agui/threads/<thread-id>?aguiSmoke=lastmile
```

Manual check:

- Open `/threads/<thread-id>` and confirm the default Thread route still loads.
- Open `/agui/threads/<thread-id>` and confirm transcript, run/tool events, Canvas, and diagnostics render from the AG-UI-shaped stream.
- Open `/agui/threads/<thread-id>?aguiSmoke=lastmile` and confirm the registered `lastmile_risk_canvas` renders KPIs, risk rows, and source status.
- Send the LastMile prompt from the AG-UI route and compare the result against the current Vercel AI Elements direction.

To run the browser-backed evidence path manually:

```bash
SMOKE_BROWSER_SCENARIO=1 SMOKE_REQUIRE_BROWSER_EVIDENCE=1 scripts/smoke-computer.sh dev
```

That mode temporarily enables the backing agent's `browser_automation` capability for the smoke turn, waits for durable `browser_automation_*` Computer events, then restores the prior capability state.

To require a successful Nova Act browser run rather than any durable browser event:

```bash
SMOKE_BROWSER_SCENARIO=1 SMOKE_REQUIRE_BROWSER_EVIDENCE=1 SMOKE_REQUIRE_BROWSER_COMPLETED=1 scripts/smoke-computer.sh dev
```

The Python Strands runtime reads the Nova Act key from `/thinkwork/<stage>/agentcore/nova-act-api-key`. Terraform creates that SecureString with a placeholder; populate the real value out of band:

```bash
aws ssm put-parameter --overwrite --name /thinkwork/dev/agentcore/nova-act-api-key --type SecureString --value "$NOVA_ACT_API_KEY"
```
