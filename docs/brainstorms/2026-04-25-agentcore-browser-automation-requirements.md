---
date: 2026-04-25
topic: agentcore-browser-automation
---

# AgentCore Browser Automation — v1 Requirements

## Problem Frame

ThinkWork already has a partial AgentCore Browser integration in the Strands runtime: a `browse_website` tool starts an AgentCore Browser session and drives it with Nova Act. That path used to work, but it is not registered as a first-class built-in tool, so it does not appear in the admin Built-in Tools surface and may be dropped by capability-catalog enforcement.

v1 should turn the existing capability into a proper policy-visible built-in named **Browser Automation**. The goal is not to design a raw browser-control SDK; it is to let agents spawn a managed browser session, complete a web UI task, and have the tool's availability and cost attributed through the same thread → agent cost path as other runtime costs.

---

## Actors

- A1. Tenant admin: understands whether Browser Automation is available for the tenant and can see it in the Built-in Tools surface.
- A2. Template or agent author: opts an agent/template into Browser Automation when web UI interaction is part of the job.
- A3. Agent runtime: registers the browser tool only when policy, configuration, dependencies, and catalog state allow it.
- A4. Operator: verifies whether Browser still works end to end and whether cost attribution is correct.

---

## Key Flows

- F1. Browser capability discovery and opt-in

  - **Trigger:** A tenant admin or template author reviews built-in tools.
  - **Actors:** A1, A2
  - **Steps:** Browser Automation appears alongside Code Sandbox in the Built-in Tools surface; the UI describes it as AgentCore Browser plus Nova Act; template/agent configuration can enable or block it consistently with other built-in tools.
  - **Outcome:** The capability is visible, auditable, and selectable without relying on hidden runtime behavior.
  - **Covered by:** R1, R2, R3, R4

- F2. Agent spawns a browser session

  - **Trigger:** A Browser-enabled agent receives a task that requires interacting with a web page.
  - **Actors:** A2, A3
  - **Steps:** Runtime resolves effective capabilities; catalog enforcement permits the browser slug; the tool starts an AgentCore Browser session; Nova Act performs the requested UI task; the tool returns a structured result or a clear failure message.
  - **Outcome:** The agent can prove a browser session was spawned and use the returned web interaction result in its answer.
  - **Covered by:** R3, R5, R6, R8

- F3. Browser costs are attributed
  - **Trigger:** A browser automation call completes or fails after starting work.
  - **Actors:** A3, A4
  - **Steps:** Runtime records browser-related tool-cost events; the API persists them to `cost_events` with tenant, thread, agent, trace, provider, duration, and metadata; analytics can distinguish Browser/Nova Act cost from generic tool spend.
  - **Outcome:** Browser usage is visible on the same thread → agent cost path as other agent work.
  - **Covered by:** R7, R9, R10

---

## Requirements

**Registration and UI**

- R1. Browser Automation must be registered as a built-in tool in the capability catalog so capability-catalog enforcement does not silently drop it.
- R2. Browser Automation must appear in the admin Built-in Tools page as an AgentCore-backed capability, with copy that distinguishes it from Web Search and Code Sandbox.
- R3. Browser Automation enablement must respect the same effective-capability narrowing model as other built-ins: tenant policy, template or agent blocks, and runtime catalog enforcement all narrow the registered tool set.
- R4. Browser Automation must be named as a high-level automation tool, not as raw browser infrastructure. The v1 product promise is "perform a browser task," not "expose browser session primitives."

**Runtime Behavior**

- R5. A Browser-enabled agent must receive a callable browser tool only when required runtime dependencies and credentials are present. Missing Nova Act configuration should produce an observable disabled/provisioning state rather than a hidden tool omission.
- R6. The tool must start an AgentCore Browser session and use Nova Act to complete the requested task, preserving the current working shape rather than replacing it with raw browser control.
- R7. Browser tool results must remain bounded and agent-readable: success returns the useful extracted or completed-task result; failure returns a concise error that the agent can summarize or recover from.
- R8. End-to-end verification must exercise a deterministic browser task against a stable page and confirm that a browser session is spawned, not merely that the tool appears in a manifest.

**Cost and Observability**

- R9. Browser cost attribution must distinguish AgentCore Browser substrate cost from Nova Act automation cost. The current blended `nova_act` cost record is not sufficient for v1.
- R10. Browser tool-cost events must be persisted with thread and agent attribution through the existing cost-event path used by chat invocations and wakeup processing.
- R11. Browser cost metadata must include enough context for audit and debugging, such as URL, task summary, duration, response length or error summary, and provider/source labels.
- R12. The cost model must use current AWS pricing assumptions: Nova Act is priced by agent-hour, while AgentCore Browser is priced by active CPU and memory usage. If per-session Browser CPU/memory usage is not available synchronously, v1 may use a clearly labeled estimate while preserving enough metadata to reconcile later.

---

## Acceptance Examples

