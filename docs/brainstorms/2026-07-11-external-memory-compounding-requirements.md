---
date: 2026-07-11
topic: external-memory-compounding
supersedes: docs/plans/2026-07-04-003-feat-external-sourcing-v1-plan.md
---

# External Memory Compounding

## Problem Frame

ThinkWork memory currently learns primarily from direct thread conversations. That is too narrow to
become durable personal, team, or company knowledge: important customer context, policies,
commitments, and external facts already live in CRM, email, websites, and documents.

Live connector search remains useful for current operational detail, but it is the wrong memory
architecture. Agents should not have to rediscover institutional context at question time, and the
Wiki cannot compound knowledge that was never retained. ThinkWork needs a governed external-memory
pipeline that acquires evidence, extracts durable knowledge, resolves cross-source identity, retains
it in the correct Hindsight bank, compounds it within that scope, and builds ontology-governed Wiki
projections.

The product should borrow PromptQL's outcome-oriented experience — visible source hydration,
shared context, citations, and feedback — while keeping ThinkWork's AWS-native, inspectable workflow
and memory architecture. It must not depend on opaque background “magic,” ordinary-user data
stewardship, or indiscriminate copying of source systems into Hindsight.

---

## Actors

- A1. **User:** owns their Personal Memory Automation, source opt-ins, schedule, and personal bank.
- A2. **Personal Memory Automation:** plans and processes one user's authorized activity into their
  User Bank with an inspectable execution history.
- A3. **Operator:** configures Space and company memory workflows and governs the tenant Knowledge
  Model.
- A4. **Memory Operator:** future privileged steward who reviews opt-in promotion candidates from
  personal memory and authorizes copies into shared banks.
- A5. **Shared Memory Workflow:** operator-managed Space or company workflow that processes explicitly
  shared sources into the corresponding bank and Wiki projection.
- A6. **Source system:** Twenty CRM, Firecrawl, approved email, or Bedrock Knowledge Bases and their
  underlying documents.

---

## Key Flows

- F1. **Scheduled personal memory processing**

  - **Trigger:** The user's saved schedule fires.
  - **Actors:** A1, A2, A6.
  - **Steps:** Preflight ranks focus areas from bounded activity signals; saved source opt-ins and
    scope policy are applied; eligible evidence is acquired and normalized; ontology-aligned memories
    are retained to the User Bank; the bank is compounded; ambiguous or risky items are deferred; the
    run publishes an inspectable summary.
  - **Outcome:** Personal memory improves automatically without expanding source access or writing to
    shared banks.
  - **Covered by:** R1-R3, R4, R6, R8-R10, R19.

- F2. **Manual interactive personal run**

  - **Trigger:** The user selects Run now.
  - **Actors:** A1, A2, A6.
  - **Steps:** The same preflight produces a proposed plan; the workflow pauses for HITL review; the
    user adjusts focus areas, sources, and time ranges; approved work follows the same processing path
    as a scheduled run.
  - **Outcome:** The user can intentionally refresh a customer, topic, or source without creating a
    separate manual pipeline.
  - **Covered by:** R4, R5, R8-R10.

- F3. **Operator-managed shared compounding**

  - **Trigger:** A configured Space or company workflow runs manually or on schedule.
  - **Actors:** A3, A5, A6.
  - **Steps:** The workflow reads only explicitly shared sources; processes evidence into the selected
    Space or Tenant Bank; compounds that bank; resolves deterministic identities; sends ambiguous
    identities to the operator Resolution Queue; and compiles affected canonical Wiki pages.
  - **Outcome:** Shared knowledge grows through one authoritative processor per scope, with every step
    visible in the Workflow execution.
  - **Covered by:** R1-R3, R7-R8, R11-R16, R19.

- F4. **Entity resolution**

  - **Trigger:** New evidence refers to an entity not already linked through an exact source mapping or
    strong, non-conflicting identity key.
  - **Actors:** A3, A2, A5.
  - **Steps:** Deterministic matches resolve automatically; ambiguous candidates enter the Knowledge
    Model Resolution Queue with the matching evidence and proposed action; the operator links, creates,
    merges, splits, rejects, or defers; dependent shared processing resumes after resolution.
  - **Outcome:** Multiple users and sources contribute to one canonical customer identity and one
    shared Wiki Entity page.
  - **Covered by:** R12-R16.

