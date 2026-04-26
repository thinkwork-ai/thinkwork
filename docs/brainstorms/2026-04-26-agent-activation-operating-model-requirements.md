---
date: 2026-04-26
topic: agent-activation-operating-model
---

# Agent Activation Operating Model

## Problem Frame

ThinkWork's agent primitives are powerful, but a new end user still has to teach the system how they operate before their agent can be meaningfully useful. A blank or thin `USER.md`, generic workspace context, and unexpressed delegation rules make the first agent feel like a generic assistant rather than a capable partner.

The opportunity is to make the first meaningful ThinkWork experience a reusable **Activation Agent**: a focused Strands/Bedrock interviewer that extracts the user's operating model, confirms each layer with the user, and turns the result into profile context, memory/wiki seeds, automations, and specialist-agent recommendations.

This builds from Nate Jones' OB1 Work Operating Model Activation recipe, which interviews through five fixed layers and generates agent-ready operating files. ThinkWork should keep that spine, but adapt the outputs to the platform: `HEARTBEAT.md` becomes EventBridge-backed automation recommendations; `USER.md` becomes user profile + workspace context; operating-model entries feed compounding memory/wiki; and friction/dependency patterns can create personal specialist agent/folder recommendations.

The durable object is not one agent's personality. It is a user-owned operating model that current and future personal agents can consume.

---

## Actors

- A1. End user: Runs activation to teach ThinkWork how they work and approves personal changes.
- A2. Activation Agent: A focused Strands/Bedrock interviewer optimized for low-latency operating-model elicitation.
- A3. Mobile app: Primary UX shell for onboarding, progress, checkpoint review, and staged apply.
- A4. Personal agent/workspace: The user's current or future agent surface that consumes the operating model.
- A5. ThinkWork memory/wiki: Stores confirmed operating-model knowledge as durable, searchable user knowledge.
- A6. Automation system: EventBridge-backed scheduled jobs that can act on approved rhythms and triggers.

---

## Key Flows

- F1. First-run full activation
  - **Trigger:** A new or existing end user chooses to activate their operating model from mobile onboarding.
  - **Actors:** A1, A2, A3
  - **Steps:** Mobile starts a full activation session; the Activation Agent interviews through operating rhythms, recurring decisions, dependencies, institutional knowledge, and friction; after each layer the user reviews a checkpoint summary; approved entries are saved as confirmed or synthesized operating-model knowledge.
  - **Outcome:** The user has a complete versioned operating model with five approved layers and a pending activation bundle.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Staged activation apply
  - **Trigger:** The full interview reaches final review.
  - **Actors:** A1, A3, A4, A5, A6
  - **Steps:** Mobile shows a review bundle grouped by safe automatic updates, behavior-changing workspace updates, automation candidates, and specialist recommendations; safe confirmed facts are already persisted; the user approves, defers, or dismisses each higher-consequence output.
  - **Outcome:** Approved personal changes are applied; deferred recommendations remain available; dismissed recommendations capture the reason when provided.
  - **Covered by:** R6, R7, R8, R9, R10, R11

- F3. Focused refresh
  - **Trigger:** The user later chooses to refresh one layer, such as dependencies or friction, or ThinkWork recommends a stale-area refresh.
  - **Actors:** A1, A2, A3
  - **Steps:** The Activation Agent resumes from the user's latest operating model, asks targeted questions for the selected layer, surfaces prior entries as tentative context, collects corrections or additions, and saves a new approved checkpoint for that layer.
  - **Outcome:** The operating model evolves without forcing the user through the full five-layer interview.
  - **Covered by:** R12, R13, R14

---

## Requirements

**Activation interview**

- R1. ThinkWork must provide a reusable Activation Agent, implemented as a focused Strands/Bedrock agent rather than a static form or the general-purpose managed agent harness.
- R2. The Activation Agent must interview in this fixed first-run layer order: operating rhythms, recurring decisions, dependencies, institutional knowledge, friction.
- R3. The Activation Agent must start from recent concrete examples rather than abstract job-description prompts.
- R4. Each layer must end with a checkpoint summary and explicit user confirmation or correction before the layer is saved.
- R5. The Activation Agent may use existing memory/wiki results as tentative hints, but may not persist or apply them as confirmed operating-model facts without user confirmation.

