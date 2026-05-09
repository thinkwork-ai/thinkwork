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
- verifies `/apps/$appId` serves the deployed Computer SPA shell
- invokes the saved applet's deterministic `refresh()` export and checks per-source statuses
- round-trips `saveAppletState` / `appletState`
- seeds the canonical LastMile CRM pipeline-risk applet and opens it through the applet route

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
