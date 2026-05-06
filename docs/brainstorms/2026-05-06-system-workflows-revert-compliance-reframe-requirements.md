---
date: 2026-05-06
topic: system-workflows-revert-compliance-reframe
---

# System Workflows Revert + Compliance Reframe

## Summary

Pull Wiki Build and Evaluation Runs out of System Workflows, remove the Activation feature and all multi-step orchestration infrastructure, then rebuild what remains as a "Compliance" feature in the Manage admin group — an append-only audit-event log in an isolated Postgres schema with cryptographic tamper evidence (in-DB hash chain anchored to S3 Object Lock), a filterable viewer, and basic export. This establishes the **SOC2 evidence foundation for selected controls** — not full SOC2 readiness, which also requires policy documentation, change management process, vendor practices, and incident response work outside this brainstorm. Fully self-built on AWS-native infrastructure with no third-party SaaS dependency.

---

## Problem Frame

System Workflows shipped in late April 2026 as a Step Functions–backed orchestration layer wrapping three platform processes: Wiki Build, Evaluation Runs, and Tenant/Agent Activation. The original intent combined SOC2-grade audit capture with multi-step process orchestration in a single substrate.

In practice, both ambitions misfired. The orchestration model is the wrong shape for Wiki Build and Evaluation Runs — both are product features that need normal dev iteration, and the seven-table abstraction with definitions, configs, evidence contracts, extension points, and step events has stalled development on both. New developers can't pick up Wiki or Evals work because the System Workflows overhead is a major distraction; even the original author can't make small changes ("I have no idea how to actually do that now"). A separate forward-looking case — adding a Hindsight memorybank aggregation flow — has no clear path because System Workflows is too heavy to justify and there's no documented alternative.

The audit/SOC2 ambition has also failed in implementation. The admin UI is read-only with no way to edit nodes; the Activity tab shows status and timestamps but no actor identity, inputs, outputs, or diffs; the Workflow detail panel reads "No step event has been recorded for this node," indicating step events are not being written; the Evidence Contract is declared but every workflow shows "Evidence: Pending." An auditor walking in today would not accept this as evidence — the schema has the shape of compliance infrastructure without the substance.

SOC2 Type 1 is a near-term gating concern: it must be in place before Thinkwork can onboard enterprise customers or work with distribution channels. But the *audit-evidence* portion of SOC2 is satisfied by traceability + tamper-evident logs + demonstrable controls, not by multi-step orchestration with pre-approval gates. (Full SOC2 readiness also requires policy documentation, change management process, vendor management, and incident response — separate work outside this brainstorm.) The right shape for the evidence portion is a flat append-only audit-event log writable from any platform service, viewable by admins, exportable for auditors. That shape is much smaller than the current System Workflows footprint.

---

## Actors

- A1. Tenant admin: views the audit-event log, filters by actor/tenant/time/event-type, exports for compliance review.
- A2. Future auditor: receives exported audit data; never has direct access to the admin UI in v1.
- A3. Platform services (resolvers, Lambda handlers, agent runtime): emit audit events when relevant actions occur.

---

## Key Flows

- F1. **Pull Wiki + Evals out of System Workflows**
  - **Trigger:** First PR after this brainstorm.
  - **Actors:** Engineering.
  - **Steps:** Wiki Build resolver flips back to direct Lambda invocation; Evaluation Runs resolver flips back to direct Lambda invocation; System Workflows infrastructure remains intact but unused by these two callers.
  - **Outcome:** Wiki Build and Evaluation Runs work without System Workflows overhead. Dev velocity on both subsystems is unblocked.
  - **Covered by:** R1, R2.

- F2. **Remove multi-step orchestration entirely**
  - **Trigger:** Second PR, after F1 lands.
  - **Actors:** Engineering.
  - **Steps:** Documents on the `codex/activation-deploy-smoke-plan` branch unrelated to Activation (Flue runtime production-wiring plan, deep-researcher launch notes) are moved to a separate branch before closure to avoid losing in-flight work. Activation feature is removed (resolver, runtime invocation, all four `activation_*` tables, in-flight smoke-plan branch closed); Step Functions state machines, adapter Lambdas, multi-step orchestration tables, and multi-step admin UI tabs are all deleted.
  - **Outcome:** No multi-step orchestration remains in the platform. The legacy System Workflows admin entry remains only as a placeholder until F3 replaces it.
  - **Covered by:** R3, R4.

