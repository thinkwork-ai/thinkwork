---
date: 2026-05-19
topic: computer-to-app-rename-and-light-mode-polish
---

# Computer → App Rename and Light-Mode Polish

## Summary

Rename the end-user application from "Cloud Computer" to "ThinkWork" (just the product brand), move its canonical URL from `computer.thinkwork.ai` to `app.thinkwork.ai`, sweep user-visible "computer"/"cloud" framing out of `apps/computer`, and fix three light-mode UI regressions on the sidebar logo, in-thread followup composer, and placeholder text contrast.

---

## Problem Frame

The end-user surface inside `apps/computer` is being repositioned as a collaborative workspace (shared computers, multi-agent threads) rather than a single-user "cloud computer." The current naming and chrome carry the old framing forward: the sidebar tags the workspace as "Cloud Computer," the URL is `computer.thinkwork.ai`, and the empty-thread page's composer copy ("Type a command, attach an .xlsx / .csv...") still leans on a command-line metaphor.

On top of that framing drift, three light-mode rendering problems make the app look unfinished:

- The sidebar logo (`public/logo.png`) is a light blue that fades into a white background.
- The in-thread followup composer in `TaskThreadView.tsx` hardcodes `text-white placeholder:text-white/75` against a dark bubble, so it stays dark in light mode while the rest of the page is white.
- Placeholder text in both composers is washed out enough in light mode to read as disabled.

The admin operator surface (`apps/admin`, served at `admin.thinkwork.ai`) is a separate product and is not part of this work.

---

## Requirements

**Naming and URL**

- R1. The end-user app's canonical URL becomes `app.thinkwork.ai`. `computer.thinkwork.ai` 301-redirects to `app.thinkwork.ai` for any path, including the OAuth callback path, for at least one quarter after cutover.
- R2. The Cognito `ThinkworkAdmin` client's CallbackURLs include `https://app.thinkwork.ai` (and any required sub-paths). The pre-rename callback for `https://computer.thinkwork.ai` stays registered while the 301 is active so in-flight OAuth flows complete cleanly.
- R3. Any user-visible reference to "computer.thinkwork.ai" inside `apps/computer` (links, copy, OAuth redirect builders that hardcode the host) resolves to `app.thinkwork.ai` after the rename.
- R4. Internal package name (`@thinkwork/computer`) and source-tree path (`apps/computer/`) are not changed in this work. Internal naming is a separate cleanup if desired later.

**Sidebar chrome**

- R5. The "Cloud Computer" subtitle line in `ComputerSidebar.tsx` is removed. The workspace header shows only "ThinkWork" plus the logo.
- R6. In light mode, the sidebar logo reads as visibly darker / higher contrast than today. In dark mode the logo treatment is unchanged.

**Composer styling — light mode**

- R7. The in-thread followup composer in `TaskThreadView.tsx` matches the New Thread composer (`ComputerComposer.tsx`) in light mode: light/transparent background, themed text color, themed border treatment. The dark-bubble hardcoding (`text-white`, `placeholder:text-white/75`, dark background) is removed.
- R8. Both composers continue to render correctly in dark mode after the change — no regression to either page.
- R9. Placeholder text in both composers reads with noticeably stronger contrast in light mode than today (still secondary, but not washed out).

**Terminology sweep**

- R10. Other user-visible strings inside `apps/computer` are reviewed for "computer" / "cloud computer" / command-line framing and updated where they no longer match the collaborative-workspace positioning. Browser tab title, empty-state copy, page headings, and tooltips are in scope; non-user-visible code identifiers are out of scope (per R4).
- R11. The in-thread followup placeholder text reads `"Type @ for connectors and sources"` — the same string as the New Thread composer — so the two composers feel like the same primitive. The `.xlsx`/`.csv` attachment affordance stays via the paperclip icon; it does not need to be in the placeholder.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** A user with a stale bookmark to `https://computer.thinkwork.ai/threads/abc123` clicks it; the browser lands on `https://app.thinkwork.ai/threads/abc123` after the 301 and renders that thread (no OAuth bounce loop, no 404).
- AE2. **Covers R5, R6.** In light mode, the sidebar shows the logo plus "ThinkWork" as a single header row with no secondary line, and the logo is visually present against the white sidebar background (not "where did the logo go" faint).
- AE3. **Covers R7, R8, R9.** In light mode, an open thread with completed steps shows a followup composer with a white/near-white background, dark text, and a placeholder string that reads clearly without straining. Switching to dark mode renders the same composer with the dark-theme styling — no leftover light-mode artifacts.
- AE4. **Covers R11.** Both the New Thread composer and the in-thread followup composer show the same placeholder text (`"Type @ for connectors and sources"`) when empty.

