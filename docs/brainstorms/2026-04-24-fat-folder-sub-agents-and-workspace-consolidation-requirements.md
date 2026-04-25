---
date: 2026-04-24
topic: fat-folder-sub-agents-and-workspace-consolidation
---

# Fat-folder Sub-agents and Workspace Consolidation

## Problem Frame

ThinkWork's Strands runtime already implements the "folder is the agent" pattern that FOG (Folder Organization Guide) and FITA (every.to "The Folder Is the Agent") describe: `AGENTS.md` loaded as a Layer-1 Map, `CONTEXT.md` per sub-workspace, `delegate_to_workspace` for isolated specialist delegation, and `ROUTER.md` profiles for channel-scoped file loading. But three drift points make this invisible and under-used:

1. **Seeds scatter across three packages** (`packages/system-workspace/`, `packages/memory-templates/`, `packages/workspace-defaults/files/`) with overlapping, inconsistent content. Template authors have no single source of truth.
2. **The 2026-04-21 `agent-workspace-files-requirements.md` brainstorm deferred sub-workspaces as out-of-scope**, even though the runtime already ships `delegate_to_workspace` and the shipped `ROUTER.md` describes sub-workspaces explicitly. The doc does not match what the code does.
3. **Distribution is the load-bearing product constraint but gets no architectural attention.** The FOG/FITA ecosystem produces reusable skill bundles as folders. If ThinkWork cannot run them unchanged (modulo a trivial path normalization), users lose the value of the emerging skill ecosystem when they adopt ThinkWork — and the project fails on its primary adoption promise.

