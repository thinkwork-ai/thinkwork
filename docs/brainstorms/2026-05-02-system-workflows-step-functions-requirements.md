---
date: 2026-05-02
topic: system-workflows-step-functions
---

# System Workflows: Step Functions as the ThinkWork Operating Spine

## Problem Frame

ThinkWork is beginning to use AWS Step Functions for user-authored Routines, but the same substrate can serve a broader and more strategic role: making ThinkWork's own automated operations visible, governed, and auditable. Today, many system processes are real workflows in practice — wiki compilation, evaluation runs, activation, bootstrap/import jobs, budget/audit processes — but they are split across Lambdas, job tables, CLI commands, docs, and CloudWatch logs. Operators can often trigger or inspect pieces, but they do not get one coherent workflow definition, run graph, evidence trail, or safe customization surface.

System Workflows turn ThinkWork's operating machinery into first-class, versioned workflows. The primary promise is not arbitrary customer workflow building; that remains Routines. The primary promise is **inspectable system internals plus governed compliance automation**: every important automated process has a definition, owner, runtime mode, run history, evidence output, and policy boundary. Customer customization and agent-authored improvement are secondary layers exposed through safe configuration, blessed extension points, and reviewed suggestions.

The strategic bet is a hybrid Step Functions architecture: **Standard parent workflows** provide the governed control plane, long-running coordination, approvals, versioning, and evidence boundary; **Express child workflows** handle short, high-volume, idempotent work where cost and throughput matter more than long-lived execution history.

---

## Actors

- A1. Tenant operator: inspects System Workflow definitions, watches runs, tunes allowed configuration, reviews evidence, and handles approvals.
- A2. Compliance/security operator: uses workflow evidence to answer audit, SOC2, incident, and policy questions.
- A3. ThinkWork engineer: owns the default System Workflow definitions, upgrade path, extension contracts, and supportability boundaries.
- A4. Tenant agent: may trigger workflows indirectly and later propose workflow improvements based on repeated operational patterns.
- A5. End user: benefits from more reliable memory, evaluations, activation, and governance without needing to understand the workflow substrate.

---

## Key Flows

- F1. Operator inspects a System Workflow
  - **Trigger:** Operator opens Automations -> System Workflows.
  - **Actors:** A1, A2.
  - **Steps:** Operator sees a data table of workflows -> filters by category/status/runtime -> opens a workflow detail -> reviews definition graph, configuration, extensions, recent runs, and evidence outputs.
  - **Outcome:** Operator can answer what the system runs, when it last ran, what version ran, and what evidence it produced.
  - **Covered by:** R1, R2, R3, R7, R8, R17.

- F2. System Workflow runs with governed evidence
  - **Trigger:** A schedule, event, admin action, CLI command, or internal system event starts a System Workflow.
  - **Actors:** A1, A2, A3.
  - **Steps:** Standard parent workflow starts -> records run identity and version -> runs policy checks -> invokes Standard or Express child stages -> persists canonical events/evidence to ThinkWork storage -> updates run status and evidence summary.
  - **Outcome:** Run is inspectable during execution and reconstructable later without relying solely on short-lived Step Functions history.
  - **Covered by:** R4, R5, R6, R9, R10, R11, R12.

- F3. Operator customizes a System Workflow safely
  - **Trigger:** Operator changes workflow settings or configures an extension point.
  - **Actors:** A1, A2.
  - **Steps:** Operator edits supported knobs or hook slots -> platform validates the change -> diff/effect is shown before activation -> new version/config becomes active -> future runs record that version/config.
  - **Outcome:** Customer policy participates in ThinkWork operations without forking unsupported workflow internals.
  - **Covered by:** R13, R14, R15, R16.

- F4. Agent proposes an operational improvement
  - **Trigger:** Agent or system detects repeated failures, manual remediations, or recurring post-run changes.
  - **Actors:** A1, A3, A4.
  - **Steps:** Agent drafts a proposal -> proposal is shown as a workflow diff or suggested config/extension change -> human reviews and approves/rejects -> accepted change follows the same validation/version path as manual customization.
  - **Outcome:** Agent-authored operations become reviewed suggestions, not automatic mutation of core system behavior.
  - **Covered by:** R18, R19, R20.

---

## Requirements

**Product surface**

