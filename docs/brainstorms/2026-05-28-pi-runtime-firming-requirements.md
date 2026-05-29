---
date: 2026-05-28
topic: pi-runtime-firming
---

# Pi Runtime Firming

## Summary

Firm the Pi agent runtime into the product's single, host-agnostic core before it
acquires production users. Delete the legacy Strands runtime entirely and stop
conforming Pi to it. Standardize **both** the cloud runtime and the desktop
sidecar on `@earendil-works/pi-coding-agent` behind our own provider interfaces
(Model / Workspace / Memory / Delegation). Collapse memory to Hindsight-only.
Redesign the runtime↔platform contract into one typed, versioned, consistently
cased shape that reports real token usage and cost. Build the STS credential
broker so the desktop sidecar is shippable to real users, and prove core
portability with the eval path as a cheap third host.

## Problem Frame

Pi is becoming the component the whole product depends on — cloud chat turns,
the desktop local agent, evals, and future multi-agent Spaces all run through it.
But the foundation grew under two pressures that are now actively harmful, and
the right time to cut them is now, with no production users to migrate.

First, **two runtimes coexist.** The legacy Strands (Python) runtime is still
deployed, and Pi was built to mirror Strands' conventions line-for-line: the same
system-prompt file order, the same `user_<id>` memory namespace, the same
completion contract. Every capability gets built twice or drifts. This also
silently reversed the earlier "Strands as single foundation" decision without
anyone deciding it on purpose.

Second, **the "single Pi core" is aspirational, not real.** A partial extraction
exists (`packages/pi-runtime-core`) and the cloud runtime consumes it for the
loop wrapper, finalize client, history, and types. But the two hosts run **two
different agent frameworks**: the cloud runtime is pinned to the now-deprecated
`@mariozechner/pi-agent-core@0.70.2`, while the desktop sidecar runs
`@earendil-works/pi-coding-agent@0.76.0` and bypasses the shared loop with its
own ~1,345-line driver. They behave differently for "the same" agent. Three of
the four provider interfaces the plan promised (Model / Memory / Workspace) were
never built — the loop hardcodes Bedrock.

Third, **the contract carries legacy debt and is quietly incorrect.** The
runtime↔platform contract is snake_case with camelCase islands, has no version
field, emits two divergent shapes (`usage` at finalize vs nested `pi_usage`
synchronously), and the desktop model resolver **silently falls back to Claude
Sonnet** when handed a model ID it doesn't recognize — which is why the desktop
UI can label a turn "Kimi" while Bedrock Sonnet actually ran. Token usage reads
zero whenever the upstream framework swallows a Bedrock error.

Fourth, **the desktop sidecar is dogfood-grade where it counts.** Its IPC
boundary, redaction, and workspace isolation are genuinely production-shaped, but
it reaches Bedrock and S3 through the **laptop's ambient AWS credential chain** —
which works for one developer and cannot work for a real user who has no AWS
credentials at all. The credential broker its own plan requires was never built.

The cost of leaving these is compounding: every new capability is built against a
divergent, mis-shaped, partially-extracted foundation. The benefit of cutting now
is a clean single core that the cloud, desktop, and eval hosts all run on, behind
seams that make the local-model and multi-agent futures cheap.

## Key Decisions

- **Strands is deleted, not deprecated.** The legacy Python runtime and its
  selection machinery are removed outright. Pi becomes the sole runtime. There is
  no dual-runtime window and no compat shim — this is the explicit "make the hard
  cut while there are no production users" call.

- **Standardize both hosts on `@earendil-works/pi-coding-agent` via its SDK
  mode.** The cloud runtime migrates off the deprecated `@mariozechner/*` scope
  and consumes `pi-coding-agent`'s `createAgentSession()` SDK surface — the same
  embedding path the desktop sidecar already uses — with builtin coding tools
  disabled and our own tools injected. This ends the two-engine divergence. Per
  the framework author's own SDK guidance, `createAgentSession()` is the intended
  embedding surface for both server and desktop; calling the lower-level
  `pi-agent-core` `Agent` directly is the path we are leaving.

- **Wrap the framework behind our own interfaces; do not own the loop.** We keep
  the upstream loop (retries, compaction, tool orchestration) and treat the
  framework as swappable transport behind our Model / Workspace / Memory /
  Delegation provider interfaces. We accept the upstream as a tracked dependency,
  not a pin-and-forget one.

