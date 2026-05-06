# Symphony Target Pickers Checkpoint Plan

## Context

The first Symphony checkpoint page is merged. It exposes connector rows in the
admin app and allows create/edit/archive lifecycle operations through the
connector GraphQL API. The form is still raw: admins must paste dispatch target
IDs and hand-write the connector config JSON.

This PR makes the checkpoint useful enough for early operator testing without
shipping the connector runtime. It keeps the page inert while making connector
setup less brittle.

## Goals

- Replace the raw dispatch target ID field with tenant-scoped agent/routine
  selectors where possible.
- Preserve a manual target ID fallback for missing, archived, or unusual
  targets.
- Add a small Linear starter config action that writes a sane JSON shape for
  `linear_tracker` connectors.
- Keep GraphQL writes scoped to the existing connector mutations; no runtime
  dispatch behavior is added.
- Cover config helper behavior with focused tests.

## Non-Goals

- No Linear OAuth, webhook, polling, or API calls.
- No Flue invocation, task handling, or dispatch runtime.
- No EventBridge Scheduler, Lambda, or state machine wiring.
- No connector provider catalog beyond the single starter config affordance.

## Implementation Units

### U1: Plan and Scope

- Capture this plan before code changes.
- Keep this PR based on the merged Symphony checkpoint UI from PR #840.

### U2: Target Option Data

- Reuse existing admin GraphQL documents for `AgentsListQuery` and
  `RoutinesListQuery`.
- Load agents/routines only while the connector form dialog is open.
- Derive target options by `DispatchTargetType`.

### U3: Target Picker UI

- Replace the raw target ID field with a select control for agent/routine target
  types.
- Show the selected target ID in compact text so operators can still inspect
  the actual persisted value.
- Provide a manual ID input fallback when no suitable option exists or the user
  chooses manual entry.
- Leave `hybrid_routine` as manual entry until the product has a canonical
  selector for it.

### U4: Linear Starter Config

- Add a helper that returns a stable starter JSON object for `linear_tracker`.
- Add an action in the form that fills the config editor with the starter shape.
- Do not hide the JSON editor; operators still need to inspect and adjust it.

### U5: Verification and PR

- Add or extend helper tests for target-option filtering and starter config.
- Run focused admin tests, admin build, codegen if documents change, and repo
  checks where feasible.
- Run the LFG review/autofix and browser pipeline steps.
- Commit, push, and open a PR.

## Risks

- Existing connectors may point at targets no longer returned by the list
  queries. Manual fallback preserves editability for those rows.
- The starter config is only a JSON convenience; server-side connector
  validation remains the source of truth.
- Local browser verification may stop at the auth redirect unless a valid
  Cognito session is present.
