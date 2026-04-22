---
title: "Dockerfile explicit-COPY list silently drops new agent-container modules"
module: packages/agentcore-strands/agent-container
date: 2026-04-22
problem_type: build_error
component: tooling
severity: high
symptoms:
  - "ModuleNotFoundError: No module named 'update_agent_name_tool' (and update_identity_tool, update_user_profile_tool) at container startup"
  - "CloudWatch log line: 'WARNING update_agent_name registration failed: No module named ...' for each of the three new tools"
  - "Agent served requests with 1 workspace tool registered instead of 4; rename/identity/profile updates silently unavailable"
  - "try/except around tool registration swallowed the failure — container stayed healthy and all 778 unit tests + typecheck + parity tests passed"
  - "Bug only surfaced in post-merge E2E when SOUL.md 'never fabricate capability' made the agent refuse the rename honestly instead of lying about success"
root_cause: incomplete_setup
resolution_type: code_fix
related_components:
  - background_job
  - assistant
  - development_workflow
tags:
  - dockerfile
  - agentcore-strands
  - strands-tools
  - tool-registration
  - silent-failure
  - ci-gap
  - workspace-tools
  - recurring-class
---

# Dockerfile explicit-COPY list silently drops new agent-container modules

## Problem

`packages/agentcore-strands/agent-container/Dockerfile` uses an explicit per-file `COPY` list (not a wildcard) for its Python sources. When a PR adds a new `.py` file to that directory and imports it from `server.py`, skipping the Dockerfile update produces a container image that's missing the file. The `ModuleNotFoundError` surfaces at runtime — either as a hard container crash (pre-2026-04-22) or, now that tool registration is wrapped in `try/except`, as a silent WARNING log while the feature ships non-functional.

**This is the third observed occurrence of the same class of bug in the last seven days** (session history):

| Date | Module missed | Fix PR | Surfaced as |
|------|---------------|--------|-------------|
| 2026-04-15 | `external_task_context.py` | #100 | Hard container crash (Runtime.ExitError) |
| 2026-04-17 | `workflow_skill_context.py` | #140 | Hard container crash |
| 2026-04-22 | 3 × `update_*_tool.py` | #394 | Silent WARNING — feature shipped non-functional |

Each previous occurrence was fixed by adding the specific file to the COPY list. No structural fix landed, so the class keeps recurring.

## Symptoms

- All CI green — 778/778 unit tests, typecheck, parity, lint, CLA — merged and deployed normally.
- Direct AgentCore invoke with `"Please rename yourself to Zig"` returned *"I can't actually rename myself — that's an admin-level change"*, `tools_called = []`, DB name unchanged.
- `/thinkwork/dev/agentcore` CloudWatch log contained:
  ```
  WARNING update_agent_name registration failed: No module named 'update_agent_name_tool'
  WARNING update_identity registration failed: No module named 'update_identity_tool'
  WARNING update_user_profile registration failed: No module named 'update_user_profile_tool'
  INFO workspace tool registered: write_memory
  ```