---

## Success Criteria

- A user looking at `apps/computer` in light mode does not see any "Cloud Computer" framing, dark-mode-leak composer, or washed-out placeholder text.
- Existing `computer.thinkwork.ai` bookmarks and OAuth handoffs continue to work for at least one quarter post-cutover with no manual intervention.
- A planning agent picking this up does not have to invent which composer styles to match, which strings to sweep, or what to do with `admin.thinkwork.ai` — those are all explicit in this doc.

---

## Scope Boundaries

- `admin.thinkwork.ai` and `apps/admin` are untouched. They remain a separate operator product.
- No nav/IA changes. The "like Slack" repositioning is signaled by naming and copy only in this work — no channels, no presence indicators, no membership UI, no rethink of Threads/Artifacts/Automations/Memory/Customize nav grouping.
- Internal package name (`@thinkwork/computer`) and folder path (`apps/computer/`) are not renamed.
- No marketing-site or external-docs changes.
- The dark-mode appearance of either composer is unchanged. The polish is light-mode-only.
- Logo asset itself is not redesigned. "Darker in light mode" can be achieved by a light-mode-specific asset variant, a CSS filter, or equivalent — the choice is for planning/implementation.

---

## Key Decisions

- **Surface rename + terminology sweep, no IA shift.** "Collaborative space" gets signaled through naming and copy now; nav/IA evolution is a separate brainstorm if it ever happens.
- **`app.thinkwork.ai` as the canonical URL.** Short, neutral, signals "the end-user app" without locking in a metaphor (workspace, hub, team) that may not age well.
- **301 from old subdomain, don't retire it immediately.** Preserves in-the-wild bookmarks and reduces OAuth pain during the cutover; revisit retirement in a future cleanup.
- **Unify both composer placeholders.** Same string in both surfaces, because they are the same primitive from the user's perspective.

---

## Dependencies / Assumptions

- Cognito `ThinkworkAdmin` user-pool client can hold callback URLs for both `app.thinkwork.ai` and `computer.thinkwork.ai` simultaneously during the redirect window. (Per the project memory entry on admin worktree Cognito callbacks, multiple URLs on the same client is already the operating pattern.)
- The CloudFront / Route 53 setup for `computer.thinkwork.ai` can be reconfigured to issue 301s (or the CloudFront distribution behind it can serve the redirect) without dropping in-flight sessions. To be confirmed during planning.
- `apps/computer`'s OAuth redirect builder uses the current host or a configured base URL, not a hardcoded `computer.thinkwork.ai` literal. Likely true given the dev port handling, but verify during planning.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] Where does the 301 actually live — CloudFront function on the existing `computer.thinkwork.ai` distribution, a redirect rule in Terraform, or a small Lambda@Edge? Pick the lowest-ceremony option.
- [Affects R6][Technical] Logo darken mechanism: ship a second PNG asset and swap via a `prefers-color-scheme` media query / Tailwind dark variant, or apply a CSS filter on the existing PNG. Pick whichever reads better at the actual sizes used.
- [Affects R9][Needs research] Exact placeholder color values for light mode. Inspect adjacent shadcn/ui primitives in `@thinkwork/ui` and the project's Tailwind theme tokens; pick a token that's already in use rather than introducing a one-off.
- [Affects R10][Technical] Full inventory of "computer"/"cloud" strings inside `apps/computer`. Grep during planning; this brainstorm names the rule, not every match.
