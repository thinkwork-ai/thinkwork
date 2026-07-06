---
title: AgentCore env mirror rejects control characters — and a failed update strands the runtime with EMPTY env
symptoms:
  - "Every 'Update AgentCore Runtimes' job on main failed: ValidationException: Environment variable value contains invalid control characters (0x00-0x1F, 0x7F). Key: 'CAPABILITY_SIGNING_PUBLIC_KEY'"
  - "After the failed update, get-agent-runtime showed environmentVariables = {} — the runtime was serving with ZERO env vars while READY"
  - "The runtime image still advanced (the inline deploy.yml update path sets the image without env), masking the breakage as partial success"
root_cause: platform_api_constraint
resolution_type: code_fix
related_components:
  - deploy-workflow
  - agentcore-runtime
  - update-agentcore-runtime-image
tags:
  - agentcore
  - environment-variables
  - pem
  - control-characters
  - deploy
---

# AgentCore env mirror rejects control characters — and a failed update strands the runtime with EMPTY env

## Problem

From the moment THINK-173 landed `CAPABILITY_SIGNING_PUBLIC_KEY` (an SPKI PEM, i.e. a multi-line value) on the `thinkwork-<stage>-agentcore-pi` companion Lambda, every "Update AgentCore Runtimes" job on main failed:

```
ValidationException when calling the UpdateAgentRuntime operation:
Environment variable value contains invalid control characters (0x00-0x1F, 0x7F).
Key: 'CAPABILITY_SIGNING_PUBLIC_KEY'
```

Lambda env vars legally contain newlines; Bedrock AgentCore runtime env vars reject any control character. `scripts/update-agentcore-runtime-image.sh` mirrors the Lambda's env verbatim into the runtime (`runtime_env_json()`), so the PEM's newlines poisoned every update call.

Worse: the failure mode is **not** "runtime keeps its old state." The THINK-154 U5 deploy left the dev Pi runtime READY on the **new** image (the inline deploy.yml update path sets the image _without_ passing env) with **zero environment variables** — a silently degraded runtime that boots but can resolve none of its wiring.

## Solution

`runtime_env_json()` now escapes control characters as literal `\n`/`\r`/`\t` in the mirrored copy (#3407, jq `map_values(gsub(...))`). Any consumer of such a value must un-escape — the Pi container's `publicKeyPemFromEnv` (`capabilities-json.ts`) already normalizes literal `\n` back to newlines, which is the intended env-PEM contract.

Recovery after a stranded update: re-run the script (post-fix) with the same image URI —

```bash
bash scripts/update-agentcore-runtime-image.sh --stage dev --region us-east-1 \
  --runtime pi --image <ecr-uri> --account-id <acct> --wait-seconds 900
```

— it re-mirrors the full (escaped) env and bumps the runtime version.

## Why This Works

The two systems have different value grammars and the mirror is the seam: escaping at the mirror keeps Lambda ergonomic (real newlines) while satisfying AgentCore's charset, and the consumer-side `\n`-normalization convention (already established for terraform/SSM-carried PEMs) makes the escaped form canonical for runtime reads.

## Prevention

- Any new env var that can contain control characters (PEMs, JSON blobs with embedded newlines) must be introduced with its consumer reading through a `\n`-normalizing helper.
- After ANY failed `update-agent-runtime`, check `get-agent-runtime … environmentVariables` before moving on — a "failed" update can still have mutated the runtime (image advanced, env dropped). READY ≠ configured.

## References

- #3407 (fix) · THINK-154 rollout evidence on the Linear issue
- `docs/solutions/workflow-issues/agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md` — the adjacent image-pinning gotcha
