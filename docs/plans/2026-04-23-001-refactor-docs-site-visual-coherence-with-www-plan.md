---
title: "refactor: Align docs site visual language with www marketing site"
type: refactor
status: active
date: 2026-04-23
---

# refactor: Align docs site visual language with www marketing site

## Overview

The docs site (`docs/`, a Starlight 0.34.8 + Astro 5 build serving `docs.thinkwork.ai`) and the marketing site (`apps/www/`, an Astro 5 + Tailwind 3 build serving `thinkwork.ai`) currently feel like two different products. A user crossing from `thinkwork.ai` to `docs.thinkwork.ai` experiences a palette shift (cool slate vs. brand sky blue), a background shift (Starlight's `#0f172a` vs. www's near-black `#070a0f`), a header shift (opaque Starlight chrome vs. www's translucent backdrop-blur), and a button shift (neutral slate CTAs vs. brand-blue `rounded-xl` CTAs).

This plan re-skins the docs site to share the same visual tokens and chrome treatments as www while preserving every functional affordance Starlight gives us (sidebar, TOC, search, code blocks, callouts, light/dark toggle). No content changes — this plan is purely token + chrome alignment. Editorial style already lives in `docs/STYLE.md` and is out of scope here.

## Problem Frame

Today a reader who reads the marketing landing, clicks "Docs", and lands on the docs home sees an abrupt visual break. The brain mark is the same shape but a different color. The headline is a different weight. The primary CTA is a different button shape. The body is a visibly lighter dark background. There is no shared brand token system between the two apps — `apps/www/tailwind.config.mjs` declares a `brand` color ramp anchored on sky-400 `#38bdf8`, while `docs/src/styles/custom.css` sets `--sl-color-accent: #e2e8f0` (neutral slate-200). The two sites were built at different times with different frameworks, and nothing today enforces visual coherence.

The goal is that a reader moving between the two sites should feel like they stayed on the same product. Content is different — marketing is narrative, docs is reference — but the visual vocabulary (colors, type rhythm, chrome translucency, brand-mark treatment, CTA shape) should be shared.

## Requirements Trace

- R1. Docs dark mode visually matches www: the same near-black page background, the same brand sky-blue accent, the same translucent header with backdrop blur, the same `border-white/5` rule color.
- R2. The shared brain mark renders in brand sky-blue in both the docs header and the docs hero, with the same drop-shadow glow treatment used on www's hero.
- R3. The primary CTA in the docs hero and in MDX content uses the same shape (`rounded-xl`), the same brand-blue fill, the same off-black text, and the same brand-tinted shadow as www's primary CTA.
- R4. Body prose link color in dark mode is a muted brand blue that reads as "same product" as www's inline accents, while preserving WCAG AA contrast against the near-black background.
- R5. Light mode is preserved for docs readers who prefer it, with the same brand-blue accent scaled for a light background (no separate "neutral" mode).
- R6. The Starlight sidebar, TOC, search palette, code blocks, and admonitions continue to work without regression — this is a token refresh, not a component rebuild.
- R7. Heading rhythm, eyebrow treatment (uppercase + tracking + leading brand dot), and section spacing in docs splash pages echo www's `SectionHeader`/`SectionShell` pattern closely enough that screenshots side-by-side feel coherent.
- R8. Favicon and logo assets on both sites visibly match (same mark, same color treatment).
- R9. Body text renders with the same font stack on both sites (Starlight's default `--sl-font-system` differs from www's; override `--sl-font` in docs to match www verbatim).

## Scope Boundaries

- **Not in scope:** content rewrites, page structure, sidebar reorganization, editorial tone (those live in `docs/STYLE.md` and the already-completed `docs/plans/2026-04-21-008-docs-full-rewrite-thinkwork-docs-site-plan.md`).
- **Not in scope:** inventing or importing new web fonts. Both sites render with OS-resident UI fonts; we keep that. Note that Starlight's default `--sl-font-system` and www's Tailwind `font-sans` stack differ in ordering and fallbacks — aligning them in dark mode via `--sl-font` is in scope (covered by R9); adding web-font downloads is not.
- **Not in scope:** replacing Starlight's built-in components (`PageFrame`, `Sidebar`, `Pagination`, `TableOfContents`, `Search`). Those pick up changes via CSS custom properties; do not swap them.
- **Not in scope:** changing the www side to match docs. www is the canonical source of visual language. This plan only changes docs.
- **Not in scope:** dropping light mode. Docs supports both modes today; this plan keeps both.
- **Not in scope:** introducing Tailwind into the docs build. Starlight does not ship with Tailwind, and fighting that is a larger refactor than the problem warrants. Tokens move via plain CSS custom properties.

### Deferred to Separate Tasks

- **Shared brand-tokens package:** extracting a `packages/brand-tokens/` module that both www's Tailwind config and docs's custom CSS consume. Today the canonical values live in `apps/www/tailwind.config.mjs` and docs mirrors them with a sync comment — same pattern already established for `brain-path.mjs`. Worth revisiting if a third surface (e.g., admin SPA, mobile web marketing) joins the brand system.
- **OG image refresh for docs:** docs does not currently generate OG images the way www does (`apps/www/scripts/generate-brand-assets.mjs`). Once the token alignment lands, a follow-up can generate matching OG imagery for `docs.thinkwork.ai`.
- **Marketing → docs shared header:** a single header component rendered by both sites. Large refactor; not required for visual coherence.

## Context & Research

### Relevant Code and Patterns

- `apps/www/tailwind.config.mjs` — canonical brand color ramp (`brand.50`..`brand.900`, anchored on `brand.400 = #38bdf8`).
- `apps/www/src/layouts/Base.astro` — body shell: `bg-[#070a0f] text-slate-100 antialiased font-sans`; also defines the `fade-in-up` keyframe used across www.
- `apps/www/src/components/Header.astro` — translucent fixed header: `bg-[#070a0f]/80 backdrop-blur-xl border-b border-white/5`.
- `apps/www/src/components/Footer.astro` — darker footer zone: `bg-[#05080c]`.
- `apps/www/src/components/Hero.astro` — radial glow pattern (`bg-brand/8 blur-[160px]`, `bg-brand/10 blur-[140px]`), brain mark with `drop-shadow-[0_0_40px_rgba(56,189,248,0.35)]`, eyebrow pill with leading brand dot.
- `apps/www/src/components/SectionHeader.astro` — canonical eyebrow rhythm: `text-[11px] font-semibold uppercase tracking-[0.22em] text-brand/90` with a `1×1` brand dot leading.
- `apps/www/src/components/SectionShell.astro` — section rhythm with `border-t border-white/5` + optional brand-tinted glow variants.
- `docs/src/styles/custom.css` — the only CSS override file docs loads today. It currently sets `--sl-color-accent` to a neutral slate. This is the primary vehicle for the token refresh.
- `docs/src/components/Hero.astro` — already a custom splash hero (Starlight's `Hero` component override, wired via `components: { Hero: "./src/components/Hero.astro" }` in `docs/astro.config.mjs`). Shape mirrors www's hero but colors are plumbed from `--sl-color-accent`. Rewire to brand tokens.
- `docs/src/components/BrainMark.astro` — already mirrors `apps/www/src/components/BrainMark.astro`. Keep this parity.
- `docs/src/lib/brain-path.mjs` — already carries a "canonical copy lives at `apps/www/src/lib/brain-path.mjs` — keep in sync" comment. The same duplication-with-sync-comment pattern should be extended to brand-color values in `custom.css`.
- `docs/src/content/docs/index.mdx` — docs landing page uses `template: splash` with a hero object. Verifies the docs `Hero.astro` override is the right integration point.
- `docs/node_modules/@astrojs/starlight/style/props.css` — Starlight's token declarations. Confirms: (a) dark is the bare-`:root` default; light is `:root[data-theme='light']` (drives R1/R5 selector convention); (b) `--sl-color-gray-*` dark ramp is inverted from Tailwind's (gray-1 lightest, gray-7 darkest); (c) `--sl-font-system` default differs from www's stack (drives R9); (d) `--sl-color-bg-nav` is the header fill token to override for translucency.
- `docs/node_modules/@astrojs/starlight/components/PageFrame.astro` — confirms the outer `<header class="header">` is already `position: fixed` with `background-color: var(--sl-color-bg-nav)`, styled inside `@layer starlight.core`. Informs the Unit 4 override strategy.
- `docs/node_modules/@astrojs/starlight/components/SiteTitle.astro` — renders the logo via `<img src>`, which is why the current raster logo cannot be recolored with CSS. Drives the Unit 6 rescoping.

### Institutional Learnings

No matching entries in `docs/solutions/`. This is the first systematic pass at docs/www visual alignment.

### Starlight theming primitives worth noting

Starlight exposes a stable set of CSS custom properties on `:root` (light) and `:root[data-theme="dark"]` (dark) that cascade into every built-in component. Keys we will actually set:

- Accent ramp: `--sl-color-accent-low`, `--sl-color-accent`, `--sl-color-accent-high` — drive sidebar active state, link color, focus ring, code-block language label, TOC current-item, primary-button background in Starlight components.
- Background/foreground ramp: `--sl-color-bg`, `--sl-color-bg-nav`, `--sl-color-bg-sidebar`, `--sl-color-text`, `--sl-color-text-accent`, `--sl-color-black`, `--sl-color-white`.
- Gray ramp: `--sl-color-gray-1`..`--sl-color-gray-6` — Starlight uses these extensively for borders, muted text, and sidebar rules.

Everything else (header translucency, hero glow hue, CTA shape, splash-page spacing) lives in targeted `:global` CSS inside `custom.css`.

## Key Technical Decisions

- **Canonical source of truth:** `apps/www/tailwind.config.mjs` owns the brand ramp. `docs/src/styles/custom.css` mirrors the values as CSS custom properties and carries a sync comment. No new shared package yet — matches the established `brain-path.mjs` pattern.
- **Token layer over component layer:** prefer adjusting CSS custom properties that Starlight already consumes. Only drop into component overrides when a property does not exist (hero glow hue, header backdrop-blur, fixed-header behavior). This minimizes regressions against future Starlight upgrades.
- **Keep light mode, tune it:** docs readers value light mode and Starlight ships it well. The accent in light mode is `brand-600`/`brand-700` (deeper blue on light backgrounds) — not a neutral — so the product identity reads the same across modes.
- **No Tailwind in docs:** docs stays on plain CSS custom properties + hand-written selectors. Introducing Tailwind here would be a larger refactor than the coherence problem justifies.
- **Preserve Starlight chrome functions:** the translucent header, sidebar, TOC, search modal, and code-block toolbar all stay; we are re-skinning, not replacing.
- **Heading + eyebrow rhythm via CSS only:** docs does not need a ported `SectionHeader` component. MDX `##`/`###` inherit rhythm from CSS; the eyebrow pattern only appears in the splash hero and is handled inside `Hero.astro`.

## Open Questions

### Resolved During Planning

- **Should docs go dark-only to match www?** Resolved: no. Docs keeps both modes. Both modes use the brand sky-blue accent. The coherence goal is about shared visual language, not about killing light mode. Flipping to dark-only later is a one-setting change if we change our minds.
- **Extract a shared brand-tokens package?** Resolved: not now. Duplicate with a sync comment (same pattern as `brain-path.mjs`). Reconsider when a third surface joins.
- **Override Starlight's `Header` component vs. CSS-only?** Resolved: CSS-only. Starlight's default `Header` already renders the logo, title, search trigger, and theme toggle. A full component replacement would re-own search wiring and mobile sidebar toggle. Backdrop-blur + border-white/5 + translucent bg is a three-line CSS override; do that.
- **Do we need a custom `components/` override for sidebar or TOC?** Resolved: no. Both pick up the accent ramp via `--sl-color-accent*`.
- **Is the docs header already `position: fixed` like www's?** Resolved: yes. `docs/node_modules/@astrojs/starlight/components/PageFrame.astro` sets `.header { position: fixed; ... }` by default; both sites already share fixed positioning. No "fixed vs. sticky" decision needs to be made. Inherit Starlight's fixed header and restyle the chrome only.
- **Starlight theme-selector convention:** Resolved: Starlight declares dark-mode defaults in bare `:root` and light-mode overrides in `:root[data-theme='light']` (see `docs/node_modules/@astrojs/starlight/style/props.css`). The existing `docs/src/styles/custom.css` already follows that convention (dark-leaning gray ramp in `:root`, accent overrides in `[data-theme='dark']` — actually the inverse of Starlight's dark-default pattern, which this plan corrects). All new token work in this plan must put dark values in `:root` and light overrides in `:root[data-theme='light']`.
- **Font stack parity:** Resolved: Starlight's default `--sl-font-system` and www's Tailwind `font-sans` stack differ in both leading entries and tail fallbacks (Starlight leads with `ui-sans-serif`, www with `system-ui`; Starlight includes `Noto Sans` + emoji fallbacks that www omits). For text-rendering parity across sites, override `--sl-font` in dark-mode `:root` to match www's stack verbatim. Track the canonical list alongside the brand-ramp sync comment.
- **Header logo format:** Resolved: `docs/src/assets/logo.png` is a 512×412 RGBA raster and cannot be recolored via CSS. www's header renders `<BrainMark class="text-brand">` (SVG, fills on `currentColor`). To achieve R2/R8 logo parity, swap the docs Starlight logo to an SVG (or override `SiteTitle.astro` to render `<BrainMark>` directly). Unit 6 is rescoped accordingly.

### Deferred to Implementation

- **Exact light-mode accent step:** `brand-600` (`#0284c7`) vs. `brand-700` (`#0369a1`) for body prose links on white — pick whichever passes AA against `--sl-color-bg` in the live Starlight light theme. Quick numbers to anchor the choice: `brand-600` on `#ffffff` ≈ 5.1:1 (passes AA normal text, fails AA large-text-bold-only tier conservatively), `brand-700` on `#ffffff` ≈ 7.0:1 (passes AAA). Default to `brand-700` unless visual weight reads too heavy alongside headings.
- **Whether Starlight's `--sl-color-bg` in dark mode is best set to exactly `#070a0f` or to a slightly lifted neighbor for readability on long docs pages.** www is a marketing site with short sections; docs is dense body copy. If `#070a0f` feels oppressive under a full concept-leaf page of prose, bump to `#080c12` and document the deviation. Decide in-browser during Unit 5.
- **Whether `template: splash` pages need an extra `border-t` rhythm between H2 sections to echo www's `SectionShell`.** May or may not help; decide during Unit 7 visual QA.

## High-Level Technical Design

> _This illustrates the intended token flow and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

```
apps/www/tailwind.config.mjs             (canonical brand ramp)
   │
   │  (values copied by hand, sync comment
   │   in docs/src/styles/custom.css)
   ▼
docs/src/styles/custom.css
   ├── :root                             (dark-mode defaults — Starlight's convention)
   │      --brand-50..--brand-900        (new, mirrors www — see www tailwind.config brand.*)
   │      --sl-color-accent-low/mid/high → brand shades for dark
   │      --sl-color-bg                  → #070a0f
   │      --sl-color-bg-nav              → same (or translucent override — see Unit 4)
   │      --sl-color-bg-sidebar          → same
   │      --sl-color-gray-1..7           → slate ramp (gray-1 lightest / gray-7 darkest
   │                                       in dark mode — Starlight's inverted direction)
   │      --sl-color-text                → slate-100
   │      --sl-color-text-accent         → brand sky
   │      --sl-font                      → www's exact system-ui stack
   │
   ├── :root[data-theme="light"]         (light-mode overrides — Starlight's convention)
   │      --sl-color-accent-low/mid/high → brand shades for light
   │      --sl-color-bg-sidebar          → leave on Starlight default (gray tile)
   │      (other light tokens: leave Starlight defaults unless QA shows a gap)
   │
   ├── header.header { ... }             (translucent + backdrop-blur + border-white/5)
   ├── footer / page-end rule zone
   ├── a[href] in prose                  (brand hover)
   ├── splash hero rhythm (consumed by docs/src/components/Hero.astro)
   └── mobile-screenshot utility         (unchanged)

docs/src/components/Hero.astro
   └── consumes --brand-* + --sl-color-* (replaces current
        color-mix(--sl-color-accent) glow color with brand glow)
```

## Implementation Units

- [ ] **Unit 1: Extract and mirror the brand token ramp into docs CSS**

**Goal:** Introduce CSS custom properties in `docs/src/styles/custom.css` that mirror the `brand` ramp from `apps/www/tailwind.config.mjs`, plus a sync comment. These variables become the single place in docs that carries brand color.

**Requirements:** R1, R5

**Dependencies:** None.

**Files:**

- Modify: `docs/src/styles/custom.css`

**Approach:**

- Add a `:root` block that declares `--brand-50` through `--brand-900` as literal hex values copied from `apps/www/tailwind.config.mjs`.
- Leave a `/* Keep in sync with apps/www/tailwind.config.mjs brand.* */` header comment in the same style as `docs/src/lib/brain-path.mjs`.
- Do not yet wire them into Starlight's `--sl-color-*` ramp — that is Unit 2. This unit just establishes the palette as an addressable token.
- Keep existing custom.css content (site-title shrink, splash content centering, mobile-screenshot utility) intact.

**Patterns to follow:**

- `docs/src/lib/brain-path.mjs` comment header ("Canonical copy lives at …") — mirror that tone.

**Test scenarios:**

- Happy path: build the docs site (`pnpm --filter @thinkwork/docs build`) and confirm no CSS errors. Open the dev server and inspect any element in devtools — `:root` should expose `--brand-400: #38bdf8`.
- Edge case: light/dark toggle keeps working (this unit does not touch mode-specific vars yet).

**Verification:**

- `--brand-*` custom properties are present on `:root` in both light and dark modes in the rendered page.
- No visible change yet to any page (these tokens are declared but not consumed).
- No build or Starlight hydration errors.

---

- [ ] **Unit 2: Wire brand tokens into Starlight's accent, background, and gray ramps**

**Goal:** Override Starlight's `--sl-color-accent-*`, `--sl-color-bg*`, and `--sl-color-gray-*` custom properties so that every built-in Starlight component (sidebar, TOC, link color in prose, code-block chrome, search modal, pagination) reads brand sky-blue on a www-matched near-black background.

**Requirements:** R1, R4, R5, R6

**Dependencies:** Unit 1.

**Files:**

- Modify: `docs/src/styles/custom.css`

**Approach:**

- **Follow Starlight's selector convention.** Starlight's `props.css` declares dark-mode defaults in bare `:root` and light-mode overrides in `:root[data-theme='light']`. This plan mirrors that: put dark values in `:root`, put light overrides in `:root[data-theme='light']`. The current `custom.css` partially follows this (dark-leaning gray ramp in `:root`) but uses `[data-theme='dark']` for accent overrides — that legacy block gets replaced in this unit.
- **In `:root` (dark defaults):** set `--sl-color-accent-low` to `var(--brand-900)`, `--sl-color-accent` to `var(--brand-400)`, `--sl-color-accent-high` to `var(--brand-300)`. Set `--sl-color-bg` to `#070a0f`, `--sl-color-bg-nav` to `#070a0f` (Unit 4 then layers backdrop-blur on top), `--sl-color-bg-sidebar` to `#070a0f` (or the marginally raised `#080c12` if a subtle edge between sidebar and main is desired — verify in-browser). Set `--sl-color-text` to `#e2e8f0` (slate-200), `--sl-color-text-accent` to `var(--brand-400)`. Also set `--sl-font` to www's exact Tailwind `font-sans` stack so text rendering matches between sites (see the Key Technical Decisions font-stack entry).
- **Gray ramp mapping (dark mode, inverted direction).** Starlight's dark-mode `--sl-color-gray-*` goes light-to-dark as the index increases — gray-1 is the lightest text color, gray-7 is the darkest surface. Map concretely:
  - `--sl-color-gray-1: #e2e8f0` (slate-200) — lightest, body heading color
  - `--sl-color-gray-2: #cbd5e1` (slate-300) — headings muted
  - `--sl-color-gray-3: #94a3b8` (slate-400) — body muted text
  - `--sl-color-gray-4: #64748b` (slate-500) — quiet muted
  - `--sl-color-gray-5: #334155` (slate-700) — rule/border lines
  - `--sl-color-gray-6: #1e293b` (slate-800) — elevated surface
  - `--sl-color-gray-7: #0f172a` (slate-900) — deepest Starlight surface (used by `--sl-color-bg-nav` default; include in the enumeration so the override is complete)
- **In `:root[data-theme='light']` (light overrides):** set `--sl-color-accent-low` to `var(--brand-100)`, `--sl-color-accent` to `var(--brand-600)`, `--sl-color-accent-high` to `var(--brand-700)` (default to `brand-700` per the Open Questions contrast math). Leave `--sl-color-bg`, `--sl-color-text`, and `--sl-color-bg-sidebar` on Starlight's defaults — light mode's sidebar is a separate gray tile by design (`--sl-color-bg-sidebar: var(--sl-color-gray-6)` in light), and lifting it to pure-bg reduces edge affordance.
- **Audit the existing `custom.css`.** Delete the legacy `--sl-color-accent: #e2e8f0;` and the now-unneeded `:root[data-theme='dark']` accent overrides once the values move into `:root`. Keep the `site-title`, `[data-has-hero]` splash-centering, and `.mobile-screenshot` rules — those are orthogonal.

**Patterns to follow:**

- Starlight theming docs pattern: override `:root` and `:root[data-theme="dark"]` separately. Do not try to be clever with `prefers-color-scheme`; Starlight already drives the mode via `data-theme`.

**Test scenarios:**

- Happy path: sidebar active item on the docs home shows brand blue, not neutral slate. Links in prose show brand blue. Code-block language label (top-right corner of fenced blocks) shows brand blue.
- Happy path: dark mode page background on `/` and on `/concepts/threads/` is near-black matching `thinkwork.ai` dark. Opening both sites in side-by-side browser windows, the backgrounds visually match.
- Happy path: light mode remains readable — body text is near-black on near-white, links are a deep brand blue that passes WCAG AA, sidebar active state is clearly highlighted.
- Edge case: Starlight's search modal still renders with readable contrast in both modes.
- Edge case: code blocks (which use Shiki's own color theme for code content, but Starlight chrome for the frame) still render without chrome-vs-code contrast collisions.
- Integration: toggling dark/light via the built-in Starlight theme switcher applies all accent changes in real time.

**Verification:**

- Side-by-side screenshots of `thinkwork.ai` (home) and `docs.thinkwork.ai` (home) in dark mode show matching background hue and matching accent hue to the naked eye.
- DevTools computed style on a `.sidebar-content a[aria-current="page"]` element returns an explicit brand-blue accent in dark mode.
- No Starlight built-in component (sidebar, TOC, search, pagination, admonition) appears visually broken or unreadable in either mode.
- WCAG AA contrast passes for body text and link text in both modes (spot-check one paragraph with a contrast tool).

---

- [ ] **Unit 3: Reskin the docs hero to use brand-blue glow, brain mark, and CTA palette**

**Goal:** Update `docs/src/components/Hero.astro` so the splash-page hero visually matches `apps/www/src/components/Hero.astro` — brand-blue radial glow, brain mark rendered in brand blue with the exact drop-shadow, `rounded-xl` primary CTA with brand-blue fill and off-black text, and an eyebrow-style rhythm consistent with www's `SectionHeader` when a tagline is present.

**Requirements:** R2, R3, R7

**Dependencies:** Unit 1 (tokens declared), Unit 2 (accent wired).

**Files:**

- Modify: `docs/src/components/Hero.astro`

**Approach:**

- Replace the current `color-mix(in srgb, var(--sl-color-accent) …)` glow color with `color-mix(in srgb, var(--brand-400) …)` at the same opacity/blur values used on www's hero (8%, 10%, 160px/140px blur).
- Set the `BrainMark` color to `var(--brand-400)` and apply the same drop-shadow: `filter: drop-shadow(0 0 48px color-mix(in srgb, var(--brand-400) 35%, transparent))`. Size values already match www (120/160).
- Update `.hero-btn.primary` to: `border-radius: 0.75rem` (matches www's `rounded-xl`), `background: var(--brand-400)`, `color: #020617` (Tailwind `slate-950`, matching www's `text-slate-950` verbatim — NOT `#0b1220`), `box-shadow: 0 10px 25px -10px color-mix(in srgb, var(--brand-400) 20%, transparent)`. Hover: `background: var(--brand-300)`.
- Update `.hero-btn.secondary` to: `border-radius: 0.75rem`, `border: 1px solid rgba(255,255,255,0.1)`, `background: rgba(255,255,255,0.03)`, `color: var(--sl-color-white)`. Hover: border-white/20, bg-white/6.
- Keep the heading typography clamp as-is (already matches www's responsive scale reasonably well); revisit only if side-by-side looks off.
- Keep the `.hero-mark svg` sizing rules untouched.

**Patterns to follow:**

- `apps/www/src/components/Hero.astro` — specifically the glow stack, brain-mark drop-shadow, and both button shapes.
- `apps/www/src/components/SectionHeader.astro` — the eyebrow pattern (uppercase + tracking + leading brand dot) if we decide to add an eyebrow above the docs hero headline. Only apply if `starlightRoute.entry.data.hero.tagline` treatment feels bare without one.

**Test scenarios:**

- Happy path: `/` renders a hero with the brain mark glowing brand blue, identical drop-shadow to www's hero brain mark.
- Happy path: the "Getting Started" action renders as a brand-blue filled pill with off-black text, visually equivalent to www's "Request a walkthrough" (or whatever the primary is).
- Happy path: the "View on GitHub" action renders with a subtle translucent border/fill, equivalent to www's secondary CTA.
- Edge case: hero still renders correctly on narrow viewports (<500px). Brain mark scales down to 120px; buttons stack.
- Edge case: hero still renders on a splash page that has no actions (hero without `actions`) — unlikely in current content but possible.
- Integration: light-mode rendering of the hero remains legible — the near-black primary button text on brand-blue still passes contrast, glow is subtler on a light background but not jarring.

**Verification:**

- Side-by-side screenshots of `thinkwork.ai` hero and `docs.thinkwork.ai` hero show matching brand-mark color, glow intensity, and button shape.
- The primary CTA border-radius visually matches a screenshot of www's primary CTA at the same zoom level.
- No regression in mobile rendering (hero stacks cleanly at 375px width).

---

- [ ] **Unit 4: Re-skin the Starlight header for translucency, backdrop-blur, and rule color**

**Goal:** Override Starlight's top header via CSS in `docs/src/styles/custom.css` to match www's `bg-[#070a0f]/80 backdrop-blur-xl border-b border-white/5`. Keep Starlight's built-in header functionality (logo, site title, search trigger, theme toggle, mobile sidebar toggle) intact — this is purely a chrome restyle.

**Requirements:** R1, R7

**Dependencies:** Unit 2 (bg vars set).

**Files:**

- Modify: `docs/src/styles/custom.css`

**Approach:**

- Identify Starlight's header selector in the rendered DOM (typically `header.header` or `.sl-header`) via devtools; target with a single `:global`-style rule in `custom.css`.
- Apply `background: color-mix(in srgb, var(--sl-color-bg) 80%, transparent); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); border-bottom: 1px solid rgba(255,255,255,0.05);` in dark mode.
- In light mode, apply the same pattern against `var(--sl-color-bg)` (a light near-white), with a thin black/5 border.
- Do not change header height, padding, or layout — Starlight's defaults are fine; only the fill/border change.
- **Do not re-solve header positioning.** Starlight's `PageFrame.astro` already sets `.header { position: fixed; ... }` by default — docs and www already share fixed positioning. The previous "fixed vs. sticky" question was based on a misread of Starlight's default and has been removed from Open Questions.
- **Selector specificity + CSS layers.** Starlight defines `.header` styles inside `@layer starlight.core`, and `custom.css` is loaded unlayered (unlayered rules outrank any layer). Prefer overriding `--sl-color-bg-nav` (which Starlight consumes for the header fill) over writing a raw `header.header { background: ... }` rule. For the backdrop-blur + rule-color bits that no token covers, use an unlayered `header.header { backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); border-bottom-color: rgba(255,255,255,0.05); }` rule; verify in devtools that the custom rule wins over the layered default.

**Patterns to follow:**

- `apps/www/src/components/Header.astro` — the `bg-[#070a0f]/80 backdrop-blur-xl border-b border-white/5` stack.

**Test scenarios:**

- Happy path: the docs header renders with a visibly translucent fill over scrolled content (scroll a long concept-leaf page past the H1 — the header should dim the content behind it, not hide it).
- Happy path: in light mode, the translucency reads as frosted white over light content, not a muddy gray.
- Edge case: sticky/scroll behavior — scrolling to the bottom of a long page and back does not leave the header stranded or flickering.
- Edge case: mobile viewport — Starlight's mobile sidebar toggle still functions.
- Integration: the search trigger (`⌘K`) still opens the search modal with the correct accent color from Unit 2.

**Verification:**

- Screenshot the top 80px of both `thinkwork.ai` and `docs.thinkwork.ai` scrolled a bit past the fold. Fills and rules visually match.
- All pre-existing header controls (logo link, theme toggle, search trigger, mobile sidebar toggle) still work.
- No new accessibility regressions — header tab order is preserved, skip-link still lands on main content.

---

- [ ] **Unit 5: Tune body-prose surfaces (background, link color, muted text, rule lines)**

**Goal:** Apply the remaining token-level polish so a long MDX body page (e.g., `/concepts/threads/lifecycle-and-types/`, `/applications/admin/threads/`) reads as the same product as a www section: near-black background, brand-blue inline links, slate-400 muted text, thin `white/5` rules between sections.

**Requirements:** R1, R4, R6

**Dependencies:** Units 1, 2.

**Files:**

- Modify: `docs/src/styles/custom.css`

**Approach:**

- Verify that Unit 2's accent wiring already made prose `a[href]` elements brand blue. If Starlight's built-in link styling needs a hover nudge (e.g., underline-on-hover or deeper shade), add it as a `.sl-markdown-content a[href]:hover` rule.
- Verify that `--sl-color-text-accent` and `--sl-color-text` render muted text (e.g., image captions, table header labels) consistent with slate-400 on www.
- Add a rule for horizontal `<hr>` inside `.sl-markdown-content` that uses `border-color: rgba(255,255,255,0.05)` in dark mode to echo www's `border-t border-white/5` section rule.
- If in-browser review shows the pure `#070a0f` background is oppressive under dense prose, lift to `#080c12` globally and record the deviation in `custom.css` with a comment. This is the deferred question from the Open Questions section.
- Preserve admonition (`:::note`, `:::tip`, etc.) styling — Starlight uses accent internally; these will already pick up brand blue from Unit 2.

**Patterns to follow:**

- www section `border-t border-white/5` — mirror for docs MDX `<hr>` + between-section rules on splash pages.

**Test scenarios:**

- Happy path: an inline link in a concept-leaf body (e.g., a cross-link to another page) renders brand blue, with a visible hover state.
- Happy path: a `:::note` admonition renders with brand-blue left border and tinted background in both modes.
- Happy path: a `<table>` in the admin docs (e.g., `/applications/admin/threads/`) shows muted header labels and readable body text, no contrast regression.
- Edge case: code samples inside prose (`<code>` spans and fenced blocks) retain Shiki syntax highlighting without the frame color fighting the brand accent.
- Integration: scrolling a dense page (e.g., `/getting-started/`) feels legible for 5+ minutes without eye fatigue — bg is dark but not oppressive.

**Verification:**

- Paragraph contrast measured against bg passes WCAG AA in both modes.
- Horizontal rules in MDX render visibly but subtly (not screaming white).
- Admonitions are color-consistent with the new accent.
- Side-by-side spot check: a text-heavy docs page and a text section from www look like they belong to the same product family.

---

- [ ] **Unit 6: Swap header logo from raster PNG to BrainMark SVG for color parity**

**Goal:** Replace the docs Starlight header logo (today a 512×412 raster `docs/src/assets/logo.png` whose color is baked into pixels) with an SVG source that renders in brand sky-blue on the new translucent header, matching www's `<BrainMark class="text-brand">` treatment.

**Requirements:** R2, R8

**Dependencies:** Unit 1 (brand tokens declared).

**Files:**

- Create: `docs/src/assets/logo.svg` (or `docs/src/components/SiteTitle.astro` if overriding the Starlight component is the chosen path — see Approach).
- Modify: `docs/astro.config.mjs` (either swap the `logo.src` path to `.svg`, or register a `SiteTitle` component override in the Starlight `components` map alongside the existing `Hero` override).
- Modify (possibly): `docs/src/styles/custom.css` (existing `a.site-title img` rule already constrains header logo size — may need to widen to `svg` as well).

**Approach:**

- **Favicon is already done.** `shasum apps/www/public/favicon.png docs/public/favicon.png` returns identical output (`623784652a79c65f2c24029187b199c96d222e52`, 13612 bytes). R8's favicon clause is satisfied by the existing state — no change required.
- **Logo needs a format change.** `docs/src/assets/logo.png` is `PNG image data, 512x412, 8-bit/color RGBA`. Raster pixels cannot be recolored with CSS; `currentColor` has no effect. Starlight's `SiteTitle.astro` renders it via `<img src>`, so there is no CSS-only path to brand-blue.
- **Two viable implementation paths — pick during implementation:**
  1. **SVG asset swap (simpler).** Author a new `docs/src/assets/logo.svg` that imports/renders the same `BRAIN_PATH_D` data used by `docs/src/components/BrainMark.astro`, with `fill="currentColor"` and `style="color: var(--brand-400)"`. Update `logo.src` in `docs/astro.config.mjs`. Starlight renders SVGs in `<img>` tags, which ignore `currentColor` on foreign-referenced SVGs — so this path requires embedding the color directly in the SVG file, accepting that the logo is a fixed brand blue and the `text-brand` CSS class cannot retint it on hover/focus.
  2. **SiteTitle component override (more control).** Register `SiteTitle: "./src/components/SiteTitle.astro"` in the Starlight `components` map (same mechanism as the existing `Hero` override). Inside the new component, render `<BrainMark class="site-mark" />` inline (so `currentColor` works) plus the site-title text. This matches www's header behavior exactly and keeps the option of tinting by CSS token.
- **Recommended:** path 2 (component override). It is ~15 lines, already uses a well-understood override mechanism, and preserves cross-site parity with how www renders its header mark.
- Delete (or ignore) `docs/src/assets/logo.png` once the swap lands — keep `favicon.png` (different asset, still used for browser tab icons).

**Patterns to follow:**

- `docs/astro.config.mjs` `components: { Hero: "./src/components/Hero.astro" }` — mirror the same registration shape for `SiteTitle`.
- `apps/www/src/components/Header.astro` — `<BrainMark class="text-brand" size={44} title="ThinkWork" />` is the exact reference.

**Test scenarios:**

- Happy path: the docs header renders the brain-mark in brand sky-blue in dark mode against the translucent near-black header, visually matching www's header brain-mark.
- Happy path: in light mode the header brain-mark renders in a deeper brand shade (via the light-mode `--brand-*` or a separate class rule) without becoming invisible on a light background.
- Edge case: at narrow viewport (375px), the brain-mark + wordmark lockup still fits the top bar without wrapping.
- Integration: no regression to Starlight's search trigger, theme toggle, or mobile sidebar toggle next to the logo.

**Verification:**

- Open `docs.thinkwork.ai` and `thinkwork.ai` in adjacent browser windows. The header mark in each is visibly the same brand sky-blue shape.
- No console errors about missing asset or SVG parsing.
- Favicons remain byte-identical (untouched by this unit).

---

- [ ] **Unit 7: Visual QA pass + remaining polish**

**Goal:** With Units 1–6 shipped, walk the top-traffic docs pages in both modes and compare to the equivalent www sections. Capture any remaining gaps and decide whether to close them here, defer them, or accept.

**Requirements:** R1, R2, R3, R4, R5, R7

**Dependencies:** Units 1–6.

**Files:**

- Modify (as needed): `docs/src/styles/custom.css` and `docs/src/components/Hero.astro` for any final nudges.

**Approach:**

- Walk these docs pages in both dark and light mode at 1440px and at 375px:
  1. `/` (splash hero + card grid)
  2. `/getting-started/`
  3. `/concepts/threads/` (hub)
  4. `/concepts/threads/lifecycle-and-types/` (concept leaf, dense prose)
  5. `/applications/admin/threads/` (dense page with route/file banner + tables)
  6. `/architecture` (diagrams + long body)
  7. Any page the reviewer or owner flags
- For each, open the matching-spirit www section in an adjacent window (home hero, pricing top-of-page, "Five controls" section, `SystemModel`) and compare:
  - Background hue
  - Accent hue + where it appears
  - Heading weight/tracking
  - Eyebrow rhythm
  - Button shape + shadow
  - Rule-line weight
- List deltas. Classify each as: (a) close this PR (2-line CSS nudge), (b) defer (tracked as follow-up), or (c) accept (inherent docs/marketing difference).
- Close category (a) deltas in-place. Log category (b) items in the plan itself for a follow-up.

**Test scenarios:**

- Happy path: a viewer presented with screenshots of www's home hero and docs' home hero cannot tell they are two apps without reading the URL.
- Edge case: light mode on a dense concept-leaf page remains comfortable for extended reading.
- Edge case: a code-heavy page (e.g., `/api/graphql/`) still renders syntax highlighting without fighting the new chrome.
- Integration: the theme toggle, search modal, sidebar, and TOC all still function and look right.

**Verification:**

- A written delta list exists at the end of the QA session, with each item classified (close / defer / accept).
- All category (a) items are closed in this unit.
- A brief paragraph added to the plan's closing notes records what was deferred vs. accepted.

## System-Wide Impact

- **Interaction graph:** the change is CSS-scoped to the docs app. No admin SPA, mobile app, or API code is touched. Starlight's internal components inherit token changes; no Starlight component is replaced.
- **Error propagation:** n/a — styling only.
- **State lifecycle risks:** n/a — no persistent state is introduced or changed.
- **API surface parity:** the www marketing site's Tailwind `brand` ramp is the canonical visual contract; this plan conforms docs to it. If that ramp later changes, docs's `custom.css` must be updated in the same PR (called out via sync comment).
- **Integration coverage:** the only cross-layer integration is "reader's eye" coherence. Covered by the Unit 7 side-by-side QA.
- **Unchanged invariants:** Starlight's built-in functionality — sidebar, TOC, search, code blocks, admonitions, mobile drawer, theme toggle — is deliberately untouched at the component level. A future Starlight upgrade should not require re-porting this work; CSS custom property overrides are the public contract Starlight exposes.

## Risks & Dependencies

| Risk                                                                             | Mitigation                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Starlight upgrade changes the CSS custom property names we override.             | We only override the documented public vars (`--sl-color-accent-*`, `--sl-color-bg*`, `--sl-color-gray-*`). A breaking rename would be flagged in Starlight's changelog; handle on the next upgrade PR. |
| Light-mode accent contrast regresses against Starlight's default white-ish bg.   | Unit 2 verifies AA contrast; Unit 7 re-verifies across real pages. If the `brand-600`/`brand-700` choice fails, step down further on the ramp.                                                          |
| Dark-mode body prose on `#070a0f` feels oppressive under dense reference pages.  | Deferred question in Unit 5 explicitly allows lifting to `#080c12` if reading fatigue shows up during QA.                                                                                               |
| Translucent fixed header covers content above the fold on narrow viewports.      | Unit 4 tests mobile layout; fall back to sticky (non-fixed) with translucency if fixed causes overlap.                                                                                                  |
| Brand ramp drifts between www's Tailwind config and docs's custom.css over time. | Sync comment in `custom.css` points at `apps/www/tailwind.config.mjs`. Deferred: extract a shared package when a third surface joins.                                                                   |
| Visual coherence review is subjective and hard to accept.                        | Unit 7 requires a side-by-side screenshot pass with explicit delta classification; gives reviewers a concrete artifact to react to rather than "does this feel right?"                                  |

## Documentation / Operational Notes

- No deploy, infra, or runtime change. Ship via a normal docs PR; merge pipeline publishes `docs.thinkwork.ai` as usual.
- No rollback plan needed beyond `git revert` of the PR.
- Recommend including before/after screenshots of home, a hub, and a concept leaf (dark + light) in the PR description — same deal as the demo-reel practice used for UI PRs.
- Optional: if the Unit 7 delta list surfaces non-trivial deferred items, file them as separate issues with "visual parity follow-up" tags rather than letting them linger in this plan.

## Sources & References

- Related code (source of truth):
  - `apps/www/tailwind.config.mjs` — brand ramp
  - `apps/www/src/layouts/Base.astro` — body shell
  - `apps/www/src/components/Header.astro` — translucent header pattern
  - `apps/www/src/components/Footer.astro` — darker rule zone
  - `apps/www/src/components/Hero.astro` — hero glow + brain-mark drop-shadow + CTA shapes
  - `apps/www/src/components/SectionHeader.astro` — eyebrow rhythm
  - `apps/www/src/components/SectionShell.astro` — section rule + optional glow variants
- Related code (target):
  - `docs/src/styles/custom.css`
  - `docs/src/components/Hero.astro`
  - `docs/src/components/BrainMark.astro`
  - `docs/src/lib/brain-path.mjs` — the precedent for cross-app duplication with a sync comment
  - `docs/astro.config.mjs` — where the Hero override is registered
- Related prior plans (editorial axis, orthogonal to this plan):
  - `docs/plans/2026-04-21-008-docs-full-rewrite-thinkwork-docs-site-plan.md`
  - `docs/plans/2026-04-21-009-docs-www-journey-messaging-rewrite-plan.md`
  - `docs/plans/2026-04-22-002-docs-www-homepage-copy-polish-plan.md`
  - `docs/STYLE.md`, `docs/STYLE-AUDIT.md` — editorial style; respected, not touched by this plan