- Adjacent prompts ("set your creature to fox", "call me Rick") produced *fabricated* success replies because the model routed the intent to `recall` + `remember` as a plausible substitute. The SOUL.md "never fabricate capability" rule (PR #388) caught only the rename case cleanly; the adjacent-tool-fallback case slipped past because the model DID call a tool, just the wrong one.
- Distinction from prior occurrences: the previous two incidents (PR #100, PR #140) crashed the container process entirely with `Runtime.ExitError: exit status 1`. Loud failure. PR #391 introduced the `try/except` wrapper around each `@tool` import — that pattern was designed for graceful partial degradation but converted a hard crash into a **silent 100% feature failure**. The new failure mode is strictly worse than the old one; the old one self-reported.

## What Didn't Work

(session history)

- **"Local Python unit tests prove the file is fine."** Running `python -m unittest test_workflow_skill_context.py` passes cleanly — but it runs against the repo's working directory, not a container image. The Dockerfile's COPY list is invisible to unit tests. This misled the PR #140 author and contributed to recurrence.
- **"CI passing means the container will boot."** The `pnpm typecheck` / `vitest` / parity passes do not exercise the container image. The deploy pipeline builds the image on every merge, but there's no step that asserts the `@tool` roster registered correctly at container startup — the registration warnings live only in CloudWatch.
- **"Look at the Lambda handler log first."** In the PR #100 incident, the Lambda-level log showed only `Runtime.ExitError exit status 1`. The actual `ModuleNotFoundError` line appeared in the AgentCore runtime's own log group (`/thinkwork/dev/agentcore`), not the Lambda handler log group. Checking the wrong log group cost multiple hours of MCP / auth / wire-format debugging before the real cause surfaced.

This session's diagnostic fumbles (on top of the known-hazards above):

- **"The Lambda is pinned to the wrong image."** Partly true but beside the point. Another process was pushing `subskill-*` / `runskill-*` tagged images and overwriting PR #391's SHA-tagged image via `aws lambda update-function-code`. Forced the Lambda back to PR #391's SHA; tool registration still failed because the bug was one layer deeper.
- **"The AgentCore runtime is stale (5-day-old image)."** Real fact, wrong problem. The deploy pipeline builds `linux/amd64` images but AgentCore runtime requires `arm64`; the runtime hasn't been updatable since that mismatch started. The chat-agent-invoke path goes through the Lambda `thinkwork-dev-agentcore`, though, not the runtime directly.
- **"Terraform apply is failing."** Also real, also unrelated — PR #389 introduced an undeclared `module.lambda_api` reference that broke three successive deploys (fixed in PR #392). Resolving it didn't change the tool roster because the Dockerfile continued to ship the same incomplete file list either way.

The diagnostic that cracked it — **grep `/thinkwork/dev/agentcore` CloudWatch for `"registration failed"`** — returned three WARNING lines naming the exact missing modules. Any earlier grep against the error keyword would have solved it in under a minute. (auto memory [claude]: `feedback_read_diagnostic_logs_literally` — diagnostic logs said the thing; nobody read them.)

## Solution

Added three `COPY` directives for the new tool modules in PR #394. One-line-equivalent diff:

**Before** (`packages/agentcore-strands/agent-container/Dockerfile`, lines 37-38):

```dockerfile
COPY packages/agentcore-strands/agent-container/write_memory_tool.py .
COPY packages/agentcore-strands/agent-container/workspace_composer_client.py .
```

**After:**

```dockerfile
COPY packages/agentcore-strands/agent-container/write_memory_tool.py .
# Self-serve agent tools (docs/plans/2026-04-22-003-...-plan.md). Without
# these three COPY lines the server.py registration block silently
# falls through to warning-level logs — the tools never reach the
# agent's toolset and the model loudly refuses the actions it's been
# told (via MEMORY_GUIDE.md) it can take.
COPY packages/agentcore-strands/agent-container/update_agent_name_tool.py .
COPY packages/agentcore-strands/agent-container/update_identity_tool.py .
COPY packages/agentcore-strands/agent-container/update_user_profile_tool.py .
COPY packages/agentcore-strands/agent-container/workspace_composer_client.py .
```

After merge + image rebuild + forcing the Lambda to the new SHA-tagged image, CloudWatch showed all four tools registered at INFO:

```
INFO workspace tool registered: write_memory
INFO workspace tool registered: update_agent_name
INFO workspace tool registered: update_identity
INFO workspace tool registered: update_user_profile
```

E2E verification then cleared all three self-serve flows: rename, identity edit, user profile edit — tools fired, DB + S3 state consistent, no fabrication.

## Why This Works

The per-file `COPY` list is a deliberate choice that avoids pulling in tests, `__pycache__`, and other build detritus that a wildcard would sweep in. The cost of that choice is that every new `.py` file becomes a two-step landing: (1) add the module, (2) register it in the Dockerfile. Missing step 2 produces a runtime `ModuleNotFoundError` that neither `docker build` nor CI can catch — Python resolves imports only at container startup.

The `try/except` wrapper around each registration was added in PR #391 to allow graceful partial degradation ("one broken tool shouldn't take the whole agent down"). In practice it hid a *coordinated* 100% failure — all three missing modules came from the same Dockerfile omission, so all three warned identically, and the container happily started up with one-quarter of its intended toolset. Before PR #391, the container crashed hard and operations noticed within minutes; after PR #391, the container stays green forever and only E2E invocation reveals the gap. The pattern is strictly worse-than-what-it-replaced for failures that happen to be correlated.

## Prevention

### Immediate (structural, not just discipline)

Three occurrences in seven days make this a recurring class, not a one-off. The discipline-level fix ("remember to update the Dockerfile") has failed three times. Ship one of these:

1. **Refactor the Dockerfile to use a subdirectory + wildcard.** Move Strands-container Python files into `packages/agentcore-strands/agent-container/container-sources/` and use:
    ```dockerfile
    COPY packages/agentcore-strands/agent-container/container-sources/*.py .
    ```
    Use `.dockerignore` to exclude tests and `__pycache__`. Biggest structural fix; eliminates the class entirely.

2. **OR: Startup assertion on expected tool registration.** After `server.py`'s registration block, compare `len(tools)` (or a canonical name set) against a declared constant:
    ```python
    EXPECTED_WORKSPACE_TOOLS = {"write_memory", "update_agent_name", "update_identity", "update_user_profile"}
    missing = EXPECTED_WORKSPACE_TOOLS - set(tool.name for tool in tools)
    if missing:
        raise SystemExit(f"FATAL: workspace tools failed to register: {missing}")
    ```
    This restores the loud-failure property that PR #391's `try/except` inadvertently removed. Partial degradation is a legitimate design choice for unrelated tools; it should not apply to a coordinated set shipping in the same PR.

3. **OR: Promote `logger.warning` to `logger.error` on registration failure** in every `try/except`. Minimum-viable alarm — won't fail the container, but paints red in CloudWatch and can alarm on. This is the narrow fix tracked as a follow-up from PR #391 review (REL-005, KP-006).

### Additional safety nets (lower priority, wider value)

4. **Post-deploy smoke test that asserts expected tool registration.** After any deploy that rebuilt the agentcore image, run a script that invokes the Lambda once and greps the CloudWatch log for every `workspace tool registered: <name>` line the codebase declares. Missing INFO → fail the deploy. This catches the Dockerfile gap even if (1) and (2) aren't adopted.

5. **Dockerfile COPY audit on every new `.py` file.** When adding any Python file under `packages/agentcore-strands/agent-container/` or `packages/agentcore/agent-container/` that a container entry point imports, grep the Dockerfile for the filename. If absent, add a `COPY` line in the same PR. (This is the current discipline; it has failed three times and should not be relied on alone.)

6. **E2E tool-invocation check for any new `@tool` PR.** A post-deploy smoke that POSTs a trigger prompt to the Lambda and asserts the tool name appears in `tools_called` of the response. Would have caught PR #391 before a human ever typed "rename yourself to Zig".

### Diagnostic hygiene when this happens again

- **Grep `/thinkwork/dev/agentcore` first, not the Lambda log group.** The AgentCore runtime log group is separate from the Lambda handler log group and holds the real Python traceback. The Lambda handler log typically only shows `Runtime.ExitError: exit status 1` or — post-PR #391 — nothing useful at all.
- **`"registration failed"` and `ModuleNotFoundError` are the two keywords.** Either finds the bug in seconds.
- **Container rebuilds are not guaranteed on every PR.** An image rebuild only happens when the Dockerfile itself changes in a PR. A `.py` file added without a Dockerfile change can sit broken for days until an unrelated PR triggers the rebuild — so the first observed crash can be far removed in time from the PR that introduced the import.

## Related Issues

- **PR #391** — `feat(workspace): self-serve agent tools — rename, identity, user-profile` — added the three `@tool` modules and registration blocks but not the Dockerfile COPY lines.
- **PR #394** — `fix(agentcore): COPY the 3 new self-serve tool files into the container` — this resolution.
- **PR #388** — `feat(workspace): SOUL.md — "Never fabricate capability"` — introduced the guardrail that surfaced the honest refusal on rename. Without this PR, the agent would have fabricated success and the bug would have gone undetected longer.
- **PR #100** — `fix(agentcore): bundle external_task_context.py` — first recurrence of this class (2026-04-15).
- **PR #140** — `fix(agentcore): bundle workflow_skill_context.py into container` — second recurrence (2026-04-17).
- **Follow-up**: promote registration-failure log level + add startup assertion (PR #391 review items REL-005 and KP-006).

## Sibling silent-failure learnings

This bug joins the codebase's silent-failure family — different mechanisms, same shape ("visible only to a CloudWatch grep, CI passes regardless"):

- [`docs/solutions/logic-errors/bootstrap-silent-exit-1-set-e-tenant-loop-2026-04-21.md`](../logic-errors/bootstrap-silent-exit-1-set-e-tenant-loop-2026-04-21.md) — bash `set -e` inside a tenant loop kills the script silently when one tenant's S3 prefix is empty.
- [`docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md`](../logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md) — `ON CONFLICT DO NOTHING` returns 0 rows touched without signaling the continuation chain is dead.
- [`docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md`](../logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md) — `SELECT ... WHERE tenant_id = ? LIMIT 1` returns an arbitrary row; wrong owner assigned silently.

The common methodology lesson: **instrument the silent-failure case first, hypothesize second**. Every doc in the family was solvable in minutes once the right log line was read; each one burned hours on hypothesis-debugging before someone grepped the right keyword.
