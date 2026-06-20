---
date: 2026-06-20
topic: first-class-workflow-control-plane
linear_issue: THNK-59
---

# First-Class Workflow Control Plane

## Problem Frame

Thinkwork has several workflow-like concepts that are converging but still appear as different product surfaces: Step Functions-backed Routines, Twenty CRM workflows, managed n8n workflows, scheduled jobs, app events, agent-triggered work, and workflow catalog/config tables. The current risk is that customers and agents will see three or more "workflow" systems with different authoring, monitoring, execution, and observability semantics.

The desired product move is to make `Workflow` the first-class Thinkwork concept while treating Step Functions, n8n, Twenty CRM, and future engines/apps as adapters, bindings, imported sources, or compiled artifacts underneath it. The first version should deliver one durable workflow identity and one observable run surface without forcing a full migration of every existing engine.

The smallest useful v1 is not a universal workflow engine. It is a control plane that can wrap existing Step Functions routines, represent n8n bridge/import paths, preserve CRM object-lifecycle semantics, and create a canonical run ledger that answers: what started, why, what version ran, what happened, what changed, what failed, and where is the deeper backend evidence?

---

## Actors

- A1. Tenant operator: configures, monitors, pauses, tests, and debugs workflows across native and managed-app engines.
- A2. Workflow author: creates or imports workflow definitions and needs to understand what trigger, app, and engine behavior will exist after activation.
- A3. Tenant agent: invokes workflows as tools, starts workflow-backed work, and may surface repeated agent behavior that should later become a workflow recipe.
- A4. Connected application: contributes typed triggers, actions, resources, credentials, and evidence links, such as Twenty CRM record events or n8n workflow executions.
- A5. Thinkwork planner/engineer: uses the requirements to plan a phased implementation without re-deciding the product model.

---

## Key Flows

- F1. First-class workflow inventory
  - **Trigger:** A tenant operator opens the workflow area to understand what automation exists.
  - **Actors:** A1, A4.
  - **Steps:** Thinkwork lists workflows from the canonical workflow catalog; each workflow shows owner, status, trigger families, engine/app bindings, current version, last run, and available operations; engine-specific limitations are visible as capability flags rather than hidden.
  - **Outcome:** The operator sees one workflow inventory instead of separate Routine, n8n, and CRM workflow islands.
  - **Covered by:** R1, R2, R5, R8, R13.

- F2. Workflow run observation
  - **Trigger:** A workflow runs from manual start, schedule, webhook, CRM lifecycle event, n8n bridge call, agent request, or Step Functions execution.
  - **Actors:** A1, A3, A4.
  - **Steps:** Thinkwork creates a canonical workflow run record, records the trigger and workflow version, attaches engine/app execution identifiers, streams or records run events, and renders a single run detail page with backend evidence links.
  - **Outcome:** The operator can answer what ran and why without opening AWS, n8n, or CRM first.
  - **Covered by:** R6, R7, R9, R10, R11, R12.

- F3. n8n bridge/import lifecycle
  - **Trigger:** A workflow author wants n8n to participate in Thinkwork workflows.
  - **Actors:** A2, A4.
  - **Steps:** The author can start with a stock n8n HTTP/Webhook/Wait bridge into Thinkwork; supported n8n workflows can be imported into workflow drafts; repeated bridge/import patterns can later promote into typed workflow recipes or custom n8n node affordances.
  - **Outcome:** n8n is useful immediately without becoming the sole workflow source of truth.
  - **Covered by:** R14, R15, R16, R17.

- F4. CRM lifecycle workflow binding
  - **Trigger:** A CRM object event, such as opportunity stage change, should start or participate in a Thinkwork workflow.
  - **Actors:** A1, A2, A4.
  - **Steps:** Thinkwork represents the CRM event as a connected-app workflow trigger binding, preserves CRM object context and timing caveats, records the trigger event on the workflow run, and links back to the originating CRM evidence.
  - **Outcome:** CRM-native semantics are preserved without creating a separate CRM workflow product.
  - **Covered by:** R3, R4, R6, R10, R18.

---

## Requirements

**Workflow identity and catalog**

