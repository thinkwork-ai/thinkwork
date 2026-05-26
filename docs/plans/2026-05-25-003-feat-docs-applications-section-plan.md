---
title: "feat: Promote Applications docs and polish Desktop identity"
type: feat
status: completed
date: 2026-05-25
origin: docs/brainstorms/2026-05-25-docs-applications-section-and-desktop-showcase-requirements.md
completed_by: "commit c94e7131"
---

# feat: Promote Applications docs and polish Desktop identity

## Overview

Promote Applications from a nested Reference group into a root-level docs section above Components, add a real `/applications/` hub page, rewrite the Desktop page so it presents ThinkWork Spaces as an installed Mac app rather than an Electron implementation note, and polish the visible Desktop app icon so the Dock presence matches the product framing.

The work is mostly docs, with one targeted Desktop identity asset pass. It changes public information architecture, product positioning, and a user-visible macOS app asset. The plan therefore keeps implementation small while grounding Desktop wording and icon handling in current source material: `apps/desktop/README.md`, `.github/workflows/release-desktop.yml`, `apps/desktop/package.json`, `scripts/build-desktop.sh`, and the existing docs page at `docs/src/content/docs/applications/desktop/index.mdx`.

---

## Problem Frame

The existing docs already contain substantial application documentation under `docs/src/content/docs/applications/...`, but the sidebar buries Applications under Reference. That makes Admin, Mobile, Desktop, and CLI feel secondary to API and SDK material, even though those are the surfaces users actually open.

The Desktop page has useful install, sign-in, and update details, but its first read is still too implementation-weighted. It should lead with the product role: ThinkWork Spaces as a dedicated macOS app for daily thread, agent, and artifact work, with native shell details serving as trust-building proof points (see origin: `docs/brainstorms/2026-05-25-docs-applications-section-and-desktop-showcase-requirements.md`).

The installed-app story also has to be true visually. The current Dock icon presents as a hard-edged black square beside standard macOS rounded-square icons. That undercuts the "first-class desktop app" positioning, so this plan includes a small icon asset refresh for stable, canary, dev, and local-development icon paths.

---

## Requirements Trace

- R1. Applications appears as a root-level sidebar section above Components.
- R2. The root Applications section includes Admin, Mobile, Desktop, and CLI entries while preserving existing subpage structure.
- R3. Applications has an overview page that frames the four applications as product surfaces.
- R4. The overview page includes each application's primary audience, main job, and recommended next page.
- R5. Desktop opens with the product promise: ThinkWork Spaces as an installed macOS app.
- R6. Desktop explains dock identity, stable daily workspace, native-feeling chrome, session persistence, and controlled updates.
- R7. Desktop states it packages the same Spaces experience rather than creating a separate product surface.
- R8. Desktop describes user-visible work: Spaces navigation, threads, agent chat, generated artifacts, side panels, and command composer.
- R9. Desktop keeps system-browser OAuth, keychain-backed storage, signed/notarized DMG install, canary/stable builds, and auto-update as concise proof points.
- R10. Desktop includes a clear relationship section for Desktop vs Web Spaces, Mobile, Admin, and CLI.
- R11. Desktop copy reads like a first-class product showcase without becoming a release runbook.
- R12. Deeper signing, notarization, update-channel, and debugging guidance stays out of this pass.
- R13. Desktop does not overpromise platform coverage.
- R14. Desktop app icon reads as a polished rounded-square macOS Dock icon, not a sharp black square.
- R15. Stable, canary, dev, and local-development icon assets remain visually related while preserving channel identity.

**Origin actors:** A1 prospective customer/evaluator, A2 end user, A3 operator/implementer, A4 planning/implementation agent.

**Origin acceptance examples:** AE1 sidebar placement, AE2 Applications overview clarity, AE3 Desktop first-screen product framing, AE4 Desktop vs Web Spaces clarity, AE5 release/platform wording restraint, AE6 Dock icon polish.

---

## Scope Boundaries

- No docs theme redesign, global homepage change, visual brand-system work, or Starlight component styling changes.
- No docs screenshots or generated docs imagery required for this pass.
- No release engineering, signing, notarization, update-channel, or workflow changes.
- No substantive rewrite of Mobile, Admin, or CLI child pages beyond linking/framing from the Applications overview.
- No claim that Desktop is a separate app experience from Spaces.

