---
title: "feat: Real Symphony Admin extension"
type: feat
status: active
date: 2026-05-14
origin: direct LFG request on 2026-05-14
---

# Feat: Real Symphony Admin Extension

## Overview

Replace the current configured external-extension launcher with a real Symphony page inside ThinkWork Admin. The page must render a ThinkWork-native Symphony operator surface from `admin.thinkwork.ai/extensions/symphony`, use Admin styling/components, and call the deployed Symphony GraphQL API directly with the signed-in ThinkWork Cognito ID token. It must not iframe the standalone Symphony app and must not show a "go elsewhere" placeholder.

## Problem Frame

The first deployed attempt made Symphony visible in Admin navigation but embedded the standalone `https://symphony.thinkwork.ai/queue` app in an iframe. Google OAuth refused to render inside the frame. The emergency fix then turned the extension into a launcher card. That avoided the OAuth error, but it failed the product goal: operators need to see and use Symphony from within ThinkWork Admin as a cohesive extension surface.

The right day-one shape is not microfrontend iframe embedding. It is an Admin-native extension component that talks to Symphony's deployed API. Symphony continues to own its runtime and deployment, while ThinkWork Admin owns the host UX.

## Requirements Trace

- R1: `admin.thinkwork.ai/extensions/symphony` renders a real Symphony operator UI, not a launcher or iframe.
- R2: Symphony remains a private extension; ThinkWork OSS keeps only the generic extension host and env-configured registration.
- R3: The Symphony UI uses ThinkWork Admin design conventions: page title/tabs on the title row, compact search/filter/action row, bordered tables/cards using `bg-card`, `border-border`, `text-muted-foreground`, and shadcn-style buttons/badges.
- R4: The Admin extension calls Symphony's deployed GraphQL API with the current Admin Cognito ID token. Symphony's API remains the authorization authority through its existing `symphony-operators` group check.
- R5: The UI should degrade clearly for missing config, auth failures, forbidden users, empty queues, and transient network errors.
- R6: The extension should support at least the operational queue and dispatch pause/resume controls in the first real slice.
- R7: Future Workflows, Spend, HITL, and run-detail tabs should have an obvious code path without requiring another iframe pivot.

## Scope

### In Scope

- Replace `apps/admin/src/extensions/configured-external-extension.tsx` with a real external GraphQL extension host for Symphony.
- Add env support for `VITE_ADMIN_EXTENSION_SAMPLE_GRAPHQL_URL`; keep the existing URL as an optional "Open standalone" link.
- Add an Admin-side Symphony client boundary that uses the current Cognito ID token from Admin auth.
- Implement native tabs, queue table, totals, search, dispatch state, pause/resume controls, and empty/error/loading states.
- Add focused tests for config parsing, rendering real Symphony content, non-iframe behavior, auth error display, and mutation behavior.
- Update deploy env plumbing and GitHub repo variables so production Admin points at the live Symphony GraphQL function URL.

### Out of Scope

- Moving Symphony runtime or API into the ThinkWork monorepo.
- Building full same-origin proxy auth.
- Rebuilding Symphony's standalone operator app.
- New Symphony backend APIs beyond the currently deployed GraphQL operations.
- Run detail, workflow editor, spend charts, HITL approvals, and GitHub App setup flows beyond placeholders/tabs that do not pretend to be finished.

## Context And Research

### ThinkWork Admin Patterns

- `apps/admin/src/components/Sidebar.tsx` now supports extension nav groups, including `main`, which places Symphony below Inbox.
- `apps/admin/src/extensions/registry.ts` provides build-time registration with stable `id`, `label`, `navGroup`, `proxyBasePath`, `icon`, and `ownsPageLayout`.
- `apps/admin/src/extensions/ExtensionRoute.tsx` mounts an extension component and lets it own its page layout.
- `apps/admin/src/routes/_authed/_tenant.tsx` applies `p-4` to extension-owned layouts.
- Admin styling should follow existing pages such as Templates and Skills and Tools: compact `h-8` controls, shadcn `Button`, `Badge`, table borders, `bg-card`, `border-border`, and `text-muted-foreground`.