Maximum compatibility with the cross-vendor folder-as-agent pattern is the decisive goal, and the architecture must be **vendor-neutral** — ThinkWork runs Bedrock models, not just Claude, and there is no cross-vendor standard for sub-agent folders (FITA's `.claude/agents/` is Anthropic-specific; FOG uses plain root-level folders). ThinkWork adopts the FOG-pure layout: sub-agents are plain folders, enumerated by their parent's `AGENTS.md` routing table. Vendor-specific imports (`.claude/agents/*`, `.claude/skills/*`) are path-normalized on ingest.

A secondary but important product insight: with this architecture, the admin UI stops being a "workspace editor" and becomes a **web-based agent builder** — the flagship authoring surface where folder + content *is* the agent. Snippets, starter templates, drag-to-organize, and live composed-view previewing are first-class features, not polish.

---

## Visual: Folder layout (vendor-neutral, FOG-pure)

```
{agent}/                         ← the agent IS this folder
├── AGENTS.md                    ← Layer-1 Map (routing table enumerates sub-agents)
├── IDENTITY.md                  ← Who I am
├── SOUL.md                      ← Personality / vibe
├── USER.md                      ← Human I'm paired with (server-managed)
├── GUARDRAILS.md                ← Safety rules
├── PLATFORM.md                  ← Platform context
├── CAPABILITIES.md              ← Tools overview
├── MEMORY_GUIDE.md              ← How I handle memory
├── ROUTER.md                    ← Context profiles per channel
├── TOOLS.md                     ← Skill / tool details
├── CONTEXT.md                   ← Root folder scope
├── memory/                      ← RESERVED: working notes (lessons / preferences / contacts)
├── skills/                      ← RESERVED: local skill overrides (SKILL.md per slug)
├── expenses/                    ← sub-agent folder (enumerated in AGENTS.md)
│   ├── AGENTS.md                ← sub-agent's own map (optional; inherits)
│   ├── CONTEXT.md               ← typical starting file for a sub-agent
│   ├── GUARDRAILS.md            ← optional override
│   ├── memory/
│   ├── skills/                  ← scoped to this sub-agent
│   └── escalation/              ← recursion legal (sub-sub-agent)
│       └── CONTEXT.md
└── recruiting/
    └── CONTEXT.md               ← a minimally-populated sub-agent inherits everything else
```

**Two rules hold the whole thing together:**

1. **Reserved folder names at any depth: `memory/` and `skills/`.** These are platform-meaningful and are never treated as sub-agents, regardless of whether they appear in an `AGENTS.md` routing table. The reserved list is locked in v1 — extending it is an explicit future PR with a migration path for agents that name a sub-agent the same.
2. **Sub-agents are enumerated by `AGENTS.md`'s routing table, not by folder scan.** A folder is a sub-agent only if the parent's `AGENTS.md` routing table references it (as a `Go to` target). Unreferenced folders are just data — scratch files, attachments, imported assets. This is how FOG works; it removes the need for any magic prefix.

**Inheritance walk** — a sub-agent's composed workspace resolves each canonical file by walking upward until it finds a match. For `{agent}/expenses/IDENTITY.md`:

```
agent override       {agent}/expenses/IDENTITY.md
parent override      {agent}/IDENTITY.md
template sub-agent   _catalog/{template}/expenses/IDENTITY.md    (if declared)
template root        _catalog/{template}/IDENTITY.md
defaults root        _catalog/defaults/workspace/IDENTITY.md
```

First hit wins. Absent files fall through. The rule is universal — no per-file exceptions.

---

## Actors

- A1. **Template author** — platform engineer (per enterprise or platform-wide). Designs canonical templates by editing `packages/workspace-defaults/files/` for system defaults, or by authoring tenant-specific templates through the agent builder.
- A2. **Tenant operator** — admin user at an enterprise. Creates agents from templates, overrides files per agent, imports external folder bundles via the agent builder, assigns humans to agents.
- A3. **Paired human** — end user chatting with an agent through mobile/admin surfaces. Never authors workspace files directly, but their identity shapes `USER.md` server-side.
- A4. **Agent runtime (Strands)** — loads the composed workspace on boot, routes via `AGENTS.md`, delegates to named sub-agent folders via the existing `delegate_to_workspace` tool.
- A5. **Sub-agent (specialist, delegated)** — a Fat folder at some depth of the agent tree, enumerated in a parent's `AGENTS.md` routing table. When the parent delegates, the sub-agent runs in a separate context window with its own composed workspace (inheriting from ancestor folders for absent files).
- A6. **Ecosystem author** — third-party publishes a folder-shaped agent/skill bundle on GitHub (FOG, FITA, Codex, or future vendor layouts). Expects it to run after a path-normalization step rather than content transformation.

---

## Key Flows

- F1. **Template inheritance on agent create**
  - **Trigger:** Operator creates a new agent from a template.
  - **Actors:** A2, A4.
  - **Steps:** The agent's S3 prefix is initialized empty. On first read/boot, the composer walks each requested file path upward through agent override → template → defaults, returning the first match. No files are copied forward.
  - **Outcome:** The new agent behaves per its template from second zero; a later template edit to a live-class file propagates to this agent on the next read.
  - **Covered by:** R5, R7, R8.

- F2. **External folder import (FOG / FITA / other)**
  - **Trigger:** Operator uploads a folder bundle (zip, tar, or git ref) to an existing agent via the agent builder (or CLI).
  - **Actors:** A2, A6.
  - **Steps:** Importer runs safety checks (SI-4 zip-safety + prompt-injection sanitization per 2026-04-21 R2), **normalizes any vendor-specific paths** — `.claude/agents/{slug}/` → `{slug}/`, `.claude/skills/{slug}/` → `skills/{slug}/`, similar for `.codex/`, `.gemini/`, etc. — then resolves any collision with an existing sub-agent folder, and writes the content 1:1 into the agent's S3 prefix under the normalized paths. Content is never transformed. If the imported bundle has an `AGENTS.md`, any routing rows that reference the vendor-specific paths are rewritten to the normalized ones.
  - **Outcome:** The sub-agent is immediately available to the parent's `delegate_to_workspace` tool (after a row is added to the parent's `AGENTS.md`, auto-generated if absent), with its composed workspace walking the normal inheritance chain.
  - **Covered by:** R10, R11, R12.

- F3. **Sub-agent delegation at runtime**
  - **Trigger:** Parent agent decides (per its `AGENTS.md` routing table or prompt reasoning) to delegate to a sub-agent.
  - **Actors:** A4, A5.
  - **Steps:** Parent calls `delegate_to_workspace(path)` where path is a sub-agent folder path (`expenses` or `support/escalation` for nested). Runtime composes the sub-agent's workspace by walking the inheritance chain, parses the sub-agent's composed `AGENTS.md` routing table to resolve its scoped skill set (local `skills/*` first, platform `skill-catalog` by slug second), spawns a new context window with that system prompt + resolved skills + scoped KBs, forwards the delegated task. Sub-agent responds; parent summarizes in its own voice.
  - **Outcome:** Specialist isolation without cross-agent RPC; sub-agent memory writes stay scoped to its folder; sub-agent's skill set is determined by its composed folder tree (not the parent's DB-row skills_config); parent retains the orchestration loop.
  - **Covered by:** R9, R14, R21, R22, R23.

