---
date: 2026-05-08
topic: computer-generated-research-dashboard-artifacts
related:
  - docs/brainstorms/2026-05-06-thinkwork-computer-product-reframe-requirements.md
  - docs/brainstorms/2026-05-07-thinkwork-computer-on-strands-requirements.md
  - docs/brainstorms/2026-05-08-computer-thinkwork-ai-end-user-app-requirements.md
references:
  - https://www.perplexity.ai/products/computer
  - https://www.builder.io/blog/perplexity-computer
---

# Computer-Generated Research Dashboard Artifacts

## Problem Frame

ThinkWork Computer is becoming a long-running, governed work environment for research, orchestration, and personal work. The existing artifact model is useful for reports, plans, notes, and digests, but it does not yet express the most valuable output of some Computer threads: a private interactive surface the user can inspect, filter, and refresh.

The v1 product bet is not "generate arbitrary React apps." It is narrower and stronger: after a Computer thread performs live business research, it can produce a private **research dashboard artifact** that captures the analysis as an interactive, read-only app. The first proof is a LastMile CRM pipeline-risk dashboard that combines live CRM data with email/calendar engagement signals and external web research.

Perplexity Computer is a useful reference for the category: cloud-hosted, long-running, connector-backed agent work. Builder's critique highlights the product gap ThinkWork should avoid: opaque work with no live, inspectable feedback surface. ThinkWork's advantage should be that a Computer can produce an artifact the user can open immediately, trust through source trails, and refresh deterministically without re-running an open-ended agent loop.

---

## Actors

- A1. Computer owner: the human user who asks the Computer to investigate pipeline risk and later opens the dashboard artifact.
- A2. ThinkWork Computer: performs the initial research run, chooses the dashboard shape, records evidence, and produces the artifact plus refresh recipe.
- A3. LastMile CRM MCP: approved read-only source for opportunities, stages, activities, product lines, quantities, and amounts.
- A4. Email/calendar sources: read-only engagement context for contact recency, meeting momentum, unanswered threads, and upcoming interactions.
- A5. External web research: read-only company/account context such as news, hiring, funding, market movement, and public risk signals.
- A6. Dashboard artifact viewer: the end-user app surface that renders the generated dashboard and lets the user refresh it.

---

## Key Flows

- F1. Generate a pipeline-risk dashboard
  - **Trigger:** A1 asks the Computer to analyze pipeline risk.
  - **Actors:** A1, A2, A3, A4, A5
  - **Steps:** The Computer queries LastMile CRM for opportunities and related activity; supplements the analysis with email/calendar engagement and external web research; groups opportunities by stage; computes stale activity and product-line exposure; generates a private interactive dashboard artifact with charts, tables, source coverage, and a saved deterministic refresh recipe.
  - **Outcome:** A1 has a dashboard artifact that explains pipeline risk through CRM facts, engagement signals, and public context.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R9

- F2. Open and inspect the generated dashboard
  - **Trigger:** A1 opens the artifact from a Computer thread or artifacts view.
  - **Actors:** A1, A6
  - **Steps:** The viewer loads the generated dashboard snapshot; shows "as of" timestamps and source coverage; renders stage charts, stale-activity charts, product-line exposure, and a risk table; allows filtering and lightweight drilldown into evidence.
  - **Outcome:** A1 can understand and inspect the analysis without returning to raw CRM screens or reading a static report.
  - **Covered by:** R7, R8, R10, R11, R12

- F3. Refresh without re-running the agentic flow
  - **Trigger:** A1 chooses to refresh the dashboard.
  - **Actors:** A1, A3, A4, A5, A6
  - **Steps:** The artifact viewer re-executes the saved source queries, transforms, scoring rules, and constrained summary recipe; refreshes data, charts, stale flags, rollups, source coverage, and templated "what changed" sections; records a new refresh timestamp.
  - **Outcome:** The dashboard updates with fresh data while preserving the original dashboard shape and avoiding an open-ended LLM run.
  - **Covered by:** R13, R14, R15