---

## Context & Research

### Relevant Code and Patterns

- `docs/astro.config.mjs` owns Starlight sidebar order. Applications is currently nested inside the Reference section; moving that existing group above Components should preserve child slugs and avoid URL churn.
- `docs/src/content/docs/applications/admin/index.mdx`, `docs/src/content/docs/applications/mobile/index.mdx`, and `docs/src/content/docs/applications/cli/index.mdx` establish the current application-page tone and cross-link style.
- `docs/src/content/docs/applications/desktop/index.mdx` already covers install, sign-in, desktop chrome, web-vs-desktop update timing, and app relationships. Implementation should reorganize and strengthen it rather than replacing all content.
- `docs/STYLE.md` defines hub-page expectations: hook paragraph, real prose, optional table/diagram, `<CardGrid>` of children, and a reading-order recommendation when useful.
- Existing concept hub pages such as `docs/src/content/docs/concepts/threads.mdx` and `docs/src/content/docs/concepts/knowledge.mdx` show how to combine narrative prose, tables, asides, and related links without turning the page into pure reference.
- `apps/desktop/README.md` confirms Desktop is an Electron shell for `@thinkwork/spaces`, macOS is the launch target, stable/canary/dev channels have distinct identities, OAuth uses system-browser deep links, and production install uses DMG artifacts from `desktop-v*` GitHub Releases.
- `.github/workflows/release-desktop.yml` confirms desktop releases are tag-driven, run on `macos-14`, build/sign/notarize/publish, currently set `DESKTOP_MAC_ARCHES: arm64` in the release workflow, and produce SHA-256 artifacts.
- `scripts/build-desktop.sh` selects `apps/desktop/build/icons/icon.icns`, `icon-canary.icns`, or `icon-dev.icns` by channel and copies the selected asset to `icon-active.icns` before packaging.
- `apps/desktop/src/main/branding.ts` sets the local/dev Dock icon from `apps/desktop/build/icons/icon.png`; packaged app icons are owned by bundle metadata. Any icon polish must cover both `.png` and `.icns` paths.
- `apps/desktop/test/main/branding.test.ts` verifies the local branding code points at `build/icons/icon.png` and packaged app launches do not override bundle icons.

### Institutional Learnings

- `docs/STYLE.md` is the load-bearing local guidance for docs tone: explain what the thing is, why it exists, and how it fits before technical detail.
- No directly relevant `docs/solutions/` entry was found for Starlight sidebar IA or Desktop docs copy. Existing docs style and current source pages are sufficient.

### External References

- External research skipped. This is a local docs IA/copy change with strong repo-local patterns and current Desktop source material.

---

## Key Technical Decisions

- Move the existing Applications sidebar group instead of recreating child entries. This minimizes risk of dropped Admin/Mobile/CLI subpages and preserves current URLs.
- Add `docs/src/content/docs/applications/index.mdx` as a hub page. Starlight sidebar can link to `slug: "applications"` while retaining each application group below it.
- Use the docs style guide's hub pattern for `/applications/`: two to three framing paragraphs, a compact comparison table, a `<CardGrid>` for app drill-downs, and related links.
- Rewrite Desktop by reordering around product value first, then user flows, then native proof points. Keep release/operator facts concise and push CI-level details out of page scope.
- Keep platform wording macOS-first unless implementation verifies broader current release support. The README says macOS is the launch target, while the release workflow currently builds Mac artifacts.
- Treat the Desktop icon as part of application identity, not decorative docs art. The replacement should use a native rounded-square composition with enough padding and contrast to remain legible at Dock size.
- Update all user-visible Desktop icon assets together: stable `.icns`, canary `.icns`, dev `.icns`, active/generated source expectations, and local Dock `icon.png`.

---

## Open Questions

### Resolved During Planning

- Desktop platform wording: use macOS-first wording. The Desktop README names macOS as the launch target and the release workflow builds/signs/notarizes Mac artifacts.
- Applications overview shape: use a hybrid hub page with prose, comparison table, and CardGrid because that matches `docs/STYLE.md` for section roots and keeps the four-app comparison scannable.
- Desktop icon scope: include icon polish in this implementation plan because the screenshot shows current app identity visibly conflicts with the first-class Desktop positioning.