**Durable operating model**

- R6. The primary durable output must be a user-level Operating Model Profile, not an agent-scoped configuration file.
- R7. Operating-model entries must preserve layer, title, summary, cadence, trigger, inputs, stakeholders, constraints, source confidence, status, and last validated time.
- R8. The profile must distinguish confirmed facts from synthesized patterns approved by the user.
- R9. The profile must support versioning or equivalent history so a full activation and later refreshes can be understood over time.

**Activation bundle outputs**

- R10. Full activation must produce a staged activation bundle containing: profile/user-context updates, current-agent workspace/context updates, memory/wiki seed entries, EventBridge automation candidates, and specialist agent/folder recommendations.
- R11. Safe confirmed facts may auto-save to the user-owned operating model, user profile fields, and memory/wiki seed entries.
- R12. Behavior-changing workspace edits must be presented for review before applying to the user's personal agent/workspace.
- R13. EventBridge-backed automation candidates must require explicit user approval before any automation is created or enabled.
- R14. Specialist agent/folder recommendations must require explicit user approval before creation and must remain scoped to the user's personal agent/workspace, not tenant-wide templates.
- R15. Dismissed recommendations should capture an optional reason so future activation runs can avoid repeating unwanted suggestions.

**Lifecycle**

- R16. V1 must support a full five-layer activation for first use.
- R17. V1 must support focused refreshes for individual layers after the first activation.
- R18. ThinkWork may recommend focused refreshes when parts of the operating model appear stale, incomplete, or contradicted by later user behavior.

**Surface and ownership**

- R19. Mobile onboarding is the primary V1 surface for activation, progress, checkpoint review, and final staged apply.
- R20. Chat may initiate, resume, or deep-link to activation, but the primary interview and review experience belongs in mobile for V1.
- R21. The feature is end-user led. Admin-led employee setup, tenant-wide role templates, and admin access to raw interview content are not V1 behavior.
- R22. End users may apply personal outputs themselves when those outputs affect only their profile, memory/wiki, personal agent/workspace, personal automations, or personal specialist folders.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R4.** Given a user starts activation for the first time, when they complete the operating-rhythms layer, then the Activation Agent summarizes 2-5 concrete rhythm entries from recent examples and waits for confirmation or corrections before saving.
- AE2. **Covers R5, R8.** Given memory search suggests that the user does Monday planning, when the Activation Agent raises that hint, then it is presented as tentative and only becomes confirmed or synthesized after the user approves it.
- AE3. **Covers R10, R11, R12, R13, R14.** Given the user completes full activation, when the final bundle is shown, then profile/memory updates are already saved or ready as low-risk updates, while workspace edits, automation candidates, and specialist folder recommendations each require explicit approval.
- AE4. **Covers R13.** Given the bundle recommends "weekday 8am planning review," when the user approves it, then ThinkWork creates or enables a personal scheduled automation; if the user defers it, no EventBridge-backed job is created.
- AE5. **Covers R16, R17.** Given a user completed activation last quarter, when they choose "refresh dependencies," then the Activation Agent focuses only on the dependencies layer and produces a new checkpoint without rerunning all five layers.

---

## Success Criteria

- A new end user can complete mobile activation and end with a user-level operating model that makes their personal agent's context visibly less generic.
- The first activation produces useful outputs across all intended consumers: profile/workspace context, memory/wiki seeds, automation candidates, and specialist recommendations.
- The user can approve higher-consequence outputs without needing admin help, as long as the changes are personal-scoped.
- Focused refreshes let an activated user update one area without repeating the full onboarding.
- `ce-plan` can proceed without inventing the product shape, actor ownership, layer order, apply semantics, or V1 scope.

---

## Scope Boundaries

