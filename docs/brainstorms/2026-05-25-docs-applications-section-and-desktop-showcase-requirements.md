---
date: 2026-05-25
topic: docs-applications-section-and-desktop-showcase
---

# Docs Applications Section and Desktop Showcase

## Problem Frame

The docs currently contain substantial application documentation under `/applications/...`, but the sidebar places Applications inside Reference. That makes the primary product surfaces feel secondary to API and SDK reference material, even though Admin, Mobile, Desktop, and CLI are the concrete ways people experience ThinkWork.

The Applications section should move to the root docs navigation above Components. The Desktop page should also shift from an implementation-weighted Electron overview toward a product showcase: ThinkWork Spaces as an installed Mac application with a clear daily-work value proposition, practical user flows, and enough native detail to build trust without reading like an operator runbook.

---

## Actors

- A1. Prospective customer or evaluator: needs to understand what ThinkWork applications exist and why Desktop matters.
- A2. End user: wants to know what they can do in the Desktop app and how it differs from the browser or mobile app.
- A3. Operator or implementer: needs enough accurate release, auth, and update context to support the Desktop app without turning the page into build documentation.
- A4. Planning or implementation agent: needs stable scope so it can update docs navigation and copy without inventing positioning.

---

## Requirements

**Applications information architecture**

- R1. Applications appears as a root-level sidebar section above Components, not nested under Reference.
- R2. The root Applications section includes Admin, Mobile, Desktop, and CLI entries, preserving the existing per-application subpage structure.
- R3. Applications has an overview page that frames the four applications as the product surfaces of ThinkWork, not as reference material.
- R4. The overview page includes a concise comparison of each application's primary audience, main job, and recommended next page.

**Desktop positioning**

- R5. The Desktop page opens with the product promise: ThinkWork Spaces as an installed macOS app for daily thread, agent, and artifact work.
- R6. The Desktop page explains why the app exists in product terms: dock identity, a stable daily workspace, native-feeling window chrome, session persistence, and controlled update delivery.
- R7. The Desktop page clearly states that Desktop packages the same Spaces experience users get on the web, rather than creating a separate product surface or fork.
- R8. The Desktop page describes the user-visible work supported in Desktop: Spaces navigation, threads, agent chat, generated artifacts, side panels, and the command composer.
- R9. The Desktop page keeps native implementation facts as trust-building proof points: system-browser OAuth, macOS keychain-backed session storage, signed/notarized DMG installation, canary/stable builds, and auto-update support.
- R10. The Desktop page includes a clear relationship section for Desktop vs Web Spaces, Mobile, Admin, and CLI.

**Tone and boundaries**

- R11. Desktop copy reads as a first-class product showcase, with enough practical detail to answer user questions but without becoming a packaging or CI runbook.
- R12. Release/operator details remain concise on the Desktop page; deeper signing, notarization, update-channel, or debugging guidance is deferred to a future operator/release page if it grows.
- R13. The Desktop page should not overpromise platform coverage. It may mention macOS as the current supported release path and should avoid implying Windows or Linux are currently shipped unless verified during implementation.

**Desktop application identity**

- R14. The Desktop app icon should keep the existing brain mark and dark background, but use transparent rounded corners so it no longer appears as a sharp black square in the macOS Dock.
- R15. Stable, canary, dev, and local-development icon assets should use the same rounded-corner treatment so every user-visible Desktop icon path is consistent.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given a reader opens the docs sidebar, when they scan the top-level sections, Applications appears above Components and contains Admin, Mobile, Desktop, and CLI.
- AE2. **Covers R3, R4.** Given a reader opens `/applications/`, when they skim the page, they can tell which app is for end users, operators, developers, and deployment or support workflows.
- AE3. **Covers R5, R6, R11.** Given a prospective customer opens `/applications/desktop/`, when they read the first screen, the page explains why Desktop exists as an installed Spaces app before it explains Electron details.
- AE4. **Covers R7, R10.** Given an existing Spaces web user reads the Desktop page, when they look for differences, the page makes clear that Desktop uses the same Spaces product experience and differs primarily in native shell, sign-in, persistence, and update delivery.
- AE5. **Covers R12, R13.** Given an operator reads the Desktop page, when they look for release mechanics, they see enough status to support users but are not led into unsupported Windows/Linux or CI-specific instructions.
- AE6. **Covers R14, R15.** Given the Desktop app is shown in the macOS Dock next to standard rounded app icons, when a user scans the Dock, ThinkWork Spaces keeps its existing mark but reads as a rounded app icon rather than a raw square canvas.

---

## Success Criteria

- Applications feels like a first-class product area in the docs, not a buried reference category.
- Desktop reads like a compelling installed-app surface while remaining accurate about its relationship to Spaces and the rest of ThinkWork.
- The Desktop app's visible macOS identity matches the level of polish described by the docs page.
- A planner can move directly into implementation without deciding the IA, page tone, or Desktop scope from scratch.

---

## Scope Boundaries

- No redesign of the docs theme, global homepage, visual brand system, or Starlight component styling.
- No new docs screenshots or generated docs imagery required for this pass.
- No new release engineering, signing, notarization, or update-channel work.
- No expansion of Mobile, Admin, or CLI pages beyond what is needed for the Applications overview and navigation.
- No claim that Desktop is a separate app experience from Spaces; the relationship must remain explicit.

---

## Key Decisions

- Applications moves above Components because the docs should foreground what users actually open and use before explaining the platform primitives underneath.
- Desktop should use a product-showcase framing, but keep the current user-facing operational facts as supporting proof instead of removing them.
- A root Applications overview page is part of the change so the new top-level nav section has an intentional landing surface rather than only nested entries.
- Desktop icon polish is part of the same application-positioning pass because the installed app's Dock presence must match the first-class product framing.

---

## Dependencies / Assumptions

- The current docs content already lives under `docs/src/content/docs/applications/...`; the known gap is navigation prominence and overview/positioning, not the existence of application pages.
- The current Desktop page already contains accurate install, sign-in, header/navigation, update, and relationship material that can be reorganized and strengthened rather than replaced wholesale.
- Implementation should verify current Desktop support status against the app docs/source before making platform availability claims.
- The current Desktop icon pipeline uses channel-specific `.icns` assets for packaged builds and `apps/desktop/build/icons/icon.png` for local/dev Dock branding; implementation should update every path users can see.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R9, R13] [Technical] Confirm the exact current Desktop release status, platform support wording, and auto-update wording against the current desktop app and release pipeline before editing the public docs.
- [Affects R3, R4] [Content] Decide whether the Applications overview should use a table, cards, or short sections based on the existing docs style during implementation.
- [Affects R14, R15] [Design] Apply rounded corners only; do not redesign or embellish the existing icon artwork.

---

## Next Steps

-> /ce-plan for structured implementation planning, or proceed directly with a small docs and desktop-identity implementation pass if the team wants to skip a formal plan.
