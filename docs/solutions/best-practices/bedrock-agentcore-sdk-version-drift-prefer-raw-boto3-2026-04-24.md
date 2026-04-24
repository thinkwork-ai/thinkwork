---
title: "Prefer raw boto3 client over bedrock-agentcore SDK's code_session wrapper — signature + return-value drift across SDK versions"
module: packages/agentcore-strands/agent-container/server.py
date: 2026-04-24
problem_type: integration_issue
component: assistant
severity: medium
symptoms:
  - "`_code_session(ipi)` fails with `Provided region_name '<interpreter-id>' doesn't match a supported format` — signature changed between SDK versions"
  - "After fixing the signature: `RuntimeError: bedrock_agentcore code_session has no invoke/execute/run — cannot run preamble` — the probe assumed the context manager exposes a method named `invoke` / `execute` / `run`, but the SDK's return value has an SDK-version-dependent shape"
  - "Neither Google nor the SDK's published PyPI readme documents the exact current signature clearly"
root_cause: external_api_change
resolution_type: code_fix
related_components:
  - assistant
  - integration
tags:
  - bedrock-agentcore
  - code-interpreter
  - sdk-version-drift
  - boto3
  - best-practice
last_updated: 2026-04-24
---

# Prefer raw boto3 client over bedrock-agentcore SDK's code_session wrapper — signature + return-value drift across SDK versions

## Problem

The `bedrock_agentcore.tools.code_interpreter_client.code_session` helper is a convenience context manager on top of the raw `bedrock-agentcore` boto3 client. Across releases of the `bedrock-agentcore` Python SDK pinned in `packages/agentcore-strands/agent-container/requirements.txt` (`>=1.6.0`), the helper's behavior has drifted in at least two dimensions:

1. **Constructor signature**: earlier versions accepted `code_session(interpreter_id)`; newer versions are `code_session(region: str, *, identifier: str | None = None, ...)`. Passing `ipi` positionally to the newer form lands it on the `region` slot, and the first downstream boto3 call reports `Provided region_name '<interpreter-id>' doesn't match a supported format`.
2. **Return value shape**: the value yielded by `__enter__()` is different between versions — sometimes a client object with `.invoke()`, sometimes a wrapper that routes through a different method name, sometimes an opaque session id. A "probe for invoke/execute/run" heuristic that worked against one version raises `"bedrock_agentcore code_session has no invoke/execute/run"` against the next.

Neither failure is quick to catch — both surface deep inside the happy path where the error message ends up wrapped as a `SandboxError` visible to the end user, with a stack trace that points at your wrapper code, not the SDK.

The conclusion after debugging both: **use the raw boto3 `bedrock-agentcore` client directly.** It exposes stable, documented AWS API operations whose shapes change only when AWS bumps the API version — not when the wrapper library releases a patch.

## Symptoms

- Symptom 1 (signature drift):

  ```
  ERROR sandbox execute_code failed
  SandboxError: Provided region_name 'thinkwork_dev_<tenant>_pub-<id>' doesn't match a supported format.
  ```

  The `region_name` slot rejects anything that isn't `us-east-1`/etc. An interpreter id landing there is the tell.

- Symptom 2 (return-value drift):

  ```
  ERROR sandbox execute_code failed
  RuntimeError: bedrock_agentcore code_session has no invoke/execute/run — cannot run preamble
  ```

  Occurs when `hasattr(target, name)` probes fail for every expected method name. Probe-by-heuristic over a wrapper return value is fragile; the real fix is to not probe at all.

## What Didn't Work

- **Pinning the SDK version in requirements.txt harder.** Even a tight pin doesn't help when the rest of the stack (AgentCore runtime base image) ships a different version and the container build pulls it transitively.
- **`inspect.signature(code_session)` in a one-off script to confirm.** The SDK installed on the macOS dev box (PyPI `bedrock-agentcore==0.0.1`) is a **stub** with no code. The real package lives on a different index used by the Docker build. Can't inspect locally.
- **Grepping the AWS samples repo.** Examples show the old form and the new form interchangeably. Authoritative signature lives only in the SDK tarball the container pulls, which isn't committed to the repo.

## Resolution

Replace the `code_session` context manager with direct `boto3.client("bedrock-agentcore")` calls. The boto3 client is generated from the AWS API model and has stable names / argument shapes tied to the service API version, not the wrapper library release:

- `start_code_interpreter_session(codeInterpreterIdentifier, sessionTimeoutSeconds)` → `{sessionId, ...}`
- `invoke_code_interpreter(codeInterpreterIdentifier, sessionId, name="executeCode", arguments={"code": ..., "language": "python"})` → `{stream: <EventStream>}`
- `stop_code_interpreter_session(codeInterpreterIdentifier, sessionId)` → `{}`

Event stream shape is documented (MCP tool-result) — see `docs/solutions/best-practices/invoke-code-interpreter-stream-mcp-shape-2026-04-24.md`.

Implemented in PR #495.

## When to prefer the wrapper anyway

- **Authentication chain** — if the wrapper does non-obvious credential resolution (e.g., service account token chaining) that's painful to replicate via `boto3.client()`, keep the wrapper. (Not the case for `code_session` — it's a thin convenience.)
- **Streaming retry / event loop integration** — if the wrapper handles chunk reassembly, retry on transient stream errors, etc., and re-implementing that in the caller is a lot of code. `code_session` doesn't do enough of this to justify the shape risk.

## Prevention

1. **Document the wrapper vs. raw tradeoff in ADR-ish form.** Future hands will see `from bedrock_agentcore.tools.X import Y` and assume the team endorses that path. A one-line comment at the import site pointing at this doc is cheap prevention.
2. **Pin SDK version + test in CI.** If the wrapper is used, the CI container build should include a one-shot test that imports the wrapper and asserts a known method exists with a known signature. Catches the drift at build time instead of first-invocation time in prod.
3. **Favor boto3 by default for AWS APIs**, not because the wrapper is wrong but because the wrapper's stability surface is strictly smaller than the SDK's.

## Related Learnings

- `docs/solutions/best-practices/invoke-code-interpreter-stream-mcp-shape-2026-04-24.md` — once on raw boto3, the invoke response stream has a well-defined MCP shape you consume directly.