- F5. **Document-derived memory**
  - **Trigger:** A selected Knowledge Base document is added, changed, or removed.
  - **Actors:** A3, A5, A6.
  - **Steps:** The full document remains in Bedrock Knowledge Bases for faithful retrieval; durable
    policy, procedure, entity, decision, effective-date, and exception knowledge is extracted into
    Hindsight; source citations remain attached; later document changes supersede or retract derived
    knowledge and refresh affected Wiki pages.
  - **Outcome:** Agents can both quote the original document accurately and use its durable meaning as
    compounded organizational memory.
  - **Covered by:** R17-R19.

---

## Requirements

**Memory sources and evidence**

- R1. V1 must support four Memory Source families through one product contract: Twenty CRM,
  Firecrawl web enrichment, user-approved email, and Bedrock Knowledge Bases.
- R2. A source system remains authoritative for its original records, while ThinkWork stores enough
  versioned evidence or source references to explain, replay, refresh, and retract every derived
  memory.
- R3. Every derived memory must preserve source identity, source version or timestamp, acquisition
  run, extraction recipe/model version, target scope, and lifecycle state through Hindsight and Wiki
  provenance.

**Automation and workflow ownership**

- R4. ThinkWork must provide one managed Personal Memory Processing workflow definition with a
  per-user Automation configuration for enabled sources, source boundaries, schedule, budget, and
  User Bank target; product upgrades must not require independently editing every user's definition.
- R5. Every personal run must begin with a preflight that proposes focus areas from bounded activity
  signals and explains why each area, source, time range, estimated volume/cost, and target scope was
  selected. A manual run must pause after preflight so the user can edit that plan before processing.
- R6. A scheduled personal run must execute automatically inside previously saved opt-ins and
  boundaries; it must defer rather than guess when an item would expand access, target a broader
  scope, or require ambiguous identity resolution.
- R7. Operators must manage separate Space and company memory workflows under Settings → Workflows;
  one authoritative workflow per shared scope prevents multiple user Automations from racing to write
  shared knowledge.
- R8. Every processing stage must appear in the Workflow execution with status, bounded input/output
  counts, redacted evidence, cost, errors, deferrals, and links to resulting memories, identity-review
  items, and Wiki changes. Runs must be resumable or replayable without silently duplicating output.

**Scope, privacy, and authority**

- R9. Personal Memory Automations write only to their owner's User Bank in V1. They cannot write to a
  Space or Tenant Bank or publish a shared Wiki change.
- R10. Personal external ingestion is opt-in per user and per source. Saved opt-ins define the maximum
  scheduled boundary; expanding that boundary requires an explicit user action.
- R11. Shared workflows may write only to their configured Space or Tenant Bank and may read only
  sources explicitly authorized for that scope. They receive no implicit permission to browse User
  Banks.

**Knowledge Model and entity resolution**

- R12. The operator-facing Ontology area must become **Knowledge Model**, with distinct Definitions,
  Identity, and Resolution Queue areas. Ordinary users are not responsible for tenant identity
  stewardship.
- R13. Definitions must describe entity and relationship types, facets, identity-key rules, source
  precedence, and external vocabulary mappings; the Identity registry must separately store actual
  canonical entities and their source/natural-key mappings.
- R14. Each real-world entity must have one stable ThinkWork-generated canonical identifier. Exact
  source mappings and strong, non-conflicting identifiers resolve automatically; fuzzy, conflicting,
  or multi-match candidates require operator resolution. Agent suggestions may rank candidates and
  explain matching evidence, but cannot commit an ambiguous mapping.
- R15. Unresolved evidence may still be retained and recalled in the User Bank, but it cannot enter a
  shared bank or shared Wiki until its identity is resolved. Unresolved shared-workflow items defer at
  item level rather than failing unrelated work.
