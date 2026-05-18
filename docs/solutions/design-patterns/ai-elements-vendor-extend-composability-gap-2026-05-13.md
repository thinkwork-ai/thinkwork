---
title: "Vendor and extend AI Elements primitives locally when their slot model can't host folder or row actions"
date: 2026-05-13
category: design-patterns
module: apps/admin/agent-builder/file-tree
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - Adopting an AI Elements primitive whose children render in a structural wrapper (CollapsibleContent, ScrollArea, Portal)
  - Needing trailing actions, badges, or status indicators on a header row that has no actions slot
  - Building shadcn-vocabulary UI on top of upstream components that don't expose the slots shadcn would
tags:
  - ai-elements
  - vendor-fork
  - composability
  - trailing-slot
  - file-tree
  - cleanup-arc-2026-05-13
---

# Vendor and extend AI Elements primitives locally when their slot model can't host folder or row actions

## Context

Vercel AI Elements (`apps/admin/src/components/ai-elements/*`, `apps/computer/src/components/ai-elements/*`) follows the shadcn distribution model: source files are dropped into your repo, not consumed as a versioned npm dependency. That means when a component's slot structure doesn't fit your use case — no header-row actions slot, children rendered in the wrong place, etc. — there is no "upgrade and wait for a fix" path. The shadcn philosophy is explicit: **you own the source, you extend it locally**.

We hit this in PR #1193 with `FileTreeFolder`, which has no actions slot on the folder header row. Children render inside `<CollapsibleContent>` (i.e., nested files), with no prop or `children` position for trailing content on the header itself.

The same general pattern showed up across the prior `codex/computer-ai-elements-adoption` session (2026-05-10/11): `reasoning.tsx` had upstream TypeScript errors that required two local Edit patches; the `cn` import path in vendored components had to be remapped to point at the `@thinkwork/ui` barrel; `PromptInput`'s async submit chain didn't compose cleanly with existing call sites and required test updates to `waitFor` the resolution. Composability gaps in AI Elements are recurring, not one-off — the pattern itself is what's worth codifying. (session history)

## Guidance

When an AI Elements / shadcn primitive is *almost* the right shape:

1. **Vendor it** — the source is already in your repo. Treat the local file as the source of truth.
2. **Extend the prop type** — widen `string` props to `ReactNode` when you need inline annotations; add new optional slot props (`trailing`, `leading`, `actions`, etc.) typed as `ReactNode`.
3. **Document the extension inline** — leave a comment block explaining "local extension" so future readers know which props are upstream and which are ours.
4. **Render the new slot conditionally** — `{trailing ? trailing : null}` keeps the upstream behavior untouched when the new prop isn't passed.

Do **not** wrap the upstream component with an absolute-positioned overlay to inject content. That is a composability-gap signal — fix the gap in the source instead.

## Why This Matters

Wrapping with `<div className="absolute ...">` overlays is a code smell:

- It fights the upstream layout rather than fixing it.
- It breaks on responsive breakpoints, scrollbars, and any z-index change upstream.
- It hides the extension point from future readers — the next person searching for "trailing slot" won't find anything.

Vendor + extend keeps the extension discoverable (it's a typed prop on the component), survives upstream API changes (the local file already diverged), and matches the explicit shadcn contract. Filing an upstream PR is optional, not required — the local copy is the authoritative version for your repo.

## When to Apply

- Any AI Elements primitive that's *almost* the right shape
- Same logic for shadcn primitives and any other source-in-repo component library (Tremor source, Aceternity, etc.)
- **Pattern signal:** if you find yourself wanting to wrap a vendored component with an absolute-positioned overlay to put content "where the children prop doesn't render," that's a composability gap → vendor + extend instead
- **Pattern signal:** if you find yourself wrapping an AI Elements component just to handle a TypeScript error or a missing utility import shim, fix it inline rather than wrap

## Examples

**This session — `FileTreeFolder` trailing slot (PR #1193):**

Upstream `FileTreeFolder` renders children inside `<CollapsibleContent><div className="ml-4 border-l pl-2">{children}</div></CollapsibleContent>` — i.e., nested files, no header-row injection point.

The local extension in `apps/admin/src/components/ai-elements/file-tree.tsx`:

```tsx
export type FileTreeFolderProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  /**
   * Local extension: widened from `string` to `ReactNode` so folder rows can
   * include inline annotations (e.g. an amber "no files" badge for routed
   * sub-agent folders that have no files yet).
   */
  name: ReactNode;
  /**
   * Local extension: optional content rendered inline at the right edge of
   * the folder header row. Use this to host trailing row actions (delete
   * affordance, inheritance indicators, etc.) without collapsing them into
   * the nested-children area.
   */
  trailing?: ReactNode;
};
```

The matching render-path change:

```tsx
<button
  className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 ..."
  onClick={handleSelect}
  type="button"
>
  <FileTreeIcon>...</FileTreeIcon>
  <FileTreeName>{name}</FileTreeName>
</button>
{trailing ? trailing : null}  // the new slot
```

Callers now pass row actions and badges via `trailing={...}` instead of fighting the layout with overlays.

**Prior session corroboration — `reasoning.tsx` and `cn` shim (session history):**

The `codex/computer-ai-elements-adoption` session vendored AI Elements components, then had to:

- Add a `cn` shim at `packages/ui/src/index.ts` because vendored components imported `@/lib/utils` rather than the workspace `@thinkwork/ui` barrel.
- Apply two TypeScript fixes to `reasoning.tsx` so the component tree typechecked under this repo's stricter config.
- Update `PromptInput` test seams to `waitFor` the async submit chain because the upstream component's submit path didn't compose with existing synchronous call-site assumptions.

Each fix lived in the local copy, not as a wrapper. None was sent upstream — the local copy is authoritative.

## Related

- (auto memory [claude]) [[project_computer_ai_elements_adoption]] — Computer LLM-UI commits to Vercel AI SDK + AI Elements
- (auto memory [claude]) [[project_computer_shadcn_vocabulary_decision]] — shadcn-only allowlist, vendored source
- (foundation decision this operationalizes) [docs/solutions/architecture-patterns/ai-elements-iframe-canvas-foundation-decision-2026-05-10.md](../architecture-patterns/ai-elements-iframe-canvas-foundation-decision-2026-05-10.md)
- (vocabulary-not-framework framing) [docs/solutions/architecture-patterns/copilotkit-agui-computer-spike-verdict-2026-05-10.md](../architecture-patterns/copilotkit-agui-computer-spike-verdict-2026-05-10.md)
- (vendor-vs-extract decision rubric) [docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md](../best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md)
- PR #1193 — FileTreeFolder trailing slot extension (this session)
- `codex/computer-ai-elements-adoption` — recurring composability-gap fixes (session history)
