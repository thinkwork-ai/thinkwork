# Symphony Checkpoint UI Plan

## Context

The connector data model and GraphQL read/admin APIs are now merged. This PR
adds the first visible checkpoint for the connector-platform effort in the
admin app: a Symphony entry under Dashboard and a thin connector admin page
backed by the merged connector APIs.

This page is intentionally inert. It creates and manages connector rows only;
it does not dispatch Linear/Flue work, poll external systems, or introduce the
connector chassis from the later roadmap unit.

## Goals

- Add Symphony to the tenant dashboard navigation.
- Add a tenant-scoped Symphony page that lists connectors.
- Show connector status, connector type, dispatch target type/id, enabled state,
  and recent timing metadata.
- Allow tenant admins to create, edit, pause/resume, and archive connector rows
  through the existing GraphQL admin mutations.
- Keep the UI thin and reversible while the connector runtime work is still
  pending.

## Non-Goals

- No Linear-specific OAuth, polling, webhook, or Flue execution behavior.
- No connector catalog or provider onboarding wizard.
- No background Lambda, EventBridge Scheduler, or Step Functions integration.
- No Symphony code in the sibling `symphony` repo.

## Implementation Units

### U1: Navigation and Route

- Add a Symphony nav item immediately after Dashboard in
  `apps/admin/src/components/Sidebar.tsx`.
- Add a tenant route at `apps/admin/src/routes/_authed/_tenant/symphony.tsx`.
- Regenerate the TanStack route tree through the admin build/dev tooling.

### U2: Connector GraphQL Documents

- Add admin GraphQL documents in `apps/admin/src/lib/graphql-queries.ts` for:
  - `connectors`
  - `createConnector`
  - `updateConnector`
  - `pauseConnector`
  - `resumeConnector`
  - `archiveConnector`
- Regenerate admin GraphQL types with `pnpm --filter @thinkwork/admin codegen`.

### U3: Thin Connector Admin Page

- Render connectors in a compact table with search and refresh.
- Include status/type/target/enabled columns and relative created/updated times.
- Provide a create/edit dialog using existing shadcn form controls.
- Accept raw dispatch target IDs for this checkpoint instead of building target
  pickers.
- Validate connector config as JSON before submitting AWSJSON payloads.
- Surface mutation failures inline and refetch the list after successful writes.

### U4: Verification and Review

- Run admin codegen and route generation.
- Run focused admin checks first, then the repo checks where feasible.
- Run the Compound Engineering code review autofix pass.
- Run a browser verification pass against the admin app; if local auth blocks
  the protected route, record the limitation and preserve build/type evidence.

## Risks

- `createConnector` requires a valid dispatch target id. The thin page will let
  admins paste an agent/routine id; invalid ids should return the server-side
  validation error from the merged U4 mutation API.
- Local browser verification may be limited by the deployed Cognito session
  requirement. The route still needs a local build/typecheck to protect
  generated route and GraphQL document wiring.