- R1. System Workflows appear under Automations as a sibling to Routines, Schedules, and Webhooks.
- R2. The System Workflows index uses a data table, not cards, because the surface is expected to grow and operators need sorting/filtering/scanning.
- R3. The table includes enough columns for operational triage: workflow name, category, runtime shape, status, last run, next run when applicable, active version, evidence status, customization status, and owner.
- R4. System Workflow detail pages show the workflow definition, current configuration, blessed extension points, run history, evidence outputs, and related schedules/triggers.
- R5. System Workflow detail pages make the managed nature explicit: ThinkWork owns the core workflow, customers configure and extend approved surfaces.

**Runtime architecture**

- R6. System Workflows use AWS Step Functions as the orchestration runtime when the process benefits from multi-step coordination, retries, branching, fan-out/fan-in, approvals, run visibility, or compliance evidence.
- R7. The default runtime pattern is a Standard parent workflow for governance, approvals, long-running state, version identity, and evidence boundaries.
- R8. Express child workflows are used for short, high-volume, idempotent stages such as transformation shards, scoring batches, enrichment probes, and validation batches.
- R9. Standard is required for HITL, callbacks, long waits, non-idempotent side effects, durable coordination, and parent-level compliance evidence.
- R10. Express stages must be idempotent or explicitly deduped, must complete within the Express time window, and must summarize durable output back to the parent.
- R11. Step Functions execution history is not the only compliance record. ThinkWork persists canonical run events, evidence summaries, and audit records in its own durable storage.
- R12. Large payloads and artifacts are stored outside Step Functions state, with workflows passing pointers and summaries rather than large inline blobs.

**Initial workflow set**

- R13. The first System Workflow set includes Wiki Build Process, Evaluation Runs, and Tenant/Agent Activation.
- R14. Wiki Build Process demonstrates long-running orchestration, checkpoints, destructive rebuild approval, quality gates, enrichment/linking stages, and Standard-parent-plus-Express-child composition.
- R15. Evaluation Runs demonstrate fan-out/fan-in, test/scorer parallelism, pass/fail gates, evidence bundles, and cost-aware Express children.
- R16. Tenant/Agent Activation demonstrates operator-facing setup progress, policy checks, connector readiness, launch approvals, attestations, and mostly-Standard orchestration.

**Customization model**

- R17. System Workflows support a tiered customization model: config knobs first, blessed extension points as the flagship model, agent-proposed patches as reviewed suggestions, and full workflow forks deferred.
- R18. Config knobs include schedules, model choices, thresholds, notification targets, approval requirements, retention/evidence settings, retry posture, and workflow-specific safe parameters.
- R19. Blessed extension points expose named hook slots such as pre-checks, post-checks, approval gates, notification hooks, validation checks, and customer policy attestations.
- R20. Agent-proposed patches are never applied automatically in v1; they are reviewed as diffs or suggested configuration/extension changes.
- R21. Full workflow clone/fork editing is not part of the initial customer-facing model; it may be explored later for ThinkWork internal operations or advanced enterprise break-glass scenarios.

**Governance and compliance**

- R22. Every System Workflow run records workflow id, active version, runtime shape, trigger source, actor/system initiator, tenant, status, started/finished timestamps, and evidence summary.
- R23. Evidence outputs are first-class: operators can see what artifact or audit trail a run produced, not only whether it succeeded.
- R24. Compliance-sensitive workflows make fixed vs configurable behavior clear so audit reviewers can distinguish ThinkWork-owned controls from tenant policy choices.
- R25. Workflow changes, config changes, extension changes, approvals, and agent-proposed patch decisions are audit events.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given an operator opens Automations -> System Workflows, when the tenant has 30 workflows, the operator sees a sortable/filterable table rather than a card grid and can quickly find failing or recently changed workflows.
- AE2. **Covers R7, R8, R10, R15.** Given an Evaluation Run includes 500 test cases, when the workflow runs, the Standard parent owns run identity and final gate outcome while Express child executions process idempotent test/scorer batches and return summarized results.
- AE3. **Covers R11, R22, R23.** Given a Wiki Build execution completed 120 days ago, when a compliance operator investigates it, ThinkWork can show canonical evidence from its own durable records even if Step Functions execution history is no longer available.
- AE4. **Covers R14, R19, R24.** Given a tenant requires legal review before destructive wiki rebuilds, when the operator configures the Wiki Build workflow, they can enable a named approval gate without editing the core workflow definition.
- AE5. **Covers R16, R18, R25.** Given Tenant/Agent Activation requires security attestation before launch, when an operator adds that requirement, activation runs include the attestation step and the decision is recorded as audit evidence.
- AE6. **Covers R20, R21.** Given an agent notices repeated evaluation-run failures and proposes adding a pre-run connector check, when the proposal is reviewed, the operator sees a diff/suggestion and can approve it into an extension point or reject it; the agent cannot silently mutate the workflow.