### Deferred to Implementation

- Exact Desktop first-screen wording: choose during copy editing against the current page, but it must lead with installed Spaces product value before native implementation details.
- Exact Starlight card icons: choose from existing Starlight icon names already used in docs pages; icons are presentation only and should not block the content pass.
- Whether to mention checksum mirror details: decide while editing Desktop. Include only if it supports user trust; leave command-level checksum verification to release/operator docs.
- Exact icon composition: decide during implementation whether to reuse the current brain mark on a rounded-square background or simplify the mark for Dock-size legibility.

---

## Implementation Units

- U1. **Promote Applications in the sidebar**

**Goal:** Move Applications out of Reference and into a root-level section above Components while preserving all existing application child pages.

**Requirements:** R1, R2, AE1

**Dependencies:** None

**Files:**

- Modify: `docs/astro.config.mjs`
- Test: none

**Approach:**

- Extract the existing Applications sidebar group from inside the Reference section.
- Insert it as a top-level sidebar section after Architecture and before Components.
- Add an Overview item for `slug: "applications"` at the start of the Applications group.
- Leave Admin, Mobile, Desktop, and CLI child groups intact so all existing slugs remain unchanged.
- Keep Reference focused on API Reference and SDKs after Applications moves out.

**Patterns to follow:**

- Existing Starlight sidebar object shape in `docs/astro.config.mjs`.
- Existing nested application group structure currently under Reference.

**Test scenarios:**

- Covers AE1. Navigation: Applications appears as a top-level sidebar section above Components.
- Navigation: Applications contains Overview, Admin, Mobile, Desktop, and CLI.
- Regression: API Reference and SDKs remain under Reference after the move.

**Verification:**

- Inspect the rendered sidebar locally or via built HTML and confirm Applications is top-level, ordered before Components, and child links resolve.

---

- U2. **Add the Applications overview hub**

**Goal:** Create `/applications/` as a real section hub that explains ThinkWork's four application surfaces and routes readers to the right app documentation.

**Requirements:** R3, R4, AE2

**Dependencies:** U1

**Files:**

- Create: `docs/src/content/docs/applications/index.mdx`
- Test: none

**Approach:**

- Add frontmatter with a clear title and standalone description.
- Open with product-surface framing: Applications are where people use and operate ThinkWork; Components explain the platform primitives underneath.
- Include a concise comparison table with app, primary audience, main job, and next page.
- Add a `<CardGrid>` with Admin, Mobile, Desktop, and CLI cards. Keep descriptions specific and non-marketing.
- Add a short "How to choose" or "Read this section" ordering recommendation so evaluators can orient quickly.
- End with Related pages linking to Architecture, Threads, Spaces, and relevant application pages.

**Patterns to follow:**

- Hub page structure from `docs/STYLE.md`.
- `<CardGrid>` examples in `docs/src/content/docs/concepts/knowledge.mdx` and `docs/src/content/docs/concepts/control.mdx`.
- Cross-link style from existing application pages.

**Test scenarios:**

- Covers AE2. Content: a reader can identify each app's audience and main job from the overview without opening child pages.
- Content: every app card links to the correct `/applications/<app>/` page.
- Style: the page has real prose before the table/CardGrid, not only a menu.

**Verification:**

- Build succeeds with the new MDX page.
- Rendered `/applications/` shows the overview, comparison table, and application links without broken Starlight imports.

---

- U3. **Rewrite Desktop as a product showcase**

**Goal:** Reorganize and strengthen the Desktop page so it leads with installed-app value while preserving accurate user-facing install, sign-in, update, and relationship details.

**Requirements:** R5, R6, R7, R8, R9, R10, R11, R12, R13, AE3, AE4, AE5

**Dependencies:** U2

**Files:**

- Modify: `docs/src/content/docs/applications/desktop/index.mdx`
- Test: none

**Approach:**

