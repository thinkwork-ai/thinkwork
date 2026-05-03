---
title: FR-9a integration spike verdict — AgentCore Code Interpreter SandboxFactory + Bedrock routing
date: 2026-05-03
category: docs/solutions/architecture-patterns/
module: flue-aws
problem_type: spike_verdict
component: agent_runtime
severity: medium
applies_when:
  - Deciding whether to revise the 2026-04-26 Pi parallel plan + three follow-ups
  - Validating AgentCore Code Interpreter's BashLike compatibility for Flue
  - Confirming Bedrock model routing through Flue's init({ model, providers })
related:
  - docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md
  - docs/solutions/architecture-patterns/flue-framework-spike-verdict-2026-05-03.md
  - docs/plans/2026-05-03-004-feat-flue-fr9a-integration-spike-plan.md
tags:
  - flue
  - fr-9a
  - agentcore
  - bedrock
  - sandbox-connector
  - spike
  - verdict
---

# FR-9a integration spike verdict — AgentCore Code Interpreter SandboxFactory + Bedrock routing

**Verdict: green.** Both gating questions resolved cleanly. The reframe described in `docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md` is implementable as planned. /ce-plan can revise the 2026-04-26 plan + three follow-ups.

## What was tested

Built `@thinkwork/flue-aws` package at `packages/flue-aws/` with a `SandboxFactory` wrapping `InvokeCodeInterpreterCommand`. Connector source duplicated into `/Users/ericodom/Projects/flue/examples/hello-world/.flue/connectors/agentcore-codeinterpreter.ts` for spike execution. Two test agents in the Flue clone exercised the connector + Bedrock routing against the dev account (`487219502366`, `us-east-1`):

- `agentcore-ci-spike.ts` — 11 ops across 9 shell probes + 2 LLM-tool probes against AgentCore CI interpreter `thinkwork_dev_0015953e_pub-5rETNEk2Vt`
- `bedrock-routing-spike.ts` — three Bedrock routing attempts via Flue's `init({ model, providers })`

## AgentCore Code Interpreter capability matrix

