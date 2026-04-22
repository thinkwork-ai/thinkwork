---
name: smoke-package-only
description: Composable-skill-system smoke probe. One-step composition that runs the deterministic `package` script skill. Exists solely to prove `/api/skills/start` → agentcore → composition_runner → skill_runs.status='complete' end-to-end.
license: Proprietary
metadata:
  author: thinkwork
  version: "0.1.0"
---

# Smoke: Package Only

Minimal composition used by `scripts/smoke/*-smoke.sh` to verify the
composable-skill dispatch path reaches `status='complete'`. Not a
customer-facing skill — should never be installed on a real agent.

## Why it exists

Before this skill, the smokes could only prove "compositions fail cleanly
at the first missing sub-skill" because no sub-skills were wired in the
run_skill dispatch path. This composition calls only `package`, which is
deterministic (pure template substitution, no LLM call) and requires no
external connectors — so the full dispatch → runtime → DB loop can reach
a `complete` outcome.

## Inputs

| Field     | Required | Description |
|-----------|----------|-------------|
| synthesis | Yes      | Arbitrary markdown body. Passed verbatim to `package`. |
| format    | No       | `sales_brief` / `health_report` / `renewal_risk`. Defaults to `sales_brief`. |

## Output

`deliverable` — the rendered template as markdown.
