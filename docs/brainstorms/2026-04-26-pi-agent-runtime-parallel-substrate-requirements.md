---
date: 2026-04-26
topic: pi-agent-runtime-parallel-substrate
---

# Pi Agent Runtime as Parallel Production Substrate

## Problem Frame

ThinkWork's agent runtime is Strands-only on AWS Bedrock AgentCore (`packages/agentcore-strands/agent-container`). Strands is opinionated and capable, but it owns a lot of the agent loop: it auto-injects the system prompt via the `AgentSkills` plugin, owns tool dispatch through its `@tool` decorator, and bakes in conventions that are hard to peer through.

The user has a long-term gut feeling — without a concrete current blocker — that **Pi** (`github.com/badlogic/pi-mono`, by Mario Zechner) is a better directional fit for ThinkWork's agent substrate. Pi's design philosophy is the inverse of Strands: full prompt ownership with no hidden injection, an event-stream `subscribe()` over every loop step, mid-turn `steer()` and `followUp()`, `--no-builtin-tools` to disable defaults, and pluggable extension-registered tools.

The decision is to build a **second** AgentCore runtime container, in Node.js, running Pi headlessly, and route some agents/templates to it as parallel production traffic. Strands stays default and is not retired. Both runtimes are maintained indefinitely. Operators choose per agent.

This is a strategic investment rather than a forced response to a current limitation, and the document records that explicitly so future readers understand the bet.

### Two scoping commitments that shape the rest of this doc

1. **Base = pi-mono + selectively vendored oh-my-pi pieces.** Pi-mono is Zechner's canonical upstream and the official extension target. It does not ship MCP support or sub-agent primitives — both are explicit non-goals in pi-coding-agent's docs. The community fork `github.com/can1357/oh-my-pi` ships first-class MCP (stdio + HTTP, OAuth, hot-loadable plugins) and a parallel sub-agent task system with SDK orchestration primitives (`Agent`, `agentLoop()`, `taskDepth`, `parentTaskPrefix`). Rather than adopt the whole fork (smaller community, single-author bus factor) or rebuild from scratch, we **vendor specific oh-my-pi extensions into our own repo as TypeScript**, pinned to upstream commit SHAs with provenance and license metadata. We own the dependency graph; we accept the merge cost from both upstreams forever.

2. **Full capability parity in v1.** The Pi runtime ships with MCP, `delegate_to_workspace` (sub-agents), Hindsight, script-based skills, sandbox, and browser automation all supported on day one. There is no operator-visible "this capability isn't available in Pi" gap to surface. The point is to feel Pi's customizability story on a real tool surface, not on a stripped-down toy.

These two commitments turn what would have been a 2–3 PR partial-parity spike into a sustained engineering investment. The rest of the document is scoped accordingly.

---

## Actors

- A1. Operator: chooses which agents/templates run on Pi vs Strands runtime via a per-agent runtime selector in admin.
- A2. ThinkWork agent (instance): executes inside exactly one runtime per invocation, transparently to the end user.
- A3. End user (mobile/admin chat): interacts with agents and should not feel which runtime serves them — at v1 there are no capability differences they can hit.
- A4. Platform engineer: builds and maintains both runtimes; owns the vendored oh-my-pi pieces, the Pi version pin, the upgrade cadence, and the per-tool ports.

---

## Key Flows

- F1. Operator routes an agent to the Pi runtime
  - **Trigger:** Operator changes the agent's runtime selector from `strands` (default) to `pi` in admin.
  - **Actors:** A1, A2
  - **Steps:** Operator opens agent config; flips runtime selector to `pi`; saves; next chat invocation for that agent dispatches to the Pi AgentCore runtime ID.
  - **Outcome:** Subsequent chat turns for that agent execute in the Pi runtime, with thread history, memory, MCP servers, sub-agent delegation paths, skills, and tools all available.
  - **Covered by:** R5, R6, R7

- F2. End-user chat hits the Pi runtime, exercising the full tool surface
  - **Trigger:** End user sends a message to an agent flagged `runtime: pi`.
  - **Actors:** A3, A2
  - **Steps:** `chat-agent-invoke` Lambda reads the agent's runtime selector → invokes the Pi AgentCore runtime → Pi container loads ThinkWork-composed system prompt + native tools + vendored MCP plugin (with the agent's MCP server config) + vendored sub-agent task primitives + skill subprocess bridge → agent loop runs, possibly invoking MCP tools, delegating to a sub-agent, calling a script skill, or writing/recalling memory → response goes out via existing AppSync notification path.
  - **Outcome:** End user sees a response indistinguishable from the Strands runtime experience for the same agent.
  - **Covered by:** R3, R4, R6, R9, R10, R11, R13, R14, R15, R16

