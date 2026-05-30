---
date: 2026-05-30
topic: mobile-pi-architecture-review
status: draft
---

# Mobile Pi Architecture Review

## Problem Frame

ThinkWork mobile now has a working Pi-inspired agent path: a Hermes-native loop,
Bedrock proxy inference, S3 workspace context injection, tenant MCP tools,
local `bash` via `just-bash`, image attachments, persisted thread turns, and fast
optimistic navigation. That is a real milestone.

The architectural risk is that mobile is becoming a second agent runtime instead
of a mobile host of the same Pi-shaped platform. Pi's own docs and code point to
a small core: `createAgentSession`, explicit built-in tools, session lifecycle,
skills, and TypeScript extensions. ThinkWork's desktop and AgentCore Pi runtimes
have already moved toward that shape through `packages/pi-runtime-core` and
`packages/pi-extensions`; mobile currently mirrors the vocabulary but not enough
of the shared implementation or behavioral contract.

The goal is not to run the upstream Pi SDK directly on iOS today. The prior
embedded-Node spike remains a valid blocker. The goal is to make mobile as
Pi-compatible as practical: same mental model, same extension inventory where
portable, same workspace semantics, same observable tool evidence, and the same
"small core plus bash plus extensions" philosophy.

Research anchors:

- Pi docs: [https://pi.dev/docs/latest](https://pi.dev/docs/latest)
- Pi coding agent repo: [https://github.com/earendil-works/pi/tree/main/packages/coding-agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)
- Existing mobile harness plan: `docs/plans/2026-05-29-003-feat-mobile-harness-bedrock-cloud-plan.md`
- Parked embedded-Node spike: `docs/brainstorms/2026-05-29-mobile-on-device-pi-embedded-node-requirements.md`
- Shared Pi extension plan/status: `docs/plans/autopilot-status.md`

---

## Review Findings

**F1. Mobile is Pi-shaped, but not yet Pi-compatible.**

The mobile public surface in `apps/mobile/lib/agent/session.ts` deliberately
resembles Pi: `createAgentSession`, `prompt`, `subscribe`, `messages`, `tools`,
and extensions. This is the right product feel. The gap is that mobile owns its
own `ExtensionAPI`, tool shape, lifecycle event names, and system prompt path,
while the cloud and desktop hosts use `@earendil-works/pi-coding-agent`,
`packages/pi-runtime-core`, and `packages/pi-extensions`.

**Risk:** every new capability can now fork three ways: AgentCore Pi, desktop
Pi, and mobile Pi.

**F2. Bash exists, but it is not yet the center of gravity.**

Pi's default SDK posture is built-in tools, with `bash` as a first-class shell
tool and custom capability added through extensions. Mobile now exposes a local
`bash`, which is philosophically right. But it is an in-memory `just-bash`
sandbox with no mounted ThinkWork workspace, no durable per-thread filesystem
after app restart, and no sibling built-ins like `read`, `grep`, `find`, `ls`,
`edit`, or `write`.

**Risk:** the model can use `bash` for small command smokes, but it cannot yet
"live in" the mobile workspace the way Pi lives in a project directory.

**F3. Workspace context is prompt injection, not a workspace.**

`workspaceContextExtension` reads `USER.md`, `SPACE.md`, and `AGENTS.md` through
the workspace API and appends them to the prompt. That fixed "what is my name?"
and is useful. It still diverges from the shared system-prompt extension, which
composes date, requester context, runtime tool policy, `AGENTS.md`,
`CONTEXT.md`, `GUARDRAILS.md`, `SPACE.md`, `USER.md`, and workspace skills in a
defined order.

**Risk:** mobile answers identity/context questions, but does not yet share the
same full policy and skill context as desktop/cloud.

**F4. MCP works through direct mobile tool registration, but the surface will not
scale.**

`mcpToolsExtension` lists tenant tools and registers one model-visible tool per
MCP tool. This proved live CRM access, which is excellent. Desktop has moved
toward `pi-mcp-adapter` and an `mcp` proxy-tool style because direct exposure
can bloat tool lists, slow first token, and produce inconsistent names.

**Risk:** mobile MCP can work for a few tools, but it will get slower and more
confusing as tenants add servers.

**F5. Extension lifecycle is only partially wired.**

Mobile defines `agent_start`, `agent_end`, `tool_call`, and `after_tool_call`,
but the loop currently emits only the harness-level `AgentEvent` stream and only
uses extension dispatch for `before_agent_start`. Pi extensions can intercept,
block, render, and observe tool calls; mobile extensions can mostly register
tools and append prompt.

**Risk:** permission gates, activity UI, audit hooks, and policy enforcement
will be reimplemented outside the extension system unless lifecycle parity is
added.

**F6. Session semantics are thinner than Pi's.**

Pi sessions support durable session files, compaction, abort, steer/follow-up
queueing, model/thinking state, and session/runtime replacement. Mobile has a
single-turn loop over prior thread messages and persists final user/assistant
text, but it does not persist the agent's tool transcript as a resumable Pi
session, does not compact, and does not support steer/follow-up during a turn.

**Risk:** longer mobile work will feel less agentic than desktop even if tools
work, because the interaction model is still "send message, wait."

**F7. Tool evidence is present in tests but not yet a first-class mobile
surface.**

The mobile harness now has an `onEvent` hook, and smoke tests can observe
assistant text, tool calls, tool results, and completion. The user-facing
activity drawer/thread trace parity is still incomplete.

**Risk:** users cannot reliably tell whether mobile used `bash`, MCP, workspace
files, or just guessed.

**F8. Mobile-native capabilities should be extensions, not special cases.**

Camera/photo/file attachment support is a mobile strength. It should stay, but
it should be framed as host-provided extension capability with approval and UI
constraints, not as bespoke chat-screen plumbing that the agent loop does not
understand.

**Risk:** mobile-only tools become powerful but non-portable, and desktop/cloud
cannot reason about or test them through the same capability contract.

---

## Actors

- A1. Mobile user: starts and supervises agent work from iOS.
- A2. Mobile Pi host: Hermes-native Pi-compatible runtime in the Expo app.
- A3. Shared ThinkWork Pi capability layer: `packages/pi-extensions` and
  `packages/pi-runtime-core`.
- A4. Desktop Pi host: local Electron sidecar using the upstream Pi SDK.
- A5. AgentCore Pi host: managed AWS runtime using the upstream Pi SDK.
- A6. Platform API: Bedrock proxy, workspace files, MCP proxy, thread
  persistence, auth, and delegation.
- A7. Mobile-native environment: camera, photo library, files, clipboard,
  notifications, and OS permission prompts.

---

## Requirements

**Pi Compatibility**

- R1. Mobile must keep a small Pi-shaped public surface: session, prompt,
  subscribe, messages, tools, model provider, and extension factories.
- R2. Mobile must not attempt to run the upstream Pi SDK on iOS until the prior
  embedded-Node blockers change; compatibility is achieved through a portable
  host adapter and contract tests.
- R3. Mobile extension authoring must converge with `packages/pi-extensions`.
  Portable ThinkWork capabilities should be authored once and loaded by
  AgentCore Pi, Desktop Pi, and Mobile Pi through host providers.
- R4. Mobile must support the Pi lifecycle events that matter for runtime
  behavior: `before_agent_start`, `agent_start`, `tool_call`, `after_tool_call`,
  and `agent_end`.

**Bash and Workspace**

- R5. Mobile must treat `bash` as the primary execution tool when shell output,
  repository-style file work, command verification, package scripts, or internet
  checks are requested.
- R6. Mobile `bash` must run against a durable per-thread or per-workspace
  sandbox backed by a local rendered-workspace cache, not a process-only
  in-memory filesystem.
- R7. Mobile should expose Pi-like workspace built-ins over the same sandbox:
  `read`, `grep`, `find`, `ls`, and, when permission policy is ready, `edit`
  and `write`.
- R8. Workspace sync must be transparent and prewarmed outside the turn path
  whenever possible; the turn should observe a cached workspace quickly and
  refresh in the background.
- R9. Mobile prompt context must use the shared system-prompt composition order
  or a verified mobile equivalent: date/requester context, runtime tool policy,
  workspace files, and skills.

**MCP and Extensions**

- R10. Mobile MCP should move from "one visible tool per MCP tool" toward a
  bounded proxy surface compatible with the desktop `pi-mcp-adapter` direction:
  list/search/call through a single `mcp` tool, with direct tools only when
  explicitly allowed.
- R11. Per-turn MCP credentials must be resolved by the platform and passed
  ephemerally; no long-lived bearer tokens should be written to device disk or
  model-visible prompt.
- R12. MCP discovery failures should remain non-fatal, but the activity/trace
  surface must show that MCP discovery failed instead of letting the model
  quietly behave as if no connector exists.

**Session Semantics and User Experience**

- R13. Mobile turns must be observable from first tap: optimistic route, user
  message, working state, tool activity, final answer, and failures.
- R14. Mobile should add Pi-like `abort`, then `steer` and `followUp`, so users
  can redirect long-running work rather than waiting passively.
- R15. Mobile should persist enough tool transcript/session state to resume a
  long thread without reconstructing everything from flattened chat text.
- R16. Mobile should support compaction or thread summarization before long
  histories degrade model quality.

**Mobile-Native Capabilities**

- R17. Photo, file, clipboard, notification, location, and similar device
  powers should be modeled as mobile host extensions with explicit permission
  and UI affordances.
- R18. The model must never be allowed to use mobile-native capabilities
  silently when the OS/user would reasonably expect a prompt, approval, or
  visible action.

**Testing and Quality**

- R19. The mobile Pi contract must have local unit tests, simulator E2E smokes,
  deployed-stage harness smokes, and TestFlight/on-device smoke scripts.
- R20. The required smoke matrix must include: plain chat, "what is my name?",
  `bash`, workspace file read/search, MCP CRM, image attachment, file
  attachment, abort, and at least one failure path for missing MCP credentials.

---

## Acceptance Examples

- AE1. **Covers R5, R6, R7.** Given a user asks mobile to create a small file,
  list it, grep it, and print a computed value, the agent uses local `bash` and
  file tools in the mobile workspace sandbox and the activity surface shows each
  tool result.
- AE2. **Covers R8, R9.** Given the user opens New Thread after app launch,
  workspace cache validation starts before submit. When the user asks "what is
  my name?", the first model call has `USER.md` context without blocking on a
  full S3 sync of hundreds of files.
- AE3. **Covers R10, R11, R12.** Given the active agent has several MCP
  servers, the model sees a bounded `mcp` catalog/call tool by default. If a
  CRM token is expired, the activity surface records the auth failure and the
  assistant asks for reconnection instead of pretending no CRM exists.
- AE4. **Covers R13, R14.** Given a long mobile turn is running, the user sees
  "Working..." and live tool activity immediately, can abort, and later can
  steer or queue a follow-up without creating a confusing multiplayer turn.
- AE5. **Covers R17, R18.** Given a user asks "scan this receipt," mobile asks
  for camera/photo selection through native UI, passes the selected image as
  model input, and records that attachment/tool evidence in the thread.

---

## Recommended Plan

**U1. Mobile Pi Contract and Parity Tests**

Define a compatibility contract between upstream Pi, ThinkWork Desktop Pi,
AgentCore Pi, and Mobile Pi. Add golden tests for session shape, extension
loading, lifecycle events, tool-call transcript, and system-prompt composition.
This is a documentation plus test unit; it prevents future drift.

**U2. Shared Extension Adapter for Mobile**

Add a mobile adapter that can load `ThinkworkExtension` definitions from
`packages/pi-extensions` into the mobile `ExtensionAPI` where the capability is
portable. Start with system prompt, memory, skills, context engine, send email,
web search, and delegation providers as available. Keep mobile-only extensions
small and explicit.

**U3. Workspace Cache and Pi Built-ins**

Introduce a mobile workspace cache that mirrors the rendered workspace files
into a local app sandbox outside the foreground turn path. Mount that cache into
`bash`, then add `read`, `grep`, `find`, and `ls` tools over it. Defer
`edit`/`write` until workspace mutation policy and review UX are ready.

**U4. Bash Hardening**

Promote `local-bash` from smoke-capable to work-capable: durable filesystem,
thread/workspace partitioning, output truncation, command timeout telemetry,
public-network default, private-network denial, and visible activity rows. Keep
language honest: this is Pi-compatible mobile bash, not the native iOS shell.

**U5. MCP Adapter Direction**

Replace direct per-MCP-tool exposure as the default with a single bounded `mcp`
proxy tool that can list/search/call. Use the desktop `pi-mcp-adapter` direction
as the conceptual model, but keep bearer resolution in the platform proxy and
avoid writing secrets to disk. Allow direct tools only through explicit
workspace policy.

**U6. Session Runtime Semantics**

Add `abort`, then `steer`/`followUp`, then durable session transcript and
compaction. Align event names and behavior with Pi RPC/SDK enough that tests can
exercise the same scenarios across desktop and mobile.

**U7. Mobile-Native Capability Extensions**

Move image/photo/file attachment flows behind mobile-native extensions and
permission-aware tool surfaces. The UI can still present attachments directly,
but the agent runtime should observe them as structured inputs/tool evidence.

**U8. End-to-End Pi Parity Harness**

Make the smoke matrix repeatable in CI or pre-release automation where possible,
and manual in TestFlight where required. Capture thread ids, tool events, model
ids, latencies, and failure reasons.

---

## Success Criteria

- A simple mobile reply feels immediate: route and working state appear
  optimistically, and no workspace/MCP preflight runs invisibly inside the UI
  transition.
- A simple context question such as "what is my name?" is fast and grounded in
  `USER.md`.
- A shell task uses local mobile `bash` by default and exposes command evidence.
- A CRM/MCP task can call tenant tools, and failures are diagnosable from the
  thread activity surface.
- A downstream planner can implement the next slices without inventing mobile
  product behavior or deciding whether mobile should be Pi-compatible.

---

## Scope Boundaries

- Do not revive embedded Node on iOS until the known Node/native-addon blockers
  change.
- Do not make every upstream Pi feature a mobile requirement. TUI widgets,
  slash-command UI, keybindings, package installation, and arbitrary extension
  code execution are not mobile V1 requirements.
- Do not expose device files, contacts, location, clipboard, or camera silently.
  Native capabilities require explicit user-facing permission and visibility.
- Do not make MCP credentials model-visible or durable on device.
- Do not block first message UI on full workspace synchronization.

---

## Key Decisions

- **Mobile remains Hermes-native for now.** This accepts a compatibility layer
  instead of pretending the upstream Pi SDK can run on iOS today.
- **Bash is central.** The mobile agent should solve most executable tasks
  through `bash` plus workspace tools before reaching for specialized tools.
- **Shared extensions are the convergence path.** New ThinkWork capabilities
  should prefer `packages/pi-extensions` with host providers instead of mobile
  copies.
- **MCP should be bounded.** The default model-visible surface should be a small
  proxy/catalog tool, not unbounded per-server tool sprawl.
- **Workspace sync is infrastructure, not conversation.** It should prewarm,
  cache, and refresh transparently; turns should consume a ready local snapshot
  whenever possible.

---

## Dependencies / Assumptions

- The platform can continue vending mobile-authenticated Bedrock, workspace,
  MCP, and persistence endpoints without putting AWS credentials on device.
- `just-bash` remains acceptable as the iOS-compatible shell substrate for V1,
  with honest limitations.
- Desktop's current `pi-mcp-adapter` wrapper is the best reference direction for
  MCP shape, but mobile may need a platform-proxy implementation rather than
  running the adapter package in Hermes.
- Apple/TestFlight constraints mean some end-to-end mobile-native capability
  checks remain simulator or on-device smokes rather than normal GitHub CI.

---

## Outstanding Questions

### Resolve Before Planning

- None. The product direction is clear: move mobile from Pi-inspired toward
  Pi-compatible, without attempting upstream SDK-on-iOS.

### Deferred to Planning

- [Affects R6, R7][Technical] Pick the mobile workspace cache storage substrate
  and eviction policy.
- [Affects R10][Technical] Decide whether mobile can reuse any part of
  `pi-mcp-adapter` directly or should implement a platform-backed compatible
  proxy shape.
- [Affects R15, R16][Technical] Define the minimal durable mobile session format
  that preserves tool evidence without duplicating full upstream Pi JSONL
  semantics.
- [Affects R17, R18][Product/technical] Define which mobile-native capabilities
  are safe as true agent-callable tools versus user-attached inputs only.

---

## Next Steps

-> `/ce-plan` for a structured implementation plan, starting with U1 contract
tests and U2 shared-extension adapter before adding more mobile-only tools.
