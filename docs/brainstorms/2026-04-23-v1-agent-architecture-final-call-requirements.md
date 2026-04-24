---
date: 2026-04-23
topic: v1-agent-architecture-final-call
---

# V1 Agent Architecture — Final Call

## Problem Frame

Thinkwork's agent harness was right for early experimentation but has drifted toward enterprise-heavy scaffolding (four skill execution types, a parallel composition orchestrator, zero self-serve capability surface) at the same moment the industry is converging on a lean, model-driven shape: flat skill bundles, model-as-orchestrator, code sandbox as universal escape hatch, plugins as atomic install units.

We are imminently shipping to paying customers (4 enterprises × 100+ agents × ~5 templates). After launch, architectural changes that affect tenant data shape, template contracts, or agent runtime semantics become expensive. This brainstorm is the final call on v1 shape before that lock-in.

The core question is not "are we over-engineered?" (subjective) but "**whose hands can reach the capability surface?**" Today: only Thinkwork engineers via repo PRs. That makes us a vertical product, not a platform. Leanness for agents is not fewer abstractions — it is a smaller, uniform, well-defined capability unit that tenants can extend without engineering involvement.

---

## Actors

- A1. **Tenant admin** — uploads plugins, approves MCP endpoints after plugin upload, manages the tenant skill library, toggles tenant-level built-in tool kill-switches, promotes agent-authored skill drafts into the library.
- A2. **Template author** (subset of tenant admin) — wires skills to agent templates, sets template-level tool blocks, enables `skill_author` on templates that should learn.
- A3. **End user** (mobile / chat) — invokes agents; does not configure capability. May consent to per-user OAuth for MCP connections they own.
- A4. **Agent** (Strands runtime) — calls built-in tools, invokes skills via the `Skill` tool, optionally drafts new SKILL.md bundles when `skill_author` is enabled on its template.
- A5. **Thinkwork SRE** — maintains the seed skill catalog, ships platform infrastructure. **Is not a gatekeeper** for tenant uploads.

---

## Key Flows

- F1. **Tenant admin uploads a plugin**
  - **Trigger:** Tenant admin has a Claude Code plugin folder (or any Claude SKILL.md bundle).
  - **Actors:** A1
  - **Steps:** Admin uploads bundle (web, CLI, or git sync) → server validates plugin.json / SKILL.md frontmatter → skills install to tenant library → any `mcp.json` entries register as *pending* in MCP catalog → admin reviews pending MCP URLs + auth config and approves each → plugin is fully installed.
  - **Outcome:** Plugin's skills are immediately available for template assignment; approved MCP servers are available for template wiring.
  - **Covered by:** R1, R2, R3, R6, R12, R13

- F2. **Agent invokes a skill during a run**
  - **Trigger:** Model decides to call a skill during the Strands agent loop.
  - **Actors:** A4
  - **Steps:** Model calls `Skill(slug, …args)` → Strands dispatches as a tool call → if skill has `scripts/`, the relevant script executes in the Code Interpreter sandbox → if skill is pure SKILL.md, its body has already been loaded progressively via AgentSkills plugin and the model follows the instructions → skill may invoke other skills via nested `Skill` calls (no special handling — same tool path).
  - **Outcome:** Skill result returns to the agent loop; orchestration is entirely model-driven.
  - **Covered by:** R7, R8, R9, R17

- F3. **Agent authors a skill draft** (opt-in templates only)
  - **Trigger:** Agent recognizes a reusable pattern during a run and its template has `skill_author` enabled.
  - **Actors:** A4 → A1
  - **Steps:** Agent calls `skill_author` with proposed SKILL.md + optional scripts → drafts write to a tenant-scoped draft area, not the live library → tenant admin reviews draft (SKILL.md diff + scripts) → admin promotes to library (or rejects).
  - **Outcome:** Future agents on any template with that skill assigned can invoke it.
  - **Covered by:** R14, R15, R16

- F4. **Tenant disables a built-in tool**
  - **Trigger:** Compliance event — tenant needs to turn off code execution, web search, or another built-in.
  - **Actors:** A1
  - **Steps:** Admin opens tenant capabilities page → flips kill-switch for `execute_code` (or another tool) → runtime reads tenant policy on next agent session → tool is unavailable across all tenant agents without redeploy.
  - **Outcome:** Compliance posture enforced tenant-wide in one action.
  - **Covered by:** R10, R11

---

## Requirements