- F4. **Template swap**
  - **Trigger:** Operator changes an agent's template (agent builder "Change Template" action).
  - **Actors:** A2.
  - **Steps:** Agent builder lists every override path in the composed tree (root files and sub-agent files) with a "N overrides will be replaced" summary. Operator confirms. All agent-scoped overrides are deleted; the composed tree now resolves through the new template → defaults chain.
  - **Outcome:** Destructive, deterministic, no merge. If the operator wants to preserve overrides, they re-apply them manually after swap.
  - **Covered by:** R15.

---

## Requirements

**Canonical root file set**

- R1. The default root workspace file set is: `AGENTS.md`, `IDENTITY.md`, `SOUL.md`, `USER.md`, `GUARDRAILS.md`, `PLATFORM.md`, `CAPABILITIES.md`, `MEMORY_GUIDE.md`, `ROUTER.md`, `TOOLS.md`, `CONTEXT.md`, plus `memory/lessons.md`, `memory/preferences.md`, `memory/contacts.md`. Every file ships populated with opinionated starter content; none may be empty stubs at deploy time.
- R2. `AGENTS.md` at every folder level is the Layer-1 Map for that folder. At root, it contains: a one-paragraph "who I am and what this project is," a folder-structure overview of the canonical file set, a routing table (FOG-compatible `| Task | Go to | Read | Skills |` format) that **enumerates sub-agent folders**, and a naming-conventions section. The file fits within roughly one screen; longer content moves into referenced files.

**Seed source consolidation**

- R3. `packages/workspace-defaults/` is the single canonical source of truth for default workspace content. The files and subfolders in `packages/system-workspace/` and `packages/memory-templates/` are moved into `packages/workspace-defaults/files/` and those two packages are retired in the same PR. No deprecation aliases.
- R4. Default workspace content ships as source-controlled markdown in `packages/workspace-defaults/files/`. A deploy-time job mirrors the contents to every tenant's `_catalog/defaults/workspace/` S3 prefix on tenant creation and on a re-seed action. Updates to the package flow to tenants on deploy — planning defines the exact re-seed trigger.

**Fat-native sub-agent folders**

- R5. Sub-agents live at `{agent}/{slug}/` — any folder at any depth whose path is referenced as a `Go to` target by an ancestor's `AGENTS.md` routing table. Each sub-agent folder may contain any subset of the canonical file set (`CONTEXT.md` is typical but not strictly required), plus its own `memory/` and `skills/` subfolders, plus nested sub-agent folders of its own for recursion.
- R6. `USER.md` follows the same universal overlay rule as every other file — a sub-agent may declare its own `USER.md`. When present, the server's human-assignment event writes to every `USER.md` in the composed tree synchronously (extension of 2026-04-21 R9). Default templates ship `USER.md` at the root only.
- R7. File resolution walks upward through the folder tree: `{agent}/{parent-path}/{slug}/{file}` → `{agent}/{parent-path}/{file}` → ... up to `{agent}/{file}` → `_catalog/{template}/{parent-path}/{slug}/{file}` (if declared) → `_catalog/{template}/{file}` → `_catalog/defaults/workspace/{file}`. First matching file wins. Absent files fall through. No per-file exceptions to the walk.
- R8. A sub-agent folder containing only `CONTEXT.md` inherits everything else from ancestor folders and behaves as a thin specialist. A sub-agent folder with a full override set behaves as an independent Fat sub-agent. The runtime treats both identically — the shape is determined by which files are present, not by a declared type.
- R9. The existing `delegate_to_workspace` tool accepts a sub-agent folder path (e.g. `expenses` or `support/escalation`) rather than an opaque slug. The runtime composes the sub-agent's workspace, spawns a new context window with that system prompt and the sub-agent's scoped skills and KBs, and forwards the delegated task. The parent summarizes the sub-agent's response in its own voice.
- R25. **Reserved folder names at any depth: `memory/` and `skills/`.** These are never treated as sub-agents, regardless of whether a routing table references them. Attempting to enumerate either as a `Go to` target in `AGENTS.md` is a lint error surfaced in the agent builder. Extending the reserved list in a future release requires an explicit migration for tenants whose agents name a sub-agent the same.

**External folder import (FOG / FITA / vendor-neutral)**

