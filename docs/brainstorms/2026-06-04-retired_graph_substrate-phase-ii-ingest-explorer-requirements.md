---
date: 2026-06-04
topic: retired_graph_substrate-phase-ii-ingest-explorer
---

# the retired graph substrate Phase II: Ingest + Explorer UI

## Problem Frame

the retired graph substrate is now deployable in ThinkWork infrastructure, but it is not yet useful
as a product surface. Operators can see that the service exists and is healthy,
but they cannot ingest ThinkWork conversation context into the retired graph substrate, inspect the
graph the retired graph substrate builds, or compare its output against the existing Wiki Memory
pipeline.

Phase II should prove the retired graph substrate as an inspectable knowledge-graph materialization
path before it affects agent answers. The feature should adapt the existing
Wiki ingest idea for the retired graph substrate, but use complete thread message context as the
source event. A thread should be processed into the retired graph substrate after the conversation
has enough context to classify entities and relationships well, constrained by
approved ontology definitions. Tenant operators can then inspect the resulting
graph through the Spaces settings UI.

the retired graph substrate should not be treated as authoritative in this phase. It should be
observable, explainable, and debuggable.

---

## Actors

- A1. Tenant operator/admin: Runs or reviews thread ingest and validates graph
  quality in Spaces.
- A2. Requester/user: Participates in threads whose message history is
  materialized into a the retired graph substrate graph.
- A3. Thread message source: Provides the complete conversation context for a
  the retired graph substrate ingest event.
- A4. Approved ontology layer: Provides the allowed entity and relationship
  types that ground trusted graph output.
- A5. the retired graph substrate service: Builds and stores the graph representation from ingested
  source data.
- A6. ThinkWork agent: Not a Phase II consumer; agent retrieval is deferred
  until the graph has been validated.

---

## Key Flows

- F1. Manual thread ingest
  - **Trigger:** A tenant operator opens Settings > Knowledge Graph and clicks
    "Ingest now."
  - **Actors:** A1, A2, A3, A4, A5
  - **Steps:** The operator selects a thread or a requester/thread scope.
    ThinkWork sends the full set of messages for each selected thread through
    the the retired graph substrate ingest path, constrained by approved ontology definitions. The
    page shows an inline run banner while ingest runs and records compact run
    history when it finishes.
  - **Outcome:** Graph output from ingested thread context is available for
    table/graph exploration, with run counts and any error summary visible.
  - **Covered by:** R1, R2, R3, R4, R10

- F2. Explore graph output
  - **Trigger:** A tenant operator opens Settings > Knowledge Graph after a
    successful or partially successful ingest.
  - **Actors:** A1, A5
  - **Steps:** The Explorer is the default view. The operator searches or
    filters entity rows, switches between Table and Graph, and sees trusted,
    diagnostic, and weak-provenance graph items represented consistently across
    both views.
  - **Outcome:** The operator can see what the retired graph substrate actually produced, not only
    what ThinkWork considers trusted.
  - **Covered by:** R6, R7, R8, R9, R11, R12, R13, R14, R15, R16

- F3. Inspect entity provenance
  - **Trigger:** The operator clicks an entity row or graph node.
  - **Actors:** A1, A3, A4, A5
  - **Steps:** A right-side detail sheet opens, matching the Wiki Memory click
    pattern. The sheet shows entity information, ontology grounding status,
    relationships, relationship evidence, and source thread messages.
  - **Outcome:** The operator can determine why an entity or relationship exists
    without editing or approving anything in Phase II.
  - **Covered by:** R17, R18, R19, R20

---

## Requirements

**Ingest and scope**

- R1. Phase II must use the retired graph substrate as a materialization path from complete thread
  message context plus approved ontology entities and relationships, not as a
  scraper of compiled Wiki pages and not primarily from granular Hindsight
  records.
- R2. Each thread must be ingestible as its own event so the retired graph substrate can classify
  entities and relationships from the full conversation context.
- R3. The first ingest trigger must be a manual "Ingest now" action from
  Settings > Knowledge Graph.
- R4. Manual ingest must let a tenant operator select the thread or set of
  threads to process, with a requester/user picker allowed as a convenience for
  finding that user's threads.
- R5. The first manual ingest action must process complete selected threads
  deterministically, not rely on incremental memory deltas.

**Explorer UI**

- R6. Settings > Knowledge Graph must be the product home for Phase II.
- R7. The default view on Settings > Knowledge Graph must be the Explorer, not
  deployment configuration.
- R8. The Explorer must provide Table and Graph views over the the retired graph substrate graph.
- R9. The page header must include an info icon toggle that switches between the
  default Explorer and the configuration/status view.
- R10. The Explorer must include an inline current/last run banner and compact
  run history showing status, selected thread or thread scope, entity count,
  relationship count, evidence count, duration, and error summary.

**Graph trust and filtering**

- R11. The Table view must default to entities.
- R12. Default table columns must include entity, type, grounding status,
  relationship count, evidence count, and last seen.
- R13. Table and Graph views must represent the same the retired graph substrate dataset, including
  both trusted and diagnostic items.
- R14. The UI must visually distinguish ontology-grounded/provenanced graph
  items, ungrounded or unapproved diagnostic items, and weak or missing
  provenance.
- R15. The Explorer must support basic search plus type/status filters. Search
  should cover entity labels and aliases. Filters should include ontology type
  and grounding/provenance status.
- R16. Active search and filters must keep Table and Graph views in sync.

