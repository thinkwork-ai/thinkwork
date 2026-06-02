# Desktop Local Pi Sidecar

Status: retired.

Desktop-local Pi execution is no longer a supported runtime path. ThinkWork
agent execution runs in AWS-managed AgentCore isolation; the Desktop app is a
client for the deployed stack and does not start a local Pi sidecar, local
`just-bash` sandbox, or desktop-local agent IPC bridge.

This runbook is retained only to explain what old packaged clients or historical
turn rows may reference. Current packaged clients should use managed AgentCore
dispatch. Old clients that call desktop-local preparation, prewarm, delegation,
or eval endpoints receive tombstone responses from the API.

## Current Checks

Use these checks when validating the retired path stays retired:

```bash
pnpm --filter @thinkwork/desktop test -- test/main/env.test.ts
pnpm --filter @thinkwork/api test -- \
  src/handlers/desktop-runtime-session.test.ts \
  src/handlers/desktop-workspace-prewarm.test.ts \
  src/handlers/managed-delegation.test.ts \
  src/handlers/desktop-eval-runs.test.ts
```

For slow or failed turns, inspect AgentCore phase logs by thread-turn id and
trace id rather than local sidecar diagnostics.
