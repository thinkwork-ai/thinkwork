---
date: 2026-05-14
topic: finance-analysis-pilot
---

# Finance Analysis Pilot — Computer Attachments + Anthropic Skill Lift

## Summary

Ship a finance pilot on Thinkwork Computer for a specific prospect: customer uploads internal Excel financial statements, Computer responds with financial analysis powered by a narrow set of skills lifted and adapted from `anthropics/financial-services`. Pilot scope (one prospect, one workspace), not a finance vertical investment.

---

## Problem Frame

Anthropic shipped `anthropics/financial-services` — a Claude-plugin-format bundle of finance agent templates, skills, MCP connector refs, and Managed Agent cookbooks — and announced it as the productized version of "AI for financial services." A specific Thinkwork prospect has asked, in roughly contemporaneous timing, to "perform financial analysis on a bunch of Excel spreadsheets, internal financial statements, etc." The prospect has not named a specific deliverable, a competitor they've tried, or a defined workflow; their request is exploratory.

Thinkwork is in a fortunate position structurally: the `agentskills.io` adoption brainstorm (`docs/brainstorms/2026-05-12-agentskills-contract-and-portability-requirements.md`) and the active runbooks-as-Agent-Skills plan (`docs/plans/2026-05-12-001-refactor-computer-runbooks-as-agent-skills-plan.md`) have already put the platform on a path where Claude-compatible skill content can land with at most one translation step. The runtime (Strands on AgentCore), the workspace install model (`workspace/skills/<slug>/`), the sub-agent shape (FAT-folder routing), and the audit log (Compliance event log) are all in flight or shipped.

What is *not* in place is the path from "operator drops an Excel file in Computer's chat" to "agent reads it, applies financial-analysis skills, returns analysis with chart/table artifacts." Today, `apps/computer/src/components/ai-elements/prompt-input.tsx` has no attachment surface, the financial-analysis skill content does not exist in Thinkwork's skill catalog or any tenant workspace, and the prospect-validation loop ("does this actually feel useful to a finance person on their own data?") has not been run. The pilot exists to close that gap for one specific prospect, on the smallest credible surface, while exercising the Claude-to-Thinkwork skill translation path that the platform has already committed to.

---

## Actors

- A1. **Prospect end-user**: a finance-team member at the prospect company. Uploads their own Excel financial statements into Computer; asks questions in natural language about ratios, trends, anomalies, or model integrity; consumes the response in chat (text + chart/table artifacts).
- A2. **Thinkwork operator**: a member of the Thinkwork team (or a tenant admin at the prospect) who provisions the prospect's workspace, installs the lifted skills, runs the demo, and observes audit logs.
- A3. **Computer agent**: the Thinkwork Computer Strands agent running in the prospect's tenant; handles the chat, activates the financial-analysis skills based on prompt + attachment context, calls sub-agents if needed, and renders output.

---

## Key Flows

- F1. **Upload-and-analyze (golden path)**
  - **Trigger:** A1 attaches one or more Excel files in Computer's prompt input and asks a question (e.g., "what are the trends in operating margin?").
  - **Actors:** A1, A3
  - **Steps:**
    1. A1 drags or selects Excel files in Computer chat
    2. Files are stored where the Strands runtime can read them as workspace context
    3. A3 sees the attached files in its context and the prompt
    4. A3 activates one or more financial-analysis skills based on prompt intent + content shape
    5. A3 reads the files, performs analysis, and responds with text + tables/charts in Computer's artifact substrate
    6. A1 reads the response in chat and either accepts or asks a follow-up
  - **Outcome:** A1 has a credible, on-their-own-data financial analysis they could plausibly use in their job; A2 has a recordable demo moment.
  - **Covered by:** R1, R2, R3, R5, R6, R7, R8

- F2. **Provisioning the pilot workspace**
  - **Trigger:** A2 prepares a prospect tenant for the pilot demo.
  - **Actors:** A2
  - **Steps:**
    1. A2 creates or selects a tenant workspace for the prospect
    2. A2 installs the pilot skill bundle (the lifted+adapted financial-analysis skills) into that workspace
    3. A2 verifies a Computer template is available with the right skills active
    4. A2 runs a smoke check with a sample statement to confirm activation and output quality
  - **Outcome:** Workspace is ready for A1 to engage; activation is observable in the audit log.
  - **Covered by:** R4, R9, R10

- F3. **Audit & review**
  - **Trigger:** After a session, A2 (or compliance) reviews what the agent did.
  - **Actors:** A2
  - **Steps:**
    1. A2 opens the Compliance event log filtered to the prospect tenant
    2. A2 sees: file uploads, skill activations, sub-agent calls, output artifacts
    3. A2 can re-open the session and trace what happened end-to-end
  - **Outcome:** A2 can answer "what did the agent do, on what data, and when" without manual reconstruction.
  - **Covered by:** R11, R12

---

## Requirements

