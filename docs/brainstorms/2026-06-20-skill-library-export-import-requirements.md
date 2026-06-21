---
date: 2026-06-20
topic: skill-library-export-import
---

# Skill Library Export / Import — Requirements

## Problem Frame

Operators need a portable way to move a single skill into and out of the Skill
Library without treating ThinkWork as a closed skill authoring silo. Today the
Skill Library lets operators browse, inspect, edit, evaluate, and apply catalog
skills, but it does not expose a first-class import/export path for a complete
skill pack. That makes tenant-to-tenant promotion, dev-to-prod promotion, backup,
and external Agent Skills interoperability awkward.

V1 should make the Skill Library handle one portable skill archive at a time:
import a standards-compatible skill ZIP into the tenant catalog, and export a
selected catalog skill as the same kind of portable ZIP. Import updates the
library source of truth only; already-installed workspace copies stay stable
until an operator explicitly applies the update through the existing update
path.

---

## Actors

- A1. Tenant operator: imports, exports, inspects, and applies Skill Library
  skills.
- A2. External skill author: provides a single skill pack that follows the Agent
  Skills specification.
- A3. ThinkWork platform: validates, stores, indexes, exports, and generates
  ThinkWork-specific wiring where needed.
- A4. Downstream implementation planner: turns these product decisions into a
  concrete API, UI, validation, and test plan without inventing behavior.

---

## Key Flows

- F1. Import a new portable skill
  - **Trigger:** The operator clicks the UploadIcon action in the Skill Library
    header and selects a ZIP.
  - **Actors:** A1, A2, A3
  - **Steps:** ThinkWork reads the archive as one skill pack, validates the
    `SKILL.md` frontmatter and directory/name rules against the Agent Skills
    specification, preserves supporting files, generates default editable
    `WIRING.md` when absent, stores the skill in the tenant Skill Library, and
    opens the imported skill detail page.
  - **Outcome:** The skill is visible in the Skill Library, immediately
    installable in ThinkWork, and inspectable by the operator.
  - **Covered by:** R1, R2, R3, R4, R7, R8, R9, R12, R13

- F2. Import over an existing Skill Library slug
  - **Trigger:** The operator imports a valid archive whose skill name/slug
    matches an existing Skill Library item.
  - **Actors:** A1, A3
  - **Steps:** ThinkWork warns that the existing catalog item will be updated,
    requires explicit confirmation, replaces the catalog source after
    confirmation, refreshes the catalog metadata, and leaves installed workspace
    copies unchanged.
  - **Outcome:** The Skill Library has the newly imported version while live
    installed copies remain stable until an operator applies the update.
  - **Covered by:** R10, R11, R13

- F3. Export a selected skill
  - **Trigger:** The operator opens a skill detail page and clicks the export
    action in that detail header.
  - **Actors:** A1, A3
  - **Steps:** ThinkWork packages the complete selected catalog skill folder into
    a single-skill ZIP that follows the same archive shape accepted by import.
  - **Outcome:** The operator receives a portable archive that can be
    re-imported into ThinkWork or inspected by other Agent Skills-compatible
    tools.
  - **Covered by:** R15, R16, R17

---

## Requirements

**Import entry point and archive shape**

- R1. The Skill Library list header includes an UploadIcon import action.
- R2. V1 import accepts exactly one skill per ZIP archive.
- R3. The accepted archive shape is either `SKILL.md` at the archive root or one
  top-level folder containing `SKILL.md`.
- R4. Import preserves supporting files and directories from the skill pack,
  including `scripts/`, `references/`, `assets/`, `evals/`, and any existing
  `WIRING.md`.

**Spec compatibility and validation**

- R5. Import validates the skill against the Agent Skills specification at
  https://agentskills.io/specification, including required `name` and
  `description` frontmatter and the skill name/directory naming rules.
- R6. When the archive has root-level `SKILL.md`, ThinkWork treats the root as a
  virtual skill folder named from the valid `name` frontmatter before storing
  and validating the catalog slug.
- R7. If a valid Agent Skills archive omits ThinkWork-specific `WIRING.md`,
  ThinkWork generates default editable wiring so the skill is immediately
  installable.
- R8. Invalid archives fail without mutating the Skill Library and show an error
  specific enough for the operator to fix the archive.

**Import update semantics**

- R9. If the imported slug does not already exist, import creates a new Skill
  Library item.
- R10. If the imported slug already exists, import replaces/updates that Skill
  Library item in place only after explicit confirmation.
- R11. Updating the Skill Library/catalog through import does not automatically
  mutate already-installed agent or workspace copies. Installed copies remain
  unchanged until an operator explicitly applies or reinstalls the update through
  the existing source-hash/update-gate path.

**Post-import operator experience**

- R12. Successful import navigates to the imported skill detail page.
- R13. The success feedback states whether the skill was created or updated.
- R14. The imported skill detail page lets the operator inspect imported files,
  generated wiring, metadata, eval score, and update state using existing skill
  detail affordances where available.

**Export**

- R15. Export lives in the selected skill detail header in v1; row-level export
  from the Skill Library table is deferred.
- R16. Export downloads the complete selected catalog skill as one portable
  single-skill ZIP compatible with the v1 import path.
- R17. An exported skill should preserve the current catalog files closely enough
  that exporting and re-importing the same archive is a valid round trip.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R5, R9, R12, R13.** Given a tenant operator selects
  a ZIP containing a top-level `pdf-processing/SKILL.md` with valid Agent Skills
  `name: pdf-processing` and `description`, when they import it from the Skill
  Library header, then ThinkWork creates `pdf-processing`, shows success as a
  created skill, and opens the `pdf-processing` skill detail page.
