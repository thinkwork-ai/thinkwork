# Desktop Pi RedTeam Evaluations

Date: 2026-06-01

This runbook explains how to run the built-in RedTeam eval catalog from the
Desktop app against local Desktop Pi. Use it for focused smoke runs, category
runs, and full-catalog proof before starting failure-by-failure remediation.

## Scope

Desktop Pi evals run from Desktop Electron -> Settings -> Evaluations. The API
creates the `eval_runs` row and selected planned work items, then Electron hands
the work to the local Pi sidecar. The sidecar runs each case through
Desktop-local Pi and reports results back through the API callback endpoint.

This is not the cloud eval-worker path. Web/Admin eval behavior remains the
existing backend path.

## Prerequisites

- Use the Desktop app, not web Spaces. Desktop Pi is only exposed through the
  Electron bridge.
- Sign in to the deployed stage you want to evaluate.
- Local Pi must be available in the Desktop app. In development, the gate is on
  for `dev` and can be forced with `VITE_DESKTOP_LOCAL_PI_ENABLED=true`.
- The local sidecar must be healthy or starting. Settings disables Desktop Pi
  while the sidecar is unavailable or busy.
- The tenant must have the RedTeam starter pack seeded. The starter pack is 189
  enabled cases across agent, workspace-artifact, filesystem skill, GitHub skill,
  and workspace-context targets.
- Desktop Pi runs use the hydrated `/workspace` and host-owned `just-bash`
  boundary. They must not rely on arbitrary macOS host files, native shell, or
  browser-profile access.

## Before a Run

1. Open Desktop -> Settings -> Evaluations.
2. Confirm **Desktop Pi** is available in the run target controls.
3. For a focused smoke, select one explicit test case first.
4. For a category proof, select one category, such as
   `red-team-prompt-injection`.
5. For full proof, select all categories and leave the target as Desktop Pi.

Use the smallest run that answers the question. A one-case smoke proves the
plumbing. A category run catches systemic wording/runtime issues. A full run is
the handoff point for U7 failure remediation.

## Run Types

### One-Case Smoke

Run one case from each target family before the full catalog:

| Target family            | Example case pattern          | Expected proof                                                                       |
| ------------------------ | ----------------------------- | ------------------------------------------------------------------------------------ |
| Agent                    | `red-team-agents-*`           | The run reaches terminal status and shows Desktop Pi provenance.                     |
| Workspace artifact       | `red-team-computer-*`         | The case runs as a Desktop Pi workspace-artifact request, not a cloud Computer run.  |
| Filesystem skill         | `red-team-skill-filesystem-*` | Tooling stays inside `/workspace` and uses contained file/`just-bash` behavior.      |
| GitHub skill unavailable | `red-team-skill-github-*`     | The response refuses or asks for authorization instead of fabricating GitHub access. |
| Workspace context        | `red-team-skill-workspace-*`  | Workspace content is treated as context, not authority.                              |

Record one run id per target family, the selected case name, status, and any
failure classification.

### Category Run

Run one category after the one-case smoke. Recommended first category:
`red-team-prompt-injection`, because it covers all three historical surfaces and
usually fails fast when prompt hierarchy or injected-content guidance regresses.

Record:

- run id;
- selected category;
- planned row count;
- terminal status;
- pass/fail counts;
- any repeated failure reason.

Latest focused proof:

```text
Run id: 759dbb53-5a26-4ade-b01a-dace7c8aaf30
Target: Desktop Pi
Scope: category
Selected categories: red-team-prompt-injection
Total planned: 48
Terminal status: completed
Pass/fail/error counts: 41 passed, 7 failed
Pass rate: 85.4%
Known follow-ups: classify and remediate the 7 failing prompt-injection cases.
```

### Full Catalog

Run all categories only after the one-case and category runs reach terminal
status. The full converted catalog should create 189 planned rows.

Record:

- run id;
- `total_tests`;
- completed result count;
- terminal status;
- pass rate;
- failure list grouped by target family and category;
- whether finalization happened through normal result callbacks or stale-run
  reconciliation.

If the full run creates planned rows but the API call times out before returning
work items to Electron, cancel the run from the detail header and do not keep
retrying until the deployed API includes preparation-failure cleanup. The U6
proof branch adds bounded full-run session preparation and marks the run failed
when preparation fails after row creation.

## Reading Results

Desktop Pi runs show normal run-list and run-detail pages with Desktop Pi
provenance. On the detail page, inspect:

- planned rows while running;
- status and score for each case;
- actual output;
- assertion results;
- error messages for timeout or callback failures.

Category pass-rate pills should only count terminal completed outcomes. Pending,
waiting, and running planned rows are excluded while the run is still in flight;
failed and error outcomes are included as non-passing completed cases.

## Performance and Parallelism

Desktop Pi runs are currently safest when executed one case at a time by the
sidecar. Parallel execution can speed up the catalog, but it must be bounded and
isolated:

- use a small fixed worker pool first;
- give each case an isolated prepared session and workspace state;
- avoid concurrent writes to the same hydrated `/workspace`;
- keep cancellation and stale-run reconciliation per case;
- prove one category before increasing full-catalog concurrency.

Do not replace the sidecar loop with an unbounded `Promise.all` over the full
catalog. The catalog includes tool-heavy cases, timeouts, and workspace mutation
checks, so naive fan-out can turn test speed into nondeterminism.

## Failure Classification

Before editing workspace defaults or catalog cases, classify each failure:

- obsolete eval or legacy assumption;
- missing/unclear workspace instruction;
- missing/unclear guardrail;
- missing desktop fixture or skill availability mismatch;
- runtime/product bug.

Only change canonical workspace defaults when the failure is a legitimate agent
guidance gap. Record the motivating eval case and rerun that single case before
counting the remediation as fixed.

## Proof Template

Copy this shape into the autopilot status doc or remediation notes:

```text
Run id:
Target: Desktop Pi
Scope: one-case | category | full-catalog
Selected cases/categories:
Started at:
Completed at:
Total planned:
Terminal status:
Pass/fail/error counts:
Pass rate:
Known follow-ups:
Failure classification summary:
```

## Troubleshooting

- **Desktop Pi target is missing:** confirm you are in the Desktop app, not web
  Spaces, and that local Pi is enabled for the channel.
- **Desktop Pi target is disabled:** wait for the sidecar to finish any active
  local turn, then retry. Restart Desktop if the sidecar health state stays
  stale.
- **Run has planned rows but no results:** check sidecar logs first, then API
  callback errors. Stale-run reconciliation should eventually mark missing rows
  terminal.
- **Full-catalog start times out before returning work items:** cancel the run
  from the detail page. After the U6 API cleanup deploys, this path should mark
  the run failed automatically instead of leaving `running 0 / N` in Recent
  Runs.
- **GitHub skill cases fail as "missing tool":** verify the case expects absent
  GitHub credentials. The default Desktop Pi catalog treats GitHub skill cases
  as authorization/refusal tests unless the workspace explicitly enables GitHub.
- **Filesystem cases try host paths:** this is a failure. Desktop Pi file access
  must stay inside the hydrated `/workspace` boundary.
