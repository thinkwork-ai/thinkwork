---
title: "docs: workspace-reviews routing — concept update + Inbox HITL section + Automations admin doc (U6)"
type: docs
status: active
date: 2026-04-28
origin: docs/brainstorms/2026-04-28-workspace-reviews-routing-and-removal-requirements.md
---

# docs: workspace-reviews routing — concept update + Inbox HITL section + Automations admin doc (U6)

## Overview

Final unit (U6) of the workspace-reviews routing refactor. Updates the Astro docs site so it matches the deployed reality: paired-human HITL lives on mobile, system-agent HITL surfaces in admin Inbox as `inbox_items` rows with `type='workspace_review'`, the standalone `/workspace-reviews` admin page redirects to `/inbox`, and Automations is in the admin Work group below Inbox (no longer in Manage).

Master plan (already merged through U5): `docs/plans/2026-04-28-004-refactor-workspace-reviews-routing-and-removal-plan.md`. This plan is a focused U6 execution slice; the master plan's U6 section is the authoritative spec and is restated here for ce-work continuity.

This is docs-only. No code changes.

---

## Problem Frame

Three doc surfaces drifted during U1-U5:

1. **`docs/src/content/docs/concepts/agents/workspace-orchestration.mdx`** — the Human Review Flow section describes the old model (single admin queue at "Workspace Reviews") and references a page that no longer exists. The section needs to describe the routing model: paired-human → mobile, system → admin Inbox.
2. **`docs/src/content/docs/applications/admin/inbox.mdx`** — does not yet mention that Inbox is the home for system-agent HITL reviews. Operators reading this doc will not know the workspace_review type even exists.
3. **`docs/src/content/docs/applications/mobile/threads-and-chat.mdx`** — covers HITL for direct-agent reviews (per a prior plan) but doesn't say that sub-agent reviews surface to the parent chain's paired human via the new resolver-side chain walk.

Plus an existing drift unrelated to U1-U5 but blocking the IA story:

4. **`docs/astro.config.mjs`** — the docs sidebar still lists "Routines" under the admin Manage subgroup. The admin app has shown "Automations" (in Work, after U4) since U4 merged. Docs must match the deployed UI.

5. **`docs/src/content/docs/applications/admin/automations.mdx`** — does not exist. Every other admin nav entry has a doc page; this one needs parity.

---

## Requirements Trace

Carrying forward from the master plan:

- R9 (origin). Documentation reflects the new routing model.

Specific U6 sub-requirements (master plan U6 verification):
- R9.1. The orchestration concept doc no longer references the standalone admin Workspace Reviews page.
- R9.2. The orchestration concept doc explains paired-human-to-mobile and system-to-Inbox routing.
- R9.3. The Inbox admin doc explains the workspace_review type, the action mapping (Approve → accept, Reject → cancel, Request revision → resume with notes), and that materialization is automatic.
- R9.4. The mobile Threads doc explains sub-agent reviews surfacing to the parent chain's paired human.
- R9.5. A new `applications/admin/automations.mdx` exists, covers the Automations page's purpose (recurring agent work / scheduled jobs), and notes that it sits in the Work group below Inbox.
- R9.6. The Astro sidebar shows "Automations" (not "Routines") and the entry is in the Work subgroup of admin (mirroring the deployed admin IA).

**Origin actors (carried for context):** Paired human, Tenant operator (admin), System agent, Sub-agent.
**Origin acceptance examples:** AE1 (paired direct), AE2 (sub-agent via parent chain), AE3 (system in Inbox), AE5 (route 404 / redirect after cutover).

---

## Scope Boundaries

- No code changes. This is a docs-only PR.
- No new screenshots — text and structure only. (Screenshots can be a follow-up if visual proof becomes useful.)
- Don't write a docs page for the deleted `/workspace-reviews` route. The redirect is documented in passing inside the orchestration concept doc.
- Don't touch unrelated docs sidebar entries during the Routines→Automations rename. The minimum diff is the one entry's label, slug position, and group placement.
- Don't restructure other admin docs while we're here. Stick to the four files plus the new automations.mdx and astro.config.mjs.

---

## Context & Research

### Relevant Code and Patterns

