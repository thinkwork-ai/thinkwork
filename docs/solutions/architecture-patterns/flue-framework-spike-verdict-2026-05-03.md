---
title: FR-9 spike verdict — Flue framework hands-on validation
date: 2026-05-03
category: docs/solutions/architecture-patterns/
module: agentcore-pi
problem_type: spike_verdict
component: agent_runtime
severity: medium
applies_when:
  - Deciding whether to reframe the Pi parallel runtime around @flue/sdk
  - Validating Flue's extension-point coverage for ThinkWork integration
  - Confirming Python script-skill execution can plumb through Flue without source modification
related:
  - docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md
  - docs/brainstorms/2026-04-26-pi-agent-runtime-parallel-substrate-requirements.md
tags:
  - flue
  - pi-runtime
  - spike
  - verdict
  - fr-9
  - agentcore
---

# FR-9 spike verdict — Flue framework hands-on validation

**Verdict: PROCEED-WITH-REFRAME.** All extension points needed for ThinkWork integration work as documented. Zero Flue source modifications required to land the spike's critical-path tests. The reframe described in the 2026-05-03 brainstorm is feasible.

## What was tested

Cloned `withastro/flue` 0.3.10 to `~/Projects/flue`, ran `pnpm install`, built `@flue/sdk` and `@flue/cli`. Ran six example agents from `examples/hello-world/` against a real Anthropic key via `flue run --target node --env .env`:

- `hello` — basic prompt + valibot structured-result schema + `session.shell()`
- `with-skill` — markdown SKILL.md invocation via `session.skill()`
- `with-role` — per-call role overlay precedence
- `with-sandbox` — Daytona connector against a real Daytona PAT (six shell-semantics tests)
- `fs-test` — virtual sandbox file primitives + LLM-driven file ops
- `with-tools` — **the critical path:** custom `ToolDef` injection + per-cwd sub-agent task delegation

## Findings against FR-9 criteria

**Prompt visibility.** AGENTS.md (system prompt), roles, and skill bodies are plain markdown discovered from the workspace at runtime. No hidden injection. Matches the original Pi attraction (full prompt ownership) the 2026-04-26 brainstorm cited.

**Dispatch ergonomics.** `init({ ... })` accepts every resource we need to inject — `sandbox`, `tools`, `model`, `providers`, `role`, `cwd`, `id`. The trusted handler at `.flue/agents/<name>.ts` wraps each invocation. Matches Flue's documented "trusted code injects, harness runs the loop" pattern verbatim.

**Build pipeline.** Workspace → bundled `dist/server.mjs` in well under a second. Single `.mjs` deployable; matches `--target node`. Fast enough that the dev loop won't drag.

**Critical-path FR-7 (custom tools).** `with-tools` proved the exact shape we'd use for Python script-skills: register a `ToolDef` with `execute: async (args) => spawnSubprocessAndAwait(...)`, pass via `session.prompt({ tools: [...] })`. The LLM calls it; the return flows back. No Flue modification needed. **This was the highest-risk item in the brainstorm; it works cleanly.**

**Sub-agent task delegation.** `session.task()` (and the LLM-callable `task` tool) support per-call `cwd` + `role`, discover the target dir's AGENTS.md, share the sandbox, get fresh message history. Matches our `delegate_to_workspace` semantics exactly. Resolves an open architectural question from the 2026-04-26 brainstorm (oh-my-pi vendoring vs callback into chat-agent-invoke — neither, use Flue-native).

**Sandbox feel.** Default `virtual` sandbox uses just-bash with isolated in-memory FS — by design. Workspace files seed via `session.fs.writeFile` or factory closure (see `with-tools`'s `InMemoryFs`-shared-via-closure pattern). Our planned S3-mount custom `SandboxFactory` fits this shape.

**FR-6 (Daytona connector) validated end-to-end.** Ran `with-sandbox` against a real Daytona PAT: container provisioned (Ubuntu 6.8), six shell-semantics tests all passed — `uname`, file round-trip, compound commands, native pipes, redirects, `find | wc`. The `import { daytona } from '../connectors/daytona'` pattern wraps the Daytona SDK into Flue's `SandboxFactory` cleanly. **This is the exact shape we'll write for the AgentCore Code Interpreter connector** — same import pattern, different SDK wrapped underneath. Confirms FR-8's "clean AWS Flue package" structural goal is reachable.

**Real shell vs virtual shell.** Daytona's container gives us native pipes/redirects; just-bash does not (it emulates a subset). This matters for the AgentCore Code Interpreter capability map — when we write that connector, we need to know whether Code Interpreter exposes real-shell semantics or a just-bash-like subset. Drives the connector docs' "supported operations" matrix and informs operator messaging on when to escalate to Daytona.

## Gotchas

- **Bedrock model routing not exercised.** Flue's model strings are `anthropic/...`, `openai/...`, `openrouter/...`. Bedrock-routed inference needs a `bedrock/` provider prefix or a `providers.anthropic.baseUrl` override. Documented in Flue's README; not exercised in this spike. Worth an early planning-phase verification.
- **`session.skill()` recursion.** Flue's markdown-skill primitive uses the `task` system internally and hit the default max-depth-4 in `with-skill`. Not blocking — FR-7 plumbs Python skills through `tools`, not `session.skill()`. Markdown-only skills (none in our catalog today) would need depth tuning.
- **AgentCore Code Interpreter capability surface.** Not exercised in this spike — out of scope for an Anthropic-key-only run. Stays open per the brainstorm; first task in planning is to write the connector against the AWS service and discover its actual `BashLike` mapping.

## Recommendation

**Proceed to FR-9a integration spike, then `/ce-plan`** — the brainstorm review (`/ce-doc-review` 2026-05-03) found that this 1-hour Flue-feel spike does not exercise the highest-risk technical question (AgentCore Code Interpreter `BashLike` compatibility against the real AWS service, Bedrock model routing through Flue's `providers` config). Plan revision should not unlock on the FR-9 verdict alone. FR-9a is a 4-6 hour second spike that builds the AgentCore CI `SandboxFactory` end-to-end, captures the supported-operations matrix, and verifies Bedrock routing — see `docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md`. The FR-9 spike confirms only what it tested: zero Flue forks needed, custom `ToolDef` injection works, `session.task()` works, Daytona connector consumption works. Those are real wins; they are not sufficient gating for the multi-week reframe.
