---
date: 2026-06-20
topic: first-class-workflows
focus: "Unify Thinkwork routines, Twenty CRM workflows, and n8n workflows into one first-class workflow concept with UI monitoring and observations."
mode: repo-grounded
---

# Ideation: First-Class Workflows In Thinkwork

## Grounding Context

### Codebase Context

Thinkwork already has a substantial native workflow substrate under the name "routines." The `routines` table stores definitions with an `engine` partition, Step Functions ARNs, documentation, current version, visibility, ownership, and optional `catalog_slug`. `routine_asl_versions` stores the ASL, markdown summary, and step manifest. `routine_executions` mirrors Step Functions executions into Postgres for query/UI/audit, and `routine_step_events` records per-step status, recipe type, retry count, cost, outputs, errors, and log previews.

The web UI already includes a routines list, workflow/activity/details tabs, a React Flow-based routine editor, execution list, and execution graph/detail surfaces. Execution detail intentionally renders from the ASL version that backed the run and can infer succeeded steps from output when callback events are missing. This means the problem is not "no UI at all"; it is that the product concept is still `Routine = Step Functions` while other workflow-like concepts are arriving through n8n, Twenty CRM, scheduled jobs, Spaces, and agent workflows.

The current n8n integration is a migration bridge, not live federation. `importN8nRoutine` fetches an n8n workflow, maps a narrow supported linear webhook-to-response shape into a routine plan, builds Step Functions artifacts, and creates a tenant-shared routine. That is useful, but it does not make n8n a live workflow backend or give Thinkwork unified monitoring over n8n executions.

There is already a workflow catalog table, `tenant_workflow_catalog`, used for Customize workflow discovery, and a separate `workflow_configs` table for orchestration settings. Those names are close to the desired concept but do not yet form a single first-class workflow domain with runs, triggers, versions, engine adapters, app bindings, and UI monitoring.

One technical gap is especially important: manual routine runs capture the exact ASL version row, while scheduled routine runs appear to start through the alias path without the same exact version capture. Any unified workflow model should close that "what exactly ran?" gap early.

### Past Learnings

- `docs/solutions/developer-experience/routine-rebuild-closeout-checkpoints-2026-05-03.md`: workflow products have multiple sources of truth - authoring metadata, generated artifacts, deployed runtime versions, execution rows, step events, and UI graph state. A successful execution does not prove authoring, runtime activation, observability, agent access, mobile parity, and recipe promotion are complete.
- `docs/solutions/architecture-patterns/recipe-catalog-llm-dsl-validator-feedback-loop-2026-05-01.md`: do not let agents emit raw executable workflow definitions as the primary product contract. Prefer typed recipes/capabilities with server-side validation and repair loops.
- `docs/solutions/architecture-patterns/managed-app-mcp-oauth-lifecycle-2026-06-06.md`: managed app lifecycle, MCP connector state, and user authorization are separate but reconciled state machines. This applies directly to n8n/Twenty workflow participation.
- `docs/brainstorms/2026-06-08-connected-application-registry-requirements.md`: applications should not call each other directly by default. Thinkwork should be the hub for capability contracts, routing, policy, audit, idempotency, readiness, and cross-app workflow observability.
- `docs/ideation/2026-06-20-managed-n8n-thinkwork-bridge-ideation.md`: a stock HTTP/Wait bridge into Thinkwork should prove the n8n handoff contract before a custom n8n node becomes the canonical path.

### External Context

n8n treats a workflow as a visual trigger/action graph and an execution as one run of that workflow. It supports manual and production execution modes, webhook triggers, workflow-level execution views, public API resources, Prometheus metrics, log streaming, and OpenTelemetry tracing for workflow/node executions. The product lesson is that n8n's workflow is both authoring object and operational object, but external invocation is often webhook-shaped rather than "start arbitrary workflow by ID" shaped. Sources: [n8n executions](https://docs.n8n.io/workflows/executions/), [n8n webhooks](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/), [n8n API](https://docs.n8n.io/api/api-reference/), [n8n OpenTelemetry](https://docs.n8n.io/hosting/logging-monitoring/opentelemetry/).

