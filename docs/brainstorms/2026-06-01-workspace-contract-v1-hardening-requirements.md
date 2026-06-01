---
date: 2026-06-01
topic: workspace-contract-v1-hardening
---

# Workspace Contract v1 Hardening

## Problem Frame

The workspace architecture now has a cleaner source model, but the product still
needs one explicit contract that ties together what humans see, what the agent
sees, what files mean after edits, and why a turn spent time syncing. Without
that contract, operators keep encountering the same confusion from different
angles: a Space looks like a plain settings form even when it has workflow
behavior, the rendered sandbox differs from the source tree, write-back policy is
unclear, and slow local turns are hard to diagnose.

Workspace Contract v1 should make the runtime and UI feel like one coherent
workspace while keeping backing storage split behind the scenes. The goal is not
to physically collapse S3 into one Agent-rooted tree in v1. The goal is to render
one legible tree to agents and users, route writes by provenance, make Space
configuration file-editable, keep live task state database-authoritative, and
surface enough timing to debug sync latency.

---

## Actors

- A1. Operator/user: inspects and edits Agent, Space, User, and Thread context
  through the product UI.
- A2. Agent: reads the rendered workspace, writes files, and uses tools to change
  structured workflow state.
- A3. Runtime hosts: AgentCore, desktop local Pi, and mobile local Pi; each must
  hydrate the same logical workspace contract.
- A4. Platform/API: validates manifests, enforces applied policy, regenerates
  projections, reconciles file writes, and records timing.
- A5. Planner/implementer: uses this document to plan a bounded implementation
  without inventing product behavior.

---

## Key Flows

- F1. Runtime workspace render
  - **Trigger:** A turn starts.
  - **Actors:** A2, A3, A4
  - **Steps:** The platform resolves Agent source files, the active Space, the
    acting User, and thread/goal state. The runtime hydrates a single coherent
    `/workspace` tree with Agent files at root, `Spaces/INDEX.md`, the active
    `Spaces/<space>/` folder, `User/`, and generated `Thread/` projections. Each
    writable file has provenance to an underlying source/destination.
  - **Outcome:** The agent sees one predictable tree and can tell where Agent,
    Space, User, and Thread context live.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Space manifest edit and apply
  - **Trigger:** A human or agent edits `Spaces/<space>/SPACE.md`.
  - **Actors:** A1, A2, A4
  - **Steps:** The platform parses typed frontmatter plus prose, validates the
    manifest, auto-applies low-risk descriptive fields, and requires explicit
    apply/approval for behavior/security fields. The UI renders read-only Space
    overview panels from the manifest/applied projection.
  - **Outcome:** Space behavior is visible and editable as markdown, while
    runtime enforcement uses a validated projection.
  - **Covered by:** R6, R7, R8, R9

- F3. Progress projection refresh
  - **Trigger:** A task/goal changes, a turn starts, or a user clicks
    "Refresh progress" in the info panel.
  - **Actors:** A1, A2, A4
  - **Steps:** The platform reads authoritative database state and regenerates
    generated Thread projections such as `Thread/PROGRESS.md`, `Thread/GOAL.md`,
    and `Thread/TASKS.md`. The UI and future turns see the refreshed projection.
  - **Outcome:** Agents get plain-text progress context without making markdown
    the source of task status truth.
  - **Covered by:** R10, R11, R12, R13

- F4. End-of-turn write-back and diagnostics
  - **Trigger:** A turn completes with changed runtime files.
  - **Actors:** A2, A3, A4
  - **Steps:** The runtime diffs files, maps each changed path to its provenance
    lane, validates path/size/secrets, persists allowed lanes to the correct S3
    destination, ignores/rejects generated read-only projections, and records a
    per-turn summary. The debug/details panel shows sync, hydration, and
    reconcile timing/counts.
  - **Outcome:** No changed file silently disappears or writes to an ambiguous
    destination, and slow turns can be diagnosed by phase.
  - **Covered by:** R14, R15, R16, R17, R18

---

## Requirements

**Rendered workspace contract**

- R1. V1 presents one coherent rendered runtime tree to all runtimes and UI
  inspectors, without requiring physical S3 storage to collapse into one
  Agent-rooted source tree.
- R2. The rendered runtime root contains Agent files directly, plus top-level
  `Spaces/`, `User/`, and `Thread/` folders.
- R3. The rendered runtime hydrates the active Space fully at
  `Spaces/<active-space>/` and represents other authorized Spaces through a
  lightweight `Spaces/INDEX.md` registry, not full folder hydration by default.
