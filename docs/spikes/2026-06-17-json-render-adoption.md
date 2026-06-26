---
title: "json-render adoption spike for Thread GenUI"
date: 2026-06-20
status: superseded
issue: THNK-34
plan: docs/plans/2026-06-17-001-feat-thread-genui-json-render-plan.md
unit: U1
superseded_by: docs/plans/2026-06-26-001-refactor-json-render-shadcn-cutover-plan.md
---

# json-render Adoption Spike

> Superseded by THNK-77. The current direction is production adoption of
> `@json-render/core`, `@json-render/react`, and `@json-render/shadcn`, with new
> Thread generated UI carried as `data-json-render`. The old recommendation to
> keep json-render dev-only, exclude `@json-render/shadcn`, and preserve
> `data-genui` as the host-owned envelope no longer applies.

## Verdict

Keep `@json-render/core` + `@json-render/react` as a dev-only candidate
substrate for the web Thread GenUI rendering path, with ThinkWork-owned
catalogs, validators, actions, and render components. Do not adopt
`@json-render/shadcn` for v1.

The U2 `data-genui` envelope should remain renderer-independent and host-owned.
The web adapter may use json-render to render validated specs after U2 defines
the envelope and U3 resolves the production peer gate or chooses a host-owned
renderer fallback. Dashboard analytics and Thread inline charts continue to
share the `@thinkwork/analytics-display` contract introduced by THNK-57.

The production adoption gate is not fully passed in U1: `@json-render/react`
publishes a `react@^19.2.3` peer, while the current web lock resolves React
19.1.0. U1 proves the static renderer path under the current lockfile but keeps
the packages in `devDependencies` only. U3 must either resolve the peer gate or
use the host-owned fallback before landing user-facing production rendering.

## Dependency Decision

- Added `@json-render/core@0.19.0` and `@json-render/react@0.19.0` to
  `apps/web` devDependencies for the spike verifier only.
- Kept the existing web React ranges and lockfile resolution unchanged for U1.
  A local React 19.2 alignment attempt caused workspace-wide peer graph churn,
  so React alignment is intentionally deferred out of this characterization
  slice.
- Recorded the `@json-render/react` peer mismatch as a failed production
  adoption gate for U1 rather than adding a root package override or widening
  the package's peer contract locally.
- Excluded `@json-render/shadcn@0.19.0`. It brings a broader UI catalog and
  dependencies (`radix-ui`, `vaul`, `embla-carousel-react`, `lucide-react`,
  `tailwind-merge`, `class-variance-authority`, `clsx`) that duplicate
  ThinkWork's existing design-system surface without helping the controlled v1
  Thread catalog.

## Package Review

- `@json-render/core@0.19.0`: Apache-2.0, Vercel Labs repository, depends on
  `zod@^4.3.6`, unpacked package size about 915 KB.
- `@json-render/react@0.19.0`: Apache-2.0, Vercel Labs repository, depends on
  `@json-render/core@0.19.0`, unpacked package size about 494 KB.
- Installed package footprints were about 940 KB for core and 520 KB for the
  React adapter.
- `pnpm audit --prod --audit-level high` still reports existing workspace
  advisories, but the JSON audit output did not reference `@json-render`.

## Runtime And Security Notes

- The smoke test proves ThinkWork can define an allowlisted component catalog,
  validate a spec before render, reject unknown component types, reject invalid
  props, and render an explicit fallback for renderer-level unknown types.
- json-render validation must remain the security boundary. Runtime code should
  render only specs that pass the U2 catalog validator; renderer fallbacks are
  UX affordances, not authorization.
- The React package includes optional streaming hooks that call `fetch`. Thread
  GenUI v1 should use the static `JSONUIProvider` + `Renderer` path, not
  json-render's streaming/chat hooks.
- `pnpm --filter @thinkwork/web verify:json-render-smoke` imports only the
  static `JSONUIProvider` + `Renderer` path, builds the baseline and renderer
  bundles, fails if the size delta exceeds the committed thresholds, greps the
  emitted renderer bundle for forbidden runtime patterns, and executes the
  renderer bundle under jsdom to assert the expected DOM content.
- The emitted renderer bundle contained no `fetch(`, `eval(`, `new Function`,
  `XMLHttpRequest`, dynamic `import(`, `useUIStream`, or `useChatUI` usage.
- React DOM's normal `dangerouslySetInnerHTML` prop handling remains present in
  React's own internals; U1 did not find json-render-specific HTML injection in
  the static renderer smoke path.

## Verification

- `pnpm install` completed for all workspace projects. On local Node 25,
  `canvas@2.11.2` attempted a native fallback build and logged a missing
  `pkg-config` / `pixman-1` warning, but the install command exited
  successfully.
- `pnpm --filter @thinkwork/web test -- src/components/workbench/genui/json-render-smoke.test.tsx`
  passed: 4 tests.
- `JSON_RENDER_SMOKE_ENTRY=baseline pnpm --filter @thinkwork/web build:json-render-smoke`
  passed. Baseline output: 186.85 KB raw, 58.64 KB gzip.
- `JSON_RENDER_SMOKE_ENTRY=renderer pnpm --filter @thinkwork/web build:json-render-smoke`
  passed. Renderer output: 311.44 KB raw, 94.69 KB gzip.
- Bundle delta: about +124.59 KB raw and +36.05 KB gzip for the minimal static
  json-render renderer path.
- `pnpm --filter @thinkwork/web verify:json-render-smoke` passed and enforced
  the bundle scan, size thresholds, and jsdom runtime render assertion.
- `pnpm --filter @thinkwork/web typecheck` passed.
- `pnpm --filter @thinkwork/web build` passed. The build emitted existing route
  and sourcemap warnings plus existing large chunk warnings.

## Follow-On Constraints For U2

- Define the `data-genui` envelope and component catalog in ThinkWork terms
  before binding it to json-render.
- Keep U2 renderer-independent so the envelope can survive a U3 decision to
  change or wrap the renderer.
- Do not add runtime `@json-render/*` production imports until U3 resolves the
  React peer gate or records the host-owned fallback decision.
- Catalog entries should be compact Thread primitives and analytical payload
  references, not a general-purpose UI/component marketplace.
- Actions must route through existing Thread state and must not expose arbitrary
  callbacks.
- Unknown, invalid, oversized, sensitive, or unsupported payloads must degrade
  to compact textual summaries.