- R10. The agent builder (and the `thinkwork` CLI) supports importing a folder bundle as a sub-agent. Accepted input formats: uploaded zip/tar, and a git ref (repo URL + optional branch/tag). The importer validates folder structure, runs safety checks (SI-4 zip-safety + prompt-injection sanitization per 2026-04-21 R2), **path-normalizes vendor prefixes** (`.claude/agents/*` → `*`, `.claude/skills/*` → `skills/*`, `.codex/agents/*` → `*`, etc.), and lands the content 1:1 under the normalized paths. Content of recognized canonical files is never transformed.
- R11. Files in the imported folder beyond the canonical file set are preserved unchanged. They do not participate in the runtime auto-load but remain readable by the agent via existing file-read tools. Operators can view and delete them through the agent builder.
- R12. Import failure modes are surfaced as explicit agent-builder errors, never silent fallbacks: invalid folder structure, SI-4 safety flag, collision with an existing sub-agent slug (admin chooses replace / rename / abort), schema violation on a recognized file, reserved-name conflict (an imported folder named `memory/` or `skills/` that isn't the reserved meaning). Planning defines the exact failure taxonomy.

**Agent Builder (admin UI)**

- R13. The agent builder is a web-based, folder-tree authoring surface — the canonical surface for creating and editing agents at enterprise scale; no external tool (CLI, git, IDE) is required for any common agent-creation or -editing action. The builder renders the full composed tree as folder navigation, and every folder and every file shows an inheritance indicator (`[inherited]` | `[overridden]` | `[template update available]`) with the source it resolves to. Operators can create new sub-agent folders, override files within them, delete overrides to revert, and edit `AGENTS.md` routing rows inline.
- R14. Pinned-class files (`GUARDRAILS.md`, `PLATFORM.md`, `CAPABILITIES.md` per 2026-04-21 R8a) retain pinned-propagation semantics at every folder level, not only at root. A template update to `_catalog/{template}/expenses/GUARDRAILS.md` surfaces as "Template update available" on that specific file in the expenses sub-agent folder of every agent using the template; acceptance is per-file per-folder.
- R15. Template swap is destructive for all agent-scoped overrides in the composed tree. The agent builder shows an explicit confirmation listing the exact paths that will be replaced (e.g., `IDENTITY.md`, `expenses/CONTEXT.md`, `expenses/GUARDRAILS.md`) before commit. No automatic merge with the new template's sub-agent set.
- R26. The agent builder ships **starter snippets and starter templates** from day one:
  - Snippets: insertable fragments for common patterns — an `AGENTS.md` routing-table row, a common `GUARDRAILS.md` section (e.g., PII redaction, EEOC-compliance), an `IDENTITY.md` voice block, a skill-row example, a `ROUTER.md` channel-profile stub.
  - Starter templates: named skeletons that spawn a ready-to-edit tree ("Single-agent"; "Delegator with 2 specialists"; "Multi-specialist team"). Applying a starter template seeds the root + a nominal set of sub-agent folders with placeholder `CONTEXT.md` and a populated `AGENTS.md` routing table.
- R27. Sub-agent creation in the agent builder is **drag-to-organize**: operators create/rename/move sub-agent folders in the tree UI, and the builder automatically keeps the ancestor `AGENTS.md` routing table rows in sync (add, rename, remove). Direct editing of the routing table is also supported; the builder resolves round-trip consistency (editing the tree or editing the table converge to the same model).

**Mental-model documentation**

- R16. Two complementary docs ship:
  (a) **`AGENTS.md` in `packages/workspace-defaults/files/`** — routing-table-focused, one-screen, loaded into every agent invocation. Audience: the agent itself.
  (b) **`/docs/agent-design/` Starlight section** — philosophy, template authoring guide, full inheritance rules, FOG/FITA import walkthrough, video/article references, worked examples for each canonical file. Audience: template authors and operators.
- R17. Both docs explicitly map the ThinkWork canonical file set to the FOG 3-layer model (Map / Rooms / Tools) and to FITA's "folder is the agent" thesis, and explain the vendor-neutral path-normalization rule for imports. Users arriving from any ecosystem can orient on ThinkWork's layout by recognizing familiar terms.

**Workspace-Skills unification**

- R20. Workspace editing and per-agent skill assignment consolidate into a single folder-based agent builder (R13). The standalone skill-assignment surface (list of skill slugs attached to an agent row) is retired. Operators edit skills inline within the folder they apply to.
- R21. Each folder's scoped skill set is declared in that folder's `AGENTS.md` routing table, in a FOG-compatible `| Task | Go to | Read | Skills |` structure. Skills listed in a row apply when the parent (running with that `AGENTS.md`) delegates to the row's target folder. A sub-agent's own scoped skills — what it runs with when invoked — resolve through inheritance from its composed `AGENTS.md` walking up the folder tree.
- R22. Local skills at `{folder}/skills/{slug}/SKILL.md` are valid at any folder depth. When an `AGENTS.md` row references a skill slug, resolution order is: (1) local `skills/{slug}/` in the current folder, (2) local `skills/{slug}/` in any ancestor folder walking up, (3) platform `packages/skill-catalog/{slug}/`. First match wins — same inheritance mechanics as canonical files.
- R23. On sub-agent delegation (F3), the Strands runtime rebuilds `skills_config` from the composed workspace tree by parsing the sub-agent's composed `AGENTS.md` and resolving each referenced slug per R22. The parent's DB-row `skills_config` becomes derivative of composed folder declarations (computed on save), not the runtime source of truth.

**Migration / backfill**

- R18. The 4 existing agents (copy-on-create vestiges) migrate per 2026-04-21 R18, extended for Fat: the reverse-substitute comparator runs against root files, any sub-agent folders declared on their templates materialize as empty-override folders in the agent's S3 prefix, and the migration emits a dry-run report before the destructive copy-removal step.
- R19. Retirement of `packages/system-workspace/` and `packages/memory-templates/` is a single PR. All repo references (runtime bundle paths, admin-UI imports, CLI asset paths) update in the same PR. No parallel-path period.
- R24. `ROUTER.md`'s `- skills:` directive is removed as part of the Option-3 switch; `ROUTER.md` retains its channel-profile file-selection role (`- load:`, `- skip:`) but no longer governs skill scope. Any agent whose shipped `ROUTER.md` uses `- skills:` at migration time has those declarations translated into the root `AGENTS.md` routing table during backfill.

---

## Acceptance Examples

- AE1. **Covers R10, R11.** Given an operator uploads a zip containing `.claude/agents/expenses/` with `CONTEXT.md`, `IDENTITY.md`, `GUARDRAILS.md`, `memory/lessons.md`, and a `NOTES.md`, when the import completes, the content lands at `{agent}/expenses/{CONTEXT.md, IDENTITY.md, GUARDRAILS.md, memory/lessons.md, NOTES.md}` (the `.claude/agents/` prefix is stripped). The agent builder shows `CONTEXT/IDENTITY/GUARDRAILS/memory/lessons` as `[overridden]` inheritance indicators and `NOTES.md` as a non-canonical retained file. The parent's `AGENTS.md` routing table is auto-updated with an `expenses` row if absent.
- AE2. **Covers R5, R7, R8.** Given sub-agent `recruiting/` contains only `CONTEXT.md`, when the parent delegates to `recruiting`, the runtime composes `IDENTITY.md`, `SOUL.md`, `USER.md`, `GUARDRAILS.md`, `PLATFORM.md`, `CAPABILITIES.md`, `MEMORY_GUIDE.md`, `TOOLS.md` from the parent agent folder and `CONTEXT.md` from the sub-agent folder. No errors; thin-specialist behavior is automatic.
- AE3. **Covers R9, R14.** Given sub-agent `expenses/` overrides `GUARDRAILS.md` with a stricter PII-redaction rule set, when the parent delegates to `expenses`, the sub-agent's composed system prompt uses the sub-agent's `GUARDRAILS.md`, not the parent's. The agent builder on `expenses/GUARDRAILS.md` shows an `[overridden]` badge with a diff preview against the parent's `GUARDRAILS.md`.
- AE4. **Covers R15.** Given an agent with overrides at `IDENTITY.md`, `expenses/CONTEXT.md`, and `recruiting/GUARDRAILS.md`, when the operator swaps template, the agent builder confirmation lists those three paths explicitly; on accept, all three are deleted and the composed tree resolves through the new template.
- AE5. **Covers R6.** Given an agent has `USER.md` at root (server-managed per 2026-04-21 R9), and a sub-agent `escalation/` declares its own `USER.md` (rare, typically from an imported bundle), when the paired human changes, both `USER.md` files are rewritten synchronously in the same assignment event.
- AE6. **Covers R21, R22, R23.** Given sub-agent `expenses/` declares `approve-receipt` in its composed `AGENTS.md` routing table, and `{agent}/expenses/skills/approve-receipt/SKILL.md` exists as a local override, when the parent delegates to `expenses`, the runtime loads the sub-agent's local `approve-receipt` SKILL.md (not the platform catalog's version, even if one exists). The parent agent does not see `approve-receipt` unless its own `AGENTS.md` references that slug.
- AE7. **Covers R25.** Given an operator attempts to create a sub-agent folder named `memory` or `skills` via the agent builder, the builder rejects the name with a lint error referencing the reserved list. Given an imported bundle contains a folder literally named `memory/` that is not the reserved meaning (e.g., a company-team folder), the importer surfaces an explicit rename prompt.
- AE8. **Covers R26, R27.** Given an operator selects the "Delegator with 2 specialists" starter template, the agent builder seeds a root folder with populated canonical files, an `AGENTS.md` routing table with 2 pre-filled rows, and two sub-agent folders each containing a placeholder `CONTEXT.md`. Given the operator then drag-renames one sub-agent folder in the tree, the parent's `AGENTS.md` routing-table row updates automatically (both the `Go to` path and any text references to the old name).