- F3. **Rebuild as Compliance**
  - **Trigger:** Separate planning effort after F2 lands.
  - **Actors:** Engineering, then Tenant admin.
  - **Steps:** New audit-event log replaces the orchestration data model; "System Workflows" admin entry is renamed to "Compliance" and moved to the Manage group; write helpers are added to platform services; the starter event slate is implemented; an Events list view + basic Reports export ship.
  - **Outcome:** Compliance feature exists with a usable audit log, a filterable admin viewer, and CSV/JSON export. The platform can demonstrate SOC2 Type 1 readiness on the listed event types.
  - **Covered by:** R5, R6, R7, R8, R9, R10.

- F4. **Admin views the audit log**
  - **Trigger:** Tenant admin opens the Compliance section of the admin UI.
  - **Actors:** A1.
  - **Steps:** Admin lands on the Events list; filters by event type, actor, tenant, and date range; opens an event to view its full payload; optionally exports the filtered set as CSV or JSON.
  - **Outcome:** Admin can find and export any tracked event without leaving the admin UI.
  - **Covered by:** R7, R8, R9.

- F5. **Platform service writes an audit event**
  - **Trigger:** Any platform action listed in the starter event slate occurs (sign-in, agent skills change, workspace governance file edit, etc.).
  - **Actors:** A3.
  - **Steps:** Service calls a write helper with event type and payload; helper resolves actor identity from the request context; event is written to the audit log append-only. **Failure semantics follow R6 tiers:** telemetry events are logged and dropped without blocking; control-evidence events fail the originating action and surface the failure to the caller.
  - **Outcome:** The action is recorded with actor identity, timestamp, tenant context, and structured payload.
  - **Covered by:** R5, R6, R10.

---

## Requirements

**Phase 1 — Wiki Build and Evaluation Runs revert**
- R1. Wiki Build returns to direct GraphQL-resolver-to-Lambda invocation, with no dependency on System Workflows.
- R2. Evaluation Runs returns to direct GraphQL-resolver-to-Lambda invocation, with no dependency on System Workflows.

**Phase 2 — Multi-step orchestration removal**
- R3. The Activation feature is removed. All four `activation_*` tables drop together to avoid orphaned FK references: `activation_sessions`, `activation_session_turns`, `activation_apply_outbox`, `activation_automation_candidates`. The in-flight `codex/activation-deploy-smoke-plan` branch is closed without merging.
- R4. All multi-step orchestration infrastructure is removed: Step Functions state machines, adapter Lambdas, the seven `system_workflow_*` tables (`system_workflow_definitions`, `system_workflow_configs`, `system_workflow_extension_bindings`, `system_workflow_runs`, `system_workflow_step_events`, `system_workflow_evidence`, `system_workflow_change_events`), and the multi-step admin UI tabs. The separate `workflow_configs` table (per-tenant orchestration configuration used by the `orchestration/` GraphQL resolvers) is **not** in scope of this removal — it serves Routines and other product-owned orchestration that survives this revert.