- Rewrite the opening around "ThinkWork Spaces as an installed macOS app" and explain the daily-work value before mentioning Electron.
- Add or strengthen sections for:
  - why Desktop exists: dock identity, stable workspace, native window, session persistence, controlled updates;
  - what users do there: Spaces navigation, threads, agent chat, generated artifacts, side panels, command composer;
  - Desktop vs Web Spaces: same product experience, packaged at release time;
  - native trust points: system-browser OAuth, keychain-backed session restore, signed/notarized DMG, stable/canary channel identity, auto-update;
  - relationship to Mobile, Admin, CLI, and Web Spaces.
- Keep current install and sign-in guidance, but move it after product framing.
- Use a "Known limits" or concise status section for macOS-first support if needed.
- Avoid CI-secret lists, release command recipes, or deep build mechanics. Link relationship/support context only when it helps the reader.

**Patterns to follow:**

- Current Desktop page content in `docs/src/content/docs/applications/desktop/index.mdx`.
- Desktop source-of-truth status in `apps/desktop/README.md` and `.github/workflows/release-desktop.yml`.
- Docs style guide guidance on hook paragraphs, honesty sections, and putting implementation detail near the bottom when needed.

**Test scenarios:**

- Covers AE3. First screen: the opening explains installed Spaces product value before Electron/build details.
- Covers AE4. Relationship: the page explicitly says Desktop packages the same Spaces experience and differs primarily in native shell, sign-in, persistence, and update delivery.
- Covers AE5. Platform status: the page uses macOS-first wording and does not imply Windows or Linux are shipped.
- Content: install, sign-in, and update facts from the current page are preserved or intentionally reframed.
- Content: Desktop's relationship table or section links to Mobile, Admin, CLI, and relevant Spaces/Threads concepts.

**Verification:**

- Rendered `/applications/desktop/` reads as a product page at the top and still answers practical install/sign-in/update questions.
- No unsupported platform claim is introduced.

---

- U4. **Verify docs, links, formatting, and icon polish**

**Goal:** Validate that the navigation move, MDX copy changes, and Desktop icon asset refresh are complete and do not introduce broken docs structure or app-identity regressions.

**Requirements:** R1, R2, R3, R4, R11, R13, R14, R15, AE1, AE2, AE5, AE6

**Dependencies:** U1, U2, U3, U5

**Files:**

- Modify: none
- Test: none

**Approach:**

- Run the docs build for Astro/Starlight.
- Run the repo's formatting check or format the touched Markdown/MDX/JS files according to normal repo workflow.
- Manually inspect the rendered sidebar and key pages if a local preview is available: `/applications/`, `/applications/desktop/`, `/applications/admin/`, `/api/graphql/`.
- Manually inspect the refreshed Desktop app icon in a Dock-sized context or packaged-app preview.
- Treat content review as part of verification: read the first screen of Desktop and Applications after editing to confirm tone and scope match the origin doc.

**Patterns to follow:**

- `docs/package.json` provides `build`; repo root provides `format:check`.
- Existing docs use site-root links such as `/applications/mobile/` and `/concepts/threads/`.

**Test scenarios:**

- Build: Starlight/Astro completes without MDX import or route errors.
- Navigation: Applications root and child links resolve.
- Regression: Reference still exposes API Reference and SDK pages after Applications moves.
- Content QA: Desktop page does not contain release-runbook depth such as secret lists or tag-push command recipes.
- Visual QA: Desktop icon reads as a rounded macOS app icon at Dock size, not a hard-edged black square.

**Verification:**

- Docs build succeeds.
- Formatting check passes for touched files, or the touched files are formatted.
- Manual sidebar/content/icon inspection confirms requirements trace.

---

- U5. **Polish Desktop Dock icon assets**

**Goal:** Replace the hard-edged Desktop app icon with a native-looking rounded-square icon across local/dev and packaged channel assets.

**Requirements:** R6, R14, R15, AE6

**Dependencies:** None

**Files:**

- Modify: `apps/desktop/build/icons/icon.png`
- Modify: `apps/desktop/build/icons/icon.icns`
- Modify: `apps/desktop/build/icons/icon-canary.icns`
- Modify: `apps/desktop/build/icons/icon-dev.icns`
- Modify: `apps/desktop/build/icons/icon-active.icns`
- Test: none

**Approach:**