**Capability surface and bundle format**
- R1. Tenants can upload plugins to their own tenant library without Thinkwork engineering involvement. The in-repo skill catalog becomes the default seed set, not the only source.
- R2. Skill bundles must match the Anthropic Agent Skills spec exactly: `SKILL.md` with YAML frontmatter (`name`, `description`, `allowed-tools`, optional input/output hints), optional `scripts/` folder, optional `references/` folder. A Claude skill dropped into Thinkwork must work unmodified.
- R3. Plugins must match Claude Code's plugin format: a folder containing `plugin.json` + optional `skills/` (multiple SKILL.md bundles) + optional `mcp.json` + optional `hooks/` + optional `commands/`. A Claude Code plugin dropped into Thinkwork must install unmodified (subject to MCP approval in R13).

**Execution model**
- R4. **There is exactly one skill execution type.** The distinctions `script` / `context` / `composition` / `declarative` are removed from the data model. A skill is a SKILL.md bundle; scripts are optional files, not a type.
- R5. All skill `scripts/` Python executes inside the Bedrock AgentCore Code Interpreter sandbox. First-party (seed) and tenant-uploaded scripts follow the same dispatch path. The Strands container never runs tenant-authored code.
- R6. Orchestration is model-driven. Skills that need to invoke other skills do so via the built-in `Skill` tool (nested tool call). The parallel `composition_runner.py` code path is removed. "Workflow" lives in SKILL.md prose, not in a runtime state machine.

**Built-in tool baseline**
- R7. Every agent has the following built-in tools available by default: `execute_code` (sandbox), `web_search`, `recall` + `reflect` (memory), `artifacts` (workspace write), `Skill` (skill dispatch).
- R8. The `Skill` built-in tool is the only path for skill-to-skill invocation. Nested `Skill` calls are supported to any depth the model requires (subject to tool-call budgets).
- R9. Built-in tool registration happens once per agent session; there is no template-level declaration of which built-ins exist, only which are *blocked*.

**Compliance and kill-switches**
- R10. Tenants can globally disable any built-in tool (kill-switch) from a single admin screen. Disable takes effect on new agent sessions without redeploy. Tools with compliance/cost implications (`execute_code`, `web_search`) are the primary targets; memory tools (`recall`/`reflect`) are load-bearing and may be flagged "not recommended to disable" in UI.
- R11. Templates may additionally block specific built-in tools (template-scoped narrowing). A tool blocked at the tenant level cannot be unblocked at the template level.

**Plugin install and trust**
- R12. Plugin uploads are atomic at the plugin level: either the whole plugin installs to the tenant library or none of it does. Partial installs are not a valid state.
- R13. MCP servers shipped inside a plugin's `mcp.json` **do not auto-connect**. They register as *pending* entries in the MCP catalog and require tenant admin approval (URL + auth config review) before any agent can invoke them. Skills from the plugin install immediately; only the network-reaching MCP layer is gated.

**Agent authorship (compounding loop)**
- R14. Templates may opt in to a `skill_author` built-in tool. When enabled, the agent can produce a SKILL.md + optional scripts and write them to a tenant-scoped drafts area.
- R15. Drafts are not invocable by any agent until a tenant admin promotes them to the tenant library. The promotion action uses the same admin surface as human plugin upload.
- R16. Agents without `skill_author` in their template cannot write to the drafts area. This is a hard runtime check, not an honor system.

**Runtime and dispatch**
- R17. The Strands agent loop is the only orchestrator. Strands dispatches skill tool calls, sandbox execution, built-in tools, and MCP calls through its existing tool-call mechanism. No orchestrator runs above Strands.
- R18. AgentSkills progressive disclosure (load skill list → model picks → body loads on invocation) remains the scale strategy. Up-front injection of every skill's SKILL.md into the system prompt is explicitly rejected.

