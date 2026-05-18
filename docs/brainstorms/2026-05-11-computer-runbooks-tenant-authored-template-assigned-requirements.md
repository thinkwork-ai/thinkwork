---
date: 2026-05-11
topic: computer-runbooks-tenant-authored-template-assigned
superseded_by: docs/plans/2026-05-12-001-refactor-computer-runbooks-as-agent-skills-plan.md
---

# Computer Runbooks: Tenant-Authored and Template-Assigned

> Superseded on 2026-05-12 by `docs/plans/2026-05-12-001-refactor-computer-runbooks-as-agent-skills-plan.md`. The decision that "runbooks reference skills as capabilities; they are not skills themselves" is withdrawn. Runbooks are now framed as complex Agent Skills using `SKILL.md`, `references/`, `assets/`, and optional `scripts/`.

## Summary

Computer Runbooks become tenant-authored, machine-executable recipes assigned to Computer templates for team segmentation, stored as structured frontmatter plus per-phase markdown, governed by field-level pin/live policy, and audited via the already-shipped DB run lifecycle. `packages/runbooks/` is repositioned as the seed-on-tenant-create source for platform-published starters that tenants own and edit after seeding.

---

## Problem Frame

The earlier `docs/brainstorms/2026-05-10-computer-runbooks-foundation-requirements.md` scoped runbooks to "ThinkWork-published only" with artifact-centric outputs, and treated the runbook source as a YAML+Markdown bundle living in a new `packages/runbooks/` package. Implementation is partway shipped: the DB schema (`tenant_runbook_catalog`, `computer_runbook_runs`, `computer_runbook_tasks`) is merged, the UIMessage parts (`data-runbook-confirmation`, `data-runbook-queue`) are merged, and the `packages/runbooks/` directory exists.

Two assumptions in that scope no longer match product intent. First, runbook authorship is a **tenant-facing primary flow** — enterprises author their own runbooks via the admin UI; the engineering team's Computer templates need engineering runbooks, the sales team's need sales runbooks, and ThinkWork ships starters, not the whole library. Second, runbook outputs are **outcome-flexible** — bug triage producing a Linear issue, an autonomous PR for a coding task, or any other terminal action — not just durable artifacts.

A third tension already lives in the repo: the Artifact Builder skill at `packages/workspace-defaults/files/skills/artifact-builder/` is a workspace-folder skill with progressive-disclosure references, and its own SKILL.md declares itself a "compatibility shim for the published ThinkWork runbooks." Today there are two parallel definitions for the same work — the FITA-shaped skill and the package-resident YAML runbook. That duality is what motivated reconsidering storage shape.

Additionally, the S3-event-driven orchestration substrate described in `docs/brainstorms/2026-04-25-s3-event-driven-agent-orchestration-requirements.md` is being deprecated, so the runbook architecture must not depend on it.

---

## Actors

- A1. **Tenant operator**: admin user who authors, edits, assigns, enables, and disables runbooks via the admin UI; can review tenant-wide run history.
- A2. **Elevated tenant role**: subset of operators with permission to edit pin-class fields (capability_roles, triggers, auto_select_threshold, template assignments).
- A3. **End user (Computer owner)**: paired human who invokes runbooks through Computer; sees Confirmation cards for auto-selected runs and Queue progress during execution.
- A4. **Computer runtime (Strands)**: executes phases sequentially, compiling phase guidance into Strands primitives bounded by the declared capability_roles allowlist.
- A5. **Admin UI**: renders the authoring surface (structured form + per-phase markdown editor), template-assignment controls, run history, and enable/disable affordances.
- A6. **ThinkWork platform**: ships the capability-role registry and skill catalog as code, and seeds tenant catalogs with starter runbooks on tenant creation.

---

## Key Flows

- F1. **Author a tenant runbook**
  - **Trigger:** A1 opens the admin Runbooks page and creates a new runbook (or edits an existing one).
  - **Actors:** A1 or A2 (depending on which fields are touched), A5.
  - **Steps:** Operator names the runbook (slug + display name), fills frontmatter in a structured form (description, category, phases enumeration, expected outputs, confirmation copy, capability_roles, auto_select_threshold), and authors per-phase guidance in a markdown editor. Pin-class field edits require elevated role and produce a change-history record. Save persists the content to tenant storage and rebuilds the catalog index synchronously.
  - **Outcome:** A draft or active runbook exists at tenant scope, ready for template assignment.
  - **Covered by:** R1, R2, R3, R5, R19, R20

