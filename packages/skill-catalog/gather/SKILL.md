---
name: gather
description: >
  Parallel fan-out primitive for compositions. Declarative stub — the real
  semantics live in the composition runner, which executes a step's
  branches concurrently via asyncio.gather.
license: Proprietary
metadata:
  author: thinkwork
  version: "0.1.0"
---

# Gather Skill (declarative)

## This is not a runnable skill

`gather` has no script, no prompt, and no MCP. It exists in the catalog
so that admins and composition authors can see parallel fan-out as a
first-class primitive. The behavior is baked into the composition runner.

## How to use it

In a composition's `steps:`, declare a step with `mode: parallel` and
a `branches:` list. Each branch is a sub-skill invocation with its own
inputs, an optional `critical: true` flag, and an optional
`timeout_seconds`. The composition runner fans the branches out with
`asyncio.gather`, enforces per-branch timeouts, and aggregates results.

```yaml
steps:
  - id: gather
    mode: parallel
    on_branch_failure: continue_with_footer
    branches:
      - id: crm
        skill: crm_account_summary
        inputs: { customer: "{customer}" }
        critical: true
      - id: ar
        skill: ar_summary
        inputs: { customer: "{customer}" }
      - id: tickets
        skill: support_incidents_summary
        inputs: { customer: "{customer}" }
    output: gathered
```

## Branch semantics

- **critical: true** — if this branch fails, the whole composition aborts
  with status `failed`. The composition's `on_branch_failure` policy
  does not apply to critical branches.
- **critical: false** (default) — the branch's failure is recorded as a
  footer note on the step output. The composition continues per
  `on_branch_failure` (default `continue_with_footer`).
- **timeout_seconds** (default 120) — `asyncio.wait_for` per branch.
  Exceeding the timeout is a branch failure; combined with the critical
  flag it either aborts the run or footers cleanly.

## What this skill does NOT do

- It does not decide what to fetch — the composition author picks the
  branches.
- It does not block the composition on any external signal. Branches
  should be short-running fetches or computations; anything that waits
  on humans or downstream systems belongs in the reconciler pattern
  (see plan D7a), not in a gather branch.
- It does not guarantee ordering inside the aggregated output. Treat
  `{gather_output}` as a dict keyed by branch id.
