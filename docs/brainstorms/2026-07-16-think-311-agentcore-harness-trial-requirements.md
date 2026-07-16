---
date: 2026-07-16
topic: think-311-agentcore-harness-trial
---

# THINK-311 AgentCore Harness Trial

## Problem Frame

ThinkWork needs a fast, decisive test of whether AWS AgentCore Harness can replace Pi as the execution engine without changing ThinkWork's product model. The trial is not an enterprise workflow demonstration or a production cutover. It must prove one complete existing path: take a ThinkWork Agent Folder, run that agent through Harness, and publish the resulting self-contained HTML plate through ThinkWork's existing artifact and signed-share experience.

The reference behavior is the TEI thread `a97275ae-4152-41a0-bf1b-9afe4f8abfed` and its published `QBR: 777 Automotive` HTML plate. Success means the equivalent run is performed by Harness rather than Pi while the Agent Folder and ThinkWork artifact system remain authoritative.

---

## Actors

- A1. ThinkWork operator: selects the existing agent and invokes the trial through the deployed ThinkWork product path.
- A2. ThinkWork control plane: resolves the Agent Folder, tenant/user context, tools, and artifact destination.
- A3. AWS AgentCore Harness: executes the compiled agent configuration and returns the run output.
- A4. Artifact pipeline: stores, renders, and publishes the final HTML plate using the existing ThinkWork share path.

---

## Key Flows

- F1. Run an existing Agent Folder on Harness
  - **Trigger:** A1 starts the representative QBR-style agent from ThinkWork.
  - **Actors:** A1, A2, A3
  - **Steps:** ThinkWork resolves the selected Agent Folder; projects the folder content needed by the run into Harness; invokes Harness with the same user, tenant, prompt, skills, and tools needed by the reference agent; streams or records enough state to determine success or failure.
  - **Outcome:** Harness completes the agent run without Pi executing the model/tool loop.
  - **Covered by:** R1, R2, R3, R4, R7

- F2. Publish the HTML plate
  - **Trigger:** The Harness run produces its final plate content.
  - **Actors:** A2, A3, A4
  - **Steps:** ThinkWork accepts the final HTML; validates it as an HTML plate; persists it through the existing artifact lifecycle; exposes it in the thread; creates a signed share URL.
  - **Outcome:** The user can open a self-contained, responsive HTML plate comparable to the reference QBR artifact.
  - **Covered by:** R5, R6, R7, R8

---

## Requirements

**Agent Folder execution**

- R1. The trial must run one existing representative ThinkWork Agent Folder; it must not introduce a second authoring format for the agent.
- R2. The folder's effective instructions, model choice, required skills, and required connector/tool access must be projected into Harness closely enough to complete the reference run.
- R3. ThinkWork must remain authoritative for the agent identity, tenant/user context, folder contents, and allowed tool surface; Harness configuration is generated execution input.
- R4. The accepted trial run must use Harness for the model/tool loop and must not silently fall back to Pi. Unsupported folder behavior must fail explicitly.

**Plate artifact output**

- R5. The run must produce a complete HTML document recognized as a ThinkWork plate, including the plate type metadata, title, embedded styling, content, and any charts or tables required by the representative artifact.
- R6. The HTML must be self-contained and usable in the existing artifact renderer and signed-share route without a Harness-specific viewing experience.
- R7. The artifact must be attached to the originating ThinkWork thread and remain available after the run has completed and the page has been reloaded.
- R8. The published result must be materially comparable to the reference `QBR: 777 Automotive` plate in completeness, readability, responsive layout, and print behavior. Pixel identity and identical prose are not required.

**Trial evidence and decision**

- R9. The trial must retain minimal proof that the accepted run used the selected Agent Folder and Harness version and produced the published artifact; full observability, cost accounting, and fleet analytics are deferred.
- R10. The trial outcome must result in a clear go/no-go decision: proceed to productionization planning if the end-to-end slice passes, or document the precise Harness limitation and keep Pi while evaluating the fallback.

---

## Acceptance Examples

- AE1. **Covers R1-R8.** Given the existing representative Agent Folder and the QBR-style prompt/data used by the reference TEI thread, when the operator invokes the agent through the Harness trial path, Harness completes the run and ThinkWork publishes a durable, shareable HTML plate comparable to `QBR: 777 Automotive` without Pi executing the loop.
- AE2. **Covers R4, R9, R10.** Given a required folder capability cannot be mapped to Harness, when the trial is invoked, the run fails explicitly with the unsupported capability identified; it does not fall back to Pi and report a false pass.
- AE3. **Covers R5-R8.** Given the trial reports success, when the thread and signed share URL are opened after completion, the same self-contained plate renders on desktop and mobile and remains printable.

---

## Success Criteria

- One existing ThinkWork Agent Folder executes end to end on AWS AgentCore Harness and produces the expected customer-facing HTML plate through the deployed ThinkWork path.
- The run proves that ThinkWork can preserve Folder-is-the-Agent and its artifact experience while substituting Harness for Pi at the execution seam.
- Planning can proceed without inventing a trial vertical, writeback workflow, observability program, or production migration strategy.

---

## Scope Boundaries

- No ERP, fleet, tank-monitor, approval, or external-system writeback scenario beyond what the selected existing agent actually requires.
- No general proof of every Agent Folder capability, nested-agent pattern, memory behavior, or connector type.
- No production cutover, tenant canary, Pi deletion, or fleet-scale certification.
- No observability redesign, cost dashboards, bill reconciliation, optimization, or comprehensive runtime parity program.
- No new artifact format or Harness-specific artifact viewer.
- Eve-on-AWS remains a fallback only if this focused Harness trial exposes a blocking limitation.

---

## Key Decisions

- Use the existing QBR HTML plate path as the trial oracle rather than inventing a new enterprise use case.
- Test one thin end-to-end slice before specifying production-grade cutover requirements.
- Keep the ThinkWork Agent Folder and artifact pipeline stable; replace only the execution loop under test.
- Require an explicit failure instead of Pi fallback so the trial cannot produce a false positive.

---

## Dependencies / Assumptions

- The representative Agent Folder and the data/tool access used by the referenced TEI thread remain available in a deployed non-production ThinkWork stage.
- The existing artifact finalization and signed-share pipeline can accept HTML generated by a Harness-backed run without format changes.
- AWS AgentCore Harness can be invoked with the prompt, model, skills, and tool surface required by the representative folder; verifying the exact projection is implementation-planning work.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1, R2][Technical] Identify the exact deployed Agent Folder and invocation inputs behind the reference TEI thread.
- [Affects R2-R4][Needs research] Determine the smallest projection from the current compiled manifest into Harness that supports that folder without broadening the trial.
- [Affects R5-R7][Technical] Identify the current runtime-to-artifact finalization seam to reuse unchanged.

---

## Next Steps

-> `/ce-plan` for structured implementation planning