- R16. A customer must compile as an ontology-backed Entity, not an ad hoc Topic. Shared Wiki Entity
  pages must upsert by canonical entity identifier so aliases, renames, and evidence from multiple
  users or sources cannot create duplicate customer pages.

**Documents, compounding, and Wiki**

- R17. Full documents must remain in Bedrock Knowledge Bases for passage retrieval, page-level
  citations, and multimodal fidelity; Hindsight receives a durable ontology-aligned projection rather
  than indiscriminate document chunks.
- R18. Document replacement, deletion, expiration, or supersession must update or retract its derived
  Hindsight memories and affected Wiki claims without removing unrelated corroborating evidence.
- R19. After successful ingestion, the workflow must compound only the targeted bank and then compile
  only eligible shared knowledge through approved ontology definitions into canonical Wiki pages.

---

## Acceptance Examples

- AE1. **Covers R1-R3, R11, R14, R16.** Given Twenty, Firecrawl, and a shared
  email source all refer to Acme using different names, when the company workflow completes, then the
  evidence maps to one canonical customer and one Wiki Entity page with source-specific citations.
- AE2. **Covers R4-R6, R8.** Given a user manually runs their Personal Memory
  Automation, when preflight proposes Acme and two other focus areas, then the run pauses, the user can
  remove one focus area and add an approved source, and the execution shows the resulting plan and
  processing evidence.
- AE3. **Covers R6, R10.** Given a scheduled personal run discovers activity in
  an email folder the user did not opt into, when the run executes, then that activity is excluded and
  reported without pausing or expanding access.
- AE4. **Covers R9-R11, R15.** Given a personal email produces a useful memory
  with an ambiguous Acme identity, when the personal run completes, then the user can recall it, no
  shared bank or Wiki receives it, and the ambiguity is not assigned to the ordinary user.
- AE5. **Covers R12-R16.** Given an operator sees “Acme,” “AcmeCorp,” and
  “Acme Corporation” in the Resolution Queue, when they link the records to one canonical entity,
  then dependent shared evidence resumes against that identity and the merge preview shows affected
  memories, graph relationships, and Wiki pages.
- AE6. **Covers R17-R19.** Given a policy PDF is replaced by a new edition,
  when the Knowledge Base sync and memory workflow complete, then exact passages remain retrievable
  from the new document, superseded requirements no longer appear as active memory, and the Wiki cites
  the current edition.
- AE7. **Covers R7-R8, R19.** Given two users have personal memories about the
  same customer, when the operator company workflow runs, then neither User Bank is read implicitly;
  only tenant-authorized sources are processed, and the execution identifies every write and Wiki
  change.

---

## Success Criteria

- A user can enable selected external sources, run an interactive memory refresh, and understand
  exactly why each focus area and resulting memory was processed.
- Scheduled personal memory improves without requiring routine user maintenance and without crossing
  the user's saved access or scope boundary.
- An operator can run one customer-brain workflow across all four source families and produce a
  single cited customer Wiki Entity page rather than source- or user-specific duplicates.
- Every shared claim can be traced to source evidence, processing run, target bank, canonical entity,
  and ontology definition, and can be refreshed or retracted.
- Planning can decompose the work into source-by-source tracer bullets without inventing ownership,
  approval, scope, identity, document, or trigger behavior.

---

## Scope Boundaries

### Deferred for later

- Slack and Microsoft Teams Memory Sources; their connector/channel product story remains governed by
  separate work.
- User Bank → Space Bank → Tenant Bank harvesting. The intended later model is an opt-in,
  agent-assisted **Memory Operator** workflow that reviews redacted promotion candidates and copies
  approved knowledge with provenance; shared workflows still do not browse raw User Banks implicitly.
- Tenant policy that overrides individual source opt-in for corporate accounts or regulated work
  sources; this requires a separate access-control and disclosure decision.
- Automatic cross-scope promotion based only on confidence or corroboration.
- Additional sources such as warehouses, product analytics, GitHub, Google Drive connectors, and
  Slack/Teams.
