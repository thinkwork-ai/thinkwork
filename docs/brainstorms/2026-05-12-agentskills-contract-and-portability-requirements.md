---
date: 2026-05-12
topic: agentskills-contract-and-portability
---

# Agentskills.io Contract and Portability (Borrow C of OpenClaw Pattern Slate)

## Summary

ThinkWork formally adopts agentskills.io as its open contract for skills, documents its agent-level canonical file set (IDENTITY / SOUL / AGENTS / USER / etc.) as a portable superset above the spec, and ships a one-shot translator at the ThinkWork ↔ Claude / Codex boundary. A read-only Strands audit pass produces a migration list of code-resident behaviors that should live in workspace files; the actual code-to-FS refactor is a follow-up plan. In-flight runbooks-as-skills work is confirmed-aligned, not redone.

---

## Problem Frame

ThinkWork's product thesis is that the filesystem *is* the agent. The FAT-folder brainstorm (2026-04-24) and the skills-as-workspace-folder brainstorm (2026-04-27) shipped most of the principle: sub-agents are plain folders enumerated by `AGENTS.md` routing, skill activation reads the synced workspace tree, vendor paths (`.claude/agents/*`, `.codex/agents/*`) normalize on import, the agent builder is the authoring surface, and the SKILL.md frontmatter shape already aligns with agentskills.io by taste.

Two things are still un-decided:

1. **The relationship to agentskills.io is implicit, not documented.** The alignment is incidental, not formal. As the spec matures and the Claude product surface (Claude Code, Claude.ai Skills, Claude Agent SDK) converges on it, alignment-by-coincidence is fragile. The first incompatible spec move would catch ThinkWork unaware.

2. **The platform has two kinds of code — agent-shaping and fleet-running — and they are currently entangled.** Per-agent behavior (which MCP servers a given agent uses, which skills activate, which canonical files auto-load) lives in code alongside fleet operation (memory engine selection, runtime bootstrap, Computer always-on lifecycle, scheduling, IAM tiers, audit, AppSync). Without an explicit two-layer model, "filesystem is the agent" cannot be strengthened further — every refactor would have to negotiate the entanglement.

At v1 enterprise scale (4 enterprises × 400+ agents + always-on Computer workers + scheduled jobs + tiered runtimes + position-driven provisioning), two pressures sit on this question and pull in opposite directions:

- **Maximum openness with the agent ecosystem.** Claude, Codex, and any future agentskills.io-compliant tool must consume a ThinkWork-authored agent with at most one translation step; ThinkWork must consume their agents with at most the existing path-normalization step. Openness at the agent layer is ThinkWork's wedge against larger incumbents (closed enterprise agent platforms).
- **Fleet management at scale.** Always-on agents, scheduled wake-ups, tiered IAM, per-tenant routing, audit, admin authoring — none of which the open ecosystem provides primitives for. ThinkWork's enterprise value sits here.

Both pressures are legitimate. The contract must serve both without bleeding either into the other.

---

## Two-Layer Model

The contract is organized around two layers that move independently. The classifier for any code or stored state is: *would I want this to travel with the agent when exported?*

**Agent layer — what an agent IS.** Lives in workspace files. Portable.

- Skill subtree (`workspace/skills/<slug>/SKILL.md` + scripts/ + references/ + assets/): agentskills.io-compliant, verbatim per spec
- ThinkWork canonical files at the agent root: `IDENTITY.md`, `SOUL.md`, `AGENTS.md`, `USER.md`, `PLATFORM.md`, `CAPABILITIES.md`, `GUARDRAILS.md`, `MEMORY_GUIDE.md`, `ROUTER.md`, `TOOLS.md`, `CONTEXT.md`
- `memory/` subtree (lessons / preferences / contacts), `skills/` subtree, sub-agent folders at any depth (FAT-folder convention)
- One-shot translation produces a Claude Code or Codex export; one-shot path-normalization imports from those surfaces

**Fleet layer — how ThinkWork RUNS a fleet.** Lives in code, DB rows, Terraform. Not portable, by intent.

- Always-on Computer runtime lifecycle (scaling, scheduling, persistent session state)
- AWS Scheduler → job-trigger → wakeup orchestration
- IAM tier assignment (Borrow B)
- Position-to-agent provisioning (Borrow A)
- Tenant routing, admin UI, AppSync subscription bridge, Aurora rows
- Memory engine selection (Hindsight vs AgentCore managed) and resolver wiring
- Audit (`skill_runs`, `agentcore_traces`)
- Workspace bootstrap mechanism, materialize-at-write-time machinery