---

## Success Criteria

- A user with a working FITA `.claude/agents/specialist/` folder or an analogous Codex/other-vendor layout on GitHub can import it into a ThinkWork agent via the agent builder; the importer path-normalizes the vendor prefix, content is untouched, and the specialist delegates, inherits, and runs with the same file-resolution semantics the user had locally.
- A user arriving from FOG drops their root-folder Claude Code structure into ThinkWork unchanged — FOG's layout is already ThinkWork's layout.
- Template authors reason about agent behavior by reading a single populated tree at `packages/workspace-defaults/files/` plus the `/docs/agent-design/` section. No reference to `system-workspace` or `memory-templates` is ever required.
- An operator creating a new agent from scratch can go from empty to a working multi-specialist agent inside the agent builder alone — starter template → drag to add sub-agents → snippets for routing and guardrails → save — without touching a CLI, git, or an IDE.
- Operators inspecting any agent in the agent builder see, for every file at every folder depth, whether it is inherited, overridden, or pending a template update.
- `ce-plan` can proceed from this document without inventing product behavior for sub-agent shape, inheritance walk, import semantics, template swap, reserved-name enforcement, or agent-builder UX surface.

---

## Scope Boundaries

- Not introducing a Thin-vs-Fat distinction in the storage or composer. Inheritance-as-overlay is the only mechanism; file shape emerges from which files are present.
- Not using a vendor-specific sub-agent path (`.claude/agents/`, `.codex/agents/`, `.gemini/agents/`). Sub-agents live at plain folder paths enumerated by `AGENTS.md`. Vendor-specific paths are path-normalized at import only.
- Not growing the reserved-folder-name list beyond `memory/` and `skills/` in v1. Any future additions require a migration PR.
- Not renaming `AGENTS.md` to `CLAUDE.md`. The runtime ships `AGENTS.md` and the cross-vendor convention aligns; FOG compat is addressed in docs, not rename.
- Not changing the `delegate_to_workspace` tool contract beyond accepting a path instead of a slug. The tool stays simple; sub-agent-to-sub-agent cross-calls happen via natural parent-child recursion, not a peer-routing API.
- Not building two-way sync between an external folder bundle and a ThinkWork agent. Import is one-directional in v1; upstream-follows-fork is a future initiative.
- Not retiring `packages/skill-catalog/`. Platform skills remain the authoritative shared, versioned, governed, SI-4-validated source. The UI surface that retires is specifically the "attach a list of skill slugs to an agent DB row" editor — which becomes derivative of folder declarations per R23.
- Not introducing a dedicated `SKILLS.md` canonical file. Skills live in `AGENTS.md`'s routing table (FOG-literal) and optionally in `skills/*` subfolders for local overrides.
- Not solving runtime cost of deep recursion at scale. Planning must confirm composed-tree materialization strategy (materialize per version vs. compose per read), but the product decision stands regardless of the implementation choice.
- Not eliminating `ROUTER.md` context profiles. They remain a separate mechanism (same-context file selection per channel) distinct from sub-agent delegation (separate-context specialist invocation); both are load-bearing.

