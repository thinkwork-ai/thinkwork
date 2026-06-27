---
date: 2026-06-26
topic: thnk-82-structured-result-json-render
linear_issue: THNK-82
---

# Structured Result Presentation with json-render

## Problem Frame

ThinkWork agents can now emit validated `data-json-render` Thread UI parts, but
the behavior is still framed as an optional compact UI surface. Agents continue
to receive structured data, inspect it, and flatten it into prose or markdown
tables even when a bounded UI would be easier to scan, compare, and act on.

THNK-82 should make structured-result presentation an agent habit. After a tool
or reasoning step produces a result set, the agent should run a presentation
pass: inspect the shape of the answer, choose `emit_json_render_ui` when the
allowed catalog can express the result clearly, and fall back to prose when UI
would add friction.

The v1 exemplar suite is not one card. It must cover Work Items, agent-authored
user questions, and approval/review queues together, because those represent
the three most important result-presentation moments: scanning work, answering
or reviewing agent questions, and operating a decision queue.

---

## Actors

- A1. End user: Reads Thread answers and acts on structured results.
- A2. ThinkWork agent: Chooses between prose and generated UI during final
  presentation.
- A3. Host runtime: Exposes and validates `emit_json_render_ui` when the agent
  has the Thread json-render capability.
- A4. Web Thread renderer: Displays validated generated UI inline.
- A5. Mobile or unsupported client: Reads the required fallback content.
- A6. Planner/implementer: Converts this product behavior into runtime prompts,
  reusable guidance, tests, and catalog support.

---

## Key Flows

- F1. Present a Work Item result set
  - **Trigger:** A tool or agent step returns multiple similar Work Items or
    issue-like records.
  - **Actors:** A1, A2, A3, A4, A5
  - **Steps:** The agent inspects the records, identifies shared fields such as
    title, status, owner, priority, blocker, or due date, and chooses generated
    UI when those fields form a scan-friendly list or table. The agent includes
    concise fallback lines for non-web clients. If only one tiny item or a
    narrative explanation matters, it answers in prose.
  - **Outcome:** The user can scan work state faster than they could in a
    markdown table, without losing readable fallback text.
  - **Covered by:** R1, R2, R3, R7, R8, R9

- F2. Present agent questions without replacing blocking HITL
  - **Trigger:** The agent needs to show multiple questions, summarize answered
    questions, or present a non-blocking question set for review.
  - **Actors:** A1, A2, A3, A4, A5
  - **Steps:** The agent first decides whether it needs to block on one user
    decision. If yes, it uses the existing question mechanism rather than
    generated UI. If the question set is informational, non-blocking, already
    answered, or part of a reviewable result collection, the agent may use
    json-render to make the question states easy to scan.
  - **Outcome:** Generated UI improves question review without confusing or
    bypassing the existing blocking-question path.
  - **Covered by:** R1, R4, R7, R8, R9

- F3. Present an approval or review queue
  - **Trigger:** The agent returns multiple approvals, review items, pending
    decisions, or queue entries.
  - **Actors:** A1, A2, A3, A4, A5
  - **Steps:** The agent groups the queue into a compact UI that surfaces item
    identity, state, recommended action, and relevant rationale. Display-only
    queues remain valid. If an item includes durable actions, those actions use
    the existing validated action boundary and never arbitrary callbacks.
  - **Outcome:** The user can review and act on a queue without parsing a long
    prose answer, while safety boundaries remain intact.
  - **Covered by:** R1, R2, R5, R6, R7, R8, R9

---

## Requirements

**Agent presentation behavior**

- R1. Agents with `emit_json_render_ui` available must run a presentation pass
  before final response when the answer contains structured results.
- R2. Agents should prefer generated UI when the answer is primarily a
  homogeneous list, table-like row set, status collection, checklist,
  comparison, timeline, Work Item set, or review queue where scanning matters.
- R3. Work Items and Linear-like issue lists are a v1 must-cover result shape.
  The presentation should surface the fields users naturally scan: title,
  status, priority, owner or assignee, blocker/risk state, due date or recency,
  and concise rationale when available.
- R4. Agent-authored user questions are a v1 must-cover shape, but generated UI
  must not replace the existing blocking question primitive. Use generated UI
  for non-blocking question sets, answered-question summaries, and reviewable
  question collections; use the blocking question path when the turn should
  pause for a single required answer.
- R5. Approval and review queues are a v1 must-cover shape. Display-only queue
  UI is valid; actionable queue UI must follow the existing durable action
  boundary.
- R6. Generated UI actions, when present, must remain bounded to recognized
  host-validated action descriptors. The agent must not invent callbacks,
  browser effects, URLs, scripts, imports, or arbitrary tool execution through
  generated UI.
- R7. Prose remains the correct fallback when the answer is narrative, too small
  to benefit from UI, unsupported by the catalog, too open-ended, or clearer as
  direct text.