- **Hindsight is the only memory engine.** The managed AgentCore Memory path is
  deleted. The deciding factor beyond simplicity: AgentCore Memory is a
  cloud-only managed service and cannot serve the offline-capable desktop host,
  so a portable engine is required regardless. Memory still sits behind a
  `MemoryProvider` interface so the engine choice is swappable later.

- **One clean, typed, versioned contract.** The runtime↔platform contract is
  redesigned free of Strands-mirroring: consistent casing, a version field, a
  single unified emission shape, and accurate token/cost reporting. Model
  resolution fails loudly on an unsupported model ID rather than silently
  substituting a default.

- **The credential broker ships in this pass.** The desktop sidecar moves from
  ambient laptop AWS credentials to short-lived brokered credentials, making it
  shippable to users who have no AWS credentials of their own.

- **Prove portability with a third host.** The eval invocation path (synchronous,
  no finalize callback) is used as a cheap third host to prove the extracted core
  is genuinely host-agnostic — guarding against the host assumptions that
  produced Strands-shaped Pi in the first place.

## Actors

- A1. Cloud Pi runtime: the AgentCore/Lambda-hosted host that serves chat turns,
  wakeups, and skill runs.
- A2. Desktop Pi sidecar: the Electron-supervised local host that runs the agent
  loop on the user's machine.
- A3. Eval harness: the synchronous invocation path used for evaluations and as
  the portability proof host.
- A4. Platform API: resolves identity, permissions, workspace prefixes, sessions,
  and persists finalized turns.
- A5. Desktop user: a signed-in user whose desktop turns run locally and who has
  no AWS credentials of their own.
- A6. Platform engineer: implements and operates the runtime across all hosts.

## Key Flows

- F1. Cloud chat turn on the unified core
  - **Trigger:** A user sends a chat message; the platform dispatches a turn.
  - **Actors:** A1, A4
  - **Steps:** The platform builds a typed, versioned invocation payload; the
    cloud host constructs a `pi-coding-agent` session via the shared core with our
    injected tools and providers; the loop runs against Bedrock; the host posts a
    single unified finalize payload with real usage and cost.
  - **Outcome:** A cloud turn runs on the same core the desktop host runs, with a
    clean contract and accurate cost.
  - **Covered by:** R1, R2, R6, R7, R8, R9, R14

- F2. Desktop turn on the unified core with brokered credentials
  - **Trigger:** A signed-in desktop user sends a message; the sidecar is healthy.
  - **Actors:** A2, A4, A5
  - **Steps:** The desktop host acquires short-lived brokered credentials; it
    constructs the same core session through the same provider interfaces; the
    loop runs; the turn finalizes through the same unified contract as cloud.
  - **Outcome:** A real user with no AWS credentials runs a local turn; the
    runtime behavior matches cloud because it is the same core.
  - **Covered by:** R1, R2, R3, R10, R11, R14, R15

- F3. Portability proof via the eval host
  - **Trigger:** An evaluation invokes the runtime synchronously.
  - **Actors:** A3, A4
  - **Steps:** The eval path drives the extracted core through the same provider
    interfaces without the finalize-callback machinery, reading the synchronous
    response shape.
  - **Outcome:** The core is exercised by a third host, proving no host-specific
    assumptions leaked into it.
  - **Covered by:** R5, R6, R16

- F4. Model selection is honest
  - **Trigger:** A turn specifies a model ID the active provider set does not
    support.
  - **Actors:** A1, A2, A4
  - **Steps:** Model resolution rejects the unsupported ID with a clear error
    rather than substituting a default; the failure surfaces to the caller and
    the UI.
  - **Outcome:** The UI never claims a model ran that did not run.
  - **Covered by:** R9, R13

## Requirements

**Strands removal**

- R1. Pi is the sole agent runtime. The Strands runtime, its container, and its
  Python sources are removed.
- R2. The runtime-selection surface is removed end to end, not defaulted to Pi:
  the runtime resolver, the `agent.runtime` column and its GraphQL field, the
  admin runtime-picker control, the runtime-not-provisioned error path, and the
  per-runtime environment/SSM wiring.
- R3. Shared infrastructure currently owned by the Strands Terraform module is
  re-homed before deletion without destroying live resources: the code-interpreter
  sandbox base-image source file, and the shared ECR repository and async DLQ that
  the Pi runtime depends on. The ECR repository must not be destroyed and
  recreated (doing so drops the Pi image).
- R4. CI/CD and operational scripts are updated to a Pi-only world: build,
  release, deploy, post-deploy, image-update, and IAM-lint paths no longer
  reference Strands.
