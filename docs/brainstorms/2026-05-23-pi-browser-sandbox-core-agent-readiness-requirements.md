---
date: 2026-05-23
topic: pi-browser-sandbox-core-agent-readiness
---

# Pi Browser And Sandbox Core-Agent Readiness

## Problem Frame

ThinkWork is moving the core agent toward the Pi runtime because Pi better matches the "folder is the agent" direction: filesystem-owned behavior, minimal harness assumptions, and agent-editable markdown configuration. The current blocker is capability parity. The core ThinkWork agent cannot move to Pi while two baseline built-ins are missing or incomplete:

- **AgentCore Browser / Browser Automation** for managed web UI work.
- **AgentCore Code Interpreter / Code Sandbox** for `execute_code`.

Strands already has working runtime paths for both. Pi has the right architectural hooks for tools and already has MCP support, but today it is not core-agent eligible because Browser is absent and Sandbox only validates the interpreter payload without exposing a callable tool.

This work is not a broad runtime re-decision. Strands remains supported. The goal is to make Pi safe to use for the core agent by closing the Browser and Sandbox parity gaps.

---

## Actors

- A1. Operator: chooses Pi versus Strands for an agent and needs confidence that core capabilities remain available.
- A2. Core ThinkWork agent: runs in Pi and must be able to browse, execute code, use MCP, use memory, and follow filesystem configuration.
- A3. End user: chats with the core agent and should not hit a runtime-specific missing-tool cliff.
- A4. Platform engineer: implements and verifies Pi parity without regressing the Strands runtime.

---

## Key Flows

- F1. Core agent invokes Code Sandbox on Pi
  - **Trigger:** A Pi-runtime agent receives a task that requires Python analysis, transformation, or quick computation.
  - **Actors:** A2, A3
  - **Steps:** `chat-agent-invoke` performs sandbox preflight; the Pi payload includes the ready interpreter id; Pi registers `execute_code`; the agent calls it; the tool starts a per-turn AgentCore Code Interpreter session, runs code, returns structured stdout/stderr/status, records invocation evidence, and cleans up the session.
  - **Outcome:** The user sees a normal answer backed by real code execution, and runtime metadata proves the tool actually ran.
  - **Covered by:** R1, R2, R3, R4, R5, R6

- F2. Core agent invokes Browser Automation on Pi
  - **Trigger:** A Pi-runtime agent receives a task that requires interacting with a rendered web page.
  - **Actors:** A2, A3
  - **Steps:** `chat-agent-invoke` resolves Browser enablement using the same effective policy used for Strands; the Pi payload carries the browser flag/config; Pi registers `browser_automation`; the tool starts an AgentCore Browser session, performs the task through the approved high-level automation path, returns a bounded result, and emits cost/event metadata.
  - **Outcome:** Browser-enabled agents work on Pi with the same product promise as Strands: perform a browser task, not expose raw browser internals.
  - **Covered by:** R7, R8, R9, R10, R11

- F3. Runtime parity gate for core-agent promotion
  - **Trigger:** The platform team considers routing the core ThinkWork agent to Pi by default or as the preferred option.
  - **Actors:** A1, A4
  - **Steps:** Run local tests, deployed dev smoke, and an end-to-end Spaces/admin chat turn for Pi with Browser and Sandbox enabled; compare tool evidence, cost events, cleanup behavior, and user-visible response against Strands expectations.
  - **Outcome:** Pi can be promoted for the core agent only when Browser and Sandbox are proven, not merely registered.
  - **Covered by:** R12, R13, R14, R15

---

## Requirements

**Code Sandbox parity**