- F2. **Assign a runbook to Computer templates**
  - **Trigger:** A1 picks which Computer templates a runbook applies to.
  - **Actors:** A1 (elevated; assignment is pin-class), A5.
  - **Steps:** Admin opens the runbook detail, toggles each Computer-template membership, and may flip an enabled/disabled state per assignment as a kill switch. Templates the runbook is not assigned to never see it in routing or invocation.
  - **Outcome:** A runbook is visible to a Computer iff its template has an enabled assignment.
  - **Covered by:** R7, R8, R9

- F3. **Auto-selected runbook with confirmation**
  - **Trigger:** A3 prompts Computer with substantial intent; the router finds a high-confidence match against an enabled runbook assigned to the Computer's template.
  - **Actors:** A3, A4, A5.
  - **Steps:** Router resolves the candidate; backend creates a run in `awaiting_confirmation` state; the Confirmation card renders with name, description, expected outputs, phase summary, and declared capability_roles; on approve the run advances to `queued`; on reject the run records `rejected` and Computer falls back to the normal ad hoc plan.
  - **Outcome:** Auto-selected work never executes without explicit user approval; rejections are audited.
  - **Covered by:** R11, R13, R14

- F4. **Explicit runbook invocation**
  - **Trigger:** A3 explicitly names the runbook ("run the renewal-prep runbook for Acme").
  - **Actors:** A3, A4.
  - **Steps:** Router resolves the named runbook and validates it is assigned and enabled for the Computer's template; the run is created in `queued` directly; the Queue UI renders phase progress.
  - **Outcome:** Users who know what they want skip redundant approval; the template-assignment gate still applies — explicit invocation cannot bypass it.
  - **Covered by:** R10, R12

- F5. **Run execution with audit**
  - **Trigger:** A run transitions to `queued`.
  - **Actors:** A4, A3, A5.
  - **Steps:** Runtime claims the run, snapshots the runbook content into `definition_snapshot`, expands phases into concrete tasks, and executes sequentially. The capability_roles allowlist bounds what skills the runtime may invoke during execution. Phase/task/status updates stream to the Queue UI. On completion, failure, or cancellation the terminal status and result persist. The audit record carries invoking user, Computer template, runbook version, and capability_roles actually exercised.
  - **Outcome:** Every run has an immutable record of what ran, who triggered it, and what capabilities it touched.
  - **Covered by:** R14, R15, R16, R17, R18

---

## Requirements

**Authoring and storage**

- R1. Tenants author runbooks via the admin UI. ThinkWork-published-only authorship is no longer a constraint; platform-published runbooks become starter content seeded into the tenant catalog on tenant creation.
- R2. Runbook content is stored at tenant scope (not per-agent, not per-Computer) as structured frontmatter plus per-phase markdown files. Frontmatter holds the typed catalog metadata; markdown holds long-form phase guidance.
- R3. The frontmatter is a typed schema (display name, description, category, triggers, expected outputs, phase IDs, capability_roles, auto_select_threshold, confirmation copy). Per-phase markdown is freeform agent-facing prose.
- R4. Saving a runbook rebuilds the denormalized `tenant_runbook_catalog` index synchronously. Filesystem-style content is the source of truth; catalog rows are derived for query.
- R5. The admin authoring surface combines a structured form for frontmatter (with field-level pin/live affordances) and a markdown editor for each phase. No separate skills tab, no visual drag-drop workflow builder.
- R6. `packages/runbooks/` is repositioned as the seed source for platform-published starter runbooks at tenant creation. Once seeded, tenants own and may freely edit the result.

**Template assignment and activation**

