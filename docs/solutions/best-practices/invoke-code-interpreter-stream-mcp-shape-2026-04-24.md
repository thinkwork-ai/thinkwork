---
title: "InvokeCodeInterpreter event stream uses MCP tool-result shape (result.content[] + result.structuredContent)"
module: packages/agentcore-strands/agent-container/server.py
date: 2026-04-24
problem_type: integration_issue
component: assistant
severity: medium
symptoms:
  - "sandbox_invocations.exit_status='ok' and duration_ms > 0, but stdout_bytes=0 — code ran, output dropped"
  - "Agent reply: 'The code ran successfully but produced no output — which is odd given the print() call'"
  - "Stream consumer walks event dict looking for keys named 'stdout*' / 'stderr*' — those names don't exist in the API response"
root_cause: implementation_bug
resolution_type: code_fix
related_components:
  - assistant
  - integration
tags:
  - bedrock-agentcore
  - code-interpreter
  - mcp
  - event-stream
  - boto3
last_updated: 2026-04-24
---

# InvokeCodeInterpreter event stream uses MCP tool-result shape (result.content[] + result.structuredContent)

## Problem

`boto3.client("bedrock-agentcore").invoke_code_interpreter(...)` returns `{"stream": <EventStream>, "sessionId": ...}`. Each event on the stream wraps a single top-level `result` key — the MCP tool-result envelope. Inside `result`:

- **`content`**: a list of content blocks. `type='text'` blocks carry stdout chunks. `type='resource'` blocks carry file handles (S3 pointers, download URLs). Text blocks stream incrementally for long-running code.
- **`structuredContent`**: a dict with `stdout` / `stderr` / `exitCode` fields. Authoritative, single-shot — appears on the terminal event (not every intermediate chunk).
- **`isError`**: boolean, set on terminal failure.

An initial parser that probed the event dict for keys named `stdout` / `stderr` / `exit_code` misses the whole response shape — those names aren't in the payload anywhere. Every invocation completed with a non-zero `duration_ms` (session opened + code ran) but `stdout_bytes=0` because the parser dropped every chunk on the floor.

## Observed event shape

Confirmed live against `/thinkwork/dev/agentcore` log group after running a simple `print('[1,1,2,3,5,8,13,21,34,55]')` in the sandbox:

```
INFO sandbox stream event shape: ['result']
INFO sandbox stream event shape: ['result']
```

Two events, both `{"result": {...}}`. The terminal event carries `structuredContent.stdout == '[1, 1, 2, 3, 5, 8, 13, 21, 34, 55]\n'` (34 bytes).

## Symptoms

- `sandbox_invocations` row: `exit_status='ok'`, `duration_ms` around 2000–3000 ms, `stdout_bytes=0`, `stderr_bytes=0`, valid `session_id`
- Counter increments normally (the call *succeeded* from the tool's perspective)
- Agent receives `{"ok": true, "stdout": "", "exit_status": "ok"}` and has no way to react cleanly — there was no error but there's also no output
- Assistant reply typically reasons about the missing output: *"The code ran successfully but produced no output — which is odd given the `print()` call. That's a sandbox quirk..."*

## What Didn't Work

- **Defensive walk: "check every key for 'stdout' prefix."** Doesn't help when the API just doesn't emit keys by that name. The walk was searching an empty namespace.
- **Dump the whole event to logs.** Useful diagnostic move, not a parser. Confirmed the shape but didn't fix the consumer.
- **Wait for the terminal event only.** Works for a single shot but drops streaming chunks for long-running code. Prefer structuredContent when present, **fall back to concatenated text content blocks** when it's not yet arrived.

## Resolution

Rewrite the stream consumer to read MCP shape:

```python
for event in stream:
    if not isinstance(event, dict):
        continue
    for _k, _v in event.items():  # top-level is usually 'result'
        if not isinstance(_v, dict):
            continue
        # Authoritative single-shot fields
        sc = _v.get("structuredContent")
        if isinstance(sc, dict):
            if isinstance(sc.get("stdout"), str):
                stdout_chunks.append(sc["stdout"])
            if isinstance(sc.get("stderr"), str):
                stderr_chunks.append(sc["stderr"])
            if isinstance(sc.get("exitCode"), (int, float)):
                exit_code = int(sc["exitCode"])
        # Fall back to text content blocks when structuredContent
        # isn't emitted (streaming chunks mid-execution)
        for block in _v.get("content") or []:
            if isinstance(block, dict) and block.get("type") == "text":
                if structuredContent_seen is False and isinstance(block.get("text"), str):
                    stdout_chunks.append(block["text"])
        if _v.get("isError") is True:
            is_error = True
```

Implemented in PR #496. See `_consume_invoke_stream` in `packages/agentcore-strands/agent-container/server.py`.

Keep an INFO-level log of the top-level event keys for the first few invocations post-deploy — that's what surfaced `['result']` as the confirmed shape. Downgrade to DEBUG once the shape is known (follow-up).

## Prevention

1. **Prefer structuredContent.** AgentCore emits it on terminal events with clean `{stdout, stderr, exitCode}` tuples. Text content blocks are a fallback for partial streaming, not the primary source.
2. **Don't guess at key names.** When an integration breaks on an unknown response shape, step 1 is log the actual shape. This doc exists because "what do the keys look like?" took longer than it should have.
3. **Pin the MCP shape assumption in a comment.** The consumer's docstring calls it out so the next hand-touch knows the shape rather than re-discovering it.

## Related Learnings

- `docs/solutions/best-practices/bedrock-agentcore-sdk-version-drift-prefer-raw-boto3-2026-04-24.md` — using raw boto3 is what exposed us to the MCP stream shape directly instead of going through a wrapper that might have pre-chewed it.