- Fully automatic fuzzy entity matching. Ambiguous identity remains operator-governed.

### Outside this product's identity

- Live connector search as the primary company-memory architecture.
- Dumping complete CRM tables, mailboxes, crawled websites, or arbitrary document chunks into
  Hindsight without selection and lifecycle rules.
- Replacing Bedrock Knowledge Bases with Hindsight as the full-document retrieval engine.
- Requiring ordinary users to maintain canonical identities, merge customer records, or clear a data
  stewardship queue.
- Allowing a personal Automation to write directly to shared banks or shared Wiki pages.
- Allowing an LLM to silently expand source access, resolve ambiguous identities, or authorize a
  scope-crossing promotion.

---

## Key Decisions

- **Supersede External Sourcing v1:** The July 4 plan's zero-credential public-research-first shape and
  custom research-run path are replaced by governed multi-source memory processing through
  Automations and Workflows.
- **Workflow-visible, not magical:** Manual and scheduled triggers use the same versioned workflow and
  execution ledger; manual is interactive, scheduled is automatic within saved policy.
- **Scope-specific processors:** Users own personal Automations; operators own Space/company
  Workflows; upward harvesting is explicitly deferred.
- **Four-source V1:** Twenty, Firecrawl, approved email, and Bedrock Knowledge Bases cover structured,
  web, communication, and document knowledge.
- **Canonical identity before Wiki:** ThinkWork owns a tenant canonical-entity surrogate key with
  source mappings and natural identity claims. Deterministic matches automate; ambiguity goes to the
  operator.
- **Knowledge Model product area:** Ontology definitions and operational entity identity are adjacent
  but distinct surfaces under one operator workspace.
- **Dual document representation:** Bedrock Knowledge Bases preserve full-document fidelity;
  Hindsight stores durable meaning used for compounding and Wiki enrichment.
- **PromptQL as product inspiration:** Adopt visible source hydration, shared context, citations, and
  feedback loops, not a leave-all-context-in-place memory architecture.

---

## Dependencies / Assumptions

- The Workflow control plane already supports manual and schedule trigger families, versioned
  definitions, inspectable runs/evidence, `waiting_for_human`, and approval/resume behavior.
- Hindsight remains the canonical user, Space, and tenant memory substrate.
- Current graph identity is unique only within an ingest run, and current tenant Wiki uniqueness is
  slug-based; neither is sufficient for cross-source canonical identity, so planning must treat the
  identity registry as a new product capability.
- Twenty, email, Firecrawl, and Bedrock Knowledge Bases have existing ThinkWork integration or product
  substrate, but planning must verify the precise read, checkpoint, permission, and change-notification
  seams for each source.
- The approved Business Ontology remains the governance contract for what shared entities,
  relationships, and Wiki facets may be compiled.
- Customer-scale planning must support roughly four enterprises, 100+ agents each, and multiple
  workflow templates without cloning independently maintained definitions per user.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1-R3, R8][Technical] Define the common Memory Source checkpoint, evidence-envelope,
  replay, redaction, and deletion contract, then map each of the four source adapters onto it.
- [Affects R4-R8][Technical] Decide how the managed workflow template and per-user/per-scope bindings
  are represented without duplicating versioned definitions.
- [Affects R12-R16][Technical] Design the canonical entity registry, source-identity uniqueness,
  natural-key claim model, merge/split history, and rebind behavior for existing graph/Wiki evidence.
- [Affects R17-R18][Needs research] Validate the cheapest reliable document-change and retraction path
  across Bedrock Knowledge Base sync state, Hindsight document updates, and Wiki provenance.
- [Affects R19][Technical] Define dirty-bank targeting, consolidation completion evidence, and the
  compile handoff so scheduled processing cannot report success before memory and Wiki state settle.
- [Affects R2-R3, R8][Technical] Choose retention periods and redaction/offload rules for workflow
  evidence snapshots, especially email and document content.

---

## Next Steps

→ `/ce-plan` for structured implementation planning. The plan should preserve the four-source product
contract while sequencing source adapters as independently verifiable end-to-end tracer bullets.