**Phase 3 — Compliance feature**
- R5. A new append-only audit-event log replaces the orchestration data model. Each row uses a canonical event envelope: `event_id`, `tenant_id`, `occurred_at`, `recorded_at`, `actor`, `actor_type`, `source`, `event_type`, `resource_type`, `resource_id`, `action`, `outcome`, `request_id`, `thread_id`, `agent_id`, `payload`, `payload_schema_version`, `control_ids`, `payload_redacted_fields`, `prev_hash`, `event_hash`. Payloads above a planning-defined size threshold are stored in S3 with a key reference in the row.
- R6. Platform services emit audit events through a shared write-helper interface. Events split into two tiers. **Control-evidence events** (governance file edits, agent skills changes, MCP server add/remove, user disable/delete, data export initiated, role/permission changes — see Control / Evidence Mapping below) persist via synchronous write or same-transaction outbox; if the audit cannot be persisted, the originating action fails and surfaces the failure to the caller. **Telemetry events** (sign-in success, low-value read operations) write asynchronously and may drop on failure with operator alerting.
- R7. The admin UI surface is renamed "Compliance" and moved to the Manage group. The legacy System Workflows admin entry is removed at the same time, with no transitional double-nav.
- R8. The Compliance UI provides an Events list with filter-by-actor, filter-by-tenant, filter-by-event-type, and filter-by-date-range.
- R9. An Exports surface allows the Tenant admin to export a filtered event set as CSV or JSON for an arbitrary date range. Named "Exports" rather than "Reports" — auditor dashboards, control packages, and analytics are explicitly deferred until an auditor shapes them.
- R10. The starter event slate covers the SOC2 Type 1 high-leverage surfaces: sign-in (success and failure), sign-out, user invited/created/disabled/deleted, agent created/deleted, agent skills changed, MCP server added/removed, workspace governance file edits (AGENTS.md, GUARDRAILS.md, CAPABILITIES.md), and data export initiated. Daily workspace memory file edits are excluded from the slate.
- R11. All audit data lives in a dedicated `compliance` Postgres schema, separate from the application schema. The application database role has write-only access to `compliance.*` tables; a distinct admin role has read access; no other role can read or write the schema.
- R12. Each audit event row carries an in-row cryptographic hash chain (`event_hash`, `prev_hash`) **scoped per-tenant** — every tenant's events form their own chain, so tenant-level verification is independent and a tenant cannot verify or be implicated by another tenant's rows. Tampering with any historical row is detectable by recomputing that tenant's chain and finding the first hash mismatch.
- R13. A periodic anchoring job computes a Merkle root of recent events per tenant and writes it to an S3 bucket configured with Object Lock in Compliance mode. The anchor is the WORM-grade external proof that the in-DB chain has not been wholesale rewritten; verification re-derives the Merkle root from current Postgres data and compares it to the latest anchor. Verification produces a structured report per tenant: chain head, last anchor timestamp, count of events since last anchor, and result (`verified` / `mismatch` with first-break row id).
- R14. The audit-event schema reserves governance event types for future use without emitting them in Phase 3: `policy.evaluated`, `policy.allowed`, `policy.blocked`, `policy.bypassed`, `approval.recorded`. The canonical envelope's `event_type` field accepts these values; `payload_schema_version` allows their payloads to evolve. This preserves a future SomaOS-style governed-action lane (Phase 6) without forcing it into Phase 3.
- R15. Audit event payloads pass through a redaction step before write that removes secrets (API keys, OAuth tokens, password hashes), classifies fields as PII / sensitive / public per a maintained classification list, and routes payloads above a maximum inline size to S3. **Field-level validation enforces maximum lengths per envelope field, escapes user-controlled string values destined for structured fields, and sanitizes against newline-injection and JSON metacharacter injection so user-controlled content (e.g., file diffs in `workspace.governance_file_edited` payloads) cannot corrupt audit-record rendering or export pipelines.** The `payload_redacted_fields` envelope field records which keys were redacted so verification proves what was suppressed without exposing it.

---

## Control / Evidence Mapping

The starter event slate (R10) maps to SOC2 Trust Services Criteria as follows. This is the v1 slate — Phase 4 (auditor engagement) may add events as auditor feedback surfaces gaps; events outside this map are not control-evidence and follow the telemetry tier (R6).

| Event type | TSC area | What it evidences | Tier |
|---|---|---|---|
| `auth.signin.success` | CC6.1 | User authentication occurred | Telemetry |
| `auth.signin.failure` | CC6.1 | Failed authentication attempts; rate-limit threshold | Telemetry |
| `auth.signout` | CC6.1 | Session termination | Telemetry |
| `user.invited` / `user.created` | CC6.1, CC6.2 | User access provisioning | Control-evidence |
| `user.disabled` / `user.deleted` | CC6.1, CC6.2 | User access deprovisioning | Control-evidence |
| `agent.created` / `agent.deleted` | CC7.1, CC8.1 | Agent lifecycle changes | Control-evidence |
| `agent.skills_changed` | CC8.1 | Effective capability change; blast-radius proof | Control-evidence |
| `mcp.added` / `mcp.removed` | CC6.1, CC8.1 | External tool access boundary changes | Control-evidence |
| `workspace.governance_file_edited` | CC6.3, CC8.1 | AGENTS.md / GUARDRAILS.md / CAPABILITIES.md edits | Control-evidence |
| `data.export_initiated` | CC6.1, CC9.2 | Sensitive data leaving the tenant | Control-evidence |