AWS Step Functions provides the strongest AWS-native operational precedent: state machine definition, execution, event history, EventBridge status-change events, CloudWatch Logs for Express workflows, and X-Ray/trace integrations. This validates Thinkwork's current Step Functions investment, but also shows why Thinkwork should store large inputs/outputs and durable product state itself instead of treating backend history as the full user-facing ledger. Sources: [Step Functions EventBridge integration](https://docs.aws.amazon.com/step-functions/latest/dg/eventbridge-integration.html), [CloudWatch Logs](https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html), [GetExecutionHistory](https://docs.aws.amazon.com/step-functions/latest/apireference/API_GetExecutionHistory.html).

Twenty CRM has CRM-native workflows with record events, schedules, manual triggers, webhooks, record actions, HTTP requests, and custom code. Its troubleshooting docs expose a domain-specific failure mode: record-created workflows can fire before a human finishes entering fields because the CRM saves in real time. That argues for preserving CRM object lifecycle semantics as typed app bindings, not flattening them into generic DAG steps. Sources: [Twenty workflows overview](https://docs.twenty.com/user-guide/workflows/overview), [Twenty workflow actions](https://docs.twenty.com/user-guide/workflows/capabilities/workflow-actions), [Twenty workflow troubleshooting](https://docs.twenty.com/user-guide/workflows/how-tos/need-more-help/workflow-troubleshooting).

OpenTelemetry is best treated as a correlation substrate, not the workflow product model. It can connect Thinkwork runs, Step Functions executions, n8n nodes, Lambda logs, and app events, but Thinkwork still needs durable workflow/run tables as the source of truth.

## Ranked Ideas

### 1. Workflow Control Plane With Engine Adapters

**Description:** Make `Workflow` the first-class product construct and demote `Routine` to one backend/profile under it. A workflow owns identity, owner, triggers, typed inputs/outputs, version history, permissions, app bindings, run policy, observability expectations, and engine capabilities. Step Functions ASL, n8n workflow IDs, Twenty workflow IDs, and future agent-native execution plans become engine artifacts or adapters attached to a Thinkwork workflow.

**Warrant:** `direct:` Thinkwork already has Step Functions-backed `routines`, `routine_asl_versions`, `routine_executions`, and `routine_step_events`, plus separate n8n import, Twenty managed app, connected application registry, and workflow catalog work.

**Rationale:** This is the cleanest way to avoid three workflow concepts without throwing away existing work. It lets Thinkwork say "workflow" once, while still using Step Functions for durable AWS orchestration, n8n for visual low-code integration, and Twenty for CRM lifecycle semantics where appropriate.

**Downsides:** Requires a careful migration and naming strategy. If the abstraction is too generic, it can become a hollow registry that hides backend differences rather than clarifying them.

**Confidence:** 90%

**Complexity:** High

**Status:** Unexplored

### 2. WorkflowRun Ledger And Event Stream

**Description:** Introduce canonical `WorkflowRun` and `WorkflowRunEvent`/`WorkflowStepEvent` records for every workflow execution, regardless of origin or engine. Manual runs, schedules, webhooks, CRM lifecycle events, n8n bridge calls, agent requests, and Step Functions executions all create a Thinkwork run record before or at the execution boundary. Step Functions history, n8n execution IDs, OTel trace IDs, CloudWatch logs, and CRM event IDs become correlated evidence attached to the run, not the source of truth.

**Warrant:** `direct:` Thinkwork already mirrors routine runs into `routine_executions` and `routine_step_events`, and the code scan found a scheduled-run traceability gap compared with manual routine runs.

**Rationale:** First-class workflows are mostly trust work: what started, why, what version ran, what did each step do, what changed, what failed, what did it cost, and where can I inspect the backend evidence? A single run ledger is the spine that makes UI monitoring, observations, support, replay, cost, and audit possible across engines.

**Downsides:** Adds storage and ingestion responsibility to Thinkwork. The team will need retention, redaction, large payload offload, deduplication, and event ordering rules.

**Confidence:** 92%

**Complexity:** High

**Status:** Unexplored

### 3. Unified Trigger Contracts

**Description:** Make workflow triggers first-class records/contracts rather than engine-specific side effects. A workflow can declare manual, schedule, webhook, record lifecycle, app event, EventBridge event, agent event, API call, or child-workflow triggers. Each trigger captures provenance, actor/system identity, input schema, idempotency key, readiness checks, and which workflow version it invokes.

**Warrant:** `direct:` Existing Thinkwork paths already split manual and scheduled routine runs; n8n centers webhook-triggered executions; Twenty exposes record, schedule, manual, and webhook triggers.

**Rationale:** Trigger identity answers "why did this run?" before "how did this run?" That distinction is exactly what gets muddled when Step Functions, n8n, CRM workflows, and scheduled jobs all own their own entry points.

**Downsides:** Trigger modeling can sprawl quickly. The first version should cover the concrete trigger families already present rather than inventing a universal event ontology.

**Confidence:** 86%

**Complexity:** Medium

**Status:** Unexplored

### 4. Typed Workflow Recipes And Compiler

**Description:** Promote repeatable workflows into typed recipes/templates with declared triggers, app bindings, inputs, outputs, permissions, expected events, credentials, observability defaults, and deployment targets. A compiler emits backend artifacts such as Step Functions ASL, schedule bindings, webhook endpoints, graph metadata, n8n bridge configuration, or future agent-native plans while preserving one canonical source model.

**Warrant:** `direct:` Prior Thinkwork docs already favor typed recipe catalogs and server-side validation, while current routines store compiled ASL versions and the n8n importer maps external workflow source into routine artifacts.

**Rationale:** This is the leverage layer. It turns workflows from one-off automations into installable, versioned, tenant-customizable assets that fit Thinkwork's skill/catalog instincts and enterprise scale.

**Downsides:** Compiler boundaries are hard. If it tries to support every n8n or CRM feature on day one, it will stall. It should start with recipe families Thinkwork already owns.

**Confidence:** 84%

**Complexity:** High

**Status:** Unexplored

### 5. Connected App Workflow Bindings

**Description:** Treat Twenty, n8n, Slack, GitHub, and future managed apps as connected applications that contribute typed triggers, actions, resources, credentials, and evidence links to Thinkwork workflows. A Twenty "opportunity stage changed" workflow becomes a workflow with a CRM object trigger binding; an n8n workflow can become an external engine binding or imported source; a Step Functions routine becomes a native execution binding.

**Warrant:** `direct:` Existing Thinkwork docs favor a connected application registry, service endpoints, managed app lifecycle separation, and narrow audited control MCPs for managed workflow-like apps.

**Rationale:** This preserves domain semantics. CRM workflows encode object lifecycle, n8n workflows encode integration graph behavior, and Step Functions workflows encode durable AWS orchestration. Bindings let those semantics participate in one workflow model without pretending they are identical.

**Downsides:** Requires the connected application registry to become more real. Capability flags must be explicit or the UI will imply false uniformity across engines.

**Confidence:** 82%

**Complexity:** Medium

**Status:** Unexplored

### 6. Workflow Observability UI For Every Origin

**Description:** Generalize the existing routine run detail UI into a workflow monitoring surface that always shows trigger, actor, workflow version, engine/backend, app bindings, step/run events, external execution IDs, correlated traces, costs, outputs, errors, and repair actions. The graph becomes a runtime map that can include native steps, app lifecycle transitions, webhooks, human approvals, agent calls, and external engine handoffs.

**Warrant:** `direct:` Thinkwork already has React Flow routine authoring and execution detail surfaces; external engines such as n8n and Step Functions expose execution histories but with different semantics.

**Rationale:** This is the fastest visible path to "first-class." Users do not need to care immediately whether a run came from Step Functions, n8n, or Twenty if the run page can reliably explain what happened and where the deeper engine evidence lives.

**Downsides:** The UI can become misleading if backend capability differences are hidden. It should show "available actions" and "evidence links" per engine rather than pretending every run supports cancel, replay, retry-from-step, or full history.

**Confidence:** 88%

**Complexity:** Medium

**Status:** Unexplored

### 7. Import, Bridge, Then Promote

**Description:** Avoid choosing between "everything lives in n8n" and "n8n is only import." Use a staged model: first, stock n8n HTTP/Webhook/Wait nodes call a Thinkwork workflow bridge; second, selected n8n workflows can be imported/normalized into canonical Thinkwork workflow drafts; third, repeated bridge/import patterns promote into typed workflow recipes and eventually native engine artifacts where useful.

**Warrant:** `direct:` The existing n8n importer is narrow and migration-oriented, while the adjacent n8n bridge ideation argued for proving a stock-node bridge contract before shipping a custom Thinkwork n8n node.

**Rationale:** This keeps n8n useful immediately without making it the permanent source of truth for all workflows. It also gives Thinkwork telemetry about what customers actually automate before investing in native recipes or custom nodes.

**Downsides:** The staged story must be communicated clearly or users will see three paths instead of a lifecycle. The first bridge needs tight auth, idempotency, and callback semantics.

**Confidence:** 80%

**Complexity:** Medium

**Status:** Unexplored

## Rejection Summary

| #   | Idea                                             | Reason Rejected                                                                                                                                             |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | All workflows are n8n                            | Useful boundary marker, but it gives too much execution and product truth to an external app and weakens Thinkwork's AWS-native/agent-native identity.      |
| 2   | Only Step Functions / everything compiles to ASL | Maximizes reuse of existing routines, but flattens n8n and CRM-native semantics into an AWS engine shape and will leak capability mismatches.               |
| 3   | No Step Functions                                | Interesting long-term architecture, but too expensive relative to the existing routine substrate and not necessary to unify workflow identity.              |
| 4   | Zero-migration registry overlay                  | Good first slice for inventory and links, but insufficient as the whole strategy because it does not normalize triggers, versions, runs, or repair actions. |
| 5   | Agent-composed live workflows as the default     | Strong agent-native future, but too hard to govern as the initial workflow model; better as a promotion loop from observed agent runs into recipes.         |
| 6   | Workflow activation manager as standalone idea   | Important, but folded into Workflow Control Plane and Typed Workflow Recipes as lifecycle/version responsibilities.                                         |
| 7   | Workflow passport/provenance as standalone idea  | Valuable, but folded into WorkflowRun Ledger and Typed Workflow Recipes.                                                                                    |
| 8   | IDE project model for workflows                  | Useful authoring metaphor, but better handled during brainstorming of recipes/compiler/UI rather than as a separate product architecture.                   |

## Recommended Next Handoff

Brainstorm the first survivor: **Workflow Control Plane With Engine Adapters**. The concrete question should be: "What is the smallest useful `Workflow`/`WorkflowRun` model that can wrap existing Step Functions routines, expose n8n bridge/import paths, and represent Twenty CRM workflow semantics without forcing a full engine migration?"

That brainstorm should decide:

- whether `routines` become `workflows` directly or remain a native engine table under a new `workflows` table;
- the minimal `Workflow`, `WorkflowVersion`, `WorkflowTrigger`, `WorkflowRun`, and `WorkflowRunEvent` shape;
- how to close the scheduled-run version capture gap;
- which UI route replaces or aliases `/settings/routines`;
- how n8n appears in v1: bridge, import, engine binding, or all three behind staged labels;
- which capability flags are mandatory so users do not assume all engines support the same operations.