- F3. Per-tool capability gap surfaces (rare, future-proofing)
  - **Trigger:** A future tool (post-v1) ships in Strands runtime only and an operator on Pi tries to use it.
  - **Actors:** A2, A1, A4
  - **Steps:** Pi runtime returns a structured "tool not available in Pi runtime" error → error surfaces in admin/mobile chat → operator sees the per-runtime support marker on the tool (R20) → either re-routes the agent to Strands or waits for the per-tool port.
  - **Outcome:** Capability gaps remain observable rather than silent, even though v1 ships at full parity. Future divergence has a defined surfacing pattern.
  - **Covered by:** R20

---

## Requirements

**Pi runtime container**
- R1. New AgentCore-hosted container packaged as a sibling to `packages/agentcore-strands/agent-container` (working name `packages/agentcore-pi/agent-container`), running Pi (badlogic/pi-mono) headless SDK on Node.js LTS, with Lambda Web Adapter exposing the same `/invocations` HTTP entry shape as the Strands container.
- R2. Pi runtime authenticates to Bedrock via the same IAM role pattern as the Strands container, using Pi's Bedrock provider in `pi-ai`. Prompt caching is enabled where the Bedrock adapter exposes it.
- R3. Pi runtime owns the entire system prompt — ThinkWork composes it server-side and passes it whole. There is no AgentSkills-style auto-injection equivalent inside Pi.
- R4. Pi runtime emits the same completion-callback POST to `/api/skills/complete` as the Strands runtime, with the same payload contract (skill_run_id, status, token usage, etc.) so downstream CAS + skill_runs lifecycle is unchanged.

**Routing and operator control**
- R5. Each agent (and each template) has a runtime selector with values `strands` (default) and `pi`. Stored in Postgres on the agent and template records, editable from admin.
- R6. `chat-agent-invoke` Lambda dispatches to the correct AgentCore runtime ID based on the selector. Auth, payload shape, and AppSync notification path are unchanged.
- R7. Operators can flip an agent between runtimes without losing thread history, memory, workspace state, or per-user MCP tokens. Existing thread continues seamlessly on the new runtime.
- R8. The agent config UI in admin shows the current runtime as a labelled selector. No capability matrix is required at v1 (no gaps to surface). Pattern is in place so a future per-tool gap (R20) can be annotated inline if needed.

**Vendoring and dependency hygiene**
- R9. pi-mono is pinned in the container's `package.json` to a specific version. Each vendored oh-my-pi extension lives under `packages/agentcore-pi/vendor/oh-my-pi/<extension-name>/` with a `PROVENANCE.md` recording: upstream repo URL, commit SHA, license, date imported, and any local modifications.
- R10. Vendored oh-my-pi MCP extension provides MCP-server tool registration that the Pi agent loop can discover at startup. Per-call MCP server configs (the same payload shape `chat-agent-invoke` already passes to the Strands runtime) are translated to the vendored extension's config format inside the Pi container.
- R11. Vendored oh-my-pi sub-agent task primitives provide the orchestration surface; ThinkWork's `delegate_to_workspace` is implemented as a custom tool that calls into those primitives (or, alternatively, calls back into `chat-agent-invoke` to spawn a Strands sub-agent — decided in planning per R-OQ4).

**Capability parity (ship-grade for first prod traffic)**
- R12. Pi runtime supports AgentCore Memory (L2) reads and writes from Node, equivalent to the semantics of `memory_tools.py` in the Strands runtime.
- R13. Pi runtime supports MCP servers via the vendored extension (R10). Per-user OAuth flows that mobile already manages are honored — Pi runtime receives the same per-call MCP token/header payload from `chat-agent-invoke` that Strands does today.
- R14. Pi runtime supports `delegate_to_workspace` end-to-end (R11). Spawned workspaces complete, return results, and the parent's loop continues.
- R15. Pi runtime supports Hindsight via a Node HTTP client against Hindsight's existing REST API (`recall`, `retain`, `reflect`). Token usage is captured and returned in the response payload, equivalent to the `hindsight_usage` array shape from Strands.
- R16. Pi runtime supports script-based skills (`packages/skill-catalog`) via a Python subprocess bridge: the Pi container ships with Python 3.12 and the existing `skill_runner.py` code; per skill call, Pi spawns a Python subprocess with a JSON request over stdin and reads a JSON response from stdout. Subprocess respects per-skill timeout and memory limits; failures surface as structured tool errors.
- R17. Pi runtime supports the sandbox tool (Bedrock AgentCore Code Interpreter) via a Node port using AWS SDK v3 — equivalent semantics to the Python boto3 wrapper in `sandbox_tool.py`.
- R18. Pi runtime supports browser automation via a Node port equivalent to the Python `browser_automation_tool.py`.