- R1. Thinkwork must expose `Workflow` as the user-facing product concept for repeatable multi-step automation, regardless of whether the execution backend is Step Functions, n8n, a connected-app lifecycle hook, or future agent-native execution.
- R2. A workflow must carry owner, tenant, display metadata, lifecycle status, current version, trigger families, engine/app bindings, and capability flags sufficient for UI and agent use.
- R3. Existing Step Functions-backed Routines must be representable as workflows without losing their current authoring, versioning, execution, and run-detail value.
- R4. Twenty CRM workflow/object lifecycle semantics must be represented as connected-app workflow bindings, not flattened into generic steps that hide CRM object timing and lifecycle behavior.
- R5. Existing workflow-adjacent catalog/config concepts may inform the model, but v1 must present one workflow inventory to operators rather than separate top-level workflow nouns.

**Runs, events, and observations**

- R6. Every workflow execution must create or correlate to a canonical `WorkflowRun` record that captures workflow identity, version, trigger, actor/system, status, start/end timing, engine/app identifiers, and evidence links.
- R7. Workflow runs must support a canonical event stream or event ledger for trigger received, run started, step/action advanced, external callback received, app evidence attached, approval/decision recorded, run completed, and run failed.
- R8. Engine-specific histories, including Step Functions execution history, n8n execution IDs, CRM event IDs, logs, and OpenTelemetry trace IDs, must be attached as evidence/correlation, not treated as the sole product source of truth.
- R9. The first version must close or explicitly account for the current traceability gap where scheduled routine runs appear not to capture the same exact ASL version row as manual routine runs.
- R10. Run detail must make backend capability differences visible, including whether the run supports cancel, replay, retry, retry-from-step, full step history, long waits, human approval, streaming updates, or evidence links only.
- R11. Run observations must avoid exposing raw secrets or large payloads by default; large inputs/outputs and sensitive evidence should be summarized or linked by reference.

**Triggers and invocation**

- R12. Workflow triggers must be first-class contracts that can represent manual starts, schedules, webhooks, app events, CRM record lifecycle events, agent requests, API calls, and child-workflow invocations.
- R13. Each trigger contract must preserve why the workflow ran: trigger type, source app/system, actor or system identity, idempotency key or equivalent dedupe handle when available, and invoked workflow version.
- R14. Agents and connected apps must invoke workflows through a Thinkwork workflow contract rather than needing to know raw Step Functions ARNs, n8n webhook URLs, or CRM-specific execution details.

**n8n participation**

- R15. n8n must support a staged participation model in v1: bridge first, import/normalize when supported, and promote repeated patterns later.
- R16. The initial n8n bridge should work with stock n8n nodes before requiring a custom Thinkwork n8n node.
- R17. Imported n8n workflows must preserve source metadata, unsupported-feature diagnostics, credential requirements, and evidence links so operators can understand what was imported and what still needs review.

**Connected applications and engine bindings**

- R18. Connected applications must expose workflow-relevant capabilities as typed bindings: triggers, actions, resources, credentials, health/readiness, and evidence links.
- R19. Workflow engine/app bindings must advertise capability flags so product UI and agents do not imply false uniformity across Step Functions, n8n, Twenty CRM, and future engines.
- R20. Managed app lifecycle state, MCP/tool state, and workflow activation state must remain separate but reconciled; deploying or parking a managed app is not the same as enabling a workflow.

**Authoring, migration, and product shape**

- R21. The initial product surface should reuse and generalize the existing routine run-detail/editor investment where possible, while renaming or aliasing user-facing navigation away from "Routines" when the workflow concept is ready.
- R22. v1 must prioritize monitoring and run trust before broad visual authoring. The workflow concept can wrap and observe existing backends before it can author every possible backend graph.
- R23. Workflow recipes/templates should be the reusable packaging layer for later phases, with declared triggers, app bindings, inputs, permissions, expected events, credentials, and observability defaults.
- R24. Agent-composed live work may later promote into workflow recipes, but v1 must not require free-form agent composition as the default workflow runtime.

---

## Acceptance Examples

