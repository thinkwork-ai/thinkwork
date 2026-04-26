---
date: 2026-04-26
topic: agents-folder-reserved-name
status: reconsidered
---

# `agents/` as a Reserved Folder Name (Sub-agent Container)

> **2026-04-26 reconsideration (post ce-doc-review round 1).** The plan derived from this brainstorm was reviewed by 6 reviewer personas. The product-lens reviewer challenged the premise: both stated gaps in Marco's workspace (visible "where sub-agents live" + Add Sub-agent button) are UI affordances, deliverable by builder changes alone without modifying storage layout. The plan itself conceded "the UI fabricates the section header" and "hide `agents/` segment in display path" — meaning operators would never see the storage form anyway.
>
> **Reconsidered decision:** keep storage FOG-pure per Plan 008 (sub-agents at top-level `{agent}/{slug}/`, only `memory/` and `skills/` reserved). Deliver the affordances via UI fabrication: the agent-builder's FolderTree reads the parent's `AGENTS.md` routing rows and groups every routed top-folder under a synthetic `agents/` section header. Add Sub-agent button lives in the section's empty state. The "FOG bundle drops in unchanged" promise is preserved. Plan 008 Phases A/B/C don't need a translation layer retrofitted.
>
> **What carries forward from this brainstorm:** R7 (always-visible `agents/` location with empty-state affordance) and R8 (Add Sub-agent flow with auto-routing-row sync) — but as UI requirements, not storage requirements. **What is dropped:** R1–R6 (storage rewrite, three reserved names, semantic↔storage translation), R9–R12 (FOG/FITA importer relocation, vendor normalization changes), R13–R15 (workspace-defaults rewrite, Starlight doc rewrite, starter template path changes), R16–R22 (Plan 008 supersession, forward-only deploy migration).
>
> **Active plan:** `docs/plans/2026-04-26-002-feat-agents-folder-reserved-name-plan.md` (UI-only scope, 2 implementation units).
>
> The original requirements text below is preserved for reference; treat it as the historical reasoning, not the current specification.

---

## Problem Frame

The 2026-04-24 Fat-folder decision committed to FOG-pure layout: any top-level folder inside an agent's workspace can be a sub-agent, with sub-agent identity determined by enumeration in the parent's `AGENTS.md` routing table. Only `memory/` and `skills/` are reserved.