**Migration (pre-launch)**
- R19. All existing bundled skills migrate to the unified SKILL.md format before launch. The `composition` execution type is deleted from schema and runtime. The `declarative` execution type is deleted from schema and runtime.
- R20. The current declarative stubs (`frame`, `gather`, `synthesize`, `package`, `compound`, `skill-dispatcher`) dissolve into one of: (a) prose inside another skill's SKILL.md body, (b) entries in a `references/` folder, or (c) deletion. None survive as standalone invocable skills.
- R21. The current composition skills (`sales-prep`, `renewal-prep`, and any others) become regular SKILL.md skills with `allowed-tools: [Skill, ...]` and instructions for sub-skill invocation in the SKILL.md body. Their behavior must remain observably equivalent to the current composition runner output.
- R22. The current script skills become regular SKILL.md skills with scripts dispatched through the sandbox path. Execution characteristics (latency, return shape) must remain observably equivalent post-migration.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given a tenant admin has downloaded a community Claude skill bundle (`SKILL.md` + `scripts/foo.py` + `references/`), when they upload the bundle via the admin UI or `thinkwork skills push`, then the skill appears in their tenant library within seconds and can be assigned to a template without modifying the bundle's contents.
- AE2. **Covers R3, R12, R13.** Given a tenant admin uploads a plugin containing `plugin.json` + 2 skills + `mcp.json` referencing `https://vendor.example.com/mcp`, when the upload completes, then both skills are immediately assignable to templates AND the MCP endpoint appears as a *pending* entry in the MCP catalog requiring explicit admin approval before any agent can connect to it.
- AE3. **Covers R4, R5, R6.** Given a tenant-uploaded skill has a `scripts/summarize.py` that imports `pandas`, when any agent invokes the skill, then `summarize.py` executes inside the Code Interpreter sandbox with the tenant's isolated environment; it never runs inside the Strands container regardless of which template invoked it.
- AE4. **Covers R6, R17, R21.** Given `sales-prep` is invoked, when the agent processes the SKILL.md instructions, then sub-skill calls (`gather-crm-context`, `opportunity-scan`) happen as nested `Skill` tool calls in the Strands loop — not through a separate composition_runner — and the final artifact is written via the `artifacts` built-in tool.
- AE5. **Covers R10, R11.** Given tenant admin disables `execute_code` at the tenant level, when any agent on any template in that tenant starts a new session, then `execute_code` is not registered as an available tool and no template-level override can re-enable it.
- AE6. **Covers R14, R15, R16.** Given a template has `skill_author` enabled and the agent has discovered a reusable pattern, when the agent calls `skill_author` with a proposed SKILL.md, then the bundle lands in the tenant drafts area and is invisible to all other agents until an admin promotes it. An agent on a template *without* `skill_author` attempting the same call receives an "unauthorized" tool error, not a silent success.

---

## Success Criteria

- **Human outcome (platform bet validated):** A tenant admin can take any Claude-format SKILL.md bundle from any source, upload it, and an agent can invoke it within minutes — without Thinkwork engineering involvement, without a code change, without a deploy.
- **Human outcome (leanness felt):** An operator reading a template's capability surface sees one kind of skill and a flat list of built-in tools. No "execution type," no "mode," no "composition vs primitive." The mental model is Claude's, not Thinkwork's.
- **Human outcome (compounding works):** On a template with `skill_author` enabled, agents produce at least one promoted skill per week during early customer pilots, and those skills are invoked by later agents — evidence that the compounding loop closes.
- **Downstream handoff:** `ce-plan` can start tactical implementation without inventing product behavior. The decision to unify execution, collapse types, migrate bundled skills, and adopt Claude spec parity is unambiguous. The trust boundary (tenant code → sandbox only) is clear. The compounding layer (memory + agent authorship) is separated from the skill-type layer.

---

## Scope Boundaries

### Deferred for later

- **Cross-tenant marketplace / skill sharing.** V1 tenants upload to their own library only. Inter-tenant sharing is a v2 feature requiring trust, review, and rev-share decisions.
- **Skill signing / SHA256 verification at upload.** Uploaded bundles are trusted at the tenant boundary. Signing becomes relevant when marketplace lands.
- **Per-user skill enable/disable on mobile.** Tenant admin controls the library; mobile users inherit. Per-user toggles add complexity without clear v1 demand.
- **Skill versioning UX.** Re-uploading a skill overwrites; no side-by-side versions, no rollback UI in v1.
- **Per-skill cost metering and quotas.** Existing tenant-level sandbox quotas stand. Per-skill attribution is a v1.1+ concern.
- **Semver compatibility contract for SKILL.md frontmatter.** We accept whatever Anthropic ships today; breaking changes to the spec are a future migration, not a v1 compat layer.
- **GitOps / auto-sync of a plugin repo.** V1 supports upload (web + CLI). Continuous sync from a tenant git repo is a v1.1+ addition.
- **Rich draft review UI for agent-authored skills.** V1 can be plain diff + approve/reject. Inline-edit + comments ride later.

### Outside this product's identity

- **Closed marketplace with revenue share.** Thinkwork is not a skill marketplace business. Plugins may travel through community channels; we do not operate a paid distribution mechanic.
- **Human review / gatekeeping by Thinkwork staff.** SRE does not approve tenant uploads. Trust lives at the tenant boundary. An uploaded skill is the tenant's responsibility, enforced by sandbox isolation, not by human review.
- **Non-AWS runtimes.** The sandbox is AgentCore Code Interpreter. K8s, Docker Compose, Azure Container Apps, and vendor-neutral abstractions are out of scope per existing platform positioning.
- **Custom skill execution types beyond Claude's spec.** Even if a tenant wants a "workflow primitive" or "compound orchestrator" as a first-class type, the answer is "write it as SKILL.md prose" — not a new execution branch.
- **Runtime-level workflow DSLs (BPMN, state machines, etc.).** The model is the orchestrator. Compounding is memory + authorship. If a customer requires a deterministic DSL, that's a different product.

---