---

## Success Criteria

- Operators can answer "what automated system processes are running in ThinkWork?" from Automations without opening AWS Console or CloudWatch first.
- Compliance/security operators can reconstruct important workflow runs from ThinkWork evidence records, not only Step Functions transient history.
- The first three System Workflows demonstrate the strategic runtime mix: long-running Standard orchestration, high-volume Express fan-out, approvals, quality gates, and evidence bundles.
- Customer customization feels powerful but bounded: operators can adapt workflow behavior where their policy needs to participate, while ThinkWork retains supportable ownership of core definitions.
- `ce-plan` can turn this strategy into implementation phases without re-deciding product placement, runtime philosophy, customization model, or initial workflow set.

---

## Scope Boundaries

### Deferred for later

- Full customer-facing workflow clone/fork editing.
- Marketplace or cross-tenant sharing of System Workflow variants.
- Agent-authored workflow patches that auto-apply without human approval.
- A general visual workflow builder for System Workflows.
- SOC2/Audit Pipeline as a first implementation workflow; it remains strategically important but follows after the first three representative workflows.
- A unified cost optimizer that automatically rewrites Standard stages into Express stages.

### Outside this product's identity

- Replacing Routines. Routines remain the tenant/user/agent-authored workflow primitive; System Workflows are ThinkWork-owned operating workflows.
- Replacing the audit log with Step Functions history. Step Functions is orchestration and operational visibility; ThinkWork keeps durable compliance records.
- Making every background Lambda a Step Function by default. Step Functions should be used when orchestration earns its keep, not as ceremony around trivial handlers.
- Letting tenants fully own ThinkWork's core operating procedures in v1. The product promise is governed customization, not unsupported forks.

---

## Key Decisions

- **System Workflows live under Automations:** Keeps the operator mental model simple: this is where things run without a human chat message.
- **Index uses a data table, not cards:** The workflow inventory will grow; tables are better for scanning, filtering, sorting, and operational triage.
- **Primary promise is inspectability plus compliance:** Customer customization and agent-authored operations are important but secondary to making ThinkWork's system behavior visible and governable.
- **Hybrid Standard/Express model:** Standard parent workflows carry the governance/evidence boundary; Express children handle cheap, high-volume, idempotent work.
- **First workflow set is Wiki Build, Evaluation Runs, Tenant/Agent Activation:** Together they demonstrate long-running pipelines, fan-out quality gates, activation approvals, policy checks, evidence, and a representative spread of Step Functions capabilities.
- **Customization is tiered:** Config knobs and blessed extension points ship first; agent suggestions follow as reviewed proposals; full forks are deferred.

---

## Dependencies / Assumptions

- Step Functions remains available in the AWS regions ThinkWork targets.
- Existing Routines Step Functions work provides reusable lessons for ASL validation, recipe catalogs, execution callbacks, run graph rendering, and Standard/Express policy.
- Existing wiki, evaluation, activation, audit, and workspace-event surfaces provide the initial raw material for System Workflow definitions rather than requiring net-new product concepts.
- ThinkWork has or will maintain durable run/evidence storage outside Step Functions because Standard execution history has retention limits and Express history depends on logging.
- Tenant operators are the first UI audience; end users benefit indirectly through better system reliability and governance.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R6-R12][Technical] What shared state-machine provisioning model should System Workflows use: one workflow per tenant, one per stage with tenant input, or a hybrid based on workflow class?
- [Affects R11, R22, R23][Technical] What is the canonical System Workflow run/evidence schema, and how much can reuse existing routine execution/event tables versus needing a separate system-workflow namespace?
- [Affects R14-R16][Technical] Which existing Wiki Build, Evaluation Runs, and Activation steps map cleanly to Standard parent states versus Express child stages?
- [Affects R17-R21][Technical] What is the extension-point contract shape so hooks remain supportable and validated?
- [Affects R1-R4][Design] How should Automations navigation order System Workflows relative to Routines, Schedules, and Webhooks?
- [Affects R23-R25][Needs research] What exact evidence bundle does SOC2/audit review need from the first three workflows so later SOC2/Audit Pipeline work has a compatible foundation?

---

## Next Steps

-> /ce-plan for structured implementation planning.
