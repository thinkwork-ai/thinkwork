---
date: 2026-05-12
topic: openclaw-inspired-enterprise-pattern-borrows
---

# OpenClaw-Inspired Enterprise Pattern Borrows (Coordinating Initiative)

## Summary

A coordinating brainstorm that scopes three OpenClaw-inspired architectural borrows — Position identity layer with org-chart-driven provisioning, tiered runtimes with per-tier IAM roles, and workspace-file-as-contract — as a single tracked initiative. Each Tier 1 borrow gets its own follow-up `/ce-brainstorm` and `/ce-plan`; this doc names the slate, sequences it, and fixes what is in vs out.

---

## Problem Frame

ThinkWork is approaching its v1 enterprise scale target of roughly 4 enterprises × 100+ agents × ~5 templates (≥400 agents). Three pressures show up at that scale that current architecture does not answer cleanly:

- **Role-scoped identity is missing.** The identity stack has two layers — system-workspace (global) and per-agent `AGENTS.md` / `USER.md` (per-agent or per-user). There is no role-scoped middle layer that a department admin can edit and have propagate to all members of that role.
- **Sensitivity segregation lives only in prompt and tool allowlists.** A single Strands container under a single IAM role serves every agent. "This executive agent can touch finance APIs; this standard agent cannot" is enforced in the prompt and the tool list, not at the IAM layer.
- **Enterprise customization keeps flowing into the forked runtime.** Each new capability tends to land inside `packages/agentcore-strands`, which raises the cost of every runtime swap consideration and produces a recurring "the next runtime will solve our problems" loop (Pi parallel substrate in April; OpenClaw consideration in May). The underlying frustration is forking burden, not runtime choice.

OpenClaw's enterprise architecture documents a coherent answer to all three pressures: three-layer SOUL identity (Global / Position / Personal), tiered runtimes with separate IAM roles per tier, and a Zero Invasion principle that keeps enterprise customization in workspace files the runtime reads natively. The patterns are extractable from OpenClaw without adopting its substrate.

---

## Actors

- A1. **Enterprise IT admin**: Owns global identity, tier configuration, and which positions are permitted on which tiers; sees audit
- A2. **Department admin** (new role introduced by this initiative): Owns Position-layer files for their department's roles; assigns positions to tiers within the IT-permitted set
- A3. **Employee**: Owns Personal-layer overrides; consumes their agent through admin-configured channels
- A4. **Platform operator** (Eric / core team): Owns the underlying workspace-file contract, runtime tier configuration, and Terraform shape
- A5. **Agent runtime**: Reads composed workspace files at session start; runs under the IAM role for its assigned tier; persists outputs back to S3 and audit stores

---

## Key Flows

- F1. **Onboard an employee from an org-chart position**
  - **Trigger:** An employee record is created with a position reference
  - **Actors:** A1, A4, A5
  - **Steps:** Employee created → workspace bootstrap composes Global + Position + Personal files → agent record created and bound to the position → agent provisioned on the runtime tier assigned to that position → audit row written → operator verifies via admin UI
  - **Outcome:** The agent exists, inherits role identity that the department admin owns, and runs with tier-appropriate IAM blast radius
  - **Covered by:** R3, R4, R5, R7

- F2. **Department admin changes role-wide guidance**
  - **Trigger:** Department admin edits the Position-layer workspace file for one of their roles
  - **Actors:** A2, A5
  - **Steps:** Edit submitted → contract validates change is within IT-permitted bounds and does not override the Global layer → file persisted → next session for any agent on that position composes with the new identity automatically (no per-agent rebuild)
  - **Outcome:** One edit propagates to every member of the role
  - **Covered by:** R3, R7