- R1. Pi must expose a real `execute_code` Pi `AgentTool` whenever sandbox preflight returns ready and the invocation payload contains `sandbox_interpreter_id`.
- R2. Pi must preserve the existing sandbox policy gates: template sandbox opt-in, tenant sandbox availability, invoking-user identity, and interpreter-ready state remain resolved before runtime invocation by the existing preflight path.
- R3. Pi `execute_code` must use one AgentCore Code Interpreter session per agent turn, reuse that session across multiple `execute_code` calls in the same turn, and stop/cleanup the session at turn end.
- R4. Pi `execute_code` must return the same agent-readable structured outcome class as Strands: success/failure, stdout, stderr, truncation flags where applicable, exit status, duration, and recoverable provisioning/cap/timeout/OOM/error states.
- R5. Pi must preserve sandbox quota and audit semantics. A sandbox call that would be denied by the existing quota model must fail before spending AgentCore session work, and completed calls must produce invocation evidence suitable for the existing observability path.
- R6. Pi must consume AgentCore Code Interpreter stream output correctly, including the MCP-style `result.content[]` and `result.structuredContent` shape already learned from the Strands integration.

**Browser Automation parity**

- R7. Pi must expose a real `browser_automation` Pi `AgentTool` when Browser Automation is enabled by the same effective policy that enables it for Strands.
- R8. Pi Browser Automation must keep the v1 product shape from the existing Browser requirements: high-level "perform a browser task" automation, not raw browser-control primitives.
- R9. Pi Browser Automation must start and close managed AgentCore Browser sessions correctly, return bounded agent-readable results, and surface clear unavailable/provisioning errors when required runtime dependencies or credentials are missing.
- R10. Pi Browser Automation must preserve Browser cost and event semantics: distinguish AgentCore Browser substrate cost from Nova Act or other high-level automation cost, and include tenant/thread/agent attribution.
- R11. Pi Browser Automation must provide deterministic deployed verification that proves a browser session was spawned and used, not only that the tool appeared in a manifest.

**Core-agent readiness**

- R12. Pi must return `tools_called` and `tool_invocations` evidence for both Browser and Sandbox in the same response contract already consumed by `chat-agent-invoke` and the admin thread inspector.
- R13. Browser and Sandbox availability must be governed consistently by tenant disabled built-ins, template/space effective policy, capability-catalog enforcement, and per-agent runtime selection. Pi must not bypass existing policy narrowing just because its tool registration is implemented separately.
- R14. The core ThinkWork agent must not be considered Pi-ready until a deployed end-to-end turn from the Spaces/admin app successfully exercises both `execute_code` and `browser_automation` on Pi, with observable tool evidence.
- R15. Strands behavior must remain unchanged. The Pi work may share helpers or port semantics, but it must not weaken the working Strands Browser or Sandbox paths.

---

## Acceptance Examples

- AE1. **Covers R1, R3, R4, R6, R12.** Given a Pi-runtime agent with sandbox preflight ready, when the user asks it to run a small Python calculation, the agent calls `execute_code`, receives non-empty stdout from the AgentCore Code Interpreter stream, includes the result in its answer, and the persisted turn records `execute_code` in `tools_called` / `tool_invocations`.
- AE2. **Covers R2, R5.** Given a Pi-runtime agent whose tenant sandbox is disabled or quota is exceeded, when the agent attempts code execution, the tool returns a structured disabled/cap error without opening a Code Interpreter session.
- AE3. **Covers R7, R8, R9, R11, R12.** Given a Pi-runtime agent with Browser Automation enabled and runtime dependencies configured, when the user asks it to inspect a deterministic public page and extract a known visible value, the agent calls `browser_automation`, an AgentCore Browser session is created, the extracted value is returned, and the turn records browser tool evidence.
- AE4. **Covers R10.** Given a Pi Browser Automation call completes or fails after starting work, the resulting cost/event metadata distinguishes AgentCore Browser substrate cost from the high-level automation cost and includes tenant, agent, thread, duration, URL, task summary, and success/error state.
- AE5. **Covers R13, R15.** Given the same template/tool policy on Strands and Pi, when each runtime starts an agent turn, the effective Browser and Sandbox availability is the same unless a runtime-specific readiness error is explicitly surfaced.
- AE6. **Covers R14.** Given the core ThinkWork agent is set to Pi in dev, when an end-to-end Spaces/admin chat turn exercises Browser and Sandbox successfully, the platform can mark Pi as eligible for core-agent dogfooding; before this evidence exists, Pi remains opt-in only.

---

## Success Criteria