- V1 is not admin-led employee provisioning.
- V1 does not mutate tenant-wide templates, tenant-wide automations, or admin policy from an end-user activation session.
- V1 does not expose raw interview content to tenant admins by default.
- V1 does not use the general-purpose long-running managed-agent harness as the primary interviewer experience.
- V1 does not require adaptive layer routing for the first run; the initial interview follows the fixed five-layer sequence.
- V1 does not require importing or exporting OB1-compatible bundles, though the conceptual model should remain compatible enough to revisit later.
- V1 does not need a full visual agent-builder experience; specialist recommendations may create scoped stubs/folders through a simple approval path.
- V1 does not auto-create automations or specialist agents without explicit user approval.

---

## Key Decisions

- **Reusable Activation Agent over one-time wizard:** The operating model should evolve quarterly, after role changes, or through focused refreshes.
- **Mobile-first surface:** The interview and staged review need fast, guided UX; chat can initiate or resume but should not own the primary V1 flow.
- **Focused Strands/Bedrock agent:** The Activation Agent should be a real agent in the ThinkWork runtime family, but with a narrow tool surface and speed-oriented context.
- **User-level operating model first:** The durable asset belongs to the user and can be applied to current or future personal agents.
- **Full activation in V1:** The first shipped version should not stop at profile/`USER.md`; it should generate and apply personal automations and specialist recommendations when the user approves them.
- **`HEARTBEAT.md` becomes automations:** ThinkWork should translate rhythm and trigger outputs into EventBridge-backed automation candidates instead of generating a standalone heartbeat file as the operational endpoint.

---

## Dependencies / Assumptions

- ThinkWork already has workspace-file concepts (`USER.md`, `SOUL.md`, `IDENTITY.md`, `AGENTS.md`) and a workspace overlay model; this feature consumes those concepts rather than replacing them.
- ThinkWork already has EventBridge-backed scheduled job infrastructure; automation recommendations should map to that platform capability during planning.
- **Precondition (not directional):** This feature cannot ship before plan `2026-04-24-001-refactor-user-scope-memory-and-hindsight-ingest` lands its memory/wiki user-scope flip. The current schema keys `wiki_pages.owner_id` to `agents.id` (`packages/database-pg/src/schema/wiki.ts:62-72`, "v1: every page is agent-scoped"), which leaves the user-level Operating Model Profile (R6) and memory/wiki seed entries (R10) with no place to land. The deferred "where should the Operating Model Profile live" question must assume user-scoped storage from day one.
- Specialist recommendations should align with the folder-as-agent direction in `docs/brainstorms/2026-04-24-fat-folder-sub-agents-and-workspace-consolidation-requirements.md`.
- The final UX should preserve Nate's confirmation discipline: retrieved or inferred context is a hint until the user confirms it.

---

## Outstanding Questions

### Resolve Before Planning

- *(none)*

### Deferred to Planning

- [Affects R1][Technical] What is the minimal fast Activation Agent runtime path that still uses Strands/Bedrock without pulling in the full managed-agent harness?
- [Affects R7, R9][Technical] Where should the Operating Model Profile live relative to existing `user_profiles`, memory/wiki, and workspace-file storage?
- [Affects R10-R14][Technical] What exact apply transaction boundaries are required for profile updates, workspace edits, memory/wiki seeds, automation creation, and specialist folder creation?
- [Affects R13][Technical] How should automation recommendations map onto the existing scheduled job/EventBridge model, including approval, pause, delete, and user ownership?
- [Affects R13, R14, R22][Technical] `scheduled_jobs` (`packages/database-pg/src/schema/scheduled-jobs.ts:37-71`) currently keys ownership on `tenant_id` + `agent_id` + `routine_id` + `team_id` + an untyped `created_by_id text`; there is no `user_id` FK, no per-user index, no per-user pause/disable column. Personal-scoped automation behavior required by R22 cannot be safely implemented without one of: (a) add `user_id uuid references users(id)` with backing index, (b) treat `created_by_id` as authoritative and add a check-constraint on `created_by_type`, or (c) model personal automations on a sibling table.
- [Affects R14][Technical] What is the smallest personal specialist/folder creation path that does not require the full future agent-builder UI?
- [Affects R19][Design] What mobile interaction model keeps a 30-45 minute interview feeling resumable and lightweight rather than like a long form?

