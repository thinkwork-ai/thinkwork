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
