---
title: Mobile sub-screens use DetailLayout for the header — not a custom SafeAreaView + <H2>
date: 2026-04-23
category: best-practices
module: apps/mobile
problem_type: best_practice
component: frontend_stimulus
severity: low
applies_when:
  - Adding a new sub-screen under apps/mobile/app/ that needs a back button and title header
  - Reviewing a mobile PR whose screen builds its own SafeAreaView + header row
  - A screen header looks visually heavier or differently styled than sibling settings/detail screens
  - Refactoring a screen that imports ArrowLeft or the typography <H1>/<H2>/<H3> for a navigation bar
tags:
  - mobile
  - expo
  - react-native
  - detail-layout
  - navigation
  - nativewind
  - ui-consistency
---

# Mobile sub-screens use DetailLayout for the header — not a custom SafeAreaView + <H2>

## Context

New mobile sub-screens often reach for a custom `<SafeAreaView>` + inline `<View>` header + `<H2>Title</H2>` because the typography components look like a natural fit for a page title. They are not — the `H1`/`H2`/`H3` primitives in `apps/mobile/components/ui/typography.tsx` are calibrated for body/prose. Dropped into a navigation row they render visibly heavier than every other screen in the settings stack.

`DetailLayout` at `apps/mobile/components/layout/detail-layout.tsx` already encapsulates the canonical header (h-14 row, `text-lg font-semibold` title, `ChevronLeft size={24}` back button, long-press → `dismissAll()`, SafeAreaView edges, wide-screen `Sidebar` responsiveness). It became the canonical wrapper during the `apps/mobile` migration (commit `e9b8200`, 2026-04-10) but the decision was implicit — it just landed as "the component all sub-screens use" with no architectural memo. (session history)

This guidance was triggered by a user-flagged drift on `apps/mobile/app/settings/billing.tsx` during the Stripe mobile integration: *"the Billing header font style does not match the other header styles."* Billing was the only settings screen in the tree not using `DetailLayout` — every peer (`account.tsx`, `team.tsx`, `agent-config.tsx`, `profile.tsx`, `credentials.tsx`, `usage.tsx`, `integration-detail.tsx`, `mcp-server-detail.tsx`, `basic-credential.tsx`, `advanced-mode.tsx`, `code-factory-repos.tsx`) already delegates.

## Guidance

For any mobile sub-screen that shows a back button + title bar, wrap the screen body in `DetailLayout` from `@/components/layout/detail-layout` instead of building a custom header. Do not use typography components (`H1`/`H2`/`H3`) as header titles.

Before (drift pattern — custom SafeAreaView + inline header + `<H2>`):

```tsx
return (
  <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950">
    <View className="flex-row items-center gap-3 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
      <Button variant="ghost" size="icon-sm" onPress={() => router.back()} accessibilityLabel="Back">
        <ArrowLeft size={20} color={colors.foreground} />
      </Button>
      <H2>Billing</H2>
    </View>
    <ScrollView className="flex-1" ... >
      { /* screen content */ }
    </ScrollView>
  </SafeAreaView>
);
```

After (canonical pattern — `DetailLayout`):

```tsx
import { DetailLayout } from "@/components/layout/detail-layout";
// drop now-unused imports: SafeAreaView, ArrowLeft, H2, useRouter (if only used for .back())

return (
  <DetailLayout title="Billing">
    <ScrollView className="flex-1" ... >
      { /* screen content */ }
    </ScrollView>
  </DetailLayout>
);
```

`DetailLayout`'s prop surface:
- `title: string | ReactNode` — strings render as `Text className="text-lg font-semibold" numberOfLines={1}`. Prefer a plain string — a JSX `title` with custom inline styles re-opens the divergence `DetailLayout` was supposed to close.
- `headerRight?: ReactNode` — slot for action buttons or menu triggers.
- `showSidebar?: boolean` (default `true`) — renders the wide-screen `Sidebar` alongside when `useMediaQuery().isWide`.
- `onTitlePress?: (anchor) => void` — makes the title tappable, for picker sheets or segmented screens.

Internally, `DetailLayout` renders a `SafeAreaView edges={["top","bottom"]}`, an `h-14 flex-row items-center px-4 border-b border-neutral-200 dark:border-neutral-800` header, and a `ChevronLeft size={24}` back button whose long-press calls `dismissAll()` — popping the entire detail stack in one gesture. Don't reimplement any of this.