All 11 probes returned `clean` (no shell-wrap workarounds needed beyond the connector's existing design). The AgentCore CI image is **Amazon Linux 2023 (aarch64), kernel 6.1.158** with a real shell — `/bin/sh` (likely bash-compatible).

| SessionEnv operation | AgentCore CI tool | Status | Notes |
|---|---|---|---|
| `exec` (shell) | `executeCommand` | clean | `uname -a` returns full Linux kernel string; non-empty stdout, exitCode 0 |
| `exec` echo | `executeCommand` | clean | `echo "hello fr9a"` round-trips |
| `exec` write+read via shell | `executeCommand` | clean | `echo "x" > /tmp/f && cat /tmp/f` matches |
| `exec` pipes | `executeCommand` | clean | `printf "a\nb\nc\n" \| wc -l` returns `3` |
| `exec` compound | `executeCommand` | clean | `echo step1 && echo step2` runs both |
| `exec` mkdir | `executeCommand` | clean | `mkdir -p /tmp/dir/sub` + `test -d` confirms |
| `exec` listdir | `executeCommand` | clean | `ls -1 /tmp` returns entries |
| `exec` stat | `executeCommand` | clean | `stat -c '%F\|%s'` returns `directory\|240` |
| `exec` env | `executeCommand` | clean | `env \| grep '^HOME\|PATH\|USER'` returns 3+ vars |
| `writeFile` (LLM tool path) | `writeFiles` (via SessionEnv) | clean | LLM `write` tool routes through SessionEnv → `writeFiles`; cat verify matches |
| `readFile` (LLM tool path) | `readFiles` (via SessionEnv) | clean | LLM `read` tool routes through SessionEnv → `readFiles`; sentinel returned |

**Connector design notes from the spike:**

- **Default `cwd` prefix is removed.** Initial implementation prefixed every `executeCommand` invocation with `cd <defaultCwd> && ...`. AgentCore CI's session ships with its own non-customizable cwd — `cd /home/user` (the Daytona-like default) fails with `No such file or directory`. The connector now does NOT prefix `cd`; callers needing a specific cwd pass absolute paths in their commands. Path resolution stays internal to the SessionEnv wrapper for relative-path file ops.
- **AgentCore CI's `executeCommand` accepts arbitrary shell** — pipes, redirects, compound commands all work natively. No need to wrap in Python or invoke a shell explicitly.
- **`readFiles` / `writeFiles` / `listFiles` work as direct API calls.** No shell wrapping required.
- **`stat`, `exists`, `mkdir`, `rm` are shell-wrapped** via `executeCommand` (no direct AgentCore CI API for these). All work cleanly given the real-shell semantics above.

## Bedrock model routing

**Result: working via `amazon-bedrock/<full-arn-model-id>`.**

| Path | Model string | Status | Notes |
|---|---|---|---|
| 1. `amazon-bedrock/<short-alias>` | `amazon-bedrock/claude-haiku-4-5` | failed | `[flue] Unknown model "amazon-bedrock/claude-haiku-4-5"` — Flue's model resolver rejects pi-ai's short alias |
| 2. `amazon-bedrock/<full-id>` | `amazon-bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0` | **ok** | Round-trip "PONG" succeeded; production wiring uses this format |
| 3. `providers.anthropic.baseUrl` override | `anthropic/claude-haiku-4-5` + `bedrock-runtime.us-east-1.amazonaws.com` | not attempted | Skipped after path 2 succeeded |

**Production model strings** (for use in agent definitions and runtime selector):

- `amazon-bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0`
- `amazon-bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0`
- `amazon-bedrock/us.anthropic.claude-sonnet-4-6` (also available as `global.anthropic.claude-sonnet-4-6`)

Short aliases (`claude-haiku-4-5`) are pi-ai-internal and not exposed through Flue's model parser. /ce-plan should standardize on full-region-prefixed IDs and document a mapping helper for operators if short aliases become user-facing.

## Tenant isolation

**Finding: per-session isolation confirmed; cross-tenant isolation is IAM-bounded.**

- AgentCore CI sessions are created via `StartCodeInterpreterSession` with a unique `sessionId` per call, scoped to a single `codeInterpreterIdentifier`. The connector's `cleanup: true` option (used in the spike) calls `StopCodeInterpreterSession` after the agent loop completes, ensuring no session reuse between invocations.
- Within a single invocation, all `executeCommand`/`readFiles`/etc. calls share one session — this is desired (preserves filesystem state across the agent's tool calls).
- Cross-tenant isolation between AWS accounts uses AgentCore CI's IAM permission boundaries: each account owns its `codeInterpreterIdentifier` resources; cross-account access requires explicit IAM grants. The dev-account interpreters (`thinkwork_dev_0015953e_int-5Wi3TRcVTJ`, `thinkwork_dev_0015953e_pub-5rETNEk2Vt`) are not accessible from any other AWS account without explicit policy.
- For multi-tenant *within* a single ThinkWork enterprise account, /ce-plan must define how AgentCore CI sessions are scoped per `tenantId` — likely one interpreter resource per tenant (mirroring `terraform/modules/app/agentcore-code-interpreter/main.tf`'s pattern of per-stage interpreters), with the trusted handler resolving the right `codeInterpreterIdentifier` from the invocation's tenant context. Behavioral test for residual state leakage between two same-tenant sessions was not run at this tier; FR-4a (origin) and the brainstorm's tenant-isolation requirements address this in plan revision.

No AWS documentation was located that names the per-tenant isolation guarantee directly; the IAM-bounded model is the operative one. Naming this explicitly in the connector docs and the productionization plan resolves the open question.

## Gotchas

- **AgentCore CI session lifecycle.** The connector lazily creates a session on first call (via `ensureSession`) and stops it on cleanup. Concurrent calls within one invocation share the session — fine for a single agent loop, but means parallel `Promise.all` of file ops would all race against the same session. AgentCore CI handles this serially per-session (executeCommand is sequential), so concurrent writes from different tools may queue. /ce-plan should verify this is acceptable for `session.task()` parallel sub-agent fan-out.
- **`cwd` is non-customizable.** Setting a SessionEnv `cwd` doesn't change AgentCore CI's session cwd. The SessionEnv wrapper resolves relative paths to absolute internally, but `pwd` from inside an `executeCommand` returns AgentCore CI's default. Most file/shell flows work because absolute paths are passed; some agents that depend on `pwd` semantics may need to use `cd <abs-path> && cmd` explicitly inside their shell strings.
- **No binary file support exercised.** `writeFiles`/`readFiles` were tested with text only. Binary content (images, archives) would route through `writeFiles` `text` field — likely needs base64 encoding wrapper. Out of spike scope.
- **Stream parsing is best-effort.** AgentCore CI's `InvokeCodeInterpreterCommand` returns a stream of events; the connector consumes them and concatenates `stdout`/`stderr` from `structuredContent` first, falling back to `content[].text`. Unusual response shapes (e.g., partial chunks, error envelopes) may need additional handling — the spike's positive results came on the well-formed happy path.
- **Bedrock model short aliases reject.** `amazon-bedrock/claude-haiku-4-5` (short alias from pi-ai's `models.generated.d.ts`) errors with `Unknown model`. Flue's model resolver only recognizes the full inference-profile-prefixed IDs (`us.anthropic...`, `eu.anthropic...`, `global.anthropic...`). Document this in operator-facing model selection.

## Recommendation

**Proceed with the reframe.** Trigger `/ce-plan` to revise `docs/plans/2026-04-26-009-feat-pi-agent-runtime-parallel-substrate-plan.md` + the three 2026-04-27/04-29 follow-up plans, swapping "vendor selectively from oh-my-pi" tasks for "implement Flue extension-point integrations" using `@thinkwork/flue-aws` as the AgentCore-side seed package. The connector's design (SessionEnv-conformant, zero-monorepo-imports, real-shell semantics on AgentCore CI) is ready for productionization at /ce-plan tier — the spike-only constraints listed in the package README are the gaps to close (tenant scoping, OTel, error-path tests, multi-region support).

The brainstorm's `Next Steps` step 3 (green path) fires.