- R7. A runbook is visible to a Computer iff (a) its template is in the runbook's assignment set, and (b) the assignment row is enabled. No other activation surface (workspace presence, AGENTS.md routing, skill folders) activates runbooks.
- R8. Computer templates equal agent templates in v1; the assignment is an M:N relation between tenant runbook catalog rows and agent templates, with a per-assignment enabled boolean as a kill switch. No new template entity.
- R9. Disabling an assignment removes the runbook from routing on the next Computer turn without redeploy. In-flight runs against their `definition_snapshot` continue to completion.
- R10. The template-assignment gate applies to both auto-selection and explicit invocation. A Computer cannot invoke a runbook its template is not assigned to, even when the user explicitly names the slug.

**Routing, confirmation, and explicit invocation**

- R11. Auto-selected runbooks require a Confirmation card the user must approve before execution starts.
- R12. Explicit named invocation skips the Confirmation gate but still respects R10.
- R13. If no runbook confidently matches an assigned, enabled set, Computer falls back to a visible ad hoc task plan rather than forcing the prompt into the closest runbook.
- R14. Rejected runs and template-gate-blocked invocations are audited the same way successful runs are — an immutable record of intent, decision, actor, and timestamp.

**Execution and capability bounding**

- R15. Runs persist their lifecycle through the existing schema (`computer_runbook_runs` for run state, `computer_runbook_tasks` for expanded tasks). The Queue UI groups tasks by phase. Phases execute sequentially in v1; the schema preserves dependency fields for later parallel or state-machine execution.
- R16. The runtime compiles phase guidance into Strands primitives (main Computer agent, agents-as-tools, workflow tasks). Runbook authors declare capability_roles; they do not pick the runtime mapping.
- R17. The capability_roles declared in the runbook are an execution-time allowlist. The runtime must not invoke skills or tools outside the declared roles during a run, even when the Computer has access to them in other contexts.
- R18. `definition_snapshot` captures the runbook content at execution start. Editing or disabling the source runbook during a run does not alter the snapshot; the audit record is frozen.

**Field-level governance**

- R19. Frontmatter fields split into two classes. Pin-class: capability_roles, triggers, auto_select_threshold, template assignments. Edits require elevated role and produce a change-history record. Live-class: display name, description, confirmation copy, per-phase prose. Edits are operator-self-service.
- R20. The admin UI surfaces the class of each field; pin-class fields render with a governance affordance (e.g., lock indicator and change-log access).

---

## Acceptance Examples

- AE1. **Covers R7, R8, R10.** Given a runbook `bug-triage` is assigned only to the `engineering-pod` Computer template, when a user on a `sales-pod`-templated Computer prompts "triage this Linear bug," routing does not match the runbook and Computer responds with an ad hoc plan. An explicit "run the bug-triage runbook" prompt on the same Computer is rejected with an unauthorized-runbook outcome.
- AE2. **Covers R11, R14.** Given a high-confidence match against the `renewal-prep` runbook, when Computer responds, a Confirmation card renders; if the user rejects, the run row records `rejected` with rejecter and timestamp, and Computer falls back to chat without runbook execution.
- AE3. **Covers R10, R12.** Given the same `renewal-prep` runbook is assigned and enabled for the user's template, when the user says "run renewal-prep for Acme," execution starts directly with no Confirmation card.
- AE4. **Covers R13.** Given a prompt with no confident runbook match on the Computer's assigned, enabled set, when Computer responds, it generates a visible ad hoc task plan rather than forcing the prompt into the closest runbook.
- AE5. **Covers R15, R17, R18.** Given an active run, when the runtime executes a phase, it may invoke only skills covered by the runbook's declared capability_roles; an attempt to invoke an out-of-allowlist skill fails the task and writes a failure record. The `definition_snapshot` captured at run start does not change if the source runbook is edited mid-run.
- AE6. **Covers R9.** Given a runbook is currently routable for the engineering template, when an operator disables the assignment, subsequent Computer turns on engineering-templated Computers no longer route to the runbook; in-flight runs continue against their snapshot.
- AE7. **Covers R19, R20.** Given a non-elevated operator attempts to edit `capability_roles` or `auto_select_threshold`, the admin UI refuses and surfaces the elevated-role requirement. The same operator can edit display name, description, confirmation copy, and phase prose freely.
- AE8. **Covers R4, R6.** Given a tenant created on a fresh deploy, when the platform completes seeding, the tenant catalog contains the platform's starter runbooks as editable rows; the tenant operator can modify or delete them without affecting other tenants.