- F4. Ask the Computer to reinterpret or change the dashboard
  - **Trigger:** A1 asks a question that requires new reasoning, a changed source set, or a changed dashboard shape.
  - **Actors:** A1, A2, A6
  - **Steps:** The viewer routes the request back to the Computer as a new thread/run; the Computer can explain surprising changes, add a source, change the risk lens, or generate a new version of the artifact.
  - **Outcome:** Open-ended reasoning remains explicit and auditable instead of hidden inside routine refresh.
  - **Covered by:** R16, R17

---

## Requirements

**Generated dashboard artifact**
- R1. The artifact is an interactive research dashboard generated from a Computer thread, not a generic app-builder output.
- R2. V1's anchor dashboard analyzes pipeline risk for LastMile CRM opportunities.
- R3. The initial dashboard groups opportunities by stage and exposes at least one stage-level risk view.
- R4. The dashboard shows stale activity by stage using CRM activity and email/calendar engagement signals where available.
- R5. The dashboard shows expected quantity and amount by product line for relevant opportunities.
- R6. The dashboard includes lightweight per-opportunity evidence sufficient to understand why an opportunity is flagged, without requiring a full case-file UI.

**Source grounding**
- R7. The dashboard visibly distinguishes CRM facts, email/calendar engagement signals, and external web research signals.
- R8. Every generated dashboard has source coverage and "as of" timestamps so the user can tell what data was used and when.
- R9. LastMile CRM MCP is the live CRM source for v1, assuming it exposes read-only opportunity, activity, product-line, quantity, and amount data.
- R10. Email/calendar sources are read-only in v1 and are used to improve relationship recency and meeting-momentum signals.
- R11. External web research is read-only in v1 and is used to add account/company context that the CRM may not contain.

**Viewer behavior**
- R12. The artifact opens as a private, individual-consumption dashboard inside the ThinkWork Computer experience.
- R13. The dashboard is read-only in v1; no CRM, email, calendar, or external-system mutations are available from the artifact.
- R14. The dashboard can refresh without re-running the whole agentic Computer flow.
- R15. Refresh re-executes saved source queries, deterministic transforms, risk scoring, rollups, charts, source coverage, and constrained templated summaries.
- R16. Refresh does not perform open-ended LLM reasoning by default.
- R17. If the user asks to reinterpret, add sources, change scoring logic, or explain surprising deltas, the artifact starts a new explicit Computer run rather than silently reasoning in the background.

---

## Acceptance Examples

- AE1. **Covers R2, R3, R4, R5.** Given the LastMile CRM MCP returns opportunities across several stages with product-line quantities, amounts, and activity history, when the Computer generates the dashboard, the user sees stage rollups, stale-activity views, product-line exposure, and a risk table.
- AE2. **Covers R7, R8, R10, R11.** Given an opportunity has stale CRM activity but recent email replies and an upcoming calendar meeting, when the dashboard flags risk, it distinguishes the CRM stale signal from the email/calendar engagement signal instead of collapsing them into one opaque score.
- AE3. **Covers R12, R13.** Given a user opens the generated dashboard, when they inspect opportunity rows and charts, the dashboard offers filtering and evidence drilldown but no buttons that update CRM, send email, create calendar events, or mutate external systems.
- AE4. **Covers R14, R15, R16.** Given the dashboard has a saved refresh recipe, when the user refreshes it, the artifact updates charts, rollups, stale flags, and templated "what changed" sections without starting a Computer agent run.
- AE5. **Covers R17.** Given the user asks "why did this account suddenly become risky?" or "add Slack chatter as a signal," when they submit that request, ThinkWork starts an explicit Computer run and links the result back to the artifact instead of hiding an LLM call inside refresh.

---

## Success Criteria