### From 2026-04-26 review

Items deferred from `/ce-doc-review` for the author and `ce-plan` to resolve. Reviewer attribution in parens; treat as open decisions, not rejected findings.

**Premise / scope (4 ROOTs)**

- [Affects Problem Frame, R5/R10/R11][Premise] **Sequencing — does Activation Agent ship before, alongside, or after the user-scope refactor (`2026-04-24-001`) and the user-knowledge reachability/knowledge-pack work?** R5's "memory search suggests Monday planning" assumes user-scoped recall already works in delegation paths; the sibling brainstorm (`2026-04-26-user-knowledge-reachability-and-knowledge-pack-requirements.md`) exists because it doesn't. Either sequence after both land and rewrite R5/R10/R11 to consume the knowledge pack, or descope V1 outputs to surfaces that exist today (profile fields + per-agent USER.md). *(product-lens)*
- [Affects R19, R20][Premise] **Is mobile actually the right primary V1 surface for a 30-45 min tacit-knowledge interview?** R3's "recent concrete examples" requirement is harder when the user is away from the artifacts (calendars, dashboards, docs) that contain those examples. Promote the deferred R19 question back to Resolve-Before-Planning, or invert: ship in admin/web first, add mobile resumption + chat-initiated micro-refreshes as the next surface. *(product-lens)*
- [Affects R21, Scope Boundaries][Premise] **End-user-led posture vs imminent enterprise rollout (4 enterprises × 100+ agents).** Distinguish two claims: (a) end-user owns/approves their own personal outputs (keep — aligns with user-opt-in-over-admin-config), vs (b) admin has zero role in initiating, observing completion of, or seeding activation (much stronger; harder to defend at 100 employees per tenant). Open (b) as a planning-phase decision, not a hard V1 boundary. Add: how does activation work when one tenant onboards 100 employees in a week? *(product-lens)*
- [Affects R10, Key Decisions][Scope] **Cut V1 to profile + workspace + memory; defer automations to V1.1 and specialist folders to V1.2.** Three of the five output classes (memory/wiki user-scope, EventBridge UX, fat-folder spawn) sit on top of platform primitives still in motion. Success Criteria is fully served by surfaces 1–3. The "Full activation in V1" Key Decision is asserted without arguing against the obvious staged alternative; if accepted, this also resolves the dependent IA, approval-fatigue, EventBridge cost, scheduled_jobs schema, specialist-stub proliferation, and R14 stub-format concerns below. *(product-lens + scope-guardian)*

**Premise (peer)**

- [Affects Problem Frame][Premise] **Pick: V1 ships a great Activation Agent writing to a deliberately minimal operating-model schema, OR V1 ships a durable user operating-model substrate whose first writer happens to be the Activation Agent.** The Problem Frame says both; planning will be pulled in two directions. *(product-lens)*

**Scope / requirement tightenings**

