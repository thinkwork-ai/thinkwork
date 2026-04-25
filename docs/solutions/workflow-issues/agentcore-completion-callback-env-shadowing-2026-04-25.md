---
title: "Agent-loop coroutines that re-read env after the turn lose THINKWORK_API_URL — snapshot at entry"
module: packages/agentcore-strands/agent-container/container-sources/run_skill_dispatch.py
date: 2026-04-25
problem_type: workflow_issue
component: agentcore-strands
severity: high
symptoms:
  - "skill_runs row stuck at status='running' for ~17 minutes, then flipped to 'failed' by the 15-min reconciler with the generic reason 'reconciler: stale running row (no terminal writeback within 15 min)'"
  - "Container log shows `workspace_sync action=composer_fetch sync_ms=2838 files=14` succeeding — proving env was populated"
  - "30 seconds later in the same coroutine: `ERROR run_skill: cannot post completion — missing THINKWORK_API_URL / API_AUTH_SECRET`"
  - "Agent turn itself succeeded silently — no exception, no traceback"
  - "Lambda env config shows THINKWORK_API_URL + API_AUTH_SECRET correctly populated (verified via `aws lambda get-function-configuration`)"
  - "Symptom is intermittent: roughly half the dev smoke runs hit it, half don't"
related_to:
  - docs/plans/2026-04-24-008-feat-skill-run-dispatcher-plan.md (introduced the dispatcher in PR #552)
  - PR #552 ce-code-review residual P1 reliability-05 ("post_skill_run_complete returns silently when env missing")
  - project_agentcore_deploy_race_env (warm-container env-injection race; related but distinct)
---

## What happened

Today's launch-blocker validation cycle on dev: ran `scripts/smoke/catalog-smoke.sh` for sales-prep against agent `c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c`. Two runs in a row (`c886c82e-c982-484d-b5d7-6f5f2fe053a7` and `6d143ead-e9ba-4f09-9e89-0f9ca257a079`) showed the same pattern:

1. `POST /api/skills/start` accepted the envelope, inserted `skill_runs` row, dispatched to agentcore-invoke Lambda. Returned `{runId, status: "running", deduped: false}`.
2. Container received `kind=run_skill`. Logs show `Raw payload keys: [...agentId...completionHmacSecret]` — envelope shape correct.
3. `_boot_assert` passed (41 expected files present).
4. `api_runtime_config.fetch` was called and **succeeded** — proving env was populated at this point. Workspace sync ran: `workspace_sync action=composer_fetch sync_ms=2838 files=14`. Skill envOverrides were injected (`Injected 8 envOverrides for skill agent-email-send`, etc.). System prompt built (4768 chars). Bedrock credentials loaded.
5. `Invoking Strands agent: model=us.anthropic.claude-sonnet-4-6, history=0 msgs, prompt_len=264` — agent turn started.
6. Tool registration ran (managed memory, workspace tools, file_read).
7. **Some time later (~30s for the c886c82e run)**: `ERROR run_skill: cannot post completion — missing THINKWORK_API_URL / API_AUTH_SECRET`.
8. `dispatch_run_skill` returned to the do_POST handler. The HTTP response went back to agentcore-invoke Lambda with `{status: "running"}` (the in-memory dispatcher result; the row never moved to terminal).
9. Row sat at `running` for 15 min until the reconciler picked it up with the generic "stale running row" reason — useless for triage.

## Why the obvious explanation isn't right

`os.environ.pop("THINKWORK_API_URL")` does not appear anywhere in the container source — verified via:

```
grep -rn 'environ\.pop\|del os\.environ\|os\.environ\[.*\]\s*=\s*"\s*"' \
  packages/agentcore-strands/agent-container/container-sources/
```

Returns: only `invocation_env.py` popping `SANDBOX_*` keys (unrelated) and `_cleanup_skill_env` popping per-skill envOverrides keys (also unrelated). Nothing pops `THINKWORK_API_URL` or `API_AUTH_SECRET`.

Lambda env config has both vars populated (`aws lambda get-function-configuration --function-name thinkwork-dev-agentcore` shows `"THINKWORK_API_URL": "https://ho7oyksms0.execute-api.us-east-1.amazonaws.com/"` and `"API_AUTH_SECRET": "HxLNQM..."` correctly).

Lambda Web Adapter passes env to the Python child process at startup. `api_runtime_config.fetch` worked at step 4, so the env *was* in the Python `os.environ` at that point. Something between step 4 and step 7 made it look empty.

Strong hypothesis without proof: a Strands SDK or botocore-driven subprocess interaction inside the agent turn temporarily shadows or unsets these specific env keys (perhaps via `os.environ.copy()` + child-process spawn that doesn't pass them through, with a context manager cleanup that mishandles the parent's env on exit). Not diagnosed conclusively — chasing this would burn hours and the structural fix below makes the diagnostic moot.

## The fix (structural, ships PR #563)

Don't re-read `os.environ` after the agent turn. Capture the values at dispatcher entry — when they're proven populated by the runtime-config fetch — and pass them through as parameters.

```python
async def dispatch_run_skill(payload: dict) -> dict:
    # ... read run_id, tenant_id, etc. from envelope ...

    # Snapshot at entry. The container code never pops these, but
    # something inside the long agent turn (Strands SDK? botocore
    # subprocess?) shadows them by the time the callback fires.
    api_url_snapshot = os.environ.get("THINKWORK_API_URL") or ""
    api_secret_snapshot = (
        os.environ.get("API_AUTH_SECRET")
        or os.environ.get("THINKWORK_API_SECRET")
        or ""
    )

    # ... runtime-config fetch, agent turn ...

    # Every post_skill_run_complete call site passes the snapshot:
    post_skill_run_complete(
        run_id, tenant_id, "complete",
        delivered_artifact_ref={...},
        completion_hmac_secret=completion_hmac_secret,
        api_url=api_url_snapshot,
        api_secret=api_secret_snapshot,
    )
```

`post_skill_run_complete` accepts the new params and uses them when provided, falling back to env reads otherwise (preserves backward compat for callers that don't snapshot — none in the current codebase, but the chat path is structurally similar and may add a caller later).

## When this pattern applies

**Any long-running agent coroutine that POSTs back terminal state at the end.** The shape that's at risk:

1. Coroutine reads env at the top to dispatch / fetch config.
2. Calls into a Strands / Bedrock / botocore agent loop that runs for tens of seconds.
3. At the end, calls a writeback function that re-reads env.

The risk surface is **the gap between #1 and #3**. Anything that mutates env in #2 (intentionally or as a side effect of subprocess management) loses the values. Snapshotting at #1 + threading through to #3 eliminates the risk regardless of what #2 does.

Other coroutines in the container that fit this shape and may need the same treatment in a future pass:
- `chat-agent-invoke.ts` → AgentCore Lambda → `_execute_agent_turn` → memory-retain Lambda invocation. The chat path doesn't currently re-read env after the turn (it uses a Lambda invoke from earlier-captured config), so it's not affected today, but if a refactor introduces post-turn env reads they should snapshot.
- Future MCP-tool wrapping that POSTs back per-tool telemetry from inside the agent loop.

## Operator playbook when this fires in prod

1. Look for `ERROR run_skill: cannot post completion` in `/thinkwork/<stage>/agentcore` CloudWatch logs.
2. Cross-reference the timestamp with `skill_runs` rows whose `status = 'running'` and `started_at` is within the last 30 minutes. Match by tenant + skill_id + start time.
3. Confirm Lambda env is correctly populated:
   ```sh
   aws lambda get-function-configuration --function-name thinkwork-<stage>-agentcore --region us-east-1 \
     --query 'Environment.Variables.{api_url:THINKWORK_API_URL, secret_set:API_AUTH_SECRET}'
   ```
4. If env is correctly populated → this is the env-shadowing bug PR #563 fixed. Verify the deploy that landed PR #563 is serving (`Configuration.LastModified > 2026-04-25T09:04:08Z`).
5. If env is NOT populated on the Lambda → this is the genuinely-empty case from `project_agentcore_deploy_race_env`; the 15-min reconciler is the only backstop.

## Resolution

Shipped in PR #563 (commit on main `4d136d2f`, deployed 2026-04-25 via run 24927369694). Two regression tests in `test_server_run_skill.py::PostCompletionTests` pin the precedence rule:
- `test_snapshot_params_override_empty_env` — env empty + snapshot provided → callback fires with snapshot
- `test_snapshot_params_take_precedence_over_env` — env populated + snapshot provided → snapshot wins, env ignored
