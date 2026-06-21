---
date: 2026-06-21
topic: skill-creator-system
---

# Skill Creator System Requirements

## Problem Frame

ThinkWork needs a governed way for users to turn a thread, repeated workflow, or source artifact into a reusable Agent Skill and publish it into the tenant Skill Library. Today ThinkWork already treats Agent Skills as the portable skill contract, stores tenant catalog source in S3, supports Skill Library import/export, and exposes `/skill` in the composer for force-pinning existing skills onto a turn. What is missing is the authoring workflow that helps users create a high-quality skill, verify it against spec and best practices, attach trust evidence, and submit it for approval.

The system should feel available from any thread through `/skill-creator`, but publishing a new catalog capability is a governed action. First-release decision: any thread user can draft a skill and request approval; only a tenant operator can approve publication into the Skill Library.

---

## Actors

- A1. Thread user: starts `/skill-creator`, explains the workflow to capture, reviews drafts, and requests approval.
- A2. Tenant operator: reviews generated skills, trust evidence, accepted risks, and approves or rejects publication.
- A3. Skill Creator agent: interviews the user, extracts reusable instructions, drafts files, creates eval prompts, runs validation, and prepares the review packet.
- A4. Skill Library system: stores approved skills in the tenant S3 catalog, maintains the catalog index, and preserves installed-copy update semantics.
- A5. Trust pipeline: validates Agent Skills spec compliance, runs NVIDIA SkillSpector, produces a skill card, verifies or creates signing evidence, and records release artifacts.

---

## Key Flows

- F1. Create a draft skill from a thread
  - **Trigger:** A user invokes `/skill-creator` in any thread.
  - **Actors:** A1, A3
  - **Steps:** The creator reads the available thread context, asks focused questions about intent, trigger conditions, expected output, source material, tools, permissions, and tests, then drafts a skill pack.
  - **Outcome:** The user has a draft skill folder and review packet, but nothing is published to the Skill Library yet.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Verify and refine the draft
  - **Trigger:** The draft skill is ready for checking.
  - **Actors:** A1, A3, A5
  - **Steps:** The system validates Agent Skills format, checks authoring best practices, runs test prompts/evals where useful, runs SkillSpector, generates a skill card, and asks the user to inspect outputs before requesting approval.
  - **Outcome:** The draft either has a complete review packet or a clear list of issues to fix before approval.
  - **Covered by:** R6, R7, R8, R9, R10, R11, R12

- F3. Approve and publish
  - **Trigger:** The user submits the verified draft for Skill Library approval.
  - **Actors:** A1, A2, A4, A5
  - **Steps:** The tenant operator reviews the skill files, generated evidence, warnings, and any accepted-risk notes. On approval, ThinkWork publishes the skill to the tenant catalog and refreshes the index.
  - **Outcome:** The skill appears in the Skill Library and becomes installable or pinnable through existing catalog flows.
  - **Covered by:** R13, R14, R15, R16

- F4. Import or update an externally authored skill
  - **Trigger:** A user or operator brings in a skill archive, repository, or upstream skill reference.
  - **Actors:** A2, A4, A5
  - **Steps:** ThinkWork validates the pack, runs the trust pipeline before install, verifies signatures when present, handles slug collisions through explicit confirmation, and keeps installed copies unchanged until an operator applies the update.
  - **Outcome:** External skills enter the same Skill Library and evidence model as generated skills.
  - **Covered by:** R14, R15, R16, R17, R18

---

## Requirements

**Slash-command authoring**

- R1. `/skill-creator` is available from any thread surface where a user can ask an agent to work; it starts a skill-creation workflow rather than force-pinning an existing skill.
- R2. `/skill` continues to mean "pin an existing catalog skill onto this turn"; `/skill-creator` must not change that behavior.
- R3. The creator starts from available thread context when useful, but it must confirm the reusable intent before drafting: what the skill enables, when it should trigger, expected outputs, source material, tool/API needs, permissions, and useful test cases.
- R4. The creator asks questions progressively and keeps non-expert users oriented; technical terms such as evals, JSON, SARIF, or signatures are explained when the user has not signaled familiarity.
- R5. The creator can draft from three source modes: current thread/workflow extraction, user-provided source artifacts, or modification of an existing skill.

**Draft artifact**

- R6. Generated skills conform to the Agent Skills specification: valid directory/name match, `SKILL.md` frontmatter with required `name` and `description`, relative references, and optional `scripts/`, `references/`, `assets/`, and `evals/` as needed.
- R7. Generated instructions follow Agent Skills best practices: grounded in real expertise, scoped as a coherent unit, concise in `SKILL.md`, progressively disclosed through references, and calibrated between flexible guidance and fragile-step procedures.
- R8. Drafts include a clear trigger description, expected output shape, declared tool/network/file/MCP capabilities when relevant, and a plain-language risk summary.
- R9. The generated draft remains unpublished until approval. Users can revise it with the creator and preview the review packet before requesting operator approval.