- F3. **IT promotes a position to a higher-sensitivity tier**
  - **Trigger:** IT admin re-assigns a position from one tier (e.g., Standard) to another (e.g., Restricted)
  - **Actors:** A1, A4, A5
  - **Steps:** Assignment updated → subsequent agent invocations on that position resolve to the new tier's IAM role and optional Guardrail → audit row written → no agent rebuild required
  - **Outcome:** Blast radius shifts at the IAM layer for every member of the role, observable in audit
  - **Covered by:** R5, R6, R7

---

## Requirements

**Initiative shape**
- R1. This document is a coordinating initiative, not a per-borrow requirements doc. It produces three follow-up `/ce-brainstorm` cycles — one for each Tier 1 borrow — and is not itself input to implementation.
- R2. The three Tier 1 borrows in the slate are: (A) a Position identity layer with org-chart-driven provisioning; (B) tiered runtimes with per-tier IAM roles; (C) a workspace-file-as-contract refactor that consolidates enterprise customization into runtime-readable files.

**Position layer + org-chart provisioning (Borrow A)**
- R3. The identity stack gains an explicit middle layer scoped to a role, owned by a department admin, that propagates to all members of the role and cannot override Global-layer constraints. Personal-layer ownership stays with the employee.
- R4. An employee record carries a position reference; creating or changing the position is the trigger for agent provisioning or reconfiguration. Position changes do not require an agent rebuild.

**Tiered runtimes + per-tier IAM (Borrow B)**
- R5. The platform supports multiple sensitivity tiers, each with its own IAM role and optional Bedrock Guardrail. Agent invocations route to the tier assigned to the agent's position. The initial tier slate is deferred to Borrow B's brainstorm — OpenClaw's Standard / Restricted / Engineering / Executive is the inspiration, not the commitment.
- R6. Tier assignment is an admin operation. The admin UI surfaces position-to-tier mapping with scoping between IT admin and department admin authority. Where that boundary sits is deferred to Borrow B's brainstorm.

**Workspace-file-as-contract (Borrow C)**
- R7. ThinkWork commits to keeping all enterprise customization in workspace files the agent runtime reads natively, rather than in agent-code branches inside the runtime fork. The workspace-file set becomes the durable contract between enterprise wrap and runtime.
- R8. Borrow C includes an audit pass over current Strands customizations that produces a migration list — items that live in code today and should move to files. Future runtime considerations become workspace-file-compatibility checks, not substrate swaps.

**Slate management**
- R9. Suggested sequencing: Borrow C first (small, foundational, audit-heavy; sets the contract that A and B ship inside); Borrow A second (highest user-visible leverage at the 400-agent scale); Borrow B third (compliance-grade defense-in-depth that intersects with A at the admin assignment surface). The per-borrow brainstorms may revise this sequence with new information.
- R10. Tier 2 items (Digital Twin; formal 5-layer security write-up) are tracked as queued follow-ups, not started under this slate. They may be promoted after the initial slate ships if they earn it.

---

## Acceptance Examples

- AE1. **Covers R3, R4, F2.** Given a finance department with 40 agents on the "Finance Analyst" position, when the finance department admin edits the Position-layer file for that role, then the next session for each of those 40 agents composes with the new identity automatically — no per-agent rebuild, no admin task per agent.
- AE2. **Covers R5, R6, F3.** Given an "Executive Assistant" position currently assigned to the Standard tier, when IT re-assigns it to Restricted, then the next invocation of any agent on that position executes under the Restricted tier's IAM role and Guardrail, and the change appears as a single audit row identifying the IT actor, the position, and the tier transition.
- AE3. **Covers R7, R8.** Given a future runtime swap consideration, when a reviewer asks "what would we lose?", then the answer is bounded by the workspace-file contract — no enterprise capability is locked to the current runtime fork. If that answer is not bounded, Borrow C is not yet complete.

---

## Success Criteria