### Symphony API Patterns

- Symphony exposes a deployed GraphQL Lambda Function URL:
  `https://gpezb67m7rm656gxy5bdgkzh3i0fxtbz.lambda-url.us-east-1.on.aws/`
- The endpoint accepts POST GraphQL requests and relies on a Cognito bearer token plus `symphony-operators` group authorization.
- The standalone operator queries:
  - `currentQueue { runs totals }`
  - `dispatchState { dispatchPaused updatedAt }`
  - `pauseDispatch`
  - `resumeDispatch`
  - later: `workflowVersions`, `currentSpend`, and `run(id:)`
- Function URL CORS currently allows `*`, `POST`, `Content-Type`, and `Authorization`, so an Admin SPA can call it directly.

### Institutional Learnings

- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`: do not trust ambient tenant claims for admin-sensitive mutation paths. In this slice, ThinkWork Admin does not authorize Symphony actions; Symphony's API validates the ID token and `symphony-operators` group.
- `docs/solutions/best-practices/oauth-client-credentials-in-secrets-manager-2026-04-21.md`: do not expose secrets through Vite env. Only public URLs and feature flags belong in Admin build env.
- Prior connector/Symphony cleanup plan `docs/plans/2026-05-14-001-refactor-retire-oss-symphony-connectors-plan.md`: do not reintroduce the retired OSS connector model. This work stays in the generic extension seam.

## Technical Decisions

### D1: Native Admin UI, Not Iframe

Authenticated standalone apps should not be embedded as raw iframes. OAuth providers block it, and it creates a brittle auth/session boundary. The Admin extension renders native React UI and calls Symphony's API directly.

### D2: Direct GraphQL For Day One

Use the deployed Symphony GraphQL Function URL directly from the Admin SPA. This is acceptable because the URL is public configuration, the bearer token remains the user's existing Cognito token, and Symphony enforces `symphony-operators` server-side. A same-origin Admin proxy is a later hardening path if CORS, audit, or network policy requires it.

### D3: Keep The Generic Extension Registry

Do not hardcode a public OSS "Symphony" route. Keep the build-time extension registration generic and driven by env variables. The concrete UI can be generic enough to be configured as the first external GraphQL extension, while the deployed repo variables supply the Symphony label and URLs.

### D4: Show Real Operational Data First

The first real slice should show the queue and dispatch controls because those prove the Admin surface is connected to Symphony's runtime. Placeholder text is acceptable only for inactive tabs that clearly do not pretend to be implemented.

## Implementation Units

### U1: Extension Config And GraphQL Client Boundary

**Goal:** Add explicit GraphQL URL config and a small client boundary that can call an external extension API with the Admin Cognito token.

**Files:**

- `apps/admin/src/extensions/configured-external-extension.tsx`
- `apps/admin/vite-env.d.ts`
- `scripts/build-admin.sh`
- `.github/workflows/deploy.yml`

**Approach:**

- Add `VITE_ADMIN_EXTENSION_SAMPLE_GRAPHQL_URL` as optional public config.
- Keep `VITE_ADMIN_EXTENSION_SAMPLE_URL` as the standalone-open URL.
- Validate GraphQL URLs as HTTPS.
- Reuse Admin auth token retrieval rather than duplicating Cognito setup.
- Return typed `{ data, errors }` failures with friendly auth/forbidden/network messages.

**Test Scenarios:**

- Missing GraphQL URL renders a config error instead of launcher copy.
- Invalid non-HTTPS GraphQL URL is ignored and surfaced as config error.
- Requests include `Authorization: Bearer <idToken>`.
- GraphQL `UNAUTHENTICATED` and `FORBIDDEN` responses produce distinct UI copy.

**Verification:**

- `pnpm --filter @thinkwork/admin test`
- `pnpm --filter @thinkwork/admin build`

### U2: Real Symphony Queue And Dispatch UI

**Goal:** Render a usable ThinkWork-native Symphony queue page using the deployed Symphony GraphQL operations.

**Files:**

- `apps/admin/src/extensions/configured-external-extension.tsx`
- `apps/admin/src/extensions/__tests__/configured-external-extension.test.tsx`

**Approach:**

- Replace launcher card with:
  - title row with tabs and refresh/open actions
  - search/filter/sort/group row matching Admin pages
  - queue table with issue, title, state, started, last usage, outcome
  - selected run summary panel when a run is selected
  - dispatch state chip/button in the title/action area
- Poll `currentQueue` and `dispatchState` on a conservative interval, with manual refresh.
- Wire `pauseDispatch` and `resumeDispatch` mutations and refresh queue/dispatch state after success.
- Keep inactive tabs visible but disabled or showing compact "not wired in this slice" content.

**Test Scenarios:**

- Active queue rows render from a mocked GraphQL response.
- Empty queue renders an empty-state row/card, not a blank page.
- Search filters visible rows locally.
- Pause/resume buttons call the right mutation and refetch state.
- No `iframe` is rendered.

**Verification:**

- `pnpm --filter @thinkwork/admin test`
- Browser check at `/extensions/symphony` with production-like env.

### U3: Production Env And Deployed Verification

**Goal:** Ship the real extension to `admin.thinkwork.ai` and verify it displays real Symphony data or a real Symphony auth/empty state.

**Files:**

- GitHub repo variables for `thinkwork-ai/thinkwork`
- PR description and deploy verification notes

**Approach:**

- Set `ADMIN_EXTENSION_SAMPLE_GRAPHQL_URL` to the live Symphony GraphQL Function URL.
- Keep `ADMIN_EXTENSION_SAMPLE_URL=https://symphony.thinkwork.ai/queue` only for the optional "Open standalone" action.
- Remove or ignore `ADMIN_EXTENSION_SAMPLE_EMBED_MODE` for this page unless future code still supports it for other extensions.
- Merge via PR after CI.
- Wait for deploy and inspect the production bundle for GraphQL URL and queue UI copy.