Phase 4 expands this map, locks retention windows per event type, and adds events the auditor flags as gaps. Phase 5 (Type 2 + AI controls) adds agent-state snapshots, tool-call events, and memory-recall events to this map.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given Wiki Build and Evaluation Runs were previously routed through System Workflows, when Phase 1 ships, then triggering a Wiki Build or Evaluation Run produces no rows in the multi-step orchestration tables and no Step Functions execution is started.
- AE2a. **Covers R6.** Given a control-evidence event (e.g., `agent.skills_changed`) cannot be persisted to the audit log because the database is unreachable, when the originating GraphQL mutation runs, then the mutation fails and the user is told the action could not be safely audited; no agent-skill change is committed.
- AE2b. **Covers R6.** Given a telemetry event (e.g., `auth.signin.success`) cannot be persisted, when the originating sign-in completes, then the user signs in successfully, the event is dropped, and an operator alert fires for the failed write.
- AE3. **Covers R8.** Given an admin filters the Events list by `event_type=agent.skills_changed` over a 7-day date range, when the filter is applied, then the list shows only matching events from the past 7 days, with actor identity and full payload available on row click.
- AE4. **Covers R10.** Given a tenant admin edits AGENTS.md in a workspace, when the edit is saved, then an audit event with type `workspace.governance_file_edited` is recorded with actor identity, the file name, and the diff.
- AE5. **Covers R11.** Given the application service attempts to UPDATE or DELETE a row in `compliance.audit_events`, when the operation runs under the application role, then the operation is rejected by Postgres permissions and the event remains unchanged. (How the rejection itself is observed and surfaced — Postgres trigger under a separate role, application-layer catch on the failed statement, or out-of-band detector — is a Phase 3 design item; see Outstanding Questions.)
- AE6. **Covers R12.** Given a privileged actor modifies a historical row in `compliance.audit_events` directly (bypassing the application), when the verification job recomputes the hash chain, then the modified row's `event_hash` no longer matches its computed value and every subsequent row's `prev_hash` link is reported as broken.
- AE7. **Covers R13.** Given the anchoring job writes a Merkle root to S3 Object Lock at time T, when any actor (including AWS root) attempts to delete or modify that anchor before its retention period expires, then the operation is rejected by S3 Object Lock Compliance mode and the anchor remains intact.
- AE8. **Covers R15.** Given an audit event payload contains a field tagged `secret` (API key, OAuth token), when the redaction step runs before write, then the field value is replaced with a placeholder, the field name is added to `payload_redacted_fields`, and no plaintext secret reaches the audit row or any downstream sink.

---

## Success Criteria

- Dev velocity on Wiki Build and Evaluation Runs visibly recovers — at least one developer who previously bounced off the System Workflows abstraction is able to land a meaningful change on Wiki Build or Evaluation Runs within two weeks of Phase 1 shipping.
- A new compound orchestration case (e.g., Hindsight memorybank aggregation) can begin without revisiting "what's the right substrate" — direct Lambda or simple background-job patterns are the documented default for new orchestration work.
- The Compliance UI presents an audit log that the engineering team would feel comfortable showing to a SOC2 auditor as a starting point — actor identity, timestamps, event types, and exportable evidence are all present and populated.
- An auditor reviewing exported data for the starter event slate can answer "who did what, when, with what context" for every event type on the list, without follow-up engineering work.
- Tamper evidence is provable end-to-end: a SOC2 auditor can be given the verification tooling and the S3 Object Lock anchors and independently confirm that audit data has not been modified since recording, without trusting Thinkwork-controlled mutable storage.

---

## Scope Boundaries

- Pre-approval workflows of any kind. No approval inbox, no review state on events, no human-in-the-loop gating UX.
- A platform-wide orchestration *abstraction* like System Workflows. Existing product-owned orchestration that happens to use Step Functions for its own reasons (e.g., Routines) remains in scope of those products and is unaffected by this brainstorm.
- A new platform-wide orchestration substrate to replace System Workflows for forward work like Hindsight aggregation. New orchestration cases default to direct Lambda invocations or simple background-job patterns case-by-case.
- Migration of historical System Workflows run data into the new audit log. The current data is not auditor-grade and is not worth preserving.
- Backfilling or importing historical events from other systems into the audit log. The hash chain assumes append-at-tail only; backfills break the chain's first-event-onward verification model. If a backfill is ever needed, it is a separate design problem with its own integrity story.
- AWS Audit Manager and CloudTrail Lake. Both are closing to new customers in April and May 2026 respectively and are not a viable substrate for net-new SOC2 prep.
- AWS QLDB. Closed to new customers 2025-07-31; AWS recommends migration to Aurora Postgres, which is the substrate we are already using.
- Vanta, Drata, or any third-party SOC2 SaaS. Thinkwork stays fully self-built on AWS-native infrastructure with no third-party compliance dependency.
- Blockchain-based ledger storage (AWS Managed Blockchain or otherwise). Overkill for a single-tenant audit log where there are no mutually-distrusting parties; the hash-chain + S3 Object Lock pattern provides auditor-grade tamper evidence at far lower complexity.
- Multi-tenant compliance reporting features (auditor self-serve UX, customer-facing audit views).
- AgentCore Evaluations native migration for Evaluation Runs. The existing wrapper Lambda stays for now and is revisited only if it becomes a velocity issue on its own.
- 12-month retention enforcement, archival, and automated deletion of expired audit data. Deferred to Phase 4 (SOC2 readiness) — the initial Compliance ship retains data indefinitely until retention policy is wired.
- Auditor-facing UX (view-as-auditor mode, evidence packaging) and dashboards/charts/summary analytics on the Reports surface. Deferred until an auditor actually engages.
- Daily workspace memory file edits as audit events. Excluded from the starter slate as too noisy.