- An enterprise of ≥100 agents can be onboarded from an org chart, and one department-admin edit propagates to all role members
- Sensitivity segregation is enforceable at the IAM layer, not only at prompt or tool-allowlist level, and the segregation is visible in audit
- `packages/agentcore-strands` stops accumulating ThinkWork-specific customization; new enterprise capabilities land as workspace-file changes by default
- Each Tier 1 borrow has its own brainstorm, plan, and PR slate, traceable back to this coordinating doc
- A downstream operator reading this doc can identify which of the three borrows they are working on, in what order, and what is explicitly out of scope

---

## Scope Boundaries

- Full migration of ThinkWork onto OpenClaw's stack — rejected after explicit consideration
- Single-bot IM gateway adoption (OpenClaw's H2 Proxy pattern) — conflicts with the current per-user mobile OAuth direction; reopen only via its own brainstorm
- Dual-deploy serverless + Fargate posture — AgentCore single-mode is intentional
- Digital Twin product feature — Tier 2 follow-up, not in this slate
- Formal 5-layer security write-up — Tier 2 follow-up, likely folded into the Compliance reframe initiative
- Per-borrow implementation detail — schema for positions, IAM role enumeration, the exact workspace-file contract field set, admin UI shape — those belong to the per-borrow brainstorms, not this coordinating doc
- Relitigating recent runtime commitments (Strands for Computer; Pi parallel substrate deferred). Borrow C decouples enterprise wrap from runtime choice; it does not propose another runtime swap

---

## Key Decisions

- **Borrow patterns, do not migrate.** Re-platforming from a larger, validated stack to a smaller, less-proven one trades 22 PRs of shipped v1 work for capabilities documented in an enterprise README. The valuable architectural deltas are extractable without adopting OpenClaw as substrate.
- **Coordinate as a slate; plan as three separate efforts.** Each Tier 1 borrow is independently meaty. Bundling them into one requirements doc would leak scope between them; separating them lets each ship cleanly while the slate keeps the shared frame and dependencies visible.
- **"Zero Invasion" maps to "workspace-file contract" inside ThinkWork.** The borrowable insight is not "run the same agent image OpenClaw runs" — it is "keep enterprise customization in files, not in runtime code." This is the move that interrupts the recurring substrate-swap loop.
- **Tier 3 stays out.** IM-gateway and dual-deploy are not partially borrowed. They conflict with existing decisions and need explicit reversal brainstorms if they re-enter scope.

---

## Dependencies / Assumptions

- Per-borrow brainstorms will be scheduled as separate `/ce-brainstorm` calls; their outputs feed `/ce-plan`. The order in R9 is the default but not binding.
- Current AgentCore + Cognito + Aurora + AppSync stack remains the substrate. The slate is additive — it is built on top of the existing platform, not in replacement of any of it.
- Borrow A intersects with the existing Cognito identity model; Borrow A's brainstorm must reconcile Position semantics with Cognito group / claim semantics.
- Borrow B intersects with the AgentCore endpoint model; Borrow B's brainstorm must decide whether tiers are separate runtime endpoints, IAM-only variations on one endpoint, or a mix.
- Borrow C requires baselining the current set of Strands customizations to scope the audit; that baseline is part of Borrow C's brainstorm.

---

## Outstanding Questions

### Resolve Before Planning

- (None — per-borrow planning is gated on the per-borrow brainstorms, not on this coordinating doc.)

### Deferred to Planning

- [Affects R5][Needs research] What is the initial tier slate for ThinkWork? OpenClaw's Standard / Restricted / Engineering / Executive may not be the right mapping.
- [Affects R3][Technical] Does the Position layer live as Aurora rows, S3 prefixes, or both? Resolved in Borrow A's brainstorm.
- [Affects R6][User decision] Where does the IT-admin vs department-admin authority boundary sit for tier assignment? Resolved in Borrow B's brainstorm.
- [Affects R7][Technical] What is the canonical workspace-file set? OpenClaw uses SOUL.md / TOOLS.md / IDENTITY.md / CHANNELS.md; ThinkWork currently uses `system-workspace` + `AGENTS.md` + `USER.md`. The contract field list is resolved in Borrow C's brainstorm.
