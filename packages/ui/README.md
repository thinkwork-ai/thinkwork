# @thinkwork/ui

Shared visual primitives, theme tokens, and design utilities for ThinkWork's web apps. Owns the look and feel; does not own routing, GraphQL, auth, or app-specific composition — those stay in each consumer (`apps/admin`, future `apps/computer`).

This is the seed of a larger extraction. Phase 1 of the package ships the `cn` class-name helper, the `ThemeProvider` / `useTheme` dark-mode hook, and a `theme.css` consumers can `@import "@thinkwork/ui/theme.css"`. shadcn primitives and the sidebar shell move in a follow-up PR (parent plan U2); admin migrates to consume the package after that (parent U4).

## Usage

```ts
import { ThemeProvider, useTheme, cn } from "@thinkwork/ui";
```

```css
/* in your app's entry CSS */
@import "@thinkwork/ui/theme.css";
```

## Scope

- ✅ Visual primitives, design tokens, theme infrastructure
- ✅ Stateless utility helpers shared by visual components (e.g. `cn`)
- ❌ Routing, data fetching, auth, GraphQL clients
- ❌ App-specific composite components (sidebars wired to admin queries, dialogs that know about agents)
- ❌ Domain logic, business rules

## Origin

See [docs/plans/2026-05-08-001-feat-computer-thinkwork-ai-end-user-app-plan.md](../../docs/plans/2026-05-08-001-feat-computer-thinkwork-ai-end-user-app-plan.md) for the parent plan and [docs/plans/2026-05-08-009-feat-thinkwork-ui-package-skeleton-plan.md](../../docs/plans/2026-05-08-009-feat-thinkwork-ui-package-skeleton-plan.md) for this slice.