**Attachments in Computer**
- R1. Computer's prompt input surface accepts file attachments from the operator-facing UI, with explicit support for Excel (`.xlsx`) and CSV; PDF support is desirable but not blocking for the pilot.
- R2. Attached files are made available to the Strands runtime such that an active skill can read their contents during the same agent turn. The mechanism is not prescribed here, but the file's bytes (or a derived structured representation) must be reachable from the skill's perspective.
- R3. The attachment surface gives the operator clear feedback when a file is received, when it is being processed, and when it is available to reference in conversation.

**Skill content lift and adaptation**
- R4. A pilot skill bundle is produced by lifting selected skills from `anthropics/financial-services/plugins/vertical-plugins/financial-analysis/skills/` and adapting them into Thinkwork's `SKILL.md` shape per the `agentskills.io` contract.
- R5. The initial lift narrows to statement-analysis-relevant skills: 3-statement model, Excel audit, and a Thinkwork-authored ratios/trends/anomaly skill targeted at "analyze internal financial statements." Comps, DCF, LBO, and pitchbook-authoring skills are not included in the pilot.
- R6. Adapted skills carry forward Anthropic's domain content (methods, definitions, step structure) but live as native Thinkwork skill directories that activate via workspace presence.

**Computer agent behavior**
- R7. With the pilot skills installed in a tenant workspace and an Excel file attached, Computer's response includes analysis grounded in the file contents — not generic financial commentary written without reading the data.
- R8. Output renders in Computer's existing artifact substrate: markdown body, tables, charts (per the JSX/shadcn substrate decision), inline references to specific values from the uploaded file. No Excel- or PowerPoint-authored output artifacts in pilot scope.

**Workspace and pilot operations**
- R9. The pilot skill bundle can be installed into a prospect tenant's workspace by a Thinkwork operator without code changes to the platform.
- R10. The pilot supports at least one prospect tenant end-to-end; multi-tenant pilots are a follow-on if the first lands.

**Audit and compliance**
- R11. File uploads, skill activations, and output artifacts produced during a pilot session are recorded in the Compliance event log already in flight.
- R12. An operator can re-open a pilot session and inspect what the agent did, in what order, on which data.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R7, R8.** Given a prospect operator has the pilot workspace open and a 3-statement Excel file on their desktop, when they drag the file into Computer's prompt input and ask "what stands out in the income statement trend?", Computer responds within the chat with prose analysis that names specific line items, period-over-period deltas, and at least one chart or table referencing the actual figures from the uploaded file — not a generic explanation of income statements.
- AE2. **Covers R4, R5, R6.** Given the Anthropic `financial-analysis` skills exist in upstream and the pilot bundle has been built, when an operator inspects the pilot bundle in a prospect workspace, they find Thinkwork-shaped skill directories (`SKILL.md` + supporting files) that retain the domain content of Anthropic's `3-statement-model.md` and `audit-xls.md`, plus a Thinkwork-authored statement-analysis skill, with no skills carried over for comps, DCF, LBO, or pitchbook authoring.
- AE3. **Covers R11, R12.** Given a pilot session has completed, when an operator opens the Compliance event log for the prospect tenant, they can identify which files were uploaded, which skills activated, and what artifacts were produced, in chronological order, and can re-enter the session detail to trace it.

---

## Success Criteria

- **Prospect outcome:** the prospect's end-user uploads their own internal financial statements during a guided demo and reaches a moment of "this is useful on my data" within that session — qualitative, recorded as operator observation, not a numeric SLA.
- **Platform outcome:** the path from "Claude plugin skill markdown" to "Thinkwork workspace skill that activates and runs" is exercised end-to-end for at least three skills, validating the `agentskills.io` translation path in practice (not just in design).
- **Handoff outcome:** a downstream planner can take this brainstorm and plan implementation without needing to invent attachment UX behavior, skill scope, agent output shape, or what "in scope for the pilot" means.

---

## Scope Boundaries