ThinkWork's enterprise differentiation lives in the fleet layer. ThinkWork's ecosystem compatibility lives in the agent layer. The two layers must remain distinguishable in code, in docs, and in the audit's classification.

---

## Actors

- A1. **Platform engineer** (Eric / core team): owns the canonical-file contract document, the agentskills.io alignment statement, and the Strands audit deliverable
- A2. **Tenant operator**: authors agents through the agent builder; expects one-click export to Claude / Codex and one-click import of external skills / agents
- A3. **External agent author**: a Claude Code or Codex user who has built a skill (or agent) folder against agentskills.io and wants to bring it into ThinkWork unchanged modulo path-normalization
- A4. **Strands runtime** (conversational): reads canonical files from the locally synced workspace tree; agnostic to "agentskills.io-spec vs ThinkWork-superset" distinction at read time
- A5. **Computer runtime** (always-on agent variant per 2026-05-07 Strands commitment): reads the same agent-layer files; lifecycle and persistence are fleet-layer
- A6. **agentskills.io spec community**: open spec; ThinkWork is a consumer in v1, not a maintainer; spec evolution may force translator updates

---

## Key Flows

- F1. **ThinkWork agent exports to Claude Code**
  - **Trigger:** Operator invokes export (admin action or CLI) on an agent
  - **Actors:** A2, A4
  - **Steps:** Exporter reads the composed agent folder → emits `.claude/agents/<agent-name>/` shape with skills under `.claude/skills/<slug>/` (agentskills.io-compliant, no transform) → includes ThinkWork superset files at the same level with a header comment marking each as a ThinkWork extension → result is a zip or git ref the operator downloads
  - **Outcome:** Operator drops the export into a Claude Code project; skills run natively, ThinkWork superset content is preserved as readable files that Claude Code's runtime simply doesn't load (it loads what it knows about)
  - **Covered by:** R5, R7, R8

- F2. **Claude Code skill imports into ThinkWork**
  - **Trigger:** Operator uploads a `.claude/skills/<slug>/` folder (zip or git ref) into an agent's workspace via the agent builder
  - **Actors:** A2, A3
  - **Steps:** Importer runs SI-4 safety + injection sanitization (per FAT R10) → path-normalizes `.claude/skills/<slug>/` → `workspace/skills/<slug>/` → content lands 1:1 → next agent invocation registers the skill via the existing `skill_resolver.py` tree walk
  - **Outcome:** Skill is editable, deletable, and active without any ThinkWork-specific authoring step
  - **Covered by:** R6