**Observability and quality**
- R19. Pi runtime emits OpenTelemetry traces and token-usage metrics into the same observability sinks as the Strands runtime. AgentCore Evaluations can score conversations from either runtime; eval runs are tagged with the source runtime so DX and quality comparison is possible.

**Maintenance contract**
- R20. New tools introduced for either runtime carry an explicit per-runtime support marker. Tools that need to run in both ship in both, or are flagged single-runtime in code so the agent config UI can annotate them inline. This is the surface F3 relies on for future divergence.
- R21. Pi version and each vendored oh-my-pi SHA are pinned in the container's manifest. Upgrade cadence is monthly or on a security advisory, not weekly. Each upgrade ships as a normal PR + CI + dev-deploy gate.

---

## Acceptance Examples

- AE1. **Covers R5, R6, R7.** Given an existing agent on Strands runtime with thread history, AgentCore memory entries, and per-user MCP tokens, when an operator flips its runtime to `pi` and the user sends the next message, the dispatch hits the Pi AgentCore runtime, the prior thread history is loaded as Pi session state, AgentCore Memory recalls return the same records, and the user sees a normal response.
- AE2. **Covers R3, R4.** Given a chat turn that completes on the Pi runtime, the completion callback POST to `/api/skills/complete` includes the same fields (skill_run_id, status, token_usage breakdown, latency, etc.) as the Strands runtime POST, so existing API consumers need no changes.
- AE3. **Covers R13, R14, R16.** Given a Pi-runtime agent whose first prod traffic message requires (a) calling an MCP-backed tool, (b) delegating to a workspace, and (c) invoking a script skill, all three succeed end-to-end — MCP via the vendored plugin, delegation via `delegate_to_workspace` wired onto vendored primitives, script skill via the Python subprocess bridge.
- AE4. **Covers R20, F3.** Given a future tool that ships only in Strands runtime, when an operator on Pi tries to use it, the agent config UI shows the per-runtime marker, and the runtime returns a structured "tool not available" error rather than failing silently.

---

## Success Criteria

- **At least one production agent serves real end-user traffic from the Pi runtime end-to-end (admin/mobile) for ≥2 weeks**, exercising MCP, sub-agent delegation, and at least one script skill in real conversations — not toy ones.
- **Operators can choose the runtime per agent in admin without engineering involvement** and can flip an agent back to Strands at any time without data loss.
- **A documented DX comparison lands in `docs/solutions/`**: prompt visibility, dispatch ergonomics, debugging, customization headroom, observability fidelity, vendoring overhead. This write-up steers future template choices and either validates or refutes the original gut feeling on a real surface.
- **Token usage, completion success rate, latency, and AgentCore Eval scores are comparable** between the Pi-routed agent and an equivalent Strands-routed reference (or are explained when they diverge).
- **The vendored oh-my-pi pieces have a documented upgrade procedure** that an engineer who wasn't involved in v1 can run, including what to compare against upstream and what local modifications to preserve.
- **Downstream `/ce-plan` has enough scope clarity to break this work into shippable units** without inventing product behavior, vendoring strategy, or runtime selector semantics.

---

## Scope Boundaries

- **Adopting the whole oh-my-pi fork as a dependency** — explicitly out of scope. We vendor specific extensions into our repo, not the whole fork, to avoid a second upstream's full surface area.
- **Replacing or retiring the Strands runtime** — explicitly out of scope. Both runtimes are maintained indefinitely.
- **Migrating existing agents off Strands** — explicitly out of scope. Operators opt agents in to Pi; nothing is moved without an explicit per-agent choice.
- **Multi-provider model routing** (using `pi-ai` to call non-Bedrock providers) — out of scope for v1; AWS-native preference still holds. Revisit only if a concrete agent shape needs a non-Bedrock model.
- **Operator-facing capability matrix UI** — out of scope at v1 because there are no v1 capability gaps to surface. The pattern (R20) is in place for future per-tool divergence; the UI is built when the first divergence actually exists.
- **Upstream contributions back to pi-mono or oh-my-pi** — out of scope for v1; revisit if a vendored extension needs a fix that would benefit upstream.

---

## Key Decisions