- The other nine Anthropic finance agents (Pitch Builder, Meeting Preparer, Earnings Reviewer, Model Builder, Market Researcher, Valuation Reviewer, GL Reconciler, Month-End Closer, Statement Auditor, KYC Screener) — pilot is one prospect, one shape; the others are not part of v1 even if customer asks adjacent questions.
- Investment-banking workflows (pitchbook authoring, comps, LBO, DCF) — different prospect class; explicitly excluded from the pilot skill lift.
- KYC, AML, and compliance-screening agents — excluded.
- External financial data MCP connectors (FactSet, Moody's, S&P Capital IQ, PitchBook, Daloopa, Morningstar, etc.) — the prospect brings their own data; no third-party data connector contracts in pilot scope.
- ERP MCP connectors (NetSuite, SAP, QuickBooks) — customer drops Excel exports manually in v1; live ERP integration is a follow-on if the pilot succeeds.
- Excel and PowerPoint *output* authoring (xlsx-author / pptx-author skills) — response stays inside Computer's existing artifact substrate; Excel output is a likely v1.5 if the prospect specifically demands it.
- The Microsoft 365 add-in deployment path — different deployment surface, not in pilot.
- A general marketplace install UX for templates (the Thinkwork analog of `claude plugin install`) — useful eventually, not on the pilot's critical path.
- API-level parity with Anthropic's `/v1/agents` Managed Agents API — Thinkwork's AgentCore-Strands runtime fills the same role.
- Generalizing this work into a multi-vertical "industry pack" abstraction — finance pilot only; healthcare/legal/ops verticals are not in scope.
- Validating the prospect's competitive landscape (BlackLine, FloQast, Trintech, etc.) — the pilot is exploratory; we are not designing against named incumbents in v1.

---

## Key Decisions

- **Pilot, not vertical.** Treat this as one-prospect demo work, not the beginning of a finance vertical investment. Reason: the prospect's request is exploratory and there is no validated competitive thesis; over-investing on speculation creates carrying cost across templates we may never ship.
- **Lift Anthropic skill content rather than re-author from scratch.** Reason: the content is open-source, written for the exact use case, and lifting it exercises the `agentskills.io` translator path the platform has already committed to. Re-authoring narrower Thinkwork-original skills is rejected for v1 because it duplicates known-good work and slows the prospect motion without changing the pilot's pass criteria.
- **Attachments-in-Computer is the load-bearing platform change.** Reason: the gap analysis shows runtime, install model, skill format, audit log, and orchestration are all already in place; the missing piece is the operator-facing path from "I have an Excel file" to "the agent can read it." Other gaps are either out of scope or already adequately covered.
- **Output stays in the current artifact substrate.** Reason: shadcn JSX artifacts and inline tables/charts are enough to demo financial analysis credibly; Excel output authoring adds Python-side `openpyxl` work for an unproven prospect appetite. Reverse only if the prospect explicitly demands a downloadable model.
- **The pilot's success criterion is qualitative, not numeric.** Reason: the prospect has not named a metric or a workflow they're trying to displace. A qualitative "they felt value" is the right v1 gate; numeric KPIs come after the prospect (or another prospect) names a real workflow.
- **Lifted skills live in `packages/skill-catalog/` as Thinkwork-managed content.** Reason: aligns with how today's sales/CS skills (account-health-review, renewal-prep, etc.) are managed; compounds for any future prospect; exercises the `agentskills.io` translator path the platform has committed to. Trade-off: licensing on `anthropics/financial-services` must be verified compatible before committing content centrally.
- **Computer attachments ship as a general capability, not pilot-gated.** Reason: the runtime gap is the same either way; gating the operator-facing UX adds complexity without saving meaningful work, and every adjacent product surface (other prospects, file-driven runbooks, internal demos) benefits immediately. The pilot is the first consumer, not the only consumer.

---

## Dependencies / Assumptions

- The `agentskills.io` contract brainstorm (`docs/brainstorms/2026-05-12-agentskills-contract-and-portability-requirements.md`) and the runbooks-as-Agent-Skills plan (`docs/plans/2026-05-12-001-refactor-computer-runbooks-as-agent-skills-plan.md`) define skill format and activation. The pilot inherits both; if either reshapes materially before the pilot ships, the lifted skills move with the contract.
- Compliance event-log work (`project_system_workflows_revert_compliance_reframe`, 2026-05-06) is the substrate for audit. The pilot does not introduce a new audit surface; it relies on Compliance covering file-upload and skill-activation events. If Compliance does not cover those event types today, that becomes pilot-blocking work.
- The Computer artifact substrate (`docs/brainstorms/2026-05-12-computer-artifact-shadcn-vocabulary-and-mcp-requirements.md`, `docs/brainstorms/2026-05-12-computer-html-artifact-substrate-requirements.md`) is the rendering target for output. Pilot does not require new artifact kinds.
- The prospect's data is unclassified Excel produced by their finance team; we are not assuming SOX, GAAP, or audit-grade output. If the prospect later wants audit-grade, that is a separate scope.
- The Anthropic skill content in `anthropics/financial-services` remains open-source and licensed compatibly for adaptation; this is *believed* true but should be verified before content is committed to a Thinkwork repo or tenant workspace.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1, R2][Technical] Where do attached files physically live and how are they exposed to the Strands runtime? S3 + a workspace path is one shape; an in-context byte-array is another. Planning will choose based on size limits and skill-side ergonomics.
- [Affects R8][Technical] What is the chart/table rendering pipeline for analysis output today, and what does it cost to emit a chart referencing a specific cell or column from an uploaded file? Likely fine via the existing JSX artifact substrate, but worth verifying.
- [Affects R11][Needs research] Does the Compliance event log already record file-upload events and skill-activation events with enough fidelity for F3? If not, what is the cheapest additional instrumentation?
- [Affects R4][Needs research] Verify the actual licensing on `anthropics/financial-services` before committing the lifted content into the Thinkwork repo. If the license is restrictive, the pilot may need to ship the content per-tenant rather than as a Thinkwork-shipped asset.