---

## Key Decisions

- **Drop multi-step orchestration entirely rather than preserve it for one caller.** Activation was the only remaining caller of the multi-step model after Wiki and Evals leave. One-caller infrastructure is the trap that produced the original ceremony — preserving it for Activation alone would amortize all data-capture and UI investment over a single use case.
- **Track-only, no pre-approval, even for governance file edits.** SOC2 is satisfied by traceability + tamper-evident logs, not by pre-authorization. Pre-approval is a heavier control that an enterprise customer may demand later — at that point, adding a review-state column is a small migration, not a re-architecture.
- **Compliance is a feature in the Manage group, not its own product surface.** Auditor-facing UX and customer-self-serve compliance views are explicit non-goals in v1; the audience is internal admins exporting data for an auditor.
- **Phasing reflects urgency, not deployment risk.** Phase 1 (Wiki + Evals revert) ships immediately because dev velocity is the active blocker. Phase 2 (multi-step removal) follows soon. Phase 3 (Compliance feature) is a separate planning effort because it is a meaningful design and UI build.
- **Fully self-built on AWS-native, no third-party compliance SaaS.** Vanta and Drata would cover the SOC2 framework + AWS-resource evidence collection layer, but introducing a SaaS dependency is rejected. AWS-native primitives (Postgres + S3 Object Lock + CloudWatch) plus our own framework mapping cover the same ground without external vendor lock-in.
- **Tamper evidence: in-DB hash chain anchored to S3 Object Lock, both shipped in Phase 3.** AWS QLDB (the obvious purpose-built service) is sunsetting and not viable. Blockchain is overkill for a single-tenant audit log where there are no mutually-distrusting parties. The hash-chain + Object Lock pattern is regulator-recognized — S3 Object Lock Compliance mode satisfies SEC 17a-4(f), CFTC 1.31(c)-(d), FINRA 4511(c), and HIPAA — and gives auditor-grade proof. Shipping both layers in Phase 3 rather than deferring Layer B to Phase 4 prevents accumulating audit data without WORM backing.
- **Audit data isolated in its own Postgres schema (`compliance.*`).** The application database role has write-only permissions on `compliance.*`; a separate admin role has read; no other role has any access. Schema-level isolation aligns with auditor expectations of clear permission boundaries and makes a future migration to a dedicated audit database (if scale demands) a schema move rather than a data extraction.
- **Per-tenant hash chains, not a global chain.** Each tenant's events form their own chain. Verification is tenant-scoped — a tenant can verify only their own data without trust requirements on other tenants' rows. Per-tenant chains also align with multi-tenant export requirements, where one tenant must not retrieve another's audit data even via a verification path. Operational cost is more chains to anchor; the alternative (one global chain) creates a permission question every time a tenant exports data.
- **Two-tier write semantics: control-evidence events get durable writes, telemetry events are async.** Losing a control-evidence event is worse than delaying or failing the originating action; losing a telemetry event is acceptable with operator alerting. Forcing every event onto a synchronous critical path would add latency to every read; treating every event as best-effort would make the audit log un-auditable.

---

## Future Direction

This brainstorm scopes Phases 1-3. Two future phases are flagged so current architecture decisions do not foreclose them.

**Phase 4 — SOC2 Type 1 audit engagement and readiness.** Engage an auditor, complete the Type 1 assessment, and harden Compliance against auditor feedback: 12-month retention enforcement, archival of expired data, auditor-facing UX (view-as-auditor mode, evidence packaging), framework mapping documentation. Out of scope here; planned when an auditor engages.

**Phase 5 — SOC2 Type 2 readiness + AI-specific controls.** Type 2 (continuous control effectiveness over 6-12 months) is the actual enterprise-sales motion — Type 1 is just the gate to start the conversation. Type 2 for AI agent platforms is novel territory because the Trust Services Criteria were written for traditional SaaS and do not have agent-specific guidance. Phase 3 architecture must not foreclose:

- **Non-determinism.** Agent actions vary across runs. Controls must instrument *process* (tools called, memory accessed, guardrails fired) rather than output correctness, since the same input can produce different actions.
- **Dynamic blast radius.** An agent's effective permissions are a function of skills + MCP tools + GUARDRAILS.md + workspace files + memory state. Static IAM models do not capture this; auditing "could agent X have accessed tenant Y's data" requires richer state capture.
- **Self-modifying state.** When an agent edits its own AGENTS.md or skills, audit must capture the resulting capability delta, not just the file change.
- **Prompt-injection containment.** User content can change agent behavior; the integrity of GUARDRAILS.md is itself a load-bearing control. Auditors will ask how injection is detected and contained.
- **Memory recall as auditable surface.** "What did the agent know when it took action X?" — model version, system prompt, tools available, memories recalled, RAG sources cited — is the AI equivalent of code provenance and is not in the current starter event slate.
- **Continuous control monitoring.** Type 2 expects alerting on control failures. For deterministic controls this is straightforward; for agent behavior it is an open problem industry-wide and requires its own design pass.
- **Framework lag.** Trust Services Criteria do not yet have agent-specific guidance. Auditors will reason by analogy. This is both a risk (auditor surprise) and an opportunity to lead with a published Thinkwork framework that becomes a reference for other agent platforms.

Phase 5 is its own future brainstorm-and-plan effort, expected to launch after Phase 3 ships. The current Phase 3 design should leave room for: agent-state snapshots at action time, tool-call audit events, memory-recall audit events, model-version provenance per action, continuous-monitoring sinks that consume the audit log, and supply-chain governance for agent assets (signed runtime container images, provenance for skill packs, hashed/versioned workspace defaults, and recorded "agent effective capability snapshot" at action time — directly answering the dynamic-blast-radius and self-modifying-state challenges above).

**Phase 6 — Governed Action Contract.** A SomaOS-style action-governance layer for high-risk operations: MCP mutation tools, outbound connector sends (Slack, email), workspace review approvals, destructive workspace/governance-file edits. The contract is `actor + action + context + policy_snapshot → allow | review_required | blocked + risk_score + reasons` with context-hashed approvals and per-action replay. Reuses the Phase 3 audit-event spine for replay history; emits the governance event types reserved in R14. Out of scope here; separate ce-brainstorm + plan effort. Pre-approval workflows remain out of scope until this Phase 6 brainstorm decides whether to introduce them.

---

## Dependencies / Assumptions

- The pre–System Workflows direct-Lambda invocation path for **Wiki Build** is still present in the codebase as a fallback (`compileWikiNow.mutation.ts` lines 62–77 — `isUnconfiguredSystemWorkflow` catch dynamically imports `LambdaClient`/`InvokeCommand`). The **Evaluation Runs** resolver does **not** have a fallback path — `evaluations/index.ts` lines 412–422 catch SW launch failure, mark the run failed, and rethrow with no direct Lambda invoke. Phase 1 R1 (Wiki) is a wiring change; Phase 1 R2 (Evals) requires reimplementing the direct invoke (handler ARN resolution, IAM, error handling).
- No customer or auditor has engaged on a SOC2 Type 1 program yet; the Compliance feature ships in advance of that engagement and may need adjustments once an auditor surfaces specific control expectations.
- The existing System Workflows admin nav location and the Manage admin group are both stable enough surfaces that Phase 3's rename + move is a UX change, not a navigation overhaul.
- The starter event slate covers the highest-leverage SOC2 Trust Services Criteria controls for an early-stage SaaS, but is not exhaustive — additional events will be added on the SOC2 timeline as gaps surface.
- Postgres role separation supports schema-level grants — write-only on `compliance.*` for the application role, read-only for an admin role. The Aurora Postgres deployment can be configured with the necessary roles without requiring a major migration.
- An S3 bucket with Object Lock enabled in Compliance mode is provisionable in the relevant AWS region(s). Once an object is written with a retention period, no actor (including AWS root) can delete or modify it before retention expires. Object Lock cannot be disabled on a bucket once enabled, so the bucket-level decision is one-way.

---

## Outstanding Questions

### Resolve Before Planning

*The following questions surfaced from doc review (2026-05-06) — all must be resolved before `/ce-plan` for Phase 3 begins. Items marked "(Promoted from Deferred)" were elevated when review identified them as planning-blockers, not implementation details.*