- **Parallel production runtime, not time-boxed spike, not replacement project.** Lets us ship real Pi production traffic and learn at scale. Accepts indefinite two-runtime maintenance cost.
- **Pi base = pi-mono + selectively vendored oh-my-pi pieces.** Owns the dependency graph; not subject to fork drift; pays the engineering cost of being our own integrator.
- **Full capability parity in v1.** No operator-visible gaps at ship. Validates Pi's customizability claim on a real surface, not a toy.
- **Script skills run via Python subprocess from the Pi (Node) container.** Single skill catalog, no port duplication, accepts per-call subprocess startup cost and a Python runtime inside the Pi container. Re-evaluate if cold-start latency becomes user-visible.
- **`delegate_to_workspace` strategy decided in planning** (R11, R-OQ4): either vendored oh-my-pi primitives natively, or a callback into `chat-agent-invoke` to spawn a Strands sub-agent. Real architectural choice.
- **Per-agent runtime selector lives on the agent record (and template record) in Postgres**, not template-only. Operators experiment per-agent without forking templates.
- **Strands stays the default** for existing and new agents. The doc records the bet without prejudging it.
- **Pi version and vendored SHAs are pinned with monthly upgrade cadence (R21).** Pi's weekly release rhythm with breaking changes is incompatible with production stability if we track HEAD.
- **First agent on Pi: deep researcher with sub-agent fan-out.** Brand-new agent (no existing-traffic risk), exercises MCP (search server), `delegate_to_workspace` (child explore agents), script skill (result formatting), and AgentCore Memory in real conversations. Validates the three most-doubted v1 parity points on one user-facing surface.

---

## Dependencies / Assumptions

- *[Unverified]* AWS Bedrock AgentCore can host a Node.js container with Lambda Web Adapter on the same `/invocations` contract as our Python container. AgentCore docs need explicit verification during planning.
- *[Unverified]* Pi's headless SDK mode is stable enough for sustained server traffic. The OpenClaw deployment is the only public production reference found; planning should cite or reproduce its server pattern.
- *[Verified by web research]* AgentCore Memory L2 has REST/SDK access from Node (`bedrock-agentcore` API surface is multi-language).
- *[Verified by web research]* oh-my-pi (`github.com/can1357/oh-my-pi`) ships first-class MCP and sub-agent SDK primitives. License needs verification at vendoring time.
- *[Partially verified]* `chat-agent-invoke` already supports per-call AgentCore runtime selection conceptually (for Strands' two memory engines / `enable_hindsight` path); refactoring to dispatch by runtime selector is incremental, not greenfield. Planning should confirm exact code paths.
- *[Assumption]* Pi remains MIT-licensed and actively maintained by upstream. If badlogic stops maintaining pi-mono, our vendored copy of needed pieces becomes the contingency.
- *[Assumption]* Python subprocess startup time per skill call (cold Python interpreter ≈ 50–200 ms) is acceptable for v1 user-perceived latency. If not, mitigations include a warm subprocess pool, a long-lived child Python worker, or a per-runtime skill protocol over a Unix socket — all deferred until measured.
- *[Assumption]* Hindsight's existing REST API is sufficient for a Node HTTP client to reach parity with the Python tool wrappers, including the async `arecall`/`areflect` pattern preserved in `feedback_hindsight_async_tools`.

---

## Outstanding Questions

### Deferred to Planning

- *[Affects R1][Technical, Needs research]* Confirm Lambda Web Adapter Node binary is supported in AgentCore today; if not, identify the alternative bridge.
- *[Affects R3][Technical]* Pi's session model (JSONL tree) vs ThinkWork's thread-history rows in Postgres — define the serialization at the Lambda boundary.
- *[Affects R6, R7][Technical]* Audit the existing per-call runtime-selection plumbing in `chat-agent-invoke`.
- *[Affects R10][Technical, Needs research]* Vendor oh-my-pi's MCP extension at a specific SHA: identify the file set, license headers, any internal dependencies on other oh-my-pi modules that would also need vendoring.
- *[Affects R11][Architectural]* `delegate_to_workspace` implementation choice: vendor oh-my-pi sub-agent primitives natively (Pi-native fan-out), or have Pi runtime call back into `chat-agent-invoke` to spawn a Strands sub-agent (cross-runtime fan-out). Has real implications for token accounting, observability, and failure handling.
- *[Affects R12][Needs research]* Confirm AgentCore Memory L2 Node SDK ergonomics give parity with `memory_tools.py` semantics.
- *[Affects R15][Technical]* Hindsight Node HTTP client design — how `arecall`/`areflect` async semantics translate, how to capture the same token-usage data the Python monkey-patch captures, where to put retry/backoff.
- *[Affects R16][Technical]* Python subprocess strategy for skill calls: cold spawn per call vs warm worker vs Unix-socket protocol. Cold spawn is simplest; measure latency before optimizing.
- *[Affects R17, R18][Technical]* Sandbox + browser automation Node ports — port from Python `boto3` and the current Python browser tool, or rebuild against well-maintained Node libraries.
- *[Affects R19][Technical]* OpenTelemetry distro shape for Node + AgentCore — match the Strands container's instrumentation surface.
- *[Affects R21][Process]* Define the upgrade gate (CI checks, dev soak window) for monthly Pi version + vendored SHA bumps.

---

## Next Steps

- `-> /ce-plan` for structured implementation planning of the v1 Pi runtime container, vendoring strategy, routing changes, per-tool ports, and the deep-researcher agent's tool wiring