- R5. Pi stops conforming to Strands SDK conventions. Conventions that existed
  only to mirror Strands (system-prompt assembly details, memory namespace
  shape, completion contract mirroring, Strands-specific telemetry filters) are
  redesigned to best practice rather than preserved for parity.

**Single host-agnostic core**

- R6. A single host-agnostic runtime core is the agent engine for all hosts. The
  cloud runtime, the desktop sidecar, and the eval host all run the same core; no
  host reimplements the loop.
- R7. Both the cloud runtime and the desktop sidecar consume
  `@earendil-works/pi-coding-agent` through its `createAgentSession()` SDK mode
  with the framework's builtin coding tools disabled and the platform's own tools
  injected. The cloud runtime is migrated off the deprecated `@mariozechner/*`
  packages.
- R8. The core exposes provider interfaces for Model, Workspace, Memory, and
  Delegation. The core depends on these interfaces, not on concrete Bedrock, S3,
  Hindsight, or AWS clients. Each host supplies its own implementations.
- R9. Model resolution is honest: an unsupported or unrecognized model ID fails
  with a clear error surfaced to the caller. The runtime never silently
  substitutes a default model for a requested one.
- R10. Host-portable logic currently duplicated between the cloud handler and the
  desktop sidecar (history/prompt building, tool-call collection, assistant-text
  extraction, run-result assembly, finalize) lives in the core behind the
  provider seams, not in either host.

**Memory**

- R11. Hindsight is the only memory engine. The managed AgentCore Memory tools and
  the engine-selection branch are removed.
- R12. Memory is accessed through the `MemoryProvider` interface so the engine is
  swappable and so the desktop host can supply a host-appropriate implementation.
  Hindsight tool wrappers keep their established async/retry/lifecycle contract.

**Clean contract**

- R13. The runtime↔platform contract is a single typed shape with a version field.
  All invocation builders (chat, eval, desktop) target one shared typed contract
  rather than ad-hoc dictionaries.
- R14. Casing is consistent across the contract — no snake_case body with
  camelCase islands. The synchronous response shape and the finalize-callback
  shape are unified so consumers read usage and cost from one place.
- R15. Token usage and cost are reported accurately for a normal turn. When the
  underlying model call fails or returns no usage, the failure surfaces rather
  than being recorded as zero tokens.

**Desktop shippability**

- R16. The desktop sidecar acquires short-lived brokered credentials for its
  model and workspace access. It does not depend on the user's machine having AWS
  credentials, and it does not store long-lived secrets on the device.
- R17. The credential broker uses a browser-based identity flow exchanged for
  short-lived credentials, with the refresh secret held in the OS keychain and
  never exposed to the renderer. Per-turn capability tokens remain single-turn and
  expiring.

**Portability proof**

- R18. The eval invocation path exercises the extracted core as a third host
  without the finalize-callback machinery, and is kept working as an ongoing guard
  that no host-specific assumptions have leaked into the core.

## Acceptance Examples

- AE1. **Covers R1, R2, R4.** Given the Strands runtime is removed, when the
  platform dispatches any chat turn, wakeup, or skill run, then it routes to Pi
  with no runtime-selection branch in the path, and no deploy/CI step references
  Strands.

- AE2. **Covers R3.** Given the Strands Terraform module is deleted, when the
  stack is applied, then the Pi runtime still pulls its image from the same ECR
  repository (not a recreated one) and still has its async DLQ, because both were
  re-homed via state moves rather than destroyed.

- AE3. **Covers R6, R7, R10.** Given a chat turn and a desktop turn for the same
  agent, when each runs, then both construct the session through the same core and
  the same `pi-coding-agent` SDK path, and produce equivalent run-result and
  finalize shapes — no host runs a different loop.

- AE4. **Covers R8.** Given the core, when it runs a turn, then it invokes models,
  workspace, memory, and delegation only through the provider interfaces, and a
  host can substitute an implementation without changing core code.

- AE5. **Covers R9, R13.** Given a turn requests a model ID the active provider set
  does not support, when the runtime resolves the model, then it returns a clear
  error and the UI does not display any model as having run.

- AE6. **Covers R11, R12.** Given memory is Hindsight-only, when a turn uses
  memory, then it calls Hindsight through the `MemoryProvider` interface and there
  is no managed-AgentCore-Memory code path or engine-selection branch.