- A user can ask their Computer for pipeline-risk analysis and receive a private interactive dashboard that is more useful than a static report or CRM list.
- The dashboard earns trust by showing source coverage, timestamps, and enough evidence to explain risk flags.
- Refresh feels fast and predictable because it reuses a saved recipe rather than re-running an open-ended agent loop.
- The first proof demonstrates ThinkWork's differentiated value over a native CRM dashboard: cross-source context from CRM, email/calendar, and public web research.
- A planner can break implementation into artifact model, generation flow, viewer, refresh recipe, and source integration work without inventing product behavior.

---

## Scope Boundaries

### Deferred for later

- Mutating actions from the dashboard, including CRM updates, email send, calendar mutation, task creation, or follow-up automation.
- Slack/internal discussion as a pipeline-risk signal.
- ThinkWork memory as a first-class scoring signal, beyond any context the Computer already uses during the initial run.
- Shared/team dashboards, public links, collaborative comments, or dashboard permissions beyond the owning user's private access.
- Arbitrary user-authored app generation beyond research dashboard artifacts.
- Fully live dashboards that pull fresh data on every open.
- Background scheduled refresh.
- Rich version comparison between refreshes or dashboard generations.
- Advanced custom dashboard editing inside the viewer.

### Outside this product's identity

- A generic BI platform.
- A replacement for LastMile CRM's native reporting.
- A customer-facing app builder or website generator.
- A hidden autonomous agent that silently reinterprets business data on every refresh.
- A workflow automation surface for external-system writes in v1.

---

## Key Decisions

- **Research dashboard is the v1 app artifact shape:** The first generated app should be a private interactive analysis surface, not a generic React app generator.
- **Pipeline risk is the first proof:** The workflow is concrete: pull CRM opportunities, group by stage, inspect activity recency, and analyze quantities and amounts by product line.
- **Live CRM via LastMile CRM MCP:** V1 proves direct live-source work, not CSV upload.
- **Cross-source context is the differentiator:** Native CRM dashboards can cover CRM facts; ThinkWork should combine CRM with email/calendar and web research.
- **Read-only v1:** The first release proves insight and trust without taking on approval UX for external mutations.
- **Refreshable recipe, not full rerun:** Generated dashboards should save enough query/transform/scoring/narrative structure to refresh deterministically without an LLM.
- **Explicit reasoning boundary:** Reinterpretation, source changes, or scoring changes require a new Computer run.

---

## Dependencies / Assumptions

- LastMile CRM MCP exists or will exist as an approved tenant MCP server with read-only tools for opportunities, activities, product lines, quantities, and amounts. This exact tool contract was not found in-repo during the brainstorm and must be validated during planning.
- The Computer can access user-authorized email/calendar context in a read-only mode suitable for relationship recency and meeting-momentum analysis.
- External web research can be source-cited and bounded enough for account/company risk signals.
- The artifact viewer can serve a private interactive artifact to the owning user without creating a public or team-shared surface in v1.
- Deterministic refresh can be represented as a saved recipe/manifest that is auditable enough to explain what refreshed and what did not.

---

## Outstanding Questions

### Resolve Before Planning

(none)

### Deferred to Planning

- **[Affects R9][Technical]** Validate the LastMile CRM MCP tool contract and determine whether it exposes opportunity activity, product-line quantity, and amount data directly or requires multiple tool calls.
- **[Affects R10][Technical]** Determine the email/calendar read surface available to the Computer for v1 and how to avoid leaking private message content into the dashboard.
- **[Affects R11][Needs research]** Define acceptable external web research sources and citation rules for account/company risk signals.
- **[Affects R14, R15][Technical]** Define the saved refresh recipe format and how refresh execution is authorized, audited, and bounded.
- **[Affects R12][Technical]** Decide where the private interactive artifact is served from inside the Computer web app experience.

---

## Next Steps

-> /ce-plan for structured implementation planning.