- R8. Agents must call `emit_json_render_ui` for generated UI. They must not
  emit UI JSON in markdown fences, prose, legacy `_type` payloads, or other
  untrusted text forms.
- R9. Every generated result UI must include useful mobile fallback content: a
  title, summary, and enough lines for non-web clients to understand the result.

**Reusable guidance and tests**

- R10. The platform must provide reusable guidance that teaches the structured
  result presentation pass and the prose fallback decision.
- R11. The guidance must include examples for Work Items, agent questions,
  approval/review queues, plus supporting examples such as deployment evidence,
  evaluation runs, connector records, and search results.
- R12. Runtime/prompt tests must cover choosing generated UI for structured
  result cases without the user explicitly asking for json-render, and choosing
  prose when UI would be forced or unsupported.

**Catalog fit**

- R13. Planning must verify that the current json-render catalog can express
  useful Work Item lists, agent question sets, and approval/review queues
  without awkward composition.
- R14. If the current catalog cannot express those v1 shapes cleanly, add only
  bounded components or domain compositions for those common result
  presentations.
- R15. Do not add arbitrary agent-authored React, CSS, callbacks, imports,
  scripts, remote fetches, or tenant-authored runtime components to satisfy
  structured result presentation.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R8, R9.** Given an agent has
  `emit_json_render_ui` available and a tool returns eight Work Items with
  status, owner, and priority, when the agent responds, then it emits a compact
  json-render result UI with a readable mobile fallback instead of a markdown
  table.
- AE2. **Covers R1, R4, R7.** Given the agent needs one blocking clarification
  before continuing, when it asks the user, then it uses the existing blocking
  question path rather than generated UI.
- AE3. **Covers R1, R4, R8, R9.** Given the agent summarizes several answered
  user questions from a prior run, when the answer is mostly a question-state
  collection, then it may use json-render with fallback lines showing the
  question, selected answer, and current state.
- AE4. **Covers R1, R5, R6, R8.** Given an agent returns a review queue with
  approve/reject affordances, when generated UI is emitted, then action ids
  match bounded durable action descriptors and unsafe or unknown actions are
  rejected.
- AE5. **Covers R7.** Given the result is a short narrative answer with two
  facts and no meaningful scanning need, when the agent responds, then it uses
  normal prose and does not force a generated UI part.
- AE6. **Covers R10, R11, R12.** Given runtime guidance and tests are updated,
  when a structured result fixture is evaluated, then the agent is guided to
  choose `emit_json_render_ui` without the user naming json-render.

---

## Success Criteria

- Structured Thread answers become easier to scan for the most important v1
  shapes: Work Items, agent questions, and approval/review queues.
- Agents choose generated UI intentionally based on result shape, not because a
  blanket transformer rewrites their final text.
- Mobile and unsupported clients remain readable through fallback content.
- Planning can proceed without re-deciding whether THNK-82 is a presentation
  policy, a universal post-processor, or an arbitrary UI expansion.

---

## Scope Boundaries

- Do not build a server-side blind post-processor that rewrites arbitrary
  assistant text into UI after the fact.
- Do not auto-convert every answer into generated UI.
- Do not replace the existing blocking user-question path with json-render.
- Do not require every structured result to have durable actions.
- Do not introduce arbitrary agent-authored React, CSS, browser callbacks,
  scripts, imports, or remote fetches.
- Do not build a broad generic data-grid/report-builder product in THNK-82.
- Do not require native mobile json-render rendering; mobile fallback is
  sufficient for this work.

---

## Key Decisions

- **Use a v1 exemplar suite, not one primary example.** Work Items, agent
  questions, and approval/review queues all matter enough to define the
  behavior together.
- **Keep generated UI intentional.** The agent makes a presentation choice after
  inspecting the actual result shape; no automatic text-to-UI rewrite.
- **Preserve blocking-question semantics.** json-render may present question
  collections, but a turn that needs to pause for one answer should use the
  existing blocking question mechanism.
- **Allow display-only generated result UI.** Actions are valuable for review
  queues, but structured result presentation should not require mutation
  authority.

---

## Dependencies / Assumptions

- THNK-77 establishes `data-json-render` and the json-render/shadcn Thread
  foundation.
- THNK-78 establishes explicit `emit_json_render_ui` runtime emission with
  required fallback content.
- THNK-81 establishes the durable action boundary for Work Item status updates
  and approval/review interactions.
- The current catalog already includes domain entries for task review,
  workflow status, key/value lists, forms, analytics display, and upstream
  shadcn primitives; planning must verify whether those are sufficient for the
  v1 exemplar suite or whether bounded result components are needed.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R13, R14][Technical] Decide whether Work Item lists and question
  sets should be expressed with existing primitives/domain compositions or with
  a small bounded result-list component.
- [Affects R10, R11][Technical] Decide where reusable guidance should live:
  runtime prompt policy, workspace-default skill content, tenant catalog skill,
  or a combination.
- [Affects R12][Technical] Decide the best prompt/runtime test fixtures for
  positive generated-UI selection and prose fallback selection.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
