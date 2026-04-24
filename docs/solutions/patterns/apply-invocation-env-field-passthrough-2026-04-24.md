---
title: "apply_invocation_env subset-dict drops per-invocation fields server.py relies on downstream"
module: packages/agentcore-strands/agent-container/server.py
date: 2026-04-24
problem_type: logic_error
component: assistant
severity: high
symptoms:
  - "Dispatcher threads sandbox_interpreter_id onto the invocation payload (confirmed by chat-agent-invoke log: 'sandbox pre-flight: ready')"
  - "Runtime's 'Raw payload keys' log line includes sandbox_interpreter_id and sandbox_environment"
  - "But `os.environ.get('SANDBOX_INTERPRETER_ID')` is empty inside `_call_strands_agent`, so the `if os.environ.get('SANDBOX_INTERPRETER_ID'):` branch at server.py line 551 silently skips"
  - "execute_code tool never registers; agent reports 'I don't have an execute_code tool'"
root_cause: incomplete_setup
resolution_type: code_fix
related_components:
  - assistant
  - development_workflow
tags:
  - invocation-env
  - agentcore-strands
  - server-py
  - payload-passthrough
  - silent-failure
last_updated: 2026-04-24
---

# apply_invocation_env subset-dict drops per-invocation fields server.py relies on downstream

## Problem

`packages/agentcore-strands/agent-container/invocation_env.py::apply_invocation_env(payload)` reads a specific set of keys from its input dict and mirrors them into `os.environ` for the duration of the invocation. The helper reads — among others — `sandbox_interpreter_id` and `sandbox_environment` and sets `SANDBOX_INTERPRETER_ID` / `SANDBOX_ENVIRONMENT` in `os.environ` so downstream code in `server.py` (specifically the sandbox tool registration branch around line 551) can gate on them.

The bug: `server.py`'s main invocation path was calling `apply_invocation_env` with a **subset dict** constructed inline:

```python
invocation_env.apply_invocation_env({
    "workspace_tenant_id": workspace_tenant_id,
    "assistant_id": assistant_id,
    "user_id": user_id,
    "thread_id": ticket_id,
})
```

Identity fields only — no `sandbox_interpreter_id`, no `sandbox_environment`. Even though those keys were present on the raw `payload` dict (dispatcher sent them, container received them), the subset-dict hand-off stripped them before `apply_invocation_env` could read them.

Net effect: every upstream piece of the sandbox path worked correctly (preflight ready, payload contained the fields, invocation_env defined the mapping) — and the feature still shipped broken because one intermediate function threw away the data.

This is the "subset passthrough" anti-pattern. The fix is to pass `payload` forward intact (or pull the needed fields from it explicitly) rather than re-building a subset dict that has to be kept in sync every time someone adds a new invocation-env mapping.

## Symptoms

- `[chat-agent-invoke] sandbox pre-flight: ready` in the dispatcher Lambda logs (preflight happy, dispatcher set sandbox_* on the payload)
- Runtime startup log `Raw payload keys: [... 'sandbox_interpreter_id', 'sandbox_environment']` (payload reached the container)
- No log line `sandbox tool registered: execute_code` in `/thinkwork/${stage}/agentcore` — the registration branch skipped because the env var wasn't set
- `Strands agent complete: ... tools=[]` (not `tools=['execute_code']`) — agent has no sandbox tool
- Assistant reply: "I don't have an `execute_code` tool" — accurate to what it sees
- `sandbox_invocations` table has zero rows for the invocation — nothing tried to execute

## What Didn't Work

- **Grepping server.py for `SANDBOX_INTERPRETER_ID`**. That string appears at the `if os.environ.get(...)` gate and a few reads later. The grep confirms where the env var is *consumed* but not where it's *set*. The "apply" side lives one layer up in `invocation_env.py`, reached through a generic call that doesn't mention sandbox at all.
- **Assuming the dispatcher was wrong.** The dispatcher's preflight logged `ready` and was setting `payload.sandbox_interpreter_id`. The problem was entirely on the container side — after the payload had already arrived correctly.
- **Adding DEBUG logging inside the sandbox branch.** The branch wasn't entering at all; any log added there wouldn't fire. Had to back up one level and log what `os.environ` contained at the top of `_call_strands_agent`.

## Resolution

Pass the sandbox fields through to `apply_invocation_env` explicitly:

```python
invocation_env_keys = invocation_env.apply_invocation_env({
    "workspace_tenant_id": workspace_tenant_id,
    "assistant_id": assistant_id,
    "user_id": user_id,
    "thread_id": ticket_id,
    "sandbox_interpreter_id": payload.get("sandbox_interpreter_id") or "",
    "sandbox_environment": payload.get("sandbox_environment") or "",
})
```

Implemented in PR #491.

## Prevention

The *right* structural fix — not shipped in #491 — is to stop building a subset dict at all. `apply_invocation_env` should accept the full `payload` and read only the keys it knows about. That makes adding a new invocation-env mapping a one-line change in `invocation_env.py` instead of a two-file coordination.

Short-term, mitigate with a test:

1. **Unit test the passthrough.** `test_invocation_env.py` should have a case that constructs a payload with every declared invocation-env key (`workspace_tenant_id`, `assistant_id`, `user_id`, `thread_id`, `sandbox_interpreter_id`, `sandbox_environment`) and asserts `apply_invocation_env(payload)` sets the corresponding env vars. The moment someone adds a new key to `apply_invocation_env` without updating server.py's caller, the test fails.
2. **Shape the helper to take full payloads.** Refactor `apply_invocation_env` to read only the keys it declares, then every caller passes `payload` directly. Eliminates the class of bug.

## Related Learnings

- `docs/solutions/patterns/` — related passthrough footguns. If this directory grows a `payload-passthrough-pattern.md` summary, it belongs here.