- [Affects R7][Scope] **Reduce R7 to `layer + title + summary + cadence + status + metadata jsonb`.** `inputs`, `stakeholders`, `constraints` have no requirement, flow, or AE consuming them — they replicate the OB1 source schema rather than derive from ThinkWork's outputs. Promote individual fields when a concrete consumer requires them. *(scope-guardian)*
- [Affects R18][Scope] **Move R18 (staleness-triggered refresh) out of V1 requirements until behavior signals exist.** "Contradicted by later user behavior" has no signal source — `skill_runs` / wakeup outcomes / wiki access patterns are not wired to detect contradiction against operating-model entries. As written, R18 + R8 are decorative without a falsification probe; ce-plan would invent a calendar-age heuristic disguised as behavior detection. *(scope-guardian + adversarial)*
- [Affects R9][Scope] **Restate R9 as "checkpoint per layer with timestamp + confirmed entries; latest queryable per layer".** Full versioning before the storage decision is decided is over-specified; no AE reads a prior version. Defer history navigation until a user-facing UI requires it. *(scope-guardian)*
- [Affects R1, Key Decisions][Scope] **Drop the "not the managed-agent harness" prohibition unless a latency SLA or resource-isolation requirement is documented.** Existing `server.py` already supports tool-surface narrowing via `agent_mode_tools` / `CANONICAL_FILE_NAMES` and workspace-file context profiles. Restate R1 as: "narrow tool surface, purpose-built workspace, no delegation skills" — the runtime may reuse the existing Strands harness parameterized appropriately. *(scope-guardian)*
- [Affects R14][Scope] **Either defer R14 entirely to post-V1 (after fat-folder Phase E/F lands) OR precisely define what a "scoped stub" contains** (folder + AGENTS.md row? agents-table row? CONTEXT.md only?). "Scoped stubs/folders through a simple approval path" is currently hand-waved. *(scope-guardian)*
- [Affects Success Criteria, Outstanding Questions][Scope] **Promote two deferred questions to Resolve-Before-Planning:** (1) where the Operating Model Profile lives (new table vs `operating_model jsonb` on `user_profiles` vs wiki entries), (2) does R1's runtime reuse the existing harness with narrow config or require a new path? Both gate every other implementation choice. *(scope-guardian)*

**Design / UX gaps**