**Test Scenarios:**

- Production Admin route no longer includes the launcher copy.
- Production bundle contains the GraphQL URL and real queue UI text.
- User browser at `admin.thinkwork.ai/extensions/symphony` shows native Admin content, not Google 403 and not launcher copy.

**Verification:**

- PR checks: `cla`, `lint`, `verify`, `typecheck`, `test`.
- Main deploy run passes.
- `curl` verifies fresh Admin HTML and bundle.
- Browser screenshot/user confirmation verifies the native UI.

## Risks And Mitigations

- **Token audience mismatch:** If Admin Cognito token audience differs from Symphony's expected client ID, GraphQL will return `UNAUTHENTICATED`. Mitigation: keep UI explicit and, if needed, update Symphony auth to accept the Admin client ID because the user pool is shared.
- **Missing `symphony-operators` group:** Operators without the group will see `FORBIDDEN`. Mitigation: show clear copy that access is granted by the Symphony operator group.
- **Public Function URL exposure:** The URL is already public and protected by JWT/group checks. Mitigation: do not add secrets to Vite env; only expose URL.
- **CORS drift:** If Symphony tightens CORS away from `*`, Admin calls may fail. Mitigation: future same-origin proxy or explicit `admin.thinkwork.ai` CORS allowlist.

## Done Criteria

- `admin.thinkwork.ai/extensions/symphony` renders native Symphony queue UI.
- The page issues real GraphQL calls to the deployed Symphony endpoint.
- No iframe/launcher-only path is used for the primary surface.
- CI and deployment pass.
- Production route is verified after deploy.