- AE1. **Covers R1, R3, R6, R9.** Given an existing Step Functions-backed routine is run manually and by schedule, when the operator opens the workflow run detail for either execution, Thinkwork shows the workflow identity, trigger, exact or explicitly resolved version, Step Functions execution evidence, and per-step events from one workflow surface.
- AE2. **Covers R12, R13, R18.** Given a Twenty CRM opportunity changes stage, when that event starts a workflow, the run records the CRM object, event type, source app, trigger timing, and evidence link instead of displaying it as an anonymous webhook.
- AE3. **Covers R15, R16, R17.** Given an operator has a simple n8n workflow, when they use stock n8n HTTP/Webhook/Wait nodes to call Thinkwork, the resulting Thinkwork run is visible in the workflow run ledger with n8n execution/source metadata attached.
- AE4. **Covers R8, R10, R19.** Given one workflow run is backed by Step Functions and another by an external n8n execution, when the operator views both runs, the UI shows available actions and evidence according to each backend's capabilities rather than presenting unsupported operations.
- AE5. **Covers R21, R22.** Given the existing routine execution UI can render a Step Functions-backed workflow, when the first workflow control-plane slice ships, operators can access that same monitoring value through a workflow route or alias without losing current routine functionality.

---

## Success Criteria

- A tenant operator can answer "what workflows exist, what starts them, and what ran recently?" from one Thinkwork surface.
- A tenant operator can inspect a workflow run from manual, scheduled, webhook, CRM, n8n, or agent origin without first knowing which backend executed it.
- Existing Step Functions-backed routine value is preserved rather than reset.
- n8n participation is clear enough that users do not see bridge, import, and native workflow paths as competing concepts.
- CRM lifecycle semantics are visible as app/object context, not erased into generic webhooks.
- A planner can produce phased implementation work from this document without inventing the product model, scope boundaries, or success criteria.

---

## Scope Boundaries

- v1 does not require migrating all existing routines, n8n workflows, or CRM automations into one new runtime.
- v1 does not make n8n the canonical runtime for all Thinkwork workflows.
- v1 does not require every workflow to compile to Step Functions ASL.
- v1 does not remove the existing Routine implementation before the workflow control plane proves itself.
- v1 does not promise a complete visual workflow builder for every engine.
- v1 does not need custom n8n node packaging before a stock-node bridge contract is proven.
- v1 does not attempt a universal event ontology beyond the concrete trigger families Thinkwork already needs.
- v1 does not require retry-from-step, replay, or cancel to work uniformly across every backend.

---

## Key Decisions

- `Workflow` is the product/control-plane concept; `Routine` is treated as an existing native execution profile or source to wrap.
- `WorkflowRun` and event/evidence records are the trust backbone; OpenTelemetry and engine histories are correlation/evidence, not the durable product ledger.
- Trigger identity is first-class because "why did this run?" must be answerable before "how did this engine execute?"
- n8n participates through a staged lifecycle: stock-node bridge, supported import/normalization, then promotion into recipes or custom node affordances.
- Twenty CRM semantics remain connected-app bindings because CRM object lifecycle behavior has domain-specific timing and evidence.
- Monitoring and observation come before broad cross-engine authoring.

---

## Dependencies / Assumptions

- Existing routines, ASL versions, routine executions, and routine step events provide enough substrate to wrap native Step Functions routines without starting over.
- Existing web routine graph/run-detail UI can be generalized into a workflow run surface.
- Managed n8n and Twenty CRM work continue as connected/managed application capabilities.
- The connected application registry direction remains the right place to model app capabilities, readiness, and evidence links.
- The first implementation plan can answer technical storage/API questions; this requirements doc intentionally fixes product shape rather than schema.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1-R6][Technical] Decide whether to rename/extend `routines` directly or introduce a new workflow table/model that wraps routines as a native engine binding.
- [Affects R6-R11][Technical] Decide the durable event/ledger storage shape, payload offload strategy, retention, redaction, and replay semantics.
- [Affects R9][Technical] Verify and close the scheduled routine version-capture gap.
- [Affects R12-R14][Technical] Define the minimal trigger contract and idempotency model for schedule, webhook, CRM event, agent request, and manual start.
- [Affects R15-R17][Technical] Define the first n8n bridge contract and how imported workflow diagnostics are represented.
- [Affects R18-R20][Technical] Define connected-app capability flags and lifecycle reconciliation for workflow bindings.
- [Affects R21-R22][Product/technical] Decide the first UI route: rename `/settings/routines`, add `/settings/workflows`, or introduce an alias while preserving existing deep links.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