- R4. `User/` is an explicit folder in the rendered runtime. `User/USER.md`
  contains current-user personalization, and `User/memory/` contains
  user-scoped memory. User files are not merged into the Agent root.
- R5. Agent instructions must explicitly teach the runtime layout, including
  when to read `User/USER.md`, where the active Space lives, and where generated
  Thread projections live.

**Space manifest and workflow definition**

- R6. `Spaces/<space>/SPACE.md` is the editable markdown source for Space
  configuration and description. It uses typed frontmatter for structured fields
  and prose for human/agent-readable operating context.
- R7. The database may store an indexed/applied projection of `SPACE.md` for
  fast query and enforcement, but the conceptual authoring surface for Space
  configuration is the markdown manifest.
- R8. Descriptive `SPACE.md` changes can auto-apply after validation. Behavior,
  tool, bash, workflow, write-back, membership, budget, or security-sensitive
  fields require explicit apply or approval before runtime behavior changes.
- R9. Space workflow definitions live in Space files such as
  `Spaces/<space>/workflows/*.md`. Live task status and progress do not live in
  those Space definition files.

**Thread projections and refresh**

- R10. Live goal/task status remains database-authoritative. Markdown progress
  files are generated read-only projections for agent/reporting context.
- R11. `Thread/` is present in every rendered runtime workspace. It contains
  generated read-only projections for the current thread/turn such as
  `Thread/THREAD.md`, `Thread/GOAL.md`, `Thread/PROGRESS.md`, and
  `Thread/TASKS.md`.
- R12. Generated `Thread/*.md` projections are never accepted as authoritative
  write-back. Task/status changes must use the existing tool/UI/database paths.
- R13. The thread info panel exposes a "Refresh progress" action near the
  Progress section. It regenerates Thread projections from database state,
  refreshes the UI, emits an audit/log event, and does not change task status.

**Write-back lanes**

- R14. End-of-turn file write-back routes changed runtime paths by provenance:
  `Spaces/<active-space>/...` writes to Space source S3, `User/...` writes to
  User source S3, `Thread/notes/...` writes to thread-scoped artifact S3, and
  root Agent files write to Agent source S3.
- R15. V1 allows direct writes to durable Space working lanes such as
  `Spaces/<active-space>/CONTEXT.md`, `docs/`, `plans/`, `artifacts/`, and
  workflow files. Guidance should encourage `Thread/notes/` for raw findings and
  working notes that may later be compounded.
- R16. `Thread/notes/` is an editable thread-scoped working-notes lane. It
  auto-persists to thread-scoped S3 artifacts after secret scanning, path
  validation, and size limits. It is not Space configuration and is not
  authoritative for workflow status.
- R17. V1 does not introduce a general approval queue for workspace file writes.
  Sensitive Agent files such as `AGENTS.md` may persist if the actor is allowed
  to edit Agent workspace files, but changes must be validated, audited, visible
  in write-back summaries, and recoverable via version history.
- R18. Generated projections, runtime internals, unknown dangerous paths, inline
  secrets, and invalid manifests are rejected or marked non-persisted with a
  visible turn/write-back report.

**Sync telemetry and migration posture**

- R19. Per-turn diagnostics show workspace timing/counts in the existing turn
  details/debug surface before any separate analytics dashboard is built.
- R20. Sync diagnostics include at least source freshness check time,
  manifest/render time, hydration/copy time, SDK/session start time,
  model/tool-run time, reconcile/write-back time, files checked, cache hits,
  files hydrated, bytes copied, files changed, files persisted, files rejected,
  and files conflicted.
- R21. Slow workspace readiness should surface a warning with likely phase and
  counts, so a simple `USER.md` question can be diagnosed as sync, hydration,
  runtime boot, model latency, or reconcile.
- R22. V1 is a hard cutover for legacy workspace paths. Legacy `source/`,
  `workspace/`, and `workspace-archives/` S3 keys are migrated into canonical
  structure and then deleted. No long-lived compatibility stripping, archive
  prefix, or hidden legacy read path remains.

---

## Acceptance Examples

- AE1. **Covers R1-R5.** Given a Customer thread starts on desktop local Pi,
  when the agent runs `find . -maxdepth 2`, it sees Agent root files,
  `Spaces/INDEX.md`, `Spaces/Customer/`, `User/USER.md`, and `Thread/`, not the
  old singular `Space/` mount or a root-level merged `USER.md`.
- AE2. **Covers R6-R9.** Given an operator opens Settings -> Spaces ->
  Customer, when `SPACE.md` declares customer onboarding workflow, tools, skills,
  and review policy, the page renders those as read-only overview panels instead
  of only showing Name, Access, Status, and Description.