- The core ThinkWork agent can run on Pi in dev without losing Browser Automation or Code Sandbox.
- A deployed Pi end-to-end smoke proves both tools execute for real, with persisted tool evidence, not just model-written descriptions.
- Operators can select Pi for an agent without needing to memorize which of these core built-ins are missing.
- Planning can split this into implementation slices without reopening whether Browser and Sandbox are required for Pi core-agent readiness.

---

## Scope Boundaries

- Replacing Strands is out of scope. Strands remains supported and should keep its existing Browser and Sandbox behavior.
- Raw browser-control APIs are out of scope for this parity slice. Pi should match the existing Browser Automation product promise before introducing lower-level browser primitives.
- Cross-turn Code Interpreter filesystem persistence is out of scope. The required model is still one sandbox session per agent turn.
- New sandbox environments, new network policy models, new credential-injection models, and new quota products are out of scope unless planning finds an unavoidable parity blocker.
- A full built-in capability matrix UI is out of scope. This work should make these two tools available in Pi, not build a new governance product around them.
- Reworking MCP is out of scope except where Browser or Sandbox is intentionally exposed through MCP-compatible adapters in planning.

---

## Key Decisions

- **Browser and Sandbox are core-agent blockers for Pi.** Pi can remain an experimental runtime without them, but it cannot be the core agent runtime until both work end to end.
- **Parity means real tool execution evidence.** The acceptance bar is not "the model answered as if it had the tool"; it is persisted `tools_called` / `tool_invocations`, cleanup, and deployed smoke evidence.
- **Keep policy resolution outside the runtime.** The existing `chat-agent-invoke` preflight/effective-policy path remains the authority. Pi consumes the resulting payload and must not invent a separate policy layer.
- **Match existing product shapes first.** Code Sandbox remains `execute_code`; Browser remains high-level Browser Automation. Better abstractions can come later after parity is no longer blocking core-agent use.

---

## Dependencies / Assumptions

- *[Verified by code read]* `chat-agent-invoke` already sends `browser_automation_enabled` and sandbox preflight fields in the invocation payload.
- *[Verified by code read]* Pi already bridges MCP server configs into Pi `AgentTool[]` and records tool execution metadata from Pi events.
- *[Verified by code read]* Pi currently resolves `sandbox_interpreter_id` but comments state the current agent loop does not invoke the sandbox itself yet.
- *[Verified by code read]* Strands registers `execute_code` from `SANDBOX_INTERPRETER_ID` and registers `browser_automation` when Browser Automation is enabled.
- *[Verified by existing solution docs]* AgentCore Code Interpreter stream events use an MCP-style result envelope; Pi must preserve that parser lesson rather than rediscovering it.
- *[Assumption]* The current Node AWS SDK surface for Bedrock AgentCore Code Interpreter is sufficient for Pi parity. Planning should verify method names and event shapes against tests and deployed smoke.
- *[Assumption]* Browser Automation can be ported to a TypeScript/Pi tool without changing the v1 product promise. If the AgentCore Browser client is Python-only in practice, planning may choose a thin internal service/MCP bridge, but the runtime-visible behavior must remain the same.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1-R6][Technical] Decide whether Pi `execute_code` should wrap the existing `@thinkwork/pi-aws` AgentCore Code Interpreter connector directly or introduce a dedicated `execute_code` tool module that mirrors Strands result semantics more explicitly.
- [Affects R5][Technical] Decide the minimal quota/audit integration needed for v1 parity: direct REST calls from Pi like Strands, shared TypeScript helper, or a narrow adapter around existing API endpoints.
- [Affects R7-R11][Needs research] Verify the best TypeScript path for AgentCore Browser sessions: native AWS/AgentCore client, Playwright-over-CDP equivalent, Nova Act integration, or an internal MCP/service bridge.
- [Affects R10][Technical] Decide whether Browser cost records are emitted directly by Pi or normalized by `chat-agent-invoke` from Pi tool metadata.
- [Affects R14][Technical] Define the deployed end-to-end smoke prompts and deterministic browser target used to mark Pi core-agent eligible.

---

## Next Steps

-> /ce-plan for structured implementation planning of Pi Browser Automation and Code Sandbox parity.
