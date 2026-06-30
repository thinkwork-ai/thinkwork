---
issue: THINK-97
title: Remove legacy Brain/Cognee-facing memory surfaces
status: in_progress
updated: 2026-06-29
---

# THINK-97 Autopilot Status

## Scope

- Keep THINK-103 memory stability fixes intact.
- Remove active/expected Cognee and legacy Knowledge Graph language from user
  and operator memory surfaces.
- Redirect legacy routes to current Memory and Context Diagnostics surfaces.
- Keep backend/runtime memory code unchanged unless verification exposes a
  blocker.

## Progress

- 2026-06-29: Moved Linear issue to In Progress and started implementation on
  `codex/think-97-memory-surface-language`.
- 2026-06-29: Preserved THINK-103 as the regression gate. Because this work is
  scoped to web UI copy/routes/tests, rerun the THINK-103 backend memory gate
  only if backend/runtime memory files are modified.
- 2026-06-29: Implemented web UI route/copy updates:
  - `/memory/memories` is the primary Memories route; `/memory/brain` redirects.
  - `/settings/memory/ontology` is the primary Ontology route;
    `/settings/memory/knowledge-graph` and `/settings/knowledge-graph`
    redirect.
  - `/settings/context-diagnostics` is the primary operator diagnostics route;
    `/settings/brain-operations` redirects.
  - Memory settings no longer renders deployment-engine switching copy.
  - Knowledge Base surfaces no longer label sources as Brain Sources.
  - Plugin/managed-app surfaces no longer present Cognee or Memory Graph as the
    active product surface.
- 2026-06-29: Fixed Memory header refresh affordance during local verification:
  hover now uses primary color, click enters a short active primary state, and
  the icon spins while refresh is pending.

## Verification

- Passed: focused web unit tests for Memory settings, settings navigation,
  Context Diagnostics, Plugin detail, managed applications, and memory shell
  routes.
- Passed: `corepack pnpm --filter @thinkwork/web build`.
- Passed: `corepack pnpm --filter @thinkwork/web typecheck`.
- Passed after refresh-control fix:
  `corepack pnpm --filter @thinkwork/web exec vitest run src/components/settings/SettingsMemoryHome.test.tsx`.
- Not run: THINK-103 backend memory gate, because no backend/runtime memory
  files were modified.
- Pending: user verification in local dev server on `localhost:5174`.