**Evaluation and authoring quality**

- R10. The creator proposes realistic test prompts before publishing. Skills with objectively checkable behavior should include eval cases; subjective or creative skills may rely on human review plus a smaller smoke-test set.
- R11. When eval cases exist, they use the existing ThinkWork skill-eval/trust-core direction: per-skill cases, isolated execution where possible, and `pass | fail | error` verdict semantics rather than a parallel scoring system.
- R12. The review packet includes human-readable test output and, when available, `evals/evals.json` and `BENCHMARK.md` or equivalent benchmark evidence.

**Trust pipeline**

- R13. Every generated or imported skill runs an Agent Skills spec validation step before publication; invalid skills cannot be approved until fixed.
- R14. Every generated or imported skill runs the upstream NVIDIA SkillSpector scanner against the complete skill directory before publication. Critical or high findings block approval unless a tenant operator explicitly records a formal acceptance rationale.
- R15. The system generates or requires a skill card before approval, using NVIDIA's Skill Card template as the source of truth for owner, license/terms, use case, deployment geography, risks, outputs, references, evaluation evidence, version, and ethical considerations.
- R16. Approved releases store the trust evidence with the skill: scan report or CI link, skill card, eval evidence when present, accepted-risk notes, signature verification result when present, and approval decision.
- R17. Signed external skills must be verified before installation when `skill.oms.sig` is present. For ThinkWork-generated skills, the release packet should support OMS signing as the target enterprise posture; if signing infrastructure is not yet configured, the Skill Library must clearly mark the release as unsigned rather than imply signature coverage.

**Skill Library publication**

- R18. Approval publishes into the tenant Skill Library source of truth, reusing the existing catalog/import/index behavior rather than creating a second skill storage path.
- R19. If a generated or imported skill collides with an existing catalog slug, replacement requires explicit operator confirmation and does not mutate already-installed workspace copies until the existing update/apply path is used.
- R20. Published skills become visible through existing Skill Library inspection, install, export, eval score, and composer skill-picker surfaces.

**Upstream reuse**

- R21. ThinkWork should treat Anthropic's `skill-creator` skill, Agent Skills docs, NVIDIA SkillSpector, NVIDIA Skill Card template, and NVIDIA/OMS signing guidance as upstream dependencies to consume and refresh, not as one-off copied prose.
- R22. Where an upstream artifact is itself an Agent Skill or executable tool, ThinkWork should integrate that artifact directly or through a thin wrapper so updates can be adopted intentionally with version/source evidence.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a user is in a thread where an agent just completed a repeatable workflow, when the user types `/skill-creator`, the system starts a creation interview based on the thread context and does not open the existing `/skill` pin menu.
- AE2. **Covers R6, R7, R8, R13.** Given the creator drafts `invoice-review`, when validation runs, the skill must have valid `name: invoice-review`, a matching folder slug, a useful trigger description, relative references, and no invalid frontmatter before it can be submitted for approval.
- AE3. **Covers R10, R11, R12.** Given a file-transform skill with deterministic expected behavior, when the creator prepares the review packet, it proposes realistic eval prompts, records expected outcomes, and includes runnable skill-eval evidence or a clear reason evals were skipped.
- AE4. **Covers R14, R15, R16.** Given SkillSpector reports a high-severity data-exfiltration finding, when a user requests approval, the tenant operator sees the finding in the review packet and approval is blocked unless the operator records a formal acceptance rationale.
- AE5. **Covers R17.** Given an imported skill includes `skill.oms.sig`, when the trust pipeline runs, ThinkWork verifies the signature against the expected trust anchor and records the result before install.
- AE6. **Covers R18, R19, R20.** Given an approved draft has slug `crm-lookup` and the catalog already has `crm-lookup`, when the operator confirms replacement, the Skill Library item updates but installed agent copies remain unchanged until explicitly updated.

---

## Success Criteria

- A user can turn a real thread or artifact into a useful skill without knowing the Agent Skills specification in advance.
- A tenant operator can decide whether to publish a generated skill from a single review packet that includes intent, files, tests, risks, scan evidence, and approval state.
- The Skill Library trust story is credible for enterprise buyers: ThinkWork can say generated and imported skills pass a pipeline based on Agent Skills spec validation, NVIDIA SkillSpector, skill cards, eval artifacts where relevant, and OMS-compatible signature handling.
- Downstream planning can implement the system by composing with existing Skill Library catalog/import/update/eval flows rather than inventing a second skill system.

---

## Scope Boundaries