- [Affects R4][Design] **Specify the checkpoint surface** (screen/modal/sheet), each entry row's content (title + summary + source-confidence badge), the affordance for editing an entry (inline expand vs. back-to-conversation vs. full sheet), the affordance for adding a missed entry, and the empty / overlong (10+) / agent-disagrees-with-correction states. *(design-lens)*
- [Affects R5, R8][Design] **Specify the visual treatment** for confirmed-fact vs synthesized-pattern vs tentative-hint at each surface (interview message, checkpoint entry, bundle item) — badges, colors, interactions. R8's "must distinguish" is unimplementable without this; tentative hints need a tap-to-confirm before advancing. *(design-lens)*
- [Affects R19, R16][Design] **Define the partial-completion contract** — minimum-layer threshold for bundle generation (e.g., layers 1+2 only — generate or block?), draft persistence model when the user backgrounds at layer 3, and re-entry surface (banner / push / inbox / settings card). 30-45 min on mobile sees real drop-off mid-flow. *(design-lens + adversarial)*
- [Affects R15][Design] **Specify dismiss-with-reason UX** — inline vs sheet, structured chips (Not relevant / Already doing this / Too much overhead / Other) vs free-text vs both, optional-at-dismissal vs deferred-prompt. Also separate "deferred" (re-surfaces later) from "dismissed" (don't suggest again) as distinct states. *(design-lens)*
- [Affects F2][Design] **Specify per-item bundle states** beyond the three terminal ones — pending → applying (spinner) → applied / apply-failed (with retry) — plus a session-level partial-progress state for bundle reviews split across sessions. Existing `InlineApprovalCard` will silently swallow failures for backend-write items (automations, specialist folders). *(design-lens)*
- [Affects R11, R4][Design] **Define the cross-layer fact-conflict policy.** R11 allows auto-saving facts during the interview; R4 ends each layer with a checkpoint. If a Layer-3 dependency contradicts a Layer-1 rhythm: retroactive update? conflict flag? user-resolution prompt? Either save only at full-interview-end, or run a named conflict-detection step before bundle apply. *(design-lens)*
- [Affects R10, R13, R14, AE3][Design] **Bundle IA + approval friction** — calibrate friction per consequence (single-tap USER.md vs schedule-detail confirm for automation vs two-step for new agent runtime); ban a single "approve all" affordance for R13/R14 categories; specify section ordering, expand/collapse per category, and item-count truncation. Without this, 5 heterogeneous categories at the end of a 30-45 min flow invite rubber-stamp approval of automations and specialists. *(design-lens + adversarial)*

**New requirements proposed**

- [Affects R3, R4][Requirement] **Add a sparse-signal exit:** per-layer minimum confidence floor; "I don't have rhythms yet" checkpoint outcome that produces an empty layer rather than synthesized content; per-layer signal threshold gating bundle generation. R3 forces "recent concrete examples" the new-hire / student / career-switcher can't supply, and the document never says what the checkpoint contains under sparse signal — strongly implying fallback to synthesis the user lightly endorses. *(adversarial)*
- [Affects R2, R10, R11, Scope Boundaries][Requirement] **Add a friction-layer privacy invariant:** friction-layer entries write to user-private memory only, never to wiki or any cross-user retrieval surface. Make "by default" in the scope boundary a strict invariant. Require provenance tagging (layer-of-origin, sensitivity flag) on every memory/wiki seed. *(adversarial)*
- [Affects R13][Requirement] **Add cost disclosure to automation approval** — per-fire estimate, aggregate monthly forecast across approved bundle, and a Bedrock-invocation note. Currently a user can approve 8-12 weekday automations totaling ~200+ Bedrock-backed runs/month with no cost signal at the approval moment. *(adversarial)*
- [Affects R14][Requirement] **Cap specialist-stub recommendations at 2 in V1; auto-archive zero-use stubs after N days; allow deferring specialist creation past final-bundle review** so it isn't a same-session decision. Without this, first activation produces 6-8 stubs the user later regrets. *(adversarial)*

**Security boundaries**

- [Affects R6, R7][Security] **Resolve storage-location + access-control model before planning starts.** Pick the storage key (`user_id` vs `agent_id`); confirm the GraphQL resolver enforces `ctx.auth.userId === profile.user_id`; document whether any agent in the tenant can query the profile or only the owning user's agents. The existing `wiki_pages.owner_id → agents.id` schema cannot represent user-level ownership without a deliberate decision. *(security-lens)*
- [Affects R1, Key Decisions][Security] **Enumerate the Activation Agent's tool allowlist** — recall-read yes; workspace-write no; MCP connectors no — and enforce at IAM / invocation-payload level, not just system prompt. The current `server.py` skill-catalog and MCP allowlist are environment-injected; an Activation Agent launched with general-purpose config gains Slack/GitHub/Google + write_memory access. *(security-lens)*
- [Affects R21, Scope Boundaries][Security] **Either remove the "by default" hedge on admin access to raw interview content (categorical exclusion) OR enumerate the conditions, consent mechanism, and technical controls that govern the non-default state** (DSAR / litigation-hold / field-level encryption / access log). The hedge currently anticipates a non-default state with no specification. *(security-lens)*

**Coherence**

- [Affects R11, AE3][Coherence] **Align AE3 ("already saved or ready as low-risk updates" — definite) with R11 ("safe confirmed facts may auto-save" — permissive).** Pick one direction; planners will diverge on whether profile/memory persist immediately or wait for final bundle approval. *(coherence)*
- [Affects R15][Contradiction] **R15 dismiss-with-reason — keep + spec or cut.** Coherence + design-lens want it fully specified (input UX + F3 consumption + future-run suppression behavior); scope-guardian wants the reason field cut for V1 because no V1 consumer exists (R18 is itself aspirational). Decide one way. *(coherence + scope-guardian — contradiction)*

**FYI — kept on record, no decision required**

- R11's "safe confirmed facts" boundary is operationally undefined; deferred to planning. *(coherence)*
- Approval friction is uniform across categories with materially different consequence (single-tap USER.md edit vs creating a new agent runtime). *(design-lens)*
- 5-layer fixed order is anchored on Nate's OB1 recipe wholesale; the document doesn't argue why these five vs ThinkWork-output-shaped alternatives. *(product-lens)*
- Opportunity cost vs in-flight work (knowledge pack, fat-folder, S3-orchestration, plan `2026-04-24-001`) is not examined. *(product-lens)*
- No data classification or retention defined for third-party PII collected in dependencies/friction layers; GDPR/CCPA exposure for named subjects. *(security-lens)*
- Operating Model Profile may overlap an `operating_model jsonb` column on existing `user_profiles` without a new table; brainstorm doesn't acknowledge this candidate. *(scope-guardian)*

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