- [P0][Affects R6, R12] Per-tenant hash chain linearization mechanism: advisory lock per `tenant_id`, SERIALIZABLE isolation with retry, or single-writer outbox drainer. Without this, two concurrent control-evidence writes for the same tenant produce orphan chain links and verification reports false-positives during normal operation.
- [P0][Affects R5, R6] Outbox-vs-sync write semantics for control-evidence events. The compliance schema lives in the same Aurora cluster as the application schema, so synchronous-fail-on-audit-failure (R6 + AE2a) makes audit a tier-0 dependency for admin operations. Same-transaction outbox provides durability without holding originating action hostage. (Promoted from Deferred.)
- [P0][Affects R13] S3 Object Lock retention period AND Compliance-vs-Governance mode for staging/dev environments. Compliance mode is irreversible — a misconfiguration written during dev cannot be recovered. Decide retention period before anchoring job ships; consider Governance mode for non-prod environments. (Promoted from Deferred.)
- [P1][Affects R1, R2] Cleanup plan for SW step/evidence recorder calls embedded in `wiki-compile.ts` and `eval-runner.ts` handlers as part of Phase 1. Phase 1 currently flips the resolver but leaves handler-side recorder calls in place; Phase 2 deletion of the recorder tables breaks those call sites. Either strip recorder calls in Phase 1 or wire null-context no-op handling and prove it.
- [P1][Affects R3] What onboarding flow replaces Activation in Phases 1-3? The activation smoke plan was authored 2026-05-03 for a feature being removed three days later. Resolve whether enterprise-customer onboarding (the SOC2 driver) has a Phase 1-3 path or waits for Phase 6 governed-action.
- [P1][Affects R5] Phase 2/3 transition: full delete + rebuild vs extract-and-evolve the existing audit-events-shaped table in place. Full delete maximizes the no-capture window and discards usable data; extract-and-evolve preserves continuity but requires explicit migration of envelope shape.
- [P1][Affects R8, R11] Events list read path under R11 write-only application role. Options: graphql-http Lambda assumes admin role via `SET ROLE` for `compliance.*` queries; separate read-only Lambda; SECURITY-DEFINER view in `public` granted to application role with mandatory tenant_id predicate.
- [P1][Affects R12, R13] Premise: tamper evidence sized for SOC2 Type 1 audit-evidence needs vs over-engineered for broker-dealer regimes. SEC 17a-4(f) / FINRA 4511(c) are financial recordkeeping rules; most early-stage SaaS pass Type 1 with append-only Postgres + IAM + CloudTrail. Reaffirm or scale back.
- [P1][Affects Phase 3] Sequencing: build-then-engage-auditor vs engage-auditor-first to scope evidence. Phase 4 currently engages auditor after Phase 3 ships. Inverting (engage first, scope to spec, then build) reduces risk of shipping the wrong shape.
- [P1][Affects Phase 3 vs Phase 5] Commodity-control work (sign-ins, governance file edits) vs AI-specific work (agent-state snapshots, tool calls, memory recall) sequencing. Phase 5 is named as the actual enterprise-sales motion; Phase 3 invests engineering in evidence types every SaaS already produces.
- [P1][Affects R12] Per-tenant hash chains vs simpler global chain. Internal-only audience commitment (R7/R9) doesn't justify per-tenant complexity; per-tenant fans out anchor writes by tenant count and accumulates un-deletable Object Lock objects per tenant.
- [P1][Affects R5, R15] GDPR right-to-be-forgotten pseudonymization design — must land before R5 envelope schema is finalized. Industry standard is option (a): store stable opaque `actor_id` in audit; PII in separately-erasable lookup table; hash opaque ID into `event_hash`, not PII. (Promoted from Deferred.)
- [P1][Affects R15] Redaction policy: deny-by-default allow-list classification (only classified fields permitted) vs current block-list approach (classified fields redacted; unclassified fields pass through). Allow-list catches "new event type with secret-like field" cases at the schema gate. Plus: named owner for the classification list and event-type registration gate.
- [P1][Affects R13] Anchoring job IAM scope (least-privilege: read-only on audit_events, PutObjectRetention on anchor bucket only); CloudWatch alarm on anchor-gap duration; anchor-gap detection in verification report. Without these, an attacker who disables the anchor job leaves no detectable trace.
- [P1][Affects R9] Export endpoint controls: mandatory tenant-id predicate at resolver (not user-supplied), server-side max date range (e.g., 90 days per request), per-tenant rate limit, confirmation that `data.export_initiated` is control-evidence tier (currently in starter slate but tier not explicit).
- [P1][Affects R11] Postgres role separation infra plan: new Secrets Manager secret + Terraform plumbing for the second role; cross-schema transaction support for control-evidence writes; whether the same Yoga process serves both write-only-app and read-only-admin queries or splits.
- [P1][Affects R6] Strands Python runtime audit semantics: how cross-language control-evidence emission satisfies R6's two-tier guarantees when the agent runtime cannot transactional-rollback an S3 PUT (workspace file edits are S3-event-driven, not transactional with Postgres).
- [P1][Affects R13] Per-tenant Merkle anchoring cost projection at 4 enterprises × N tenants × cadence × 12-month retention. Object Lock objects accumulate un-deletably; consider global Merkle-tree-with-per-tenant-proof-paths as alternative that preserves tenant-scoped verification with single anchor stream.
- [P1][Affects R8] Events list states: loading, empty (especially for new tenants — a new tenant on a blank screen will question whether the feature works), error. Implementation will diverge without an explicit spec.
- [P1][Affects R8] Filter interaction model: single-select vs multi-select per filter; event_type's natural prefix grouping (`auth.*` / `agent.*` / `workspace.*`) — flat list vs grouped tree vs typeahead; applied-filter chips vs sidebar.
- [P1][Affects R8] Event detail drill-down: slide-over panel vs modal vs separate page; layout for the 22-field envelope (which fields prominent, which collapsed, how `payload_redacted_fields` surfaces); S3-payload async fetch loading + error states.
- [P1][Affects R9] Export interaction: trigger location (Events list export-current-filter vs separate Exports page with own filter); sync vs async delivery (large exports cannot be synchronous); progress/email-link UX; download queue.
- [P2][Affects R5, R10] Coexistence plan for existing `activity_log` and `tenant_policy_events` tables. activity_log overlaps the audit-events shape; tenant_policy_events is insert-only and explicitly regulator-visible (overlaps `user.*` and governance event types in R10). Migrate, deprecate, or leave as parallel surfaces.
- [P2][Affects R6] Same-transaction outbox vs transactional CDC for control-evidence write durability. Outbox: same-tx insert into `compliance.audit_outbox`, async drainer hashes + writes audit_events. CDC: logical replication straight into audit_events. Tradeoff is operational simplicity vs latency.
- [P2][Affects R6] System-actor identity scheme for non-user-triggered events (scheduled jobs, agent runtime auto-actions, S3-event-driven hooks). Synthetic actor scheme: `system:<service-name>` for Lambda handlers, `agent:<agent_id>` for agent-runtime emissions; non-null actor enforced at write-helper level.
- [P2][Affects R14] Governance event-type reservation: keep `policy.*` reservation as forward-compat for Phase 6, or drop until Phase 6 commits its own naming. `payload_schema_version` already provides the evolution lever R14 cites; reservation may ship dead surface area.
- [P2][Affects R12, R13] Auditor-independent verification path: signature/provenance for verification tooling; how an external auditor obtains read access to `compliance.audit_events` without Aurora credentials; whether verification tooling is open-source/runnable in auditor's environment.
- [P2][Affects R8] Events list columns/sort/pagination model. 22 envelope fields cannot all show as columns; default sort (newest-first vs oldest-first) affects discoverability; offset vs cursor vs virtual-scroll pagination at high event volume. Plus: admin-viewer health surface for write-failure visibility (gap markers, health indicator, integration with operator alerting).
- [P2][Affects R15] Log injection broader policy beyond field-level sanitization (added in R15): payload-level export-pipeline hardening (CSV interpolation safety, JSON metacharacter neutralization on render), rate-limited oversize-blob handling, payload S3 bucket access control.
- [P2][Affects R3, R10] If `activity_log` and `tenant_policy_events` are merged into `compliance.audit_events` (paired with the coexistence question above), what's the migration approach — preserve rows, regenerate envelope, hash-chain back-fill? Backfills are otherwise out-of-scope per Scope Boundaries; this is an explicit exception that needs its own integrity story.