- `docs/src/content/docs/applications/admin/inbox.mdx` — current admin doc structure to mirror.
- `docs/src/content/docs/applications/admin/threads.mdx` — existing admin doc style template.
- `docs/src/content/docs/concepts/agents/workspace-orchestration.mdx` — has an existing "Human review flow" section (around line 243 per master plan); rewrite in place.
- `docs/src/content/docs/applications/mobile/threads-and-chat.mdx` — contains the prior paired-human HITL flow doc; extend it with sub-agent surfacing.
- `docs/astro.config.mjs` — Astro sidebar config. Current state: `Routines` label points at `applications/admin/routines`, listed under the admin Manage subgroup.
- `apps/admin/src/components/Sidebar.tsx` — deployed admin sidebar, authoritative for the Work group order (Dashboard, Threads, Inbox, Automations) after U5.

### Institutional Learnings

- Master plan (already merged) carries the design rationale for the Inbox pivot. Reference but do not re-litigate.
- `feedback_user_opt_in_over_admin_config` — paired-human surfaces belong on mobile, admin owns infra/ops. The doc copy should preserve that framing.

### External References

None required. All context is internal.

---

## Key Technical Decisions

- **Three doc files modified, one created, one config updated.** Five surfaces total. No code change.
- **Concept doc rewrite is targeted, not wholesale.** Replace the Human Review Flow section in `workspace-orchestration.mdx` and any troubleshooting-table entries that mention "Workspace Reviews." Leave the rest of the concept doc alone.
- **Inbox HITL section is additive.** Add a "Workspace reviews (system HITL)" subsection to `inbox.mdx`. Do not reorganize the existing inbox doc.
- **Mobile Threads addition is one paragraph.** Extend the existing HITL flow doc with sub-agent surfacing. Don't refactor the file.
- **Automations admin doc is short.** Brief overview of recurring agent work + scheduled jobs + IA position note ("now in the Work group, below Inbox"). Mirror inbox.mdx structure.
- **Astro sidebar fix is the smallest possible diff.** Rename the label from "Routines" to "Automations" and move the entry from the admin Manage subgroup to the admin Work subgroup. Leave the slug as-is (keep `applications/admin/routines` if that's what exists) UNLESS we're creating `applications/admin/automations` as the new page — in which case the slug points at the new page and the old `applications/admin/routines` doc may need to redirect or be deleted. **Decision: create `applications/admin/automations.mdx` as the new page; if `applications/admin/routines.mdx` exists, replace its content with a one-line "moved to automations" frontmatter redirect or delete it depending on Astro's redirect support — verify during implementation.**

---

## Open Questions

### Resolved During Planning

- Where does the system HITL story go in the docs? → Inbox doc, as a dedicated subsection.
- Does the new Automations doc include HITL content? → No. HITL lives in the Inbox doc; Automations doc just describes its own functionality + IA position.
- Does the workspace-orchestration concept doc need a diagram update? → Yes, the routing tree from the master plan's High-Level Technical Design section is reusable. Either drop in the ASCII tree or convert to a Mermaid diagram if `workspace-orchestration.mdx` already uses Mermaid.

### Deferred to Implementation

- **Whether `applications/admin/routines.mdx` exists today.** If yes, decide between deleting it or leaving a content-redirect. Astro's behavior for stale slugs in the sidebar (without a real page) needs verification.
- **Mermaid vs ASCII for the routing tree** in `workspace-orchestration.mdx`. Match whatever the rest of that file uses; verify on read.
- **Exact section heading naming** ("Workspace reviews (system HITL)" vs "System reviews" vs "HITL reviews") in `inbox.mdx`. Pick whichever reads cleanly with the rest of the page.

---

## Implementation Units

- U6.1. **Update workspace-orchestration concept doc**

**Goal:** Rewrite the Human Review Flow section to describe the routing model (paired-human → mobile, system → Inbox). Update troubleshooting-table entries that reference the standalone admin page.

**Requirements:** R9.1, R9.2.

**Dependencies:** None.

**Files:**
- Modify: `docs/src/content/docs/concepts/agents/workspace-orchestration.mdx`

**Approach:**
- Replace the existing "Human review flow" section content.
- Describe the two surfaces explicitly: paired-human reviews on the human's mobile threads; system-agent reviews in admin Inbox as `inbox_items` rows with `type='workspace_review'`.
- Include the routing tree (ASCII or Mermaid, matching the rest of the file's style) — covers AE1 (paired direct), AE2 (sub-agent via parent chain), AE3 (system).
- Remove or rewrite any reference to "Workspace Reviews" page or `/workspace-reviews` route. Note that the route now redirects to `/inbox`.
- Update troubleshooting-table entries: "Review deletion does not resume a run" (mentions the deleted page) — point to Inbox actions instead.

**Test scenarios:**

Test expectation: none — docs are MDX, no behavior to test. Verification handled by content review and Astro build.

**Verification:**
- `pnpm --filter @thinkwork/docs build` (or whatever the docs build command is) succeeds with no broken links from this file.
- Manual read: routing tree is present, paired vs system surfaces are clearly distinguished, no references to the removed page outside of the redirect note.

---

- U6.2. **Add Inbox HITL section**

**Goal:** Document that Inbox is the home for system-agent HITL workspace reviews. Explain the type, action mapping, and automatic materialization.

**Requirements:** R9.3.

**Dependencies:** None (parallel to U6.1).

**Files:**
- Modify: `docs/src/content/docs/applications/admin/inbox.mdx`

**Approach:**
- Add a new subsection (likely "Workspace reviews (system HITL)" or similar) near the type/payload-renderer documentation if any, or near the bottom under an "Item types" section.
- Explain that system-agent (and unrouted) workspace reviews materialize as `inbox_items` rows with `type='workspace_review'` automatically when a run pauses for review.
- Document the action mapping in a small table:
  - Approve → `acceptAgentWorkspaceReview` (run resumes with approval)
  - Reject → `cancelAgentWorkspaceReview` (run cancelled)
  - Request revision → `resumeAgentWorkspaceRun` with notes carried as response (run resumes; agent reads notes and addresses them)
- Note that paired-human reviews do NOT appear here — they live on mobile.
- Cross-link to `concepts/agents/workspace-orchestration` for the underlying routing model.

**Test scenarios:**

Test expectation: none — docs only.

**Verification:**
- Astro build passes; no broken cross-links.
- Manual read: section explains the type, action mapping, automatic materialization, and the paired-vs-system distinction.

---

- U6.3. **Add sub-agent surfacing paragraph to mobile Threads doc**

**Goal:** Document that sub-agent reviews surface to the parent chain's paired human via the resolver-side chain walk (U2). Closes the doc gap from U3.

**Requirements:** R9.4.

**Dependencies:** None (parallel to U6.1, U6.2).

**Files:**
- Modify: `docs/src/content/docs/applications/mobile/threads-and-chat.mdx`

**Approach:**
- Find the existing HITL section. Add a paragraph (or short subsection) explaining that sub-agent reviews appear in the parent chain's paired human's mobile threads.
- Mention the sub-agent label override ("Sub-agent {agent.name} needs your input on {target_path}") so users understand why a review they didn't directly request showed up.
- Cross-link to the orchestration concept doc.

**Test scenarios:**

Test expectation: none — docs only.

**Verification:**
- Astro build passes.
- Manual read: sub-agent surfacing is clearly explained alongside the existing HITL flow.

---

- U6.4. **Create Automations admin doc**

**Goal:** Add `applications/admin/automations.mdx` so the Automations admin nav entry has documentation parity with every other admin entry.

**Requirements:** R9.5.

**Dependencies:** None (parallel to U6.1-U6.3).

**Files:**
- Create: `docs/src/content/docs/applications/admin/automations.mdx`

**Approach:**
- Mirror the structure of `inbox.mdx` and `threads.mdx`: brief overview, walkthrough of scheduled jobs / recurring agent work, IA note ("Automations is in the Work group, below Inbox").
- Do NOT include HITL content — that belongs in `inbox.mdx`. Cross-link from here ("system-agent HITL items appear in [Inbox](/applications/admin/inbox)") if useful.
- Frontmatter: title, sidebar order (verify what the Astro Starlight conventions are by reading another admin doc's frontmatter).

**Test scenarios:**

Test expectation: none — docs only.

**Verification:**
- Astro build passes; the new page renders.
- Manual read: page describes the deployed Automations functionality without overlapping with the Inbox doc's HITL section.

---

- U6.5. **Fix Astro sidebar drift (Routines → Automations, Manage → Work)**

**Goal:** Update `docs/astro.config.mjs` so the docs site sidebar matches the deployed admin app's IA. Rename "Routines" to "Automations" and move it from the admin Manage subgroup to the admin Work subgroup.

**Requirements:** R9.6.

**Dependencies:** U6.4 (the new admin doc must exist before pointing the sidebar at it).

**Files:**
- Modify: `docs/astro.config.mjs`
- Possibly Modify or Delete: `docs/src/content/docs/applications/admin/routines.mdx` (if it exists — verify; replace with a one-line redirect note or delete depending on Astro support)

**Approach:**
- In the admin Work subgroup, add an `Automations` entry pointing at `applications/admin/automations` (the U6.4 page).
- Remove the `Routines` entry from the admin Manage subgroup.
- Final admin Work subgroup order in docs sidebar: Dashboard, Threads, Inbox, Automations (mirroring the deployed admin app from U5).
- If `applications/admin/routines.mdx` exists as a real page, decide between (a) deleting it and accepting that any external links 404, or (b) replacing its content with a frontmatter-level redirect to `automations`. Astro Starlight supports `redirect` in frontmatter; verify before relying on it.

**Test scenarios:**

Test expectation: none — config-only.

**Verification:**
- Astro build passes; the docs sidebar renders with Automations under Work, not Routines under Manage.
- No 404s for any internal cross-link to the renamed entry.
- Manual read of the rendered docs site sidebar matches the deployed admin app sidebar order: Dashboard, Threads, Inbox, Automations under Work; Analytics, Webhooks, People, (Billing if owner), Settings under Manage.

---

## System-Wide Impact

- **Interaction graph:** Docs-only. No runtime interaction with the application.
- **Error propagation:** N/A.
- **State lifecycle risks:** N/A.
- **API surface parity:** N/A.
- **Integration coverage:** Astro build is the integration check.
- **Unchanged invariants:** All code (admin app, mobile, GraphQL surface, workspace event processor, inbox machinery) unchanged. Only the docs site changes.

---

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| `applications/admin/routines.mdx` exists today and external links to its current slug would 404 after U6.5. | Verify whether the file exists; if yes, replace content with a redirect or accept the 404 risk for an internal-only doc page that hasn't been linked from outside the project. |
| The Astro sidebar config has a different shape than expected and the rename touches more than the one entry. | Read the config first before editing. Make the minimum diff. |
| Mermaid vs ASCII inconsistency in `workspace-orchestration.mdx` if I pick the wrong format. | Read the file before writing the routing tree. Match the existing convention. |
| `inbox.mdx` may already have stale references to retired item types (e.g., `task_assigned`). | Out of scope for U6. If genuinely retired, file a separate cleanup; do not pile work into this PR. |

---

## Documentation / Operational Notes

- This is the final unit of the workspace-reviews routing refactor. After U6 merges, the docs site reflects the deployed reality and the refactor is fully landed.
- No deploy implications — docs site builds via Cloudflare Pages on merge to main.
- No release-note delta beyond what U1-U5 already noted.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-28-workspace-reviews-routing-and-removal-requirements.md`
- **Master plan:** `docs/plans/2026-04-28-004-refactor-workspace-reviews-routing-and-removal-plan.md` (contains the authoritative U6 spec restated here)
- Related PRs: #674 (U1), #676 (U2), #677 (U3), #680 (plan revision), #681 (U4), #682 (U5)
- Files touched: `docs/src/content/docs/concepts/agents/workspace-orchestration.mdx`, `docs/src/content/docs/applications/admin/inbox.mdx`, `docs/src/content/docs/applications/admin/automations.mdx` (new), `docs/src/content/docs/applications/mobile/threads-and-chat.mdx`, `docs/astro.config.mjs`, possibly `docs/src/content/docs/applications/admin/routines.mdx` (if it exists)