## Why This Matters

- **User-visible consistency.** The settings stack is dense and users notice even small header divergences — this is how both known instances of the drift (billing, 2026-04-23; wiki detail title duplication, PR #240, 2026-04-19) got flagged. Every screen using `DetailLayout` shares pixel-identical chrome.
- **Less boilerplate per screen.** The billing migration removed ~15 lines (SafeAreaView wiring, back-button wiring, H2 import, `useRouter` usage that existed only for `router.back()`).
- **Wide-screen responsiveness for free.** `DetailLayout` mounts the `Sidebar` on wide layouts via `useMediaQuery().isWide`. Custom headers silently regress the iPad / landscape experience.
- **Gesture affordances built in.** Long-pressing the back chevron calls `dismissAll()` — a keyboard-and-thumb-friendly escape from a deep detail stack. Custom headers don't get this.
- **Single place to evolve the header.** Future changes (new theme tokens, a contextual search field, a11y tweaks) land in one component instead of being swept across every screen.

## When to Apply

- Any new `apps/mobile/app/**/*.tsx` screen that renders with a back button + title bar — settings sub-screens, agent detail tabs, workspace pages, connector flows, billing, profile, etc.
- Any migration of an existing screen flagged for "header style doesn't match" drift.
- Any screen that needs the wide-screen sidebar alongside its content.

Exceptions:
- Full-bleed screens that intentionally hide the chrome (chat threads, the wiki graph viewer, splash / onboarding) — these manage their own `SafeAreaView` and should not wrap in `DetailLayout`.
- Tab-root screens that are not a detail push (though `app/(tabs)/settings/index.tsx` does use `DetailLayout` with `showSidebar={isWide}` — check siblings before deciding).

## Examples

Canonical usages already in the tree — reference these when sizing a new screen:
- `apps/mobile/app/settings/account.tsx` — `<DetailLayout title="Manage Account" headerRight={accountMenu}>`
- `apps/mobile/app/(tabs)/settings/index.tsx` — `<DetailLayout title="User Settings" showSidebar={isWide}>`
- `apps/mobile/app/agents/[id]/personalize.tsx` — detail screen with `headerRight` actions
- `apps/mobile/app/settings/billing.tsx` — the screen migrated in PR #468 (before/after shown above)

Component source: `apps/mobile/components/layout/detail-layout.tsx`.

### Migration checklist (from the billing fix)

1. `import { DetailLayout } from "@/components/layout/detail-layout";`.
2. Replace the outer `<SafeAreaView>` + header `<View>` with `<DetailLayout title="...">`.
3. Remove now-unused imports: `SafeAreaView`, `ArrowLeft`, `H2`, `useRouter` (if only used for `router.back()`), and `colors` if only used by the back button.
4. Grep the file for remaining `<H1>`/`<H2>`/`<H3>` usage (modals, empty states). If any survive, either keep the import narrowly or swap them for `<Text className="text-lg font-semibold">` to match the new header weight. **This is a runtime footgun** — during the billing migration, the plan-picker `Modal` still contained `<H2>Choose a plan</H2>`, which crashed the screen at runtime after the `H2` import was dropped. Caught in the sim within minutes, but easy to miss in PR review because tsc won't catch it (the JSX element is treated as valid until resolution).
5. If the screen needs header actions or a tappable title, pass `headerRight` / `onTitlePress` — don't reintroduce a custom header.

### Related prior drift

PR #240 (session `2708993f`, 2026-04-19) fixed a different shape of the same problem on `apps/mobile/app/wiki/[type]/[slug].tsx`: the page used `DetailLayout` correctly but passed a JSX `title` with bespoke inline font styles AND duplicated the title in the page body at 26px/700. The fix there was: string title → default `text-lg font-semibold` applies, body duplicate deleted. Rule of thumb from that session: *DetailLayout header carries the only title; don't restyle it and don't mirror it in the body.* (session history)

## Related

- `apps/mobile/components/layout/detail-layout.tsx` — component source and prop contract
- `apps/mobile/components/ui/typography.tsx` — `H1`/`H2`/`H3` are for prose, not navigation
- `docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md` — related "prefer the canonical shared module over re-implementing" rule (applies to TS helpers; this doc is the layout-component variant)
- PR #468 — billing screen migration (commit `3acb8c7` on branch `fix/mobile-billing-header`)
- PR #240 — wiki detail header/body title consolidation