- AE1. **Covers R1, R3.** Given capability-catalog enforcement is enabled, when a Browser-enabled agent starts a turn, the runtime keeps the browser tool because its slug is present in the built-in capability catalog.
- AE2. **Covers R2, R4.** Given a tenant admin opens Capabilities → Built-in Tools, Browser Automation appears beside Code Sandbox and Web Search with AgentCore/Nova Act positioning, not as a generic web-search provider key.
- AE3. **Covers R5, R6, R8.** Given an agent/template has Browser Automation enabled and Nova Act configuration is present, when the agent is asked to open a deterministic public page and extract a known visible value, the runtime starts an AgentCore Browser session and the agent returns the extracted value.
- AE4. **Covers R9, R10, R11, R12.** Given a browser tool call completes, when the API records tool costs, `cost_events` contains thread- and agent-attributed browser-related rows that distinguish Nova Act elapsed-time cost from AgentCore Browser substrate cost or a labeled Browser estimate.
- AE5. **Covers R5, R7.** Given Browser Automation is enabled in policy but the Nova Act key is missing, when the agent starts a turn, the system exposes a clear unavailable/provisioning state and does not make the agent hallucinate a browser capability.

---

## Success Criteria

- An operator can determine whether the existing Browser path still works, with evidence from an end-to-end agent turn that spawned a browser session.
- Browser Automation is visible and governable through the same built-in tool model as Code Sandbox.
- A downstream planner does not need to decide whether v1 is raw browser control or Nova Act-driven automation; v1 is explicitly Nova Act-driven Browser Automation.
- Cost analytics can attribute Browser-related spend to the correct tenant, thread, and agent, and can distinguish Nova Act cost from AgentCore Browser substrate cost.

---

## Scope Boundaries

- Raw browser-control primitives are out of scope for v1. A future `browser_session` or `browser_control` built-in may expose lower-level automation if there is real need.
- Browser credential automation for logged-in websites is out of scope unless it already works through existing agent/tool context. v1 proves public or otherwise deterministic browser interaction.
- CAPTCHA avoidance, proxy configuration, session replay UI, and custom browser extensions are out of scope for v1.
- Browser-specific quota or budget circuit breakers are deferred unless planning finds current cost controls cannot safely cover the tool.
- A dedicated Browser observability UI is out of scope. v1 uses existing manifests, logs, and cost analytics.

---

## Key Decisions

- Ship **Browser Automation**, not raw Browser SDK access. This matches the current working implementation and the outcome an agent/template author expects.
- Keep the current AgentCore Browser + Nova Act substrate for v1. Replacing it with raw browser control would widen the project into a new automation framework.
- Split cost attribution. The current runtime code blends Nova Act and Browser estimates into one `nova_act` provider cost; v1 must make that accounting more honest.
- Treat Browser Automation as a Code Sandbox sibling in the Built-in Tools surface, but not as a Code Sandbox clone. Code Sandbox is policy-gated compute; Browser Automation is a managed web UI automation capability.

---

## Dependencies / Assumptions

- Existing runtime path verified in `packages/agentcore-strands/agent-container/container-sources/server.py`: `_browse_website` imports `browser_session` from `bedrock_agentcore.tools.browser_client` and drives it with `NovaAct`.
- Existing cost persistence path verified in `packages/api/src/handlers/chat-agent-invoke.ts` and `packages/api/src/handlers/wakeup-processor.ts`: `invokeResult.tool_costs` rows are inserted into `cost_events` with tenant, agent, thread, trace, provider, duration, and metadata.
- Existing capability-catalog seed verified in `packages/database-pg/drizzle/0027_capability_catalog_and_manifests.sql`: it seeds `execute_code`, `web_search`, memory tools, artifacts, and `Skill`, but not the current browser tool.
- Existing admin Built-in Tools page verified in `apps/admin/src/routes/_authed/_tenant/capabilities/builtin-tools.tsx`: the catalog includes Code Sandbox and Web Search, but not Browser Automation.
- Assumes Nova Act remains the right high-level automation driver for v1. Planning should verify SDK/API compatibility and current package availability in the AgentCore Strands image.
- Current public pricing check: AWS lists Nova Act workflows at `$4.75 per agent hour`; AgentCore Browser pricing is active CPU and memory based, not a flat `$0.001/min` charge.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1, R3][Technical] Choose the final built-in slug. Recommendation: `browser_automation` if matching the actual Strands tool slug can be done cleanly; otherwise preserve `browse_website` for compatibility and display it as Browser Automation.
- [Affects R5][Technical] Decide whether missing Nova Act configuration is represented as a stub tool that returns `BrowserProvisioning`/`BrowserUnavailable`, or as UI/runtime readiness state that prevents tool registration.
- [Affects R9, R12][Needs research] Determine whether AgentCore Browser exposes per-session CPU/memory usage quickly enough for exact per-call cost attribution. If not, define the temporary estimate and reconciliation path.
- [Affects R8][Technical] Pick the deterministic end-to-end browser test target and assertion.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