---

## Success Criteria

- An engineering team operator can, in the admin UI alone, author a bug-triage runbook, assign it to the engineering Computer template, and disable it via the kill switch without engaging ThinkWork engineering. The sales team's Computer template never sees this runbook.
- A user prompting Computer with a substantial request that confidently matches an assigned, enabled runbook sees a Confirmation card with name, description, expected outputs, phase summary, and capability_roles — and execution does not begin until they approve.
- An audit of any run shows the invoking user, the Computer template at the time, the runbook version exercised, the capability_roles actually used, and any pin-class field changes since the run started — without engineering involvement.
- A misauthored runbook can be removed from routing across all assigned templates in one operator action (disabling the catalog row or each assignment).
- The current parallel definitions for substantial work — Artifact Builder skill plus YAML runbook — collapse: runbooks reference skills as capabilities the runtime uses, not as duplicate sources of truth.
- `ce-plan` can proceed from this document without inventing the storage layout split, the assignment model, the run-state-machine semantics, the field governance classes, or the relationship between runbooks and the existing artifact-builder skill.

---

## Scope Boundaries

- Playbooks (human-facing strategy docs that may contain runbooks) — distinct concept; future brainstorm if needed.
- Cross-tenant runbook publishing or a marketplace — single-tenant authoring only.
- Parallel, fan-in/fan-out, or state-machine phase execution — sequential v1 only; schema preserves dependency fields for later.
- Visual drag-drop runbook builder — structured form plus markdown editor is the v1 authoring surface.
- S3-event-driven runbook execution — the substrate is being deprecated; runbooks must not depend on it.
- Replacing existing routines or scheduled-job infrastructure — adjacent area, not in scope.
- Runbook version-history viewer UI — `definition_snapshot` carries audit; a browsable history surface is later.
- Generic BI / app-builder / workflow-automation positioning — runbooks remain scoped to Computer's substantial-work surface.
- A new template entity distinct from `agent_templates` — Computer templates equal agent templates in v1.
- Runtime-side replacement of the existing Artifact Builder skill — the skill stays as a capability runbook phases use; deprecation is later, after at least one artifact-shaped runbook ships against it.

---

## Key Decisions

- **Tenant authorship is the primary flow, not a deferred extension.** Engineering and sales teams will author their own runbooks. The earlier "ThinkWork-published only" v1 scope is dropped; platform-published runbooks become starter content tenants own after seeding.
- **Computer templates are the team segmentation knob.** A runbook is visible to a Computer iff its template has an enabled assignment. No other activation surface activates runbooks. This is the structural difference from how skills work today (where workspace presence = active).
- **Storage shape is structured frontmatter plus markdown phases.** Frontmatter for the typed contract that routing and field governance consume; markdown for long-form phase guidance the agent reads progressively. Pure DB form would limit expressiveness; pure markdown would weaken the structured contract.
- **Filesystem-style content is source of truth; catalog row is derived.** Saving a runbook rebuilds `tenant_runbook_catalog` synchronously. The schema is preserved as a query index for catalog enable/disable and intent routing — not as the authoring substrate.
- **Field-level pin/live governance, not whole-runbook RBAC.** Some fields (capability_roles, triggers, auto_select_threshold, template assignments) require elevated role plus change history; others (display name, description, confirmation copy, phase prose) are operator-self-service. Avoids both extremes — frozen runbooks no one can edit, and unrestricted edits to the runtime's capability allowlist.
- **Runbooks reference skills as capabilities; they are not skills themselves.** Conceptual split preserved: skill = capability, runbook = recipe, workflow = orchestration model, playbook = human strategy. The artifact-builder skill stays as the capability artifact phases use; the runbook is the recipe that calls it.
- **Strands SDK is the execution backend.** Phases compile to Strands primitives (main agent, agents-as-tools, workflow tasks). Authors declare capability_roles; the runtime mapping is internal and may evolve.
- **The capability_roles allowlist is enforced at execution, not at authoring.** The runtime refuses out-of-allowlist tool invocations during a run. Authoring-time validation is best-effort UX.