---

## Key Decisions

- **Fat-native sub-agents with universal overlay inheritance, over Thin-only with a converter.** Distribution compatibility with the folder-as-agent ecosystem is the load-bearing adoption constraint. Every "downside" of Fat (guardrails divergence, memory scoping, template collision) resolves to visualization/UX work in the agent builder rather than architecture. Converters fossilize compromises and disconnect skills from upstream, breaking the skill-distribution story.
- **Vendor-neutral folder layout — FOG-pure, not FITA-literal.** Sub-agents are plain folders at any depth, enumerated by `AGENTS.md` routing tables. Reserved names (`memory/`, `skills/`) are the only carve-outs. ThinkWork runs Bedrock models, not just Claude; no cross-vendor sub-agent folder standard exists; FOG's root-folder model is the most portable and matches the "pure folder structure" product intent. Vendor-specific paths (`.claude/agents/*`, `.claude/skills/*`, and analogues) are path-normalized on import — a trivial, content-preserving transform.
- **Enumeration by `AGENTS.md` routing table, not folder scan.** The parent's routing table IS the enumeration of its sub-agents. This removes any need for magic prefixes, resolves "is this folder an agent or just data?" cleanly, and matches the FOG model literally. Unreferenced folders are just files.
- **`packages/workspace-defaults/` as single seed source.** Already named for purpose; consolidation is a straight refactor; retiring two other packages removes ambiguity about where to edit defaults.
- **Two mental-model docs (`AGENTS.md` in-template + Starlight `/docs`).** Agent-facing context map and human-facing template-author guide are genuinely different audiences with different depth needs — this is separate-docs by purpose, not hybrid reasoning.
- **`USER.md` follows the universal overlay rule, no parent-only exception.** Consistency beats per-file carve-outs; default template ships `USER.md` only at root, so the N+1 write path rarely fires in practice; the path must exist for imports that include per-sub-agent `USER.md`.
- **Template swap is destructive, not merged.** FOG/FITA both rely on git semantics — swap = folder swap. Agent builder shows the exact override paths that will be replaced before commit; operators make the call.
- **Workspace and skill editing unify under `AGENTS.md`'s routing table (Option 3 of three candidates).** FOG's routing table literally has a Skills column; `AGENTS.md` is the cross-vendor primary routing file; users arriving from any ecosystem find skill declarations where they expect them. The alternatives (extending `ROUTER.md` — lower runtime work but non-ecosystem location; adding a dedicated `SKILLS.md` — cleanest separation but non-ecosystem and file-count tax) were rejected because distribution compatibility outweighs both.
- **The admin UI is an agent builder, not a file editor.** It is the flagship authoring surface — web-based, tree-navigation, inheritance-aware, snippet-capable, template-seedable, drag-to-organize. At enterprise scale (400+ agents), the builder is the canonical path; CLI/git are escape hatches, not the primary workflow.