- AE3. **Covers R10-R13.** Given a task status changes in the database, when the
  user clicks "Refresh progress", `Thread/PROGRESS.md` is regenerated from DB
  state, the right info panel refreshes, and no task status changes occur as a
  side effect.
- AE4. **Covers R14-R18.** Given the agent writes
  `Thread/notes/findings.md`, `Spaces/Customer/docs/onboarding.md`, and edits
  `Thread/PROGRESS.md`, when the turn finalizes, the first persists to
  thread-scoped S3 artifacts, the second persists to Space source S3, and the
  generated projection edit is rejected/reported.
- AE5. **Covers R19-R21.** Given a turn spends 20 seconds before model start,
  when the operator opens turn debug details, the UI shows whether the time was
  spent in source freshness checks, manifest render, hydration/copy, SDK/session
  start, model/tool execution, or reconcile.
- AE6. **Covers R22.** Given an S3 key still exists under
  `tenants/<tenant>/spaces/<space>/source/CONTEXT.md`, when migration runs, it is
  moved to the canonical Space source path and the legacy key is deleted. Future
  readers do not silently normalize it.

---

## Success Criteria

- Operators can look at a Space and immediately understand its manifest,
  workflow, tools, skills, and runtime policy without inspecting hidden database
  rows.
- Agents receive one coherent workspace tree with clear Agent, Space, User, and
  Thread zones.
- Every writable runtime path has a known persistence destination or an explicit
  non-persisted outcome.
- Generated progress files remain reliable LLM/reporting context while the
  database remains authoritative for live task state.
- Slow turns can be diagnosed by workspace phase from the UI/debug surface.
- Planning can split the work into bounded implementation units without
  revisiting the product contract.

---

## Scope Boundaries

- Do not physically collapse all source S3 storage into one Agent-rooted tree in
  v1. Render one coherent tree and route writes by provenance instead.
- Do not hydrate all authorized Spaces fully into every turn by default.
- Do not build a general approval queue in v1.
- Do not build the full compounding/memory promotion workflow for
  `Thread/notes/` in v1.
- Do not replace database-authoritative live task/goal status with markdown.
- Do not keep compatibility stripping for legacy `source/`, `workspace/`, or
  `workspace-archives/` paths.
- Do not introduce a new workflow engine; Space workflow markdown defines
  configuration/structure, while existing task/goal machinery owns live state.

---

## Key Decisions

- **One rendered tree, split backing stores:** The user/agent experience should
  be coherent first; physical storage collapse is deferred to avoid turning this
  into a large migration.
- **`SPACE.md` is the Space manifest:** Space behavior should be visible and
  editable as markdown with typed frontmatter, with applied projections used for
  enforcement.
- **Space definitions vs. Thread state:** Space owns reusable workflow
  definitions; Thread owns generated live projections derived from database
  state.
- **Explicit `User/`:** User personalization is first-class and path-addressable,
  not merged into the Agent root.
- **`Thread/notes/` is the working-notes lane:** It gives agents a low-risk
  place for compounding findings without polluting Space configuration.
- **Hard cutover:** Because there are no active users, legacy path compatibility
  should be removed after migration rather than maintained.

---

## Dependencies / Assumptions

- Existing runtime hosts already hydrate rendered workspaces and can be extended
  to present the v1 tree consistently.
- Existing Goals/task database state remains authoritative and available for
  regenerating progress projections.
- Existing Settings workspace editor surfaces can render richer Space overview
  information and expose file-backed manifest editing.
- S3 source and thread artifact prefixes remain separate behind the scenes in
  v1, with provenance routing bridging the rendered tree to backing storage.
- S3 version history and audit/log events are sufficient v1 recovery/audit
  mechanisms for sensitive file writes such as `AGENTS.md`.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R6-R8][Technical] Define the exact typed frontmatter fields for
  `SPACE.md` and which fields are descriptive, apply-required, approval-required,
  or never file-controlled.
- [Affects R10-R13][Technical] Decide the exact generated projection set and
  refresh trigger points for `Thread/THREAD.md`, `Thread/GOAL.md`,
  `Thread/PROGRESS.md`, and `Thread/TASKS.md`.
- [Affects R14-R18][Technical] Define path validation, size limits, secret scan
  behavior, conflict behavior, and write-back summary format.
- [Affects R19-R21][Technical] Define telemetry schema and slow-workspace
  thresholds for desktop, mobile, AgentCore, and UI display.
- [Affects R22][Technical] Identify all current writers/readers still producing
  or accepting legacy `source/`, `workspace/`, or `workspace-archives/` paths
  before removing compatibility.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
