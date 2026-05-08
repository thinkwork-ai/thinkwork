---
title: Symphony GitHub Credential Setup Hardening
status: active
created: 2026-05-08
origin: user request
---

# Symphony GitHub Credential Setup Hardening

## Problem

The PR-producing Linear checkpoint now works end to end, but only after manually creating and wiring a tenant `github` credential. The Symphony connector form still makes the GitHub requirement too implicit, so an operator can save or enable a Linear connector that will later fail when the PR harness tries to create a branch and draft pull request.

## Scope

This plan hardens the existing Linear Symphony setup path. It does not add a new connector type, backend schema, migrations, credential creation flow, or runtime PR behavior. The UI will read existing active tenant credentials, require the GitHub credential fields for PR-producing mode, write explicit GitHub repo settings into connector config, and make missing GitHub credentials visible on the Connectors table.

## Requirements Traceability

- Add GitHub credential as a first-class Linear Symphony form field.
- Validate that an active GitHub credential exists before saving or enabling the PR-producing connector.
- Store explicit `github.credentialSlug`, repo owner/name, base branch, and file path in connector config.
- Show a clear disabled/error state in Symphony Connectors when the configured GitHub credential is missing.
- Keep Advanced JSON available behind the existing advanced section.
- Preserve single-line tables with no horizontal scroll.

## Existing Patterns

- `apps/admin/src/lib/connector-admin.ts` owns connector form defaults, config normalization, validation, and payload builders.
- `apps/admin/src/routes/_authed/_tenant/symphony.tsx` owns the Symphony tab UI, Connectors table, and Linear connector dialog.
- `apps/admin/src/lib/graphql-queries.ts` already exposes `TenantCredentialsQuery` for active tenant credential lookup.
- `docs/runbooks/computer-first-linear-connector-checkpoint.md` is the checkpoint operator source of truth.

## Implementation Units

### U1: Connector Admin Config Model

Files:

- `apps/admin/src/lib/connector-admin.ts`
- `apps/admin/src/lib/connector-admin.test.ts`

Decisions:

- Extend `ConnectorFormValues` with `githubCredentialSlug`, `githubOwner`, `githubRepoName`, `githubBaseBranch`, and `githubFilePath`.
- Keep the default GitHub credential slug as `github`, repo as `thinkwork-ai/thinkwork`, base branch as `main`, and checkpoint file as `README.md`.
- Normalize those fields into a top-level `github` config object so runtime defaults are no longer required for the checkpoint connector.
- Preserve existing advanced JSON fields by merging structured GitHub form values over parsed JSON.
- Add validation options for active credential slugs so callers can block save/enable when the selected GitHub credential is missing.

Tests:

- Starter config includes explicit GitHub settings and `moveOnPrOpened`.
- Create/update payloads serialize GitHub config from first-class fields.
- Existing connector config hydrates GitHub fields back into the form.
- Validation rejects missing GitHub fields and rejects an enabled connector when the selected GitHub credential is absent from active credentials.

### U2: Symphony Connector UI Hardening

Files:

- `apps/admin/src/routes/_authed/_tenant/symphony.tsx`
- `apps/admin/src/routes/_authed/_tenant/-symphony.target.test.ts`

Decisions:

- Query active tenant credentials when the Symphony page/dialog is open and pass active slugs to validation.
- Render a GitHub setup section before Advanced JSON with credential, owner, repo, base branch, and checkpoint file path.
- Prefer a credential select when active credentials exist; keep typed slug fallback so an operator can see and correct the exact slug.
- Show a destructive compact badge in the Connectors table for active/enabled connectors whose configured GitHub credential slug is not active.
- Keep the existing table fixed-layout and no-horizontal-scroll constraints.

Tests:

- Static route test confirms GitHub setup fields are first-class and appear before Config JSON.
- Static route test confirms the active credential query and missing GitHub credential warning exist.
- Static route test keeps the no-scroll and single-line table assertions.

### U3: Checkpoint Runbook Update

Files:

- `docs/runbooks/computer-first-linear-connector-checkpoint.md`

Decisions:

- Update connector setup instructions to use the structured GitHub fields rather than editing JSON first.
- Document that the Connectors tab should show setup-required state when the selected GitHub credential is missing.

Tests:

- Documentation review only; no runtime test needed.

## Sequencing

1. Implement U1 helper/config model changes and focused unit tests.
2. Implement U2 UI query, form fields, table warning, and static route tests.
3. Update U3 runbook.
4. Run focused admin tests, then broader admin checks as practical.
5. Open PR, monitor CI, merge when green.

## Risks

- Credential kind metadata does not identify GitHub-specific credentials, so validation must use the configured slug against active tenant credentials rather than infer provider type.
- The existing runtime may still tolerate missing GitHub config for backward compatibility; this PR makes the checkpoint connector explicit without removing that safety net.
- The warning badge must not create row wrapping or horizontal scroll.
