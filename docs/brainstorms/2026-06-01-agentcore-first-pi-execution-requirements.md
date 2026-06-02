---
date: 2026-06-01
topic: agentcore-first-pi-execution
---

# AgentCore-First Pi Execution

## Problem Frame

ThinkWork explored whether NVIDIA NemoClaw / OpenShell should shape the Pi agent architecture so ThinkWork could point to an established security product instead of defending a homegrown local sandbox. That path exposed too much complexity: OpenShell MicroVM is not a clean macOS + Windows story, Docker/OCI containers shift the burden to local runtime management, mobile local sandboxing becomes a separate product, and routing decisions become fragile.

The course correction is to make **AWS AgentCore the execution boundary for all Pi agent work**. Desktop and mobile become clients and orchestration surfaces. AgentCore Runtime, AgentCore Browser, and AgentCore Code Interpreter provide the managed isolation story. Pi remains the agent runtime identity, but it runs in AgentCore for execution.

The product problem then changes from "how do we invent a secure local sandbox?" to **"how do we make AgentCore feel fast enough and present enough for desktop/mobile users?"**

---

## Actors

- A1. **Desktop user:** Uses the installed ThinkWork desktop app and expects an agent experience that feels responsive and trustworthy.
- A2. **Mobile user:** Captures intent, files, images, approvals, and follow-ups from the phone.
- A3. **AgentCore Pi runtime:** Runs ThinkWork Pi turns, tools, workspace operations, memory, browser, and code execution inside AWS-managed boundaries.
- A4. **Desktop/mobile clients:** Render threads, stream progress, manage auth/session state, and initiate/observe AgentCore work.
- A5. **Platform operator / enterprise reviewer:** Needs one simple security story and clear operational evidence.

---

## Key Flows

- F1. **Desktop turn runs in AgentCore**
  - **Trigger:** A desktop user sends a message.
  - **Actors:** A1, A3, A4
  - **Steps:** Desktop submits the turn to the API; the API dispatches to AgentCore Pi; AgentCore runs model/tool work inside managed AWS boundaries; thread events stream back; desktop renders progress, tool evidence, and final answer.
  - **Outcome:** The user sees a responsive desktop agent experience without local sandboxing.
  - **Covered by:** R1, R2, R3, R7, R8

- F2. **Mobile turn runs in AgentCore**
  - **Trigger:** A mobile user sends a message or task.
  - **Actors:** A2, A3, A4
  - **Steps:** Mobile submits work to the API; AgentCore Pi handles execution; mobile renders progress, approvals, and final results; no local mobile Pi execution occurs.
  - **Outcome:** Mobile has the same security boundary as desktop and does not grow a second sandbox story.
  - **Covered by:** R1, R2, R4, R8

- F3. **Fast-feeling AgentCore turn**
  - **Trigger:** A user sends an ordinary message that does not need expensive tools.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** Client and API prewarm likely runtime/session/workspace state; AgentCore uses durable sessions and cached workspace hydration where possible; progress streams immediately; tools initialize lazily; the user sees early activity before final completion.
  - **Outcome:** AgentCore remains the execution boundary while the experience feels alive enough for desktop/mobile use.
  - **Covered by:** R7, R8, R9, R10, R11, R12

---

## Requirements

**Security and execution posture**
- R1. AgentCore is the execution boundary for all Pi agent work across desktop and mobile.
- R2. Desktop and mobile must not expose or run local Pi execution. Local Pi sidecars, local Pi dispatch, local Pi console/status surfaces, and mobile local loops are removed or rerouted to AgentCore.
- R3. Desktop should not expose `just-bash` as a local security or execution story once AgentCore-first is adopted.
- R4. Mobile should not run local Pi execution. Mobile submits agent work to AgentCore.
- R5. NemoClaw / OpenShell remain research references only. They are not part of the v1 execution architecture.
- R6. Pi remains the agent runtime identity; AgentCore is the hosting and isolation substrate.

**Responsiveness**
- R7. The platform must measure AgentCore turn latency by phase: client submit, API dispatch, runtime cold start, session resume, workspace hydration, model first token, tool startup, tool execution, finalize, and client render.
- R8. Desktop and mobile must stream progress immediately enough that users can tell the agent is alive before final completion.
- R9. AgentCore Pi should use durable sessions and avoid full history/workspace replay when a resumable session exists.
- R10. Desktop app open, thread open, and new-thread composer focus should prewarm likely AgentCore/session/workspace state where cost and AWS limits permit.
- R11. Browser and Code Interpreter setup must remain lazy. Ordinary conversational turns should not pay tool startup cost unless the agent actually needs the tool.
- R12. Planning should evaluate faster model routing or two-stage responses only if latency instrumentation shows model time dominates.