- F3. **Strands audit pass produces migration list**
  - **Trigger:** Audit scheduled (separate work item; this brainstorm names it as Borrow C's deliverable)
  - **Actors:** A1
  - **Steps:** Walk `packages/agentcore-strands/agent-container/` and the chat-invoke handler → for each variable behavior, classify agent-layer vs fleet-layer per the two-layer model → for agent-layer items not currently in FS, capture (current location, proposed FS location, complexity, dependent code) → write a single markdown report
  - **Outcome:** An ordered migration list. Each item is sized; planners pick batches into follow-up `/ce-plan` cycles
  - **Covered by:** R9, R10

- F4. **Runbooks-as-skills alignment check**
  - **Trigger:** In-flight runbooks work (May 10 / May 11 brainstorms) reaches PR stage
  - **Actors:** A1
  - **Steps:** Verify runbook directories conform to SKILL.md frontmatter; verify any ThinkWork-specific runbook concepts (queue position, step progress, execution profile) live in fleet-layer state or skill metadata, not as a new agent-layer file type
  - **Outcome:** Runbooks are not a parallel concept — they are skills with a particular execution profile, FS-resident and spec-compliant
  - **Covered by:** R11, R12

---

## Requirements

**Formal commitment**
- R1. ThinkWork formally adopts agentskills.io as its open contract for skills. The relationship is documented in a single canonical document (placement deferred to planning) that names which fields are spec-required, which are spec-optional, and which are ThinkWork-only.
- R2. The portability bet is single-spec across vendor surfaces (Claude Code, Claude.ai Skills, Claude Agent SDK, Codex, future agentskills.io-compliant tools). ThinkWork does not pick a specific Anthropic surface.

**Canonical file contract**
- R3. The canonical file contract document covers two explicit layers:
  - **Skill layer:** SKILL.md frontmatter fields verbatim per agentskills.io (`name`, `description`, optional `license` / `compatibility` / `metadata` / `allowed-tools`); supporting tree (`scripts/`, `references/`, `assets/`) verbatim per spec; no ThinkWork extensions inside the SKILL.md frontmatter itself
  - **Agent layer (ThinkWork superset):** `IDENTITY.md`, `SOUL.md`, `AGENTS.md`, `USER.md`, `PLATFORM.md`, `CAPABILITIES.md`, `GUARDRAILS.md`, `MEMORY_GUIDE.md`, `ROUTER.md`, `TOOLS.md`, `CONTEXT.md`, plus the `memory/` and reserved `skills/` subtrees, plus sub-agent folders. Each canonical file gets a stated purpose, a stated role in the composed system prompt, and a marker (ThinkWork-only or spec-aligned).
- R4. The document is versioned. Updates flow through PR like any spec. The Strands runtime's auto-load behavior references this document by name; updates to either trigger a co-update PR.

**Round-trip translator**
- R5. The exporter (ThinkWork agent folder → `.claude/agents/<name>/` shape) preserves agentskills.io-compliant skills 1:1 under the FITA path convention. ThinkWork superset files are included in the export, marked clearly as ThinkWork extensions in a header comment.
- R6. The importer for `.claude/agents/*`, `.claude/skills/*`, `.codex/agents/*`, `.codex/skills/*` is already specified in FAT R10–R12 and not redesigned here. This brainstorm verifies exporter symmetry and defers `.codex/*` exporter output to the audit follow-up unless demand surfaces sooner.
- R7. Round-trip fidelity: an agent exported from ThinkWork, opened in Claude Code, modified at the skill level, exported back, and re-imported into ThinkWork preserves all skill behavior and all surviving ThinkWork superset content. Superset content that Claude Code does not understand is preserved unchanged (not stripped) on the round trip.
- R8. Live two-way sync between a ThinkWork agent and a Claude / Codex copy is not in scope. One-shot translation only.

**Strands audit pass (read-only deliverable)**
- R9. The audit produces a single markdown report (placement deferred to planning). For each variable behavior in `packages/agentcore-strands/agent-container/` and the chat-invoke handler, the report records: current location (file:line), agent-layer vs fleet-layer classification, and for agent-layer items: proposed FS location and migration complexity (low / medium / high). Fleet-layer items receive a rationale instead of a proposed FS location.
- R10. The audit explicitly classifies the following named behaviors (the audit may surface more): per-agent MCP server config, skill-resolver precedence, memory engine selection (Hindsight vs AgentCore managed), workspace bootstrap sequence, canonical-file auto-load list, Nova Act key resolution, `has_workspace_map` mode trigger logic, the `skills_config` payload from chat-invoke, and any per-agent runtime configuration currently passed via environment or invocation parameter rather than read from the workspace tree.

**Alignment with in-flight work**
- R11. The in-flight runbooks-as-skills work (May 10 brainstorm, May 11 brainstorm + plan) ships against this contract. Runbook directories conform to SKILL.md shape; ThinkWork-specific runbook execution state (queue, step progress) lives in fleet-layer DB or skill metadata, not as new agent-layer file types. Borrow C does not redo those brainstorms; it confirms alignment.
- R12. Computer (always-on agent variant) reads the same agent-layer files as conversational Strands. Computer-only behavior (always-on lifecycle, scaling, persistent session state) is fleet-layer and not exported. If a Computer-specific agent-layer concept emerges during the audit (e.g., a runbook execution profile that differs from chat-thread profile), it lands as an agent-layer addition under this contract — not as a parallel file system.

**Scope of this brainstorm**
- R13. Borrow C does not refactor Strands code. The audit's migration list feeds one or more follow-up `/ce-plan` cycles; each migration is sized and scheduled independently.
- R14. Borrow C does not introduce new authoring surfaces in the admin SPA, alter the agent builder UX, or change the workspace-files Lambda. The contract is descriptive of decisions already made (FAT, skills-as-workspace-folder, materialize-at-write-time) plus the agentskills.io commitment.

---

## Acceptance Examples

- AE1. **Covers R1, R3.** Given a developer reads the canonical-file contract document, when they ask "is `IDENTITY.md` required by agentskills.io?", the document answers explicitly: "No — `IDENTITY.md` is a ThinkWork-only agent-layer file; agentskills.io defines skills only and is silent on agent shape." When they ask "what does SKILL.md frontmatter require?", the document references agentskills.io as the source of truth and links to it rather than restating it.
- AE2. **Covers R5, R7.** Given a ThinkWork agent with `workspace/skills/research-assistant/` and root `IDENTITY.md` and `SOUL.md`, when the operator exports to Claude Code, then the export contains `.claude/skills/research-assistant/` (1:1, unchanged) and `IDENTITY.md` / `SOUL.md` alongside, each with a marker comment identifying them as ThinkWork extensions. When the operator round-trips through a Claude Code session and re-imports, the superset files are still present after the round trip.
- AE3. **Covers R6.** Given an external Claude Code skill at `.claude/skills/pdf-extract/` with valid SKILL.md, when the operator imports it via the agent builder, then the skill lands at `workspace/skills/pdf-extract/` after path-normalization, content is unchanged, and the next agent turn registers it as active via the existing `skill_resolver` walk.
- AE4. **Covers R9, R10.** Given the audit deliverable is complete, when a planner reads it to scope a migration, then they find every named code-resident agent-layer behavior with a current location, proposed FS location, and complexity rating. Fleet-layer behaviors have a rationale, not a proposed FS location. No behavior is unclassified.
- AE5. **Covers R11, R12.** Given a runbook directory authored under the in-flight runbooks-as-skills work, when an external tool validates it (`skills-ref validate`), then it passes. Any ThinkWork-specific runbook execution state (queue position, step progress) is queryable in fleet-layer DB or admin UI but does not appear in the runbook's SKILL.md frontmatter or body.

---

## Success Criteria

- **Ecosystem outcome:** a Claude Code user, Codex user, or any agentskills.io-compliant tool user can pick up a ThinkWork-exported agent or skill, drop it into their environment, and have skills work without modification. Conversely, an agent or skill authored against agentskills.io in any of those environments imports into ThinkWork with one path-normalization step and works.
- **Fleet outcome:** nothing in this commitment compromises ThinkWork's ability to run always-on Computer agents, schedule jobs, route per tenant, enforce IAM tiers (Borrow B), assign Positions (Borrow A), or audit fleet operation. The fleet layer evolves in code at ThinkWork-native pace.
- **Platform-team outcome:** the audit deliverable answers "what would I have to do to make `packages/agentcore-strands/` swappable for another agentskills.io-compliant runtime?" with a concrete list rather than a hand-wave. Future runtime considerations are bounded by that list, not by speculation.
- **Downstream-agent outcome:** a `/ce-plan` cycle reading this doc can produce migration plans without inventing the agent-layer / fleet-layer classification — each candidate behavior arrives pre-classified.
- **In-flight-work outcome:** runbooks-as-skills work merges without requiring a parallel runbook spec; the alignment check is a confirmation, not a rework.

---

## Scope Boundaries

### Deferred for later

- Actual refactor of code-resident agent-layer behaviors into the FS — the audit produces the list; migration plans schedule the execution.
- Exporter shapes beyond `.claude/agents/` and `.claude/skills/` — `.codex/*` exporter output is decided in the audit follow-up based on demonstrated demand.
- A drift indicator or "follows-upstream" UI for skills imported from external sources. Skills are detached on install per skills-as-workspace-folder R4.
- ThinkWork-authored agentskills.io spec proposals or maintainer involvement. v1 is consumer-only.

### Outside this product's identity

- **Two-way live sync between ThinkWork agents and external Claude / Codex copies.** ThinkWork is the authoritative authoring surface for agents that run on it; external translation is one-shot, not collaborative-live. Two-way live sync solves a coordination problem ThinkWork users do not currently have.
- **Pure agentskills.io-only positioning (no superset).** ThinkWork's value at the agent layer is the canonical file set (IDENTITY / SOUL / AGENTS / etc.) that the spec does not provide. Abandoning the superset to be spec-pure would eliminate the differentiation.
- **Pure fleet-only positioning (no agent-layer openness).** Without portability, ThinkWork would be a closed enterprise platform competing with much larger incumbents (Salesforce Einstein, Microsoft Copilot Studio). Openness at the agent layer is the wedge.
- **Spec maintainer or owner role.** ThinkWork commits to alignment, not to owning the spec's evolution.

---

## Key Decisions

- **Two-layer model (agent / fleet) is the organizing principle.** Every other decision flows from it. The classifier "would I want this to travel with the agent when exported?" is the durable test that the audit applies to every candidate behavior.
- **Documented superset over namespaced sidecar.** Canonical files stay where they are; do not relocate to `.thinkwork/`. Refactor cost is unjustified; every reader (admin UI, runtime, planners, future migrations) already expects current paths; "ignored by non-ThinkWork tools" is achieved by header comment + extension marker, not by directory move.
- **One-shot translation, not live sync.** Round-trip fidelity is the test; bidirectional live state is out. Two-way sync solves a coordination problem the user base does not currently have.
- **Audit is the Borrow C deliverable; refactor is downstream.** Refactor-in-this-brainstorm would balloon scope. The audit's value as a planning artifact is independent of when migrations actually land.
- **Single-spec bet across vendor surfaces.** Track Claude Code, Claude.ai Skills, Claude Agent SDK, and Codex jointly via agentskills.io; betting on convergence is more durable than betting on any one surface.
- **ThinkWork remains a consumer of agentskills.io in v1.** Spec maintainer / contributor role is a future question if it ever becomes worth the effort. Until then, the translator absorbs spec drift.

---

## Dependencies / Assumptions

- agentskills.io is hosted at `agentskills.io/specification` with a public spec and a `skills-ref` reference validator. Assumption: the spec stays stable or evolves with deprecation paths, not breaking renames. If breaking changes ship, the translator absorbs the cost — verified against agentskills.io/specification on 2026-05-12.
- ThinkWork already path-normalizes `.claude/agents/*`, `.claude/skills/*`, `.codex/agents/*` per FAT R10. The importer side is reused, not redesigned.
- Materialize-at-write-time refactor (`docs/plans/2026-04-27-003-...`) is in flight; this brainstorm composes on top of its workspace-tree-as-truth model. If that plan is paused or reversed, several requirements require re-checking against the new substrate.
- Runbooks-as-skills brainstorms (May 10, May 11) commit to SKILL.md shape. Verification of alignment under R11 is a deliverable of Borrow C, not an outcome of those brainstorms.
- Strands `server.py` auto-load behavior at the lines noted in FAT brainstorm dependencies (~274, 290, 2003) is the baseline the audit reads as-of-now.
- Computer (always-on Strands variant per 2026-05-07 commitment) shares the agent-layer file contract with conversational Strands. If a Computer-specific agent-layer file type emerges, it belongs in this contract under agent-layer — not in a parallel substrate spec.
- agentskills.io's `compatibility` field example references Claude Code, suggesting Anthropic alignment. The "single-spec across Anthropic surfaces" bet assumes that alignment continues. If Anthropic diverges its surfaces from agentskills.io, the universal-target framing requires revisiting.

---

## Outstanding Questions

### Resolve Before Planning

- (None — Borrow C product decisions are resolved in this document.)

### Deferred to Planning

- [Affects R1, R3][Technical] Final filename and placement of the canonical-file contract document. Candidates include `docs/agent-design/agentskills-contract.md`, `docs/agent-design/workspace-file-contract.md`, or a top-level `CONTRACT.md` in `packages/workspace-defaults/`. Decide at plan time alongside the Starlight section structure.
- [Affects R5][Technical] Exporter surface and implementation location: CLI command (`thinkwork agent export <slug>`), admin UI action, GraphQL mutation, or all three. Sized in the implementation plan.
- [Affects R7][Technical] Round-trip fidelity test shape: fixture-based vitest, integration test that actually round-trips through filesystem, or both? Resolved at plan time.
- [Affects R9][Needs research] Audit's outer bound: does it cover `packages/agentcore/` (tenant-router + auth-agent) or only `packages/agentcore-strands/`? Decide at plan time.
- [Affects R10][Technical] Several named behaviors in R10 may turn out to be straightforwardly agent-layer or fleet-layer once the audit looks at the actual code; the audit itself produces the final classification.
- [Affects R12][Technical] Computer-specific behaviors that may surface during the audit. If a Computer-only agent-layer file type proves needed (e.g., a runbook execution profile distinct from chat-thread profile), it lands in this contract as an agent-layer addition; the audit names it.