- Design or generate a 1024x1024 source icon that reads as a native macOS rounded-square app icon at Dock size.
- Preserve ThinkWork identity by using the brain mark or a simplified variant, but avoid edge-to-edge black canvas.
- Keep stable, canary, and dev assets visually related. If channel variants need differentiation, use restrained channel-specific accents rather than separate visual languages.
- Regenerate `.icns` files from the polished source assets so packaged stable/canary/dev builds and local development Dock branding all use the same polished family.
- Leave `scripts/build-desktop.sh` channel selection behavior unchanged unless implementation reveals a broken asset path.

**Patterns to follow:**

- Existing channel asset paths in `scripts/build-desktop.sh`.
- Local Dock branding behavior in `apps/desktop/src/main/branding.ts`.
- Current test expectations in `apps/desktop/test/main/branding.test.ts`.

**Test scenarios:**

- Test expectation: none -- this is a static visual asset refresh with existing code-path coverage for which icon file local branding loads.
- Visual: local dev Dock icon no longer appears as a sharp black square.
- Visual: packaged `.icns` preview shows rounded corners/padding and remains legible at small Dock sizes.
- Regression: stable, canary, and dev packaged builds still resolve their channel-specific icon paths.

**Verification:**

- Confirm the PNG source remains 1024x1024 and includes alpha where appropriate.
- Confirm all `.icns` files are regenerated and present at the paths selected by `scripts/build-desktop.sh`.
- Launch or preview a local/dev build and compare the Dock icon against standard rounded macOS app icons.

---

## System-Wide Impact

- **Interaction graph:** Public docs navigation changes; application URLs remain stable and `/applications/` becomes a new route. Desktop icon assets change for local/dev and packaged macOS builds.
- **Error propagation:** The main failure mode is MDX or Starlight sidebar build failure, surfaced by docs build.
- **State lifecycle risks:** None. No runtime state or deployed infrastructure changes.
- **API surface parity:** No API, SDK, CLI, or app runtime behavior changes.
- **Integration coverage:** Build plus manual preview is sufficient for docs. Icon polish requires visual verification in Dock or packaged-app preview because there is no automated visual asset test.
- **Unchanged invariants:** Existing `/applications/admin/`, `/applications/mobile/`, `/applications/desktop/`, and `/applications/cli/` URLs remain valid.

---

## Risks & Dependencies

| Risk                                                     | Mitigation                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Sidebar move accidentally drops a child application page | Move the existing Applications object intact and verify each child group remains present.                                |
| Desktop copy overstates current platform support         | Ground wording in `apps/desktop/README.md` and `.github/workflows/release-desktop.yml`; use macOS-first status language. |
| Product showcase tone becomes marketing-heavy            | Follow `docs/STYLE.md`: plain, honest, specific, no generic value-prop filler.                                           |
| Overview page duplicates too much child-page content     | Keep the overview as routing/orientation; leave detail to app-specific pages.                                            |
| Icon refresh updates local dev but not packaged builds   | Update both `icon.png` and every channel `.icns` file selected by `scripts/build-desktop.sh`.                            |
| Icon remains illegible at Dock size                      | Verify the asset at small sizes, not only as a 1024px source image.                                                      |

---

## Documentation / Operational Notes

- This plan is mostly documentation plus a small Desktop icon asset refresh; no separate runbook update is required.
- If Desktop release/operator details grow during implementation, do not expand this page into a runbook. Capture that need as follow-up work for a separate operator/release page.
- After implementation, PR description should call out both the IA change and the Dock icon visual polish because reviewers will want to scan the docs sidebar and inspect the app icon.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-25-docs-applications-section-and-desktop-showcase-requirements.md](../brainstorms/2026-05-25-docs-applications-section-and-desktop-showcase-requirements.md)
- `docs/astro.config.mjs`
- `docs/STYLE.md`
- `docs/src/content/docs/applications/desktop/index.mdx`
- `docs/src/content/docs/applications/admin/index.mdx`
- `docs/src/content/docs/applications/mobile/index.mdx`
- `docs/src/content/docs/applications/cli/index.mdx`
- `apps/desktop/README.md`
- `.github/workflows/release-desktop.yml`
- `apps/desktop/package.json`
- `scripts/build-desktop.sh`
- `apps/desktop/src/main/branding.ts`
- `apps/desktop/test/main/branding.test.ts`