- AE2. **Covers R3, R5, R6, R9.** Given a ZIP contains `SKILL.md` at the archive
  root with valid `name: code-review`, when imported, then ThinkWork treats the
  archive as a virtual `code-review` folder and stores it as the `code-review`
  catalog skill.
- AE3. **Covers R7, R14.** Given a valid Agent Skills archive does not include
  `WIRING.md`, when imported, then ThinkWork generates default wiring, the skill
  can be installed, and the generated `WIRING.md` is visible/editable on the
  skill detail page.
- AE4. **Covers R8.** Given a ZIP lacks `SKILL.md` or has invalid frontmatter,
  when imported, then the Skill Library is unchanged and the operator sees a
  fixable validation error.
- AE5. **Covers R10, R11, R13.** Given `crm-lookup` already exists in the Skill
  Library and an agent has an installed copy, when the operator imports a valid
  `crm-lookup` archive and confirms replacement, then the Skill Library item is
  updated, success says updated, and the installed agent copy remains unchanged
  until the operator applies the update.
- AE6. **Covers R15, R16, R17.** Given the operator opens the `pdf-processing`
  skill detail page, when they export it, then they receive a single-skill ZIP
  that can be imported back through the v1 import flow.

---

## Success Criteria

- Operators can move a single skill between ThinkWork tenants or environments
  without manual file copying.
- Standard Agent Skills packs can enter ThinkWork without requiring
  ThinkWork-only files in the source archive.
- Importing a new catalog version does not unexpectedly change live agent
  behavior.
- Exported archives are useful as backups, promotion artifacts, and portability
  artifacts.
- A downstream `ce-plan` pass can scope UI, API, validation, storage, indexing,
  eval, and testing work without inventing product behavior.

---

## Scope Boundaries

- Multi-skill archive import is out of v1.
- `.claude/skills/*`, `.codex/skills/*`, or broader project/vendor archive
  import is out of v1 unless the archive also reduces to one accepted
  single-skill shape.
- Row-level export actions in the Skill Library table are deferred.
- Automatic propagation of imported updates to installed agent/workspace copies
  is out of v1.
- Live two-way sync with external skill authoring tools is out of scope.
- Changing the Agent Skills specification or adding ThinkWork-only frontmatter
  requirements is out of scope.
- Reworking the existing skill eval/update-gate model is out of scope; import
  should interoperate with it.

---

## Key Decisions

- **Spec-compatible single-skill ZIP.** V1 focuses on one portable skill at a
  time instead of broad project import, keeping the workflow small while
  honoring the Agent Skills portability bet.
- **In-place catalog replacement on slug collision.** Replacement keeps
  tenant-to-tenant and dev-to-prod promotion direct; explicit confirmation
  handles the risk.
- **Catalog-only update semantics.** Import updates the library source, not live
  installed copies, preserving operator control over agent behavior.
- **Generated wiring when absent.** ThinkWork-specific install wiring is
  additive, so standard Agent Skills packs can import cleanly and become usable.
- **Detail-first export.** Export lives where the selected skill can be
  inspected, avoiding table clutter in v1.
- **Navigate to detail after import.** The operator lands where they can inspect
  generated wiring, files, metadata, and update/eval state.

---

## Dependencies / Assumptions

- The Skill Library continues to treat the tenant S3 skill catalog as the source
  of truth for catalog skill files.
- The current Skill Library list/detail surfaces remain the operator-owned
  settings surface for catalog skills.
- The existing source-hash/update-gate path can represent "catalog updated,
  installed copy unchanged" for imported replacements.
- Agent Skills spec validation is available through a suitable implementation or
  can be built to match the public specification during planning.
- Generated default wiring can be expressed as a normal editable `WIRING.md`
  without adding a separate hidden metadata channel.

---

## Outstanding Questions

### Resolve Before Planning

- (None.)

### Deferred to Planning

- [Affects R5, R8][Technical] Exact validation mechanism and error taxonomy for
  Agent Skills spec failures.
- [Affects R4, R16][Technical] File size, total archive size, binary file, and
  path-safety limits for import/export.
- [Affects R7][Technical] Exact default `WIRING.md` content and whether it should
  record that it was generated.
- [Affects R11, R14][Technical] How the detail page should surface "catalog
  updated, installed copies unchanged" when eval/update-gate state exists.
- [Affects R16, R17][Technical] Export filename convention and whether generated
  `WIRING.md` is always included in exported archives.

---

## Sources / Research

- Linear issue: THNK-53, "Skill Library Export/Import".
- Agent Skills specification: https://agentskills.io/specification.
- Skill Library list: `apps/web/src/components/settings/SettingsSkills.tsx`.
- Skill detail/editor surface:
  `apps/web/src/components/settings/SettingsSkillDetail.tsx`.
- Skill catalog file client: `apps/web/src/lib/workspace-files-api.ts`.
- Catalog storage contract: `packages/api/src/types/catalog-skill.ts`.
- Catalog install/reinstall source-hash behavior:
  `packages/api/src/lib/catalog-install.ts` and
  `packages/api/src/lib/catalog-reinstall.ts`.
- Existing Skill Library docs:
  `docs/src/content/docs/applications/admin/skills-catalog.mdx`.
- Agent Skills portability requirements:
  `docs/brainstorms/2026-05-12-agentskills-contract-and-portability-requirements.md`.
- Skill eval/update-gate context:
  `docs/brainstorms/2026-06-13-skill-tests-and-evals-requirements.md`.

---

## Next Steps

-> /ce-plan for structured implementation planning.