### Deferred to Planning

- [Affects R5][Technical] What is the right write-path latency budget for audit events — synchronous write before action completes, or async write to a queue with eventual consistency?
- [Affects R5][Technical] Where do large event payloads (e.g., a full file diff for an AGENTS.md edit) get stored — inline in the audit log, in S3 with a key reference, or both depending on a size threshold?
- [Affects R6][Needs research] Which existing platform services need write-helper integration in the initial ship — every resolver, only the ones touching the starter event slate, or a phased rollout?
- [Affects R10][Needs research] What does "actor identity" look like for system-triggered events (e.g., scheduled jobs, agent runtime auto-actions) — a synthetic system actor identifier, or skipped entirely for v1?
- [Affects R7][Technical] Does the rename from System Workflows to Compliance require any data migration, or is the existing data simply abandoned during Phase 2?
- [Affects R13][Technical] What is the right anchoring frequency for Merkle roots — every N events, every X minutes, or both with whichever-comes-first? Trade-off is anchor-storage cost vs. window of unanchored exposure.
- [Affects R12, R13][Technical] How is verification surfaced operationally — periodic background job that alerts on chain break, on-demand admin-triggered verification with results in the UI, or both?
- [Affects R5][Technical] What is the inline payload size threshold above which payloads route to S3 with a key reference? Decision affects audit-table volume, query cost, and verification re-hash cost.