- V1 does not make every thread user a publisher. Drafting can be broad; catalog mutation remains approval-gated.
- V1 does not replace `/skill` force-pinning; `/skill-creator` is a separate command.
- V1 does not require automatic self-improvement of skills after publication. Eval-driven skill updater behavior remains a follow-on.
- V1 does not require live sync with Anthropic, NVIDIA, or external skill repositories. Upstream artifacts are versioned and refreshable, not continuously mirrored into tenant catalogs without review.
- V1 does not auto-install generated skills into agents. Publication to the Skill Library and installation into an agent/workspace remain distinct actions.
- V1 does not treat a clean scanner result as proof of safety. The pipeline provides evidence for review; operator approval is still required.

---

## Key Decisions

- Draft broadly, publish narrowly: any thread user can start a skill draft, but tenant operators approve catalog publication.
- Reuse the existing Skill Library source of truth: approved skills land in the tenant S3 skill catalog and derived `skill_catalog` index.
- Treat trust evidence as part of the release packet: scan reports, skill cards, eval evidence, accepted risks, and signature status travel with the skill.
- Integrate upstream tools and templates rather than freezing copied versions: Anthropic's creator workflow and NVIDIA's scanner/card/signing guidance should remain visible upstream dependencies.
- Keep `/skill-creator` distinct from `/skill`: the existing composer skill pinning behavior remains stable.

---

## Dependencies / Assumptions

- Existing Skill Library import/export behavior already accepts single-skill archives and generates default `WIRING.md` when absent.
- Existing catalog storage remains `tenants/<tenant-slug>/skill-catalog/<skill-slug>/`, with the database `skill_catalog` table as a derived index.
- Existing `/skill` composer behavior pins catalog skills per turn through message metadata and runtime pinned-skill config.
- Existing skill-eval and trust-core work supplies the preferred eval substrate; this brainstorm does not design a second eval engine.
- NVIDIA SkillSpector is available as an upstream Apache-2.0 scanner with CLI, Docker, JSON/Markdown/SARIF output, and optional LLM semantic analysis.
- NVIDIA's Skill Card source is currently a template-style markdown artifact; ThinkWork should consume it as upstream source material and adapt it into the review workflow without misrepresenting it as an Agent Skills-compliant `SKILL.md` unless NVIDIA publishes one.

---

## Outstanding Questions

### Resolve Before Planning

- None. The actor model above is an explicit first-release decision: draft broadly, publish narrowly.

### Deferred to Planning

- [Affects R1, R2][Technical] Exact composer command registration shape for `/skill-creator` alongside the existing `/skill` menu.
- [Affects R9, R16][Technical] Where draft skill packs and review packets live before approval.
- [Affects R14][Technical] Whether SkillSpector runs in Lambda, ECS, an isolated runner, or CI, and which reports are persisted.
- [Affects R15, R16][Technical] Exact Skill Card storage filename and rendering surface in Skill Library detail.
- [Affects R17][Technical] ThinkWork signing posture for generated skills: verify-only in v1, or also sign with a ThinkWork-managed OMS-compatible certificate.
- [Affects R21, R22][Needs research] Versioning and refresh policy for upstream Anthropic and NVIDIA artifacts, including license and attribution handling.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.

---

## Sources / Research

- Linear issue: THNK-11, "Skill Creator Skill".
- Anthropic skill creator: https://github.com/anthropics/skills/tree/main/skills/skill-creator
- Agent Skills specification: https://agentskills.io/specification
- Agent Skills best practices: https://agentskills.io/skill-creation/best-practices
- NVIDIA trust pipeline: https://docs.nvidia.com/skills/agent-skill-trust-pipeline
- NVIDIA SkillSpector scanning: https://docs.nvidia.com/skills/scanning-agent-skills
- NVIDIA release checklist: https://docs.nvidia.com/skills/release-checklist
- NVIDIA skill cards: https://docs.nvidia.com/skills/skill-cards
- NVIDIA signed skills guidance: https://docs.nvidia.com/skills/signing-agent-skills
- NVIDIA SkillSpector repository: https://github.com/NVIDIA/SkillSpector
- NVIDIA Skill Card template: https://github.com/NVIDIA/Trustworthy-AI/blob/main/Skill%20Card.md
- Local precedent: `docs/brainstorms/2026-05-12-agentskills-contract-and-portability-requirements.md`
- Local precedent: `docs/brainstorms/2026-06-20-skill-library-export-import-requirements.md`
- Local precedent: `docs/brainstorms/2026-06-13-skill-tests-and-evals-requirements.md`
- Local context: `apps/web/src/components/spaces/SkillMenu.tsx`
- Local context: `packages/api/src/lib/catalog-skill-archive.ts`
- Local context: `packages/database-pg/graphql/types/skill-catalog.graphql`
