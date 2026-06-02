# Desktop Pi RedTeam Evaluations

Status: retired.

The Desktop Pi RedTeam evaluation path has been superseded by managed AgentCore
evaluations. Desktop can still start and view evaluation runs, but it uses the
same managed backend path as the web app. The Electron shell does not run eval
cases through a local sidecar or local Pi runtime.

Historical runs may still show Desktop Pi provenance in run lists and result
details. Treat that provenance as old execution history, not as an available
target for new runs.

## Current Evaluation Path

Run RedTeam evaluations through the managed UI or CLI:

```bash
thinkwork eval run --stage dev --all --watch --timeout 900
```

The managed eval-runner invokes AgentCore for each test case, records
`eval_runs` and `eval_results`, and surfaces status through the standard
Evaluations pages.

## Current Checks

Use the managed evaluation tests and tombstone tests when validating this area:

```bash
pnpm --filter @thinkwork/api test -- src/handlers/eval-runner.test.ts
pnpm --filter @thinkwork/api test -- src/handlers/desktop-eval-runs.test.ts
```

Do not re-enable Desktop Pi, sidecar evaluation callbacks, or host-owned
`just-bash` evaluation flows without a new requirements document.