- AE7. **Covers R14, R15.** Given a normal completed turn, when it finalizes, then
  the recorded usage shows real input/output tokens and cost from one canonical
  field, and a turn whose model call failed records a surfaced failure rather than
  zero tokens.

- AE8. **Covers R16, R17.** Given a signed-in desktop user with no AWS credentials
  on their machine, when they send a message and the sidecar is healthy, then the
  turn completes using short-lived brokered credentials, and no long-lived secret
  is written to the device or exposed to the renderer.

## Success Criteria

- A chat turn, a desktop turn, and an eval run all execute on the same runtime
  core through the same provider interfaces.
- The repository contains no Strands runtime, no runtime-selection surface, and no
  Strands-mirroring conventions.
- A desktop user with no AWS credentials can complete a local turn.
- Token usage and cost are accurate for normal turns; failures surface instead of
  silently zeroing.
- The UI never reports a model that did not actually run.
- A downstream `ce-plan` can sequence the work — Strands removal with infra
  re-homing, core unification on `pi-coding-agent`, the four provider interfaces,
  the contract redesign, the credential broker, and the eval-host proof — without
  reopening the product shape.

## Scope Boundaries

### Deferred for later

- Local/offline model inference. The `ModelProvider` interface leaves room for it;
  Bedrock and the framework's cloud providers remain the path in this pass.
- The full local-repo coding surface (worktrees, terminal, PR on the user's
  machine) — a separate product brainstorm; this pass builds the runtime
  foundation it would land on.
- Owning a hand-written agent loop. We keep wrapping the upstream framework; a
  future move to own the loop is not foreclosed by these interfaces but is out of
  scope here.
- Landing canary.55 to main. Firming happens on the `pi-firming` branch off the
  canary; merging the larger canary is a separate decision.

### Outside this product's identity

- Running two agent runtimes or two agent frameworks as a standing architecture.
  The whole point of this pass is one core on one framework.
- A dual-runtime compatibility window or contract compat shim. There are no
  production users; the cut is clean.

## Dependencies / Assumptions

- The firming work is based on the `pi-firming` branch created off the
  `v0.1.0-canary.55` tag, which already contains `packages/pi-runtime-core`, the
  desktop sidecar, and the desktop session-prep API work.
- `@earendil-works/pi-coding-agent` is the actively maintained successor to the
  deprecated `@mariozechner/*` packages (same author, now at Earendil), and its
  `createAgentSession()` SDK mode is the intended embedding surface for both
  server and desktop. Upstream is on a rapid release cadence with an effective
  single-author bus factor; this pass treats it as a tracked dependency requiring
  deliberate version upgrades, not pin-and-forget.
- AWS Bedrock is a first-class provider in the framework but has had
  Anthropic-on-Bedrock streaming bugs; the specific model IDs the platform uses
  must be verified empirically during planning/implementation.
- The desktop credential broker can build on the existing Cognito identity and the
  existing per-turn capability-token mechanism already present in the
  desktop-session API path.
- The cloud host must satisfy AgentCore Runtime constraints (ARM64 image, the
  `/invocations` + `/ping` contract, the synchronous timeout cap); the unification
  must not break these.

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R7] Determine how the cloud host runs `pi-coding-agent`'s
  `createAgentSession()` inside the AgentCore/Lambda HTTP container (in-process SDK
  vs RPC mode) given the ARM64 and timeout constraints.
- [Affects R8] Define the exact method surface of each provider interface (Model /
  Workspace / Memory / Delegation), including streaming, cancellation, tool-result
  and usage reporting, and multi-turn handling.
- [Affects R3] Decide the re-home target for the sandbox base-image source file and
  whether the shared ECR repo and DLQ move into the Pi module or a new shared
  infra module, and the exact Terraform state-move sequence.
- [Affects R5, R14] Define the redesigned system-prompt assembly, memory namespace,
  and the single unified contract shape, including the version field semantics.
- [Affects R2] Define the database migration that removes/!backfills the
  `agent.runtime` column and the GraphQL enum cleanup, ordered against code
  removal so no live caller normalizes to a dropped runtime.
- [Affects R16, R17] Define the credential-broker design: the identity exchange,
  the short-lived credential scope and TTL, keychain storage, and the renderer
  trust boundary.
- [Affects R15] Define where usage is asserted in the loop so a swallowed model
  error surfaces, and how `hindsight_usage` is populated rather than hardcoded
  empty.
- [Affects R18] Decide which host combination the portability proof must exercise
  (eval covers invoke + synchronous response; finalize is proven by chat/desktop).