**Product clarity**
- R13. User-facing execution labels should be simple: "Managed agent" or equivalent, not a menu of sandbox substrates.
- R14. Enterprise-facing language should say that agent execution runs in AWS-managed AgentCore isolation, with Browser and Code Interpreter isolated through AWS-managed tools.
- R15. Any future local execution re-entry must require a separate requirements document and explicit evidence that AgentCore cannot meet the product need after latency optimization.

---

## Acceptance Examples

- AE1. **Covers R1-R4.** Given a desktop or mobile user sends any Pi agent message, when the turn runs, then execution occurs through AgentCore Pi; no local Pi sidecar, mobile local loop, or local `just-bash` path handles the turn.
- AE2. **Covers R7.** Given an AgentCore turn is slow, when an operator inspects the trace, then the trace identifies which phase dominated rather than collapsing the delay into "AgentCore was slow."
- AE3. **Covers R8-R11.** Given a desktop user opens a thread and sends a simple conversational message, when AgentCore is warm or prewarmed, then the client shows early progress quickly and the turn does not initialize Browser or Code Interpreter.
- AE4. **Covers R13-R15.** Given an enterprise reviewer asks where agent work runs, when the team answers, then the answer is one sentence: ThinkWork agent execution runs in AWS-managed AgentCore isolation; local desktop/mobile are clients.

---

## Success Criteria

- ThinkWork has one execution security story for desktop and mobile: AgentCore.
- Local Pi and `just-bash` are removed from desktop/mobile execution surfaces, not retained as dogfood or transitional product paths.
- The next plan is about AgentCore latency and perceived responsiveness, not local sandbox design.
- Operators can identify latency bottlenecks by phase and prioritize optimizations with evidence.
- The desktop/mobile UX feels responsive enough that local execution is not needed to solve perceived slowness.

---

## Scope Boundaries

- No OpenShell, NemoClaw, MicroVM, Docker Desktop, Podman, or local-container execution in this direction.
- No local mobile Pi loop or local mobile sandbox.
- No local desktop Pi sidecar or local desktop `bash` execution path.
- No replacement of Pi as the runtime identity.
- No removal of AgentCore Browser or AgentCore Code Interpreter.
- No future local execution work without a separate brainstorm that cites latency/product evidence.

---

## Key Decisions

- **AgentCore for all agent execution.** The simplest security story wins: desktop and mobile are clients; AgentCore runs the agent work.
- **Latency is the real problem.** The local sandbox search was mostly a response to slow AgentCore turns. The right next move is measurement and optimization.
- **Delete the local execution ambiguity.** Local Pi and `just-bash` should not compete with AgentCore as execution paths in desktop or mobile.
- **NemoClaw/OpenShell stays research.** Useful vocabulary, not current architecture.

---

## Dependencies / Assumptions

- AgentCore Pi, AgentCore Browser, and AgentCore Code Interpreter remain available and are acceptable as the managed AWS security boundary.
- Current ThinkWork desktop/mobile clients can submit and render AgentCore-backed turns through existing thread surfaces.
- Existing local Pi / `just-bash` work can be retired or rerouted to AgentCore without breaking necessary product flows.
- Performance work depends on latency instrumentation before deciding which optimizations matter.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R7][Technical] What telemetry spans already exist for AgentCore Pi, and which latency phases need new instrumentation?
- [Affects R9][Technical] What is the current durable-session state for AgentCore Pi, and what replay/hydration work remains?
- [Affects R10][Technical] What prewarm actions are safe, cost-bounded, and AWS-limit-friendly from desktop app open / thread open?
- [Affects R2-R4][Technical] What desktop/mobile local Pi and `just-bash` surfaces exist today, and what must be removed or rerouted to AgentCore?
- [Affects R8-R12][Needs research] After instrumentation, which optimization gives the largest perceived-speed win?

---

## Next Steps

-> /ce-plan for removing desktop/mobile local Pi execution, rerouting all turns to AgentCore, and instrumenting/optimizing AgentCore responsiveness.