---

## Dependencies / Assumptions

- The current runbook DB schema (`tenant_runbook_catalog`, `computer_runbook_runs`, `computer_runbook_tasks`) and UIMessage parts (`data-runbook-confirmation`, `data-runbook-queue`) are already shipped. This work reuses them; an M:N template-assignment table is the only schema addition the requirements demand.
- Computer templates equal agent templates in v1; `computers.template_id` references `agent_templates`. No new template entity.
- The S3-event-driven orchestration substrate is being deprecated. Any runbook dependency on `work/inbox/`, `work/runs/`, or canonical events from the 2026-04-25 S3-event brainstorm is removed from scope.
- The Artifact Builder skill at `packages/workspace-defaults/files/skills/artifact-builder/` stays as a skill the runbook runtime uses for artifact-producing phases. Its existing "compatibility shim for runbooks" framing aligns with this scope.
- Capability-role definitions and the runtime mapping from role to execution adapter live as code (TypeScript / Python), not as tenant-editable content.
- Single-tenant authoring is assumed; no cross-tenant authorship, sharing, or marketplace.
- The change-history mechanism for pin-class field edits is a new admin surface concern but not a new persistence pattern; it follows existing audit/log conventions.
- This document supersedes `docs/brainstorms/2026-05-10-computer-runbooks-foundation-requirements.md`. The earlier doc's product decisions about ThinkWork-only authorship, artifact-centric scope, and packages/runbooks/ as the authoring substrate are withdrawn.

---

## Outstanding Questions

### Resolve Before Planning

(None — all product decisions are resolved in this document.)

### Deferred to Planning

- [Affects R2, R4][Technical] Exact tenant-storage location for runbook frontmatter and phase content. Candidates include S3 at tenant scope, JSONB-with-phase-rows in Aurora, or a hybrid. Planning chooses based on admin-UI write path, read latency for routing, and consistency with how other tenant content stores today.
- [Affects R7, R8][Technical] Schema shape for the M:N template-assignment table — naming, indexes, and whether to attach assignment-scoped overrides (e.g., a template-specific override of auto_select_threshold) on the join row.
- [Affects R3, R5, R19][Technical] The frontmatter field enumeration and field-class assignments. Planning enumerates which exact fields belong to pin-class vs live-class, the elevated-role identity in the existing auth model, and the change-history record shape.
- [Affects R6][Technical] Seed-on-tenant-create mechanism for starter runbooks from `packages/runbooks/`. Whether tenants get a one-shot copy at creation, idempotent reseed on deploy, or both. Edge case: a tenant that has edited a starter runbook before a starter update ships.
- [Affects R13][Technical] Routing confidence thresholds for auto-selection vs ad hoc fallback. Conservative defaults plus tests against representative prompts.
- [Affects R16, R17][Technical] The capability-role registry and the runtime enforcement seam. v1 minimal set (research, analysis, artifact_build, validation), enforcement location in the Strands container, and the growth mechanism for new roles.
- [Affects R14, R18][Technical] Run-history admin surface. Default fields exposed, retention, and whether per-tenant export is v1 or follow-up.
- [Affects R10][Technical] User-facing UX when an explicit invocation hits the template-assignment gate. Friendly message, pointer to the operator who can change the assignment, fallback to ad hoc plan, or a combination.
- [Affects R15][Technical] Migration path for the in-flight runbook plan at `docs/plans/2026-05-10-003-feat-computer-runbooks-foundation-plan.md`. Which units are kept, which are reshaped, and whether the already-merged UI components need any change beyond data-source updates.
- [Affects R17][Needs research] How the existing skill_resolver and `chat-agent-invoke`'s `skills_config` interact with a per-run capability-role allowlist. Whether the allowlist is enforced by filtering the skill set the runtime registers at boot, by intercepting tool dispatch, or both.

---

## Next Steps

-> `/ce-plan` for structured implementation planning. The plan supersedes (or rewires the open units in) `docs/plans/2026-05-10-003-feat-computer-runbooks-foundation-plan.md`.