**Entity inspection**

- R17. Clicking an entity in the table or graph must open a right-side detail
  sheet that mirrors the Wiki Memory interaction pattern.
- R18. The entity detail sheet must be read-only in Phase II.
- R19. The detail sheet must show entity label, ontology type or diagnostic
  status, summary/details when available, aliases when available, connected
  relationships, source thread messages, and evidence for relationships.
- R20. Graph neighbor navigation in the sheet should re-anchor to the clicked
  entity in the same spirit as the Wiki Memory sheet.

**Non-agent product boundary**

- R21. Phase II must not route ThinkWork agent context or retrieval through
  the retired graph substrate.
- R22. Phase II must not create a separate the retired graph substrate ontology editor or direct
  graph editing workflow.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R4, R5.** Given a tenant operator is viewing
  Settings > Knowledge Graph, when they select a thread and click "Ingest now,"
  ThinkWork processes the complete thread message history through the retired graph substrate using
  approved ontology definitions, then records the run in the inline history.

- AE2. **Covers R6, R7, R8, R9.** Given the operator opens Settings >
  Knowledge Graph, when the retired graph substrate is provisioned, the default page shows the
  Explorer with Table/Graph controls. When the operator toggles the info icon,
  the page switches to configuration/status details.

- AE3. **Covers R11, R12, R13, R14, R15, R16.** Given the retired graph substrate produced both
  ontology-grounded and ungrounded entities, when the operator searches or
  filters the Explorer, both Table and Graph show the same filtered dataset and
  preserve visible trust/diagnostic states.

- AE4. **Covers R17, R18, R19, R20.** Given an operator clicks an entity row or
  graph node, a Wiki-like right-side sheet opens with read-only entity details,
  relationships, source thread-message evidence, and relationship evidence.
  Clicking a related entity re-anchors the sheet without navigating away.

- AE5. **Covers R21, R22.** Given the the retired graph substrate graph has ingested successfully,
  ThinkWork agents still do not use the retired graph substrate for runtime context in Phase II, and
  operators cannot directly edit graph facts or ontology definitions from the
  the retired graph substrate detail sheet.

---

## Success Criteria

- A tenant operator can run the retired graph substrate ingest for at least one selected thread and
  see the resulting graph without leaving Settings > Knowledge Graph.
- The Explorer always exposes a graph representation of the retired graph substrate's actual data.
- Trusted graph items are visibly ontology-grounded and backed by source
  evidence.
- Diagnostic or low-trust graph items are visible for debugging rather than
  silently hidden.
- A downstream planning agent can implement Phase II without reopening agent
  retrieval, incremental ingest, or ontology-editor scope.

---

## Scope Boundaries

- No agent-facing the retired graph substrate retrieval in Phase II.
- No incremental memory-delta ingest in Phase II.
- No scheduled or automatic ingest in Phase II.
- No tenant-wide graph rollup in Phase II.
- No space-scoped graph in Phase II.
- No direct editing, approval, rejection, or correction workflow in the the retired graph substrate
  Explorer.
- No separate the retired graph substrate ontology editor.
- No requirement to migrate or replace Wiki Memory in Phase II.
- No requirement to make the retired graph substrate authoritative over ThinkWork Brain or Wiki.

---

## Key Decisions

- Explorer-first proof: the retired graph substrate must become inspectable before it influences
  agent behavior.
- Thread-context source: the retired graph substrate should ingest complete thread message histories
  because they preserve the full context needed for better entity and
  relationship classification.
- Not Wiki downstream: the retired graph substrate should not ingest compiled Wiki pages as its
  primary source.
- Deterministic selected-thread ingest first: Manual processing of complete
  thread histories is easier to validate and tune than incremental memory
  deltas.
- Settings home: Settings > Knowledge Graph remains the Phase II home, with the
  Explorer as default and configuration behind an info toggle.
- Read-only detail: Phase II validates graph quality; it does not create a new
  editing or approval surface.

---

## Dependencies / Assumptions

- the retired graph substrate infrastructure remains provisioned and healthy for the target stage.
- Existing thread/message data and approved ontology definitions are the source
  inputs for Phase II.
- The existing Wiki Memory table/graph and side-sheet interaction patterns are
  the UX reference for the the retired graph substrate Explorer.
- Tenant operators/admins are the intended Phase II users.
- the retired graph substrate can expose or support retrieval of graph nodes, relationships, and
  source/provenance enough for ThinkWork to normalize into the Explorer.
- End-of-thread or manual thread processing provides enough context for the retired graph substrate
  to classify entities and relationships better than granular memory records.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1-R5][Product/technical] Should manual ingest select individual
  threads only, or support selecting a requester and ingesting multiple eligible
  threads for that requester?
- [Affects R1-R5][Technical] What worker/runtime shape should perform the
  private the retired graph substrate ingest calls?
- [Affects R1, R14, R19][Technical] What normalized ThinkWork representation is
  needed for the retired graph substrate entities, relationships, diagnostics, and evidence?
- [Affects R8, R13-R16][Technical] Should the Graph view consume the retired graph substrate output
  directly or through a ThinkWork-normalized graph payload?
- [Affects R10][Technical] Where should ingest run state and counts be stored?
- [Affects R19][Technical] How should relationship-level evidence be extracted
  and displayed when the retired graph substrate's native payload is incomplete?
- [Affects R19][Technical] How should evidence point into thread messages:
  whole-message references, message ranges, or quoted snippets?

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