When inspecting a real workspace (Marco's), the missing affordances were obvious:

1. **There was no visible "where sub-agents live" location.** The mental model needs a place to point at — even when empty — so an operator looking at a workspace can answer "where would a sub-agent go?" without reading the routing table.
2. **There was no Add Sub-agent action in the builder.** The flagship authoring surface lacked the most common sub-agent creation move.

The first gap is structural; the second is UX. They share a root cause: with FOG-pure storage, the existence of sub-agents is implicit (a property of routing-table enumeration), not explicit (a property of file-tree location). At the operator surface — which is the canonical authoring path at enterprise scale per 2026-04-24 R13 — implicit beats explicit only when authoring volume is low. At 4 enterprises × 100+ agents, the workspace inspection cost compounds.

The fix is to make sub-agent location explicit by adding `agents/` to the reserved-folder list. Top-level becomes flat: root canonical files plus three reserved folders (`memory/`, `skills/`, `agents/`) plus arbitrary data folders. Sub-agents live at `{agent}/agents/{slug}/`, recursively. The builder gets a permanent place to render the sub-agent set and an Add Sub-agent button.

This document supersedes specific parts of the 2026-04-24 brainstorm; deltas are itemized in the **Deltas to 2026-04-24** group.

---

## Visual: Folder layout (revised)

```
{agent}/                         ← the agent IS this folder
├── AGENTS.md                    ← routing table; enumerates sub-agents semantically
├── IDENTITY.md, SOUL.md, USER.md, GUARDRAILS.md, ...
├── memory/                      ← RESERVED
├── skills/                      ← RESERVED
├── agents/                      ← RESERVED (new)
│   ├── expenses/
│   │   ├── CONTEXT.md
│   │   ├── memory/
│   │   ├── skills/
│   │   └── agents/              ← reserved at every depth
│   │       └── escalation/
│   │           └── CONTEXT.md
│   └── recruiting/
│       └── CONTEXT.md
└── attachments/                 ← just data — operator can keep arbitrary folders here
```

Three rules hold the model together:

1. **Three reserved folder names at every depth: `memory/`, `skills/`, `agents/`.** None are ever sub-agents themselves.
2. **Sub-agents live inside `agents/`. Anything outside `agents/` and the other reserved names is data.** No more "is this folder an agent?" — answered by location.
3. **Routing-table paths are semantic.** A row says `Go to: support/escalation`, not `Go to: agents/support/agents/escalation`. The `agents/` segments are pure storage containers and never appear in routing or delegation calls.

---

## Requirements

**Reserved folder rule**

- R1. `agents/` joins `memory/` and `skills/` as a reserved folder name at every depth in an agent workspace. Reserved folders are platform-meaningful: `agents/` contains sub-agent folders only; `memory/` and `skills/` retain their existing semantics. None are sub-agents themselves regardless of routing-table content.
- R2. A sub-agent is a folder at `{ancestor-path}/agents/{slug}/` whose slug is referenced by an ancestor's `AGENTS.md` routing table. Folders inside `agents/` that are not enumerated in any ancestor's routing table are unused — visible in the builder but not loaded as sub-agents at runtime.
- R3. Folders outside the reserved-name set (data, attachments, scratch) are unaffected at every depth. They never load into the system prompt and never participate in inheritance.

**Composer and delegation semantics**

- R4. Inheritance walks past `agents/` segments — they are pure containers, not ancestors with files. For `{agent}/agents/support/agents/escalation/CONTEXT.md`, the resolution chain is: `escalation/CONTEXT.md` → `support/CONTEXT.md` → root `CONTEXT.md` → template → defaults. The `agents/` segments are never opened for canonical files.
- R5. Routing-table paths in `AGENTS.md` are semantic: a row's `Go to` value is the slug or slug-path (`support`, `support/escalation`), not the literal storage path (`agents/support`, `agents/support/agents/escalation`). The composer translates semantic paths to storage paths when reading sub-agent folders.
- R6. `delegate_to_workspace` accepts the same semantic path as the routing table: `delegate_to_workspace("support/escalation")` resolves to `{agent}/agents/support/agents/escalation/`. The tool contract remains a single string path argument; storage translation is internal.

**Builder UX**

- R7. The agent builder always renders an `agents/` section in the tree, even when it contains zero sub-agents. The empty state shows an Add Sub-agent affordance plus a one-line explanation of what sub-agents are. This is the canonical answer to "where do sub-agents go?" — visible regardless of authoring history.
- R8. The Add Sub-agent action creates a sub-agent folder under `agents/` (or under `{path}/agents/` for nested), seeds it with `CONTEXT.md` from the active starter snippet, and adds the corresponding routing row to the parent's `AGENTS.md` automatically. This satisfies R27 of the 2026-04-24 doc (drag-to-organize keeps tree and table in sync) under the new layout.
- R9. Recursive sub-agent creation is supported: from any sub-agent's tree view, the operator can open its own `agents/` folder and add a sub-sub-agent. Depth is unlimited at the product level; planning may impose a soft warning beyond a chosen depth.

**Import normalization**

- R10. The FOG-bundle drop-in invariant from 2026-04-24 weakens explicitly. Bundles are still imported untouched as content, but the importer now relocates routed root-level folders into `agents/` and rewrites the AGENTS.md routing table accordingly. This is mechanical; user intervention is required only for collisions or reserved-name conflicts.
- R11. Cross-vendor path normalization becomes uniform with `agents/`: `.claude/agents/* → agents/*`, `.codex/agents/* → agents/*`, `.gemini/agents/* → agents/*`. Vendor-specific skill paths remain `*/skills/*` per existing rules. The normalization table is documented in `/docs/agent-design/import-fog-fita/`.
- R12. Reserved-name conflicts at import surface the same rename prompt that 2026-04-24 R12 / AE7 already define. A bundle that contains a literal top-level `agents/` folder where the contents are *not* sub-agents (rare; would be an unusually-named data folder upstream) is treated identically to today's `memory/` / `skills/` collision.

**Doc and template updates**

- R13. `packages/workspace-defaults/files/AGENTS.md` is updated to describe the reserved-folder set as `memory/`, `skills/`, `agents/` and to use semantic routing paths in its example table.
- R14. The `/docs/agent-design/` Starlight section updates accordingly: `folder-is-the-agent.mdx` shows the new layout, `inheritance-rules.mdx` documents the `agents/`-pass-through composer rule, `import-fog-fita.mdx` shows the relocation rule and the updated normalization table, `authoring-templates.mdx` describes the `agents/` convention.
- R15. Starter templates in the agent builder (R26 of 2026-04-24) seed the root with an empty `agents/` folder. The "Delegator with 2 specialists" starter creates `agents/specialist-1/CONTEXT.md` and `agents/specialist-2/CONTEXT.md` with two pre-filled routing rows.

**Deltas to 2026-04-24**

- R16. R5 of 2026-04-24 ("Sub-agents live at `{agent}/{slug}/`") is **superseded**: sub-agents live at `{ancestor}/agents/{slug}/`.
- R17. R7 of 2026-04-24 (file resolution walk) is **adjusted**: the walk skips `agents/` segments rather than treating them as ancestors. The chain shape is otherwise unchanged.
- R18. R10 of 2026-04-24 (vendor-prefix normalization) is **extended**: the normalization table now lands content under `agents/` for all vendor variants. The existing `.claude/skills/* → skills/*` line is unchanged.
- R19. R25 of 2026-04-24 (reserved-name list locked at `memory/`, `skills/`) is **superseded**: the v1 reserved-name list is `memory/`, `skills/`, `agents/`. Any future additions still require an explicit migration PR.
- R20. R9 of 2026-04-24 (`delegate_to_workspace` accepts a path) is **clarified**: the path is semantic, not storage. The tool's external contract is unchanged from the operator's view; only the internal resolution changes.
- R21. The "FOG bundle drops in unchanged" success-criterion bullet from 2026-04-24 is **softened**: the new criterion is "FOG bundles import in one click; the importer mechanically relocates routed sub-agent folders into `agents/` and rewrites routing rows."
- R22. The 2026-04-24 v1 install base has zero live sub-agents (verified via this brainstorm). No data migration is required — the change is forward-only in composer, builder, importer, and `delegate_to_workspace` resolution.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R7.** Given a brand-new agent created from an empty starter, when the operator opens it in the builder, the tree shows root canonical files, `memory/`, `skills/`, and an empty `agents/` folder with an Add Sub-agent button and an explanatory line. No sub-agents exist; the affordance is still visible.
- AE2. **Covers R5, R6.** Given a parent agent's `AGENTS.md` contains the row `| Tier-2 cases | support/escalation | CONTEXT.md | reconcile-receipt |`, when the parent calls `delegate_to_workspace("support/escalation")`, the runtime resolves the path to storage `{agent}/agents/support/agents/escalation/` and composes that sub-agent's workspace. The semantic path `support/escalation` appears in the routing table; no `agents/` segments leak into operator-facing surfaces.
- AE3. **Covers R4.** Given sub-sub-agent `escalation/` contains only `CONTEXT.md`, when the parent delegates two levels deep into it, the runtime composes `IDENTITY.md`, `SOUL.md`, `USER.md`, `GUARDRAILS.md`, etc. by walking `escalation/ → support/ → root/ → template → defaults`. The two `agents/` segments in the storage path are skipped during the walk.
- AE4. **Covers R10, R11.** Given an operator imports a FOG bundle whose root contains `expenses/CONTEXT.md` and `recruiting/CONTEXT.md` referenced in the bundle's root `AGENTS.md`, when import completes the content lands at `{agent}/agents/expenses/CONTEXT.md` and `{agent}/agents/recruiting/CONTEXT.md`, the bundle's `AGENTS.md` routing rows are rewritten to use semantic paths (`expenses`, `recruiting`), and the agent builder shows both as overridden sub-agent folders inside `agents/`.
- AE5. **Covers R10, R11.** Given an operator imports a FITA bundle with `.claude/agents/legal/CONTEXT.md`, when import completes the content lands at `{agent}/agents/legal/CONTEXT.md` and the parent's `AGENTS.md` is auto-updated with a `legal` row if absent. The vendor prefix is stripped; no further restructuring is needed.
- AE6. **Covers R12.** Given an imported bundle contains a literal root-level folder named `agents/` whose contents are not sub-agents (e.g., HR documents about an "agents" department), when import runs, the operator is prompted to rename the colliding folder before import proceeds. Same UX as today's `memory/` / `skills/` collision.

---

## Success Criteria

- An operator inspecting any agent workspace can answer "where do sub-agents go?" by looking at the tree, without reading `AGENTS.md`.
- A new agent in the builder shows an Add Sub-agent affordance from second zero, regardless of whether sub-agents have been authored yet.
- FOG and FITA bundles still import in a single click. The importer's mechanical relocation step is invisible to the operator unless a collision or reserved-name conflict requires intervention.
- Routing-table rows and `delegate_to_workspace` calls read identically to FOG/FITA today: semantic slugs, not storage paths. Operators authoring routing tables never type `agents/`.
- Composer-, builder-, and importer-level changes ship together; no parallel-path period and no in-flight workspaces to migrate.
- `ce-plan` can implement this without inventing product behavior for reserved-name semantics, semantic-vs-storage path translation, FOG/FITA relocation, or the empty-state builder UX.

---

## Scope Boundaries

- Not introducing storage-path syntax in `AGENTS.md` routing tables or `delegate_to_workspace` calls. All operator-facing paths are semantic; storage is internal.
- Not adding additional reserved names beyond `memory/`, `skills/`, `agents/`. Future additions still require a migration PR per 2026-04-24's posture.
- Not changing the `delegate_to_workspace` external contract. Only the path resolution moves from FOG-pure to semantic-with-`agents/`-translation.
- Not building two-way sync with FOG/FITA upstream bundles. Import remains one-directional in v1; the relocation step makes round-tripping less natural, which is acceptable.
- Not preserving the literal "drop-in unchanged" property of FOG bundles. Bundles still import in one click, but their on-disk shape inside ThinkWork differs from their upstream shape — this is a deliberate trade for permanent operator-facing clarity.
- Not migrating any existing tenant data — the install base has no live sub-agents (R22).

---

## Key Decisions

- **Reserve `agents/` instead of relying on routing-table enumeration alone.** At enterprise authoring scale, location-as-identity beats routing-as-identity. The cost is one extra reserved name and a path-normalization rule for FOG bundles; the benefit is permanent: every operator can answer "what is this folder?" by looking at it.
- **Reserved at every depth, not just the root.** Preserves the 2026-04-24 R5 commitment to recursive specialization (a sub-agent owning its own sub-agents). The composer, builder, and importer use the same rule everywhere — no special-case logic for "only-at-root" semantics.
- **Routing-table and delegation paths stay semantic.** Operators write `support/escalation`, not `agents/support/agents/escalation`. The `agents/` segments are pure storage. Reads identically to FOG/FITA today; only storage is noisier. Worth the extra resolution rule in the parser.
- **FOG bundles relocate at import, content untouched.** The "drop in unchanged" promise softens to "drop in once, importer relocates." Practically the operator clicks once; mechanically the bundle changes shape inside ThinkWork. The benefit (permanent clarity) outweighs the cost (one mechanical transform per bundle).
- **Cross-vendor normalization becomes uniform.** Every vendor's `agents/` directory maps to ThinkWork's `agents/` directory: more literal, less prefix-stripping, easier to document. FITA and Codex normalization both improve.
- **`agents/` is visible-when-empty in the builder.** The affordance is permanent, not conditional on first creation. Storage may use a `.keep` placeholder or render the folder without backing storage — a planning detail.
- **Forward-only change; no migration.** Verified via this brainstorm: the v1 install base has no live sub-agents. The composer, builder, importer, and `delegate_to_workspace` ship the new resolution rule together; no rewrite step.

---

## Dependencies / Assumptions

- The 2026-04-24 Fat-folder document remains in force for everything not explicitly superseded by R16–R22. All other requirements (canonical file set, inheritance posture, template-swap semantics, agent-builder feature surface, skills resolution rule) carry forward unchanged.
- Plan 008 (`docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md`) Phases A/B/C are shipped (per memory: U9 spawn-live #589, U12 #584, U9 inert #578; `delegate_to_workspace` LIVE end-to-end). Adopting `agents/` requires updating the composer's path-resolution rule and the builder's tree-rendering rule before the agent-builder UI work in Phase E lands. Planning sequences this against in-flight Phase D/E/F work.
- The shipped `delegate_to_workspace` tool has no live callers using sub-agent paths today (no live sub-agents per R22). The semantic-path resolution rule can be added to the tool without breaking existing call sites.
- The path normalization table in `/docs/agent-design/import-fog-fita/` is updated in the same PR that ships the importer change, so docs and behavior never diverge.
- Reserved-name lint in the agent builder (per 2026-04-24 R25 / AE7) extends to reject creating a sub-agent named `agents`, identical to the existing rule for `memory` and `skills`.

---

## Outstanding Questions

### Resolve Before Planning

- (None — all product decisions are resolved in this document.)

### Deferred to Planning

- [Affects R7][Technical] Empty-`agents/` storage representation. Render the folder in the builder without backing S3 storage, write a `.keep` marker on agent create, or treat absence as "render-as-empty"? Affects the cost of agent creation and the importer's collision-detection logic. Bias: render-as-empty (no storage) — cheapest, cleanest.
- [Affects R5, R6][Technical] Routing-table parser update. Today's parser (per 2026-04-24's deferred question) reads `Go to` as a path. The semantic-vs-storage translation is a thin wrapper, but the parser must understand that `support/escalation` resolves through `agents/` segments. Owner: Strands runtime + TypeScript composer (both consume the table).
- [Affects R10, R11][Technical] Importer relocation algorithm. Two passes (vendor-prefix normalize, then routed-folder relocate) or single pass with combined rules? Failure-mode taxonomy when the bundle's `AGENTS.md` references a folder that doesn't exist after relocation.
- [Affects R8][Technical] Add Sub-agent flow specifics: form fields (slug, optional starter snippet, optional template inheritance), validation rules (slug format, reserved-name check, collision check), undo behavior. Builder polish, not architecture.
- [Affects R22][Technical] Forward-only change requires no migration script — but the deploy needs ordering: composer + builder + importer + `delegate_to_workspace` resolution rule should land in a single deploy window to avoid mixed-rule states. Plan 008 sequencing applies.
- [Affects R14][Technical] Whether the docs update lands in the same PR as the storage rule change, or in a follow-up PR. Bias: same PR — keeps the model and the documentation aligned through review.

---

## Next Steps

-> `/ce-plan` for structured implementation planning. Plan should sequence the rule change against Plan 008's Phase D/E/F so the agent-builder Phase E work lands on the new layout from the start, not against the FOG-pure layout that ships in Phase A/B/C.