---

## Dependencies / Assumptions

- **Verified against the runtime:** `packages/agentcore-strands/agent-container/container-sources/server.py` auto-loads `SOUL.md`, `IDENTITY.md`, `USER.md`, `AGENTS.md`, `CONTEXT.md`, `TOOLS.md` when present (`server.py:274`); `has_workspace_map` mode is triggered by `AGENTS.md` and changes KB-injection behavior (`server.py:290, 2003`). `delegate_to_workspace` is described as live in the shipped `packages/workspace-defaults/files/ROUTER.md`. `router_parser.py` exists at `packages/agentcore/agent-container/router_parser.py` and is imported by the strands container's server — planning should confirm the import path stays valid after this refactor.
- **Verified:** the three seed packages exist and overlap (`packages/system-workspace/` has PLATFORM/CAPABILITIES/GUARDRAILS/MEMORY_GUIDE; `packages/memory-templates/` has IDENTITY/SOUL; `packages/workspace-defaults/files/` has ROUTER.md + `memory/`).
- The 2026-04-21 `agent-workspace-files-requirements.md` Scope Boundary "Not addressing sub-workspaces" is **explicitly superseded by this document.** All 2026-04-21 requirements (R1–R18) remain in force for the files they cover; this doc extends the overlay chain recursively down into sub-agent folders and extends the pinned-propagation record to be per-folder-path per-file.
- The in-flight Plan 2026-04-24-001 (user-scope memory and hindsight ingest) covers the user-level memory aggregation story. Sub-agent `memory/` writes under R5 go into the parent agent's memory aggregate, which rolls up to user-level per that plan. This doc does not re-open that decision — it composes on top of it.
- Placeholder substitution at read-time (2026-04-21 R2) now walks the full folder tree, including sub-agent folders. This is a composer extension, not a new primitive.
- Import content safety applies to all imported files: SI-4 zip-safety validator (already shipped per recent PR #517 / U10) for archives, and prompt-injection sanitization per 2026-04-21 R2 for substituted placeholder values. The path-normalization step happens after safety validation, so vendor prefixes never mask unsafe content.
- Composed-tree storage strategy is a planning decision, not a product decision. Planning must confirm whether composition happens per read (cheap deploy, higher read cost), per version (snapshot materialized, cheap read, snapshot-invalidation cost), or hybrid. At the 400+ agent × sub-agent-depth scale, this is non-trivial — but the product shape commits either way.
- The agent builder's scope per R13/R26/R27 is substantially larger than the current workspace-files admin page. Planning should size it as a multi-week UI initiative, not a polish pass.

---

## Outstanding Questions

### Resolve Before Planning

- (None — all product decisions are resolved in this document.)

### Deferred to Planning

- [Affects R7][Technical] Cache invalidation for composed sub-agent folders. If `_catalog/defaults/expenses/CONTEXT.md` changes, every dependent agent's composed tree must invalidate at the right granularity. Extension of the 2026-04-21 R5-R7 composer-cache question.
- [Affects R9][Technical] How the Strands runtime enumerates sub-agent folders at boot — parse the composed root `AGENTS.md` routing table once and register all enumerated sub-agents as delegate targets, or parse on demand when `delegate_to_workspace` fires with a path?
- [Affects R10–R12][Technical] Import pipeline implementation: zip/tar/git-ref handlers, SI-4 hook points, agent-builder upload component, path-normalization table (mapping from each recognized vendor prefix to the neutral form), validation schema for recognized canonical files. Failure taxonomy per R12.
- [Affects R13][Technical] Agent builder architecture: extend the existing `POST /internal/workspace-files` handler or stand up a new GraphQL resolver? Where does composition happen — API layer (shared composer, two callers) or client? Bias per 2026-04-21 toward server-side composition.
- [Affects R14][Technical] Pinned-version record extension. Today it is per-agent per-file (2026-04-21 R8c). Under Fat, it becomes per-agent per-folder-path per-file. Storage shape: extended JSONB on the agent row, or a new relation?
- [Affects R18][Needs research] Precise backfill plan for the 4 existing agents. Planning must audit their current templates to see which (if any) imply sub-agents today, and emit a dry-run report of what the migration will create, revert, or leave in place before the destructive step.
- [Affects R4][Technical] Tenant seed re-deploy trigger. Today there is no re-seed action wired to deploy. Planning defines whether this runs on every deploy, on explicit operator action, on a content-hash change, or via a scheduled reconciler.
- [Affects R6][Technical] Transactional semantics for multi-`USER.md` assignment writes. When an agent has `USER.md` at root and in N sub-agent folders, the assignment event writes N+1 S3 objects. Single transaction (outbox), best-effort with reconciliation, or explicit resync admin action per 2026-04-21 R9's same open question?
- [Affects R17][Technical] Doc sync discipline. How do we prevent drift between `packages/workspace-defaults/files/AGENTS.md` and `/docs/agent-design/` over time — single source with a render layer, manual discipline with a docs lint, or periodic review?
- [Affects R9][Needs research] Interaction with per-channel `ROUTER.md` profiles. When a sub-agent is invoked, does the sub-agent's own `ROUTER.md` (if any) apply, or does the parent's active profile pass through? FOG/FITA don't answer this because they don't have profiles — ThinkWork must decide.
- [Affects R21][Technical] `AGENTS.md` routing-table parser. Today `AGENTS.md` is treated as prose content (auto-loaded into the system prompt). Option 3 needs a structured parser that extracts the `| Task | Go to | Read | Skills |` table for runtime use while leaving the surrounding prose intact. Planning defines the parser contract, how malformed tables fail, and whether the parser lives in TypeScript (API layer) or Python (Strands runtime) — or both.
- [Affects R20, R22][Technical] Local `SKILL.md` authoring UX. Can operators create a local `skills/{slug}/SKILL.md` inline in the agent builder, or is local-skill creation import-only (zip upload / git ref / CLI `thinkwork skill import`)? Inline authoring is more powerful but larger UI scope; import-only is simpler and matches how skill-catalog content is authored today.
- [Affects R23][Technical] Derivative `skills_config` computation. When folder declarations change, do we recompute the DB-row `skills_config` synchronously (on save), lazily (on next boot), or via an outbox job? The synchronous path is simplest but couples the admin save path to composer performance; lazy + outbox risks divergence.
- [Affects R27][Technical] Drift validation between `AGENTS.md` routing rows and actual folder state. If a row points to `expenses/` but the folder was deleted externally (or vice versa, a folder exists that isn't enumerated), is that a warning, a lint error, or auto-reconciled? The drag-to-organize UX prevents this in the common case but external edits (git, CLI) can introduce it.
- [Affects R26][Technical] Snippet and starter-template content. Authoring and reviewing the v1 snippet library + starter-template set is a content sub-track, not a code one. Planning identifies a named owner and the initial library scope (recommend: ~10 snippets, ~3 starter templates for v1).

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