## Key Decisions

- **Claude Agent Skills spec parity (R2).** Rationale: credibility of the "any Claude skill works" claim; ecosystem alignment as the industry converges on this shape; avoids owning a spec we'd have to evolve.
- **Claude Code plugin format parity (R3).** Rationale: plugins already exist as the atomic-install unit in Anthropic's ecosystem; inheriting the format costs us nothing and gives tenants a portable bundle unit.
- **One skill execution type (R4, R6).** Rationale: four types were exploratory; only two are actively used; the model orchestrates better than a runner we maintain. Collapsing deletes `composition_runner.py`, the `declarative` special case, and a fork in server.py system-prompt assembly.
- **All skill scripts in sandbox, including first-party (R5).** Rationale: one execution path is crisper than bifurcation; prevents "built-in skills can reach tenant-shared state" as a category of bug; makes "any Claude skill works" literally true without trust-tier gymnastics.
- **Built-ins default-on with tenant kill-switches (R7, R10).** Rationale: Claude Code, Deep Agents, OpenAI Agents all ship code-exec default-on. Over-gating baseline agent capability makes Thinkwork feel like a form-filling exercise. Compliance is addressed by kill-switches, not by default-off.
- **Pre-launch migration of bundled skills (R19-R22).** Rationale: the user explicitly flagged that post-launch architecture changes are expensive. Shipping v1 with a dual-path (legacy + new) guarantees the legacy path survives forever. One model at launch is cheaper than two models post-launch.
- **MCP endpoints from uploaded plugins require admin approval (R13).** Rationale: an uploaded plugin can point `mcp.json` at any URL. Auto-connecting would let a malicious plugin exfiltrate per-user OAuth tokens to an attacker endpoint. Skills install immediately (sandbox-isolated); only network-reaching MCP is gated.
- **Compounding via memory + agent authorship, not execution-type primitives (R14-R16).** Rationale: compounding is a property of how the system learns, not a type of skill. Hindsight already handles cross-run learning. Agent-authored drafts handle reusable-pattern capture. These are the right layers; a runtime orchestrator is not.

---

## Dependencies / Assumptions

- **Bedrock AgentCore Code Interpreter supports per-skill script dispatch** — dispatch pattern is `writeFiles` + `executeCode("from scripts.<slug>.entrypoint import run; …")`. Verified against AWS documentation; confirmed as the industry idiom.
- **Claude Agent Skills spec has a stable enough v1 shape** that we can build against it without weekly churn. Treating the spec as a moving target post-launch is acceptable; assuming it is stable *enough* that our frontmatter parser does not rewrite itself monthly is the bet.
- **Claude Code plugin format's `plugin.json` schema is published and documented** — verified against code.claude.com/docs/en/plugins-reference.
- **AgentSkills progressive disclosure scales to tenant-uploaded skill counts** (hundreds of skills per tenant, not just dozens).
- **Existing Hindsight recall/reflect is the correct memory foundation for the compounding loop.** No architectural change to memory is proposed here.
- **Sandbox quotas will not be the binding constraint for early pilots.** Revisit with real usage data.

---

## Outstanding Questions

### Resolve Before Planning

- *(none — all product decisions made in this brainstorm.)*

### Deferred to Planning

- [Affects R5][Needs research] AgentCore Code Interpreter dispatch mechanism: can a session load multiple `scripts/*.py` + `references/*` files and invoke by entrypoint, or is every skill script a fresh `execute_code` inline call with the script body?
- [Affects R7, R8][Technical] `Skill` built-in tool signature: is it a single meta-tool `Skill(name, args)`, or does each skill register as its own named tool? Implications for progressive disclosure and token budget.
- [Affects R19-R22][Technical] Rollout sequence for pre-launch migration: which skill migrates first, what's the verification harness for "observably equivalent output," and which skills can be migrated behind a feature flag vs. atomically.
- [Affects R14, R15][Technical] Draft storage location and access control: S3 prefix shape, IAM scoping, admin UI for draft review, what metadata is captured at author-time.
- [Affects R11][Technical] `allowed-tools` enforcement point: middleware in the Strands tool-call path, or in the tool dispatcher itself.
- [Affects R12, R13][Technical] Plugin install transaction boundary: Postgres transaction over catalog writes + S3 upload atomicity + MCP pending-state creation. Compensating actions on partial failure.
- [Affects R3][Needs research] Claude Code `hooks/` and `commands/` semantics when a plugin is installed into Thinkwork: honor, ignore, or validate-and-reject?
- [Affects R7][Technical] Is `web_search` a bundled first-party skill or a native built-in tool?

---

## Next Steps

-> `/ce-plan` for structured implementation planning of the pre-launch migration and the upload / sandbox-dispatch / plugin-install infrastructure.
