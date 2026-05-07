---
title: "feat: Symphony connector setup UX polish"
status: active
created: 2026-05-07
origin: direct user request
---

# feat: Symphony connector setup UX polish

## Problem Frame

The Linear-only Symphony checkpoint is now proven end-to-end: scheduled Linear pickup routes to a Computer-owned thread, delegates to a managed-agent turn, writes back to Linear, and appears cleanly in Symphony Runs. The remaining operator problem is setup. The current connector create/edit dialog exposes raw connector type and config JSON as the primary path, making it too easy to configure the checkpoint connector with the wrong label, missing team key, unclear credential, or wrong target.

## Scope

- Replace the raw-first connector create/edit experience with a Linear connector setup form.
- Keep advanced JSON editing available as an escape hatch.
- Make label, team key, credential, target Computer, and writeback state first-class fields.
- Validate that the checkpoint label is exactly `symphony`.
- Preserve the existing single-line, no-horizontal-scroll table behavior.
- Add focused admin helper/route tests.

## Non-Goals

- No backend GraphQL schema changes.
- No new connector type beyond `linear_tracker`.
- No OAuth credential provisioning flow.
- No changes to the proven polling, delegation, or writeback runtime.
- No expansion to Slack, GitHub, or other connector providers.

## Requirements Trace

- R1. An operator can create or edit the Linear Symphony connector without hand-authoring JSON.
- R2. The form presents `teamKey`, `label`, `credentialSlug`, target Computer, and Linear writeback target state as explicit fields.
- R3. The checkpoint label must validate as `symphony` to avoid repeating the earlier wrong-label failure mode.
- R4. The advanced JSON path remains available and round-trips with the first-class fields.
- R5. Connector and run tables stay single-line and keep `allowHorizontalScroll={false}`.

## Existing Patterns

- `apps/admin/src/routes/_authed/_tenant/symphony.tsx` owns the Symphony page, tabs, connector table, run table, and connector dialog.
- `apps/admin/src/lib/connector-admin.ts` owns connector form defaults, target option derivation, JSON parsing, and create/update payload helpers.
- `apps/admin/src/lib/connector-admin.test.ts` is the focused test home for connector UI helpers.
- `apps/admin/src/components/ui/tabs.tsx`, `apps/admin/src/components/ui/select.tsx`, `apps/admin/src/components/ui/input.tsx`, `apps/admin/src/components/ui/switch.tsx`, and the existing Symphony route provide the UI primitives to reuse.
- `docs/brainstorms/2026-05-07-computer-first-connector-routing-requirements.md` requires Computer-first connector setup for the happy path.

## Key Decisions

- **Keep this as an admin-only UI polish PR.** The backend already accepts the config object and target fields needed for the proven checkpoint. Changing contracts now would slow down the checkpoint path without adding operator value.
- **Model Linear fields as derived form state, not a second source of truth.** `ConnectorFormValues` should expose first-class Linear fields while helpers serialize them back into the existing connector `config` shape for create/update mutations.
- **Default to Computer target.** Direct Agent/Routine/Hybrid targets remain under an advanced target mode because the product direction is Computer-first connector routing.
- **Advanced JSON is opt-in.** Operators should see structured fields first, with JSON available for inspection and unusual edits.
- **Validate before mutation.** Catch wrong label, missing team key, missing credential, missing target Computer, and invalid JSON in the dialog before calling GraphQL.

## Implementation Units

### U1. Linear Form Model And Serialization

**Goal:** Add a typed Linear setup view over the existing connector config payload.

**Files:**

- Modify: `apps/admin/src/lib/connector-admin.ts`
- Modify: `apps/admin/src/lib/connector-admin.test.ts`

**Approach:**

- Extend `ConnectorFormValues` with `linearTeamKey`, `linearLabel`, `linearCredentialSlug`, `linearWritebackState`, and an `advancedJsonOpen`-compatible `configJson`.
- Parse existing `linear_tracker` configs into those fields when editing.
- Serialize the first-class fields back into the existing config shape, preserving unrelated advanced JSON keys where practical.
- Add validation helpers that return concise operator-facing error strings.

**Tests:**

- New form defaults include `linear_tracker`, label `symphony`, credential `linear`, and empty team/writeback fields.
- Existing config with `issueQuery.teamKey`, `issueQuery.labels`, `credentialSlug`, and provider writeback state hydrates first-class fields.
- Create/update payloads serialize the first-class fields into valid config JSON.
- Label validation rejects anything other than exactly `symphony`.
- Invalid advanced JSON returns a validation error and does not throw from the route.

### U2. Structured Linear Connector Dialog

**Goal:** Replace the raw-first dialog with a safe Linear setup form while retaining advanced JSON.

**Files:**

- Modify: `apps/admin/src/routes/_authed/_tenant/symphony.tsx`
- Optionally add: `apps/admin/src/routes/_authed/_tenant/symphony.target.test.tsx` or extend an existing route target test if one exists.

**Approach:**

- Change the dialog title and layout to "Linear connector" for the supported connector path.
- Hide connector `type` behind a fixed `linear_tracker` value instead of a primary editable field.
- Present first-class inputs for name, description, Linear team key, label, credential slug, writeback state, target Computer, and enabled status.
- Keep direct Agent/Routine/Hybrid target choices available behind an advanced control.
- Keep JSON in a collapsed advanced section that can be opened for inspection/editing.
- Ensure any helper text remains concise and functional, not in-app documentation.

**Tests:**

- Source-level target test confirms the dialog includes first-class Linear fields and the fixed `linear_tracker` path.
- Source-level target test confirms advanced JSON remains present but is no longer the primary path.

### U3. Table Guardrails

**Goal:** Preserve the previous Symphony table fixes while changing the dialog.

**Files:**

- Modify: `apps/admin/src/routes/_authed/_tenant/symphony.tsx`

**Approach:**

- Keep `allowHorizontalScroll={false}` for connector and run tables.
- Keep `table-fixed`, `whitespace-nowrap`, `truncate`, and compact action sizing on table cells.
- Avoid adding new row content that can wrap.

**Tests:**

- Existing route/source tests or focused target test assert both Symphony tables still pass `allowHorizontalScroll={false}` and retain `table-fixed`.

## Verification

- `pnpm --filter @thinkwork/admin exec vitest run src/lib/connector-admin.test.ts`
- `pnpm --filter @thinkwork/admin typecheck`
- `pnpm --filter @thinkwork/admin lint`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm format:check`
- Browser check: open Symphony Connectors, create/edit a connector, confirm structured Linear fields are primary, advanced JSON remains available, validation catches non-`symphony` labels, and tables remain single-line without horizontal scroll.

## Risks

| Risk                                              | Mitigation                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Advanced JSON edits and structured fields drift   | Re-parse JSON on submit and serialize through one helper path.                                    |
| Operators need unsupported connector config knobs | Keep JSON available in an advanced section.                                                       |
| No credential inventory API exists yet            | Treat credential as a first-class slug field for now; do not invent backend credential discovery. |
| Target picker has no Computers                    | Preserve manual target fallback and show validation before submit.                                |
