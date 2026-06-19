---
title: "fix: Resolve managed-app deployment release pins"
type: fix
status: active
date: 2026-06-19
origin: docs/brainstorms/2026-06-06-github-free-customer-deployments-requirements.md
---

# fix: Resolve Managed-App Deployment Release Pins

## Overview

Fix managed application deployment planning so Spaces-initiated app installs,
including Twenty CRM, create deployment jobs with a real immutable ThinkWork
release pin instead of `unresolved` placeholders. The GraphQL API should fail
closed before creating deployment rows when the release pin is missing, while
Terraform should provide the selected deployment release metadata to the
handlers that create deployment jobs.

---

## Problem Frame

Twenty CRM installation from the TEI environment failed immediately because the
managed-app deployment job carried `releaseVersion="unresolved"` and
`manifestDigest="unresolved"`. The GitHub-free deployment requirements make the
customer AWS deployment control plane responsible for managed-app lifecycle and
require deploy jobs to pull signed/versioned release artifacts rather than
source or mutable defaults. A managed-app job with unresolved release metadata
cannot safely plan or apply because it does not identify the artifacts the
runner should consume.

---

## Requirements Trace

- R1. Spaces managed-app deploy and destroy requests must create deployment jobs
  only when a real release version and manifest digest are available.
- R2. `graphql-http` must receive the selected deployment release metadata from
  Terraform, because the Managed Applications UI intentionally omits release
  fields and relies on stage defaults.
- R3. Missing or invalid release metadata must fail before any managed
  application row, deployment job row, event, or Step Functions execution is
  created.
- R4. Existing explicit release metadata inputs must continue to work for
  clients that pass them directly.
- R5. Deployment-session release metadata should stay in sync with the same
  selected release variables used by the deployment control plane.

**Origin actors:** A3 ThinkWork operator, A4 customer AWS deployment control
plane, A5 ThinkWork release publisher

**Origin flows:** F3 deploy or tear down managed applications

**Origin acceptance examples:** AE3 managed-app deployment from Spaces, AE6
release manifest/artifact selection

---

## Scope Boundaries

- Do not change the Managed Applications UI contract; it should not need to
  pass release metadata for the normal operator path.
- Do not relax the deployment runner's unresolved-release guard.
- Do not change release-manifest schema, artifact verification, or runner
  behavior.
- Do not clean up previously created failed deployment rows in this PR; operators
  can retry after the fixed API deploys.

---

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/components/settings/managed-applications/ManagedApplicationLifecycleActions.tsx`
  starts managed-app plans with key, operation, config version, desired config,
  and idempotency key, but no release fields.
- `packages/api/src/graphql/resolvers/deployments/startManagedApplicationPlan.mutation.ts`
  resolves release defaults and performs the job creation side effects.
- `packages/api/src/graphql/resolvers/deployments/shared.ts` holds the default
  release helpers and shared deployment job utilities.
- `packages/api/src/graphql/resolvers/deployments/managed-applications.test.ts`
  covers managed-app plan creation, idempotency, authorization, and Step
  Functions dispatch.
- `terraform/modules/app/lambda-api/handlers.tf` keeps `graphql-http` env vars
  intentionally compact and uses per-handler overrides for heavy or specialized
  config.
- `terraform/modules/thinkwork/main.tf` already passes selected deployment
  release variables into the deployment control plane module.

### Institutional Learnings

- `docs/solutions/architecture-patterns/github-free-customer-deployments-aws-control-plane-pattern-2026-06-06.md`
  says managed applications are durable deployment jobs and deployment changes
  should fail closed against explicit release artifacts.
- `docs/solutions/architecture-patterns/managed-app-mcp-oauth-lifecycle-2026-06-06.md`
  reinforces the split between managed-app infrastructure lifecycle and
  per-user MCP/OAuth state; this fix stays on the lifecycle side only.

### External References

- None. Existing repo patterns and requirements are sufficient.

---

## Key Technical Decisions

- Validate release metadata in the GraphQL resolver before parsing desired
  config or writing rows: this keeps failure atomic and produces an operator
  readable error.
- Treat `unresolved`, blank, and non-SHA-256 manifest digests as invalid job
  metadata: a release version alone is not enough to identify trusted artifacts.
- Wire release metadata only to `graphql-http` and `deployment-sessions`: this
  avoids expanding the shared Lambda env block, which is already near AWS's
  4 KB limit.
- Preserve explicit release inputs: callers that pass `releaseVersion` and
  `manifestDigest` continue to override environment defaults.

---

## Open Questions

### Resolved During Planning

- Should the fix happen in the UI or API? API. The normal operator path should
  remain stage-default driven, and the API is the side-effect boundary that can
  enforce atomic failure.
- Should Terraform pass release vars through `common_env`? No. Use per-handler
  env to avoid bloating every Lambda.

### Deferred to Implementation

- Exact operator cleanup for the existing failed TEI row: this can be handled
  operationally after deploy if the UI still shows the failed job; it is not
  required to prevent retry success.

---

## Implementation Units

- U1. **Add Release-Pin Guard**

**Goal:** Reject unresolved or malformed release metadata before deployment job
side effects begin.

**Requirements:** R1, R3, R4

**Dependencies:** None

**Files:**
- Modify: `packages/api/src/graphql/resolvers/deployments/shared.ts`
- Modify: `packages/api/src/graphql/resolvers/deployments/startManagedApplicationPlan.mutation.ts`
- Test: `packages/api/src/graphql/resolvers/deployments/managed-applications.test.ts`

**Approach:**
- Trim default release env values so blank strings fall back to explicit
  unresolved placeholders.
- Add a shared assertion for managed-app deployment release metadata.
- Call the assertion after resolving explicit-or-default release values and
  before `parseAwsJsonObject`, `ensureManagedApplication`, job insert, event
  insert, or Step Functions start.

**Execution note:** Start with a failing test that proves unresolved defaults do
not create rows or start Step Functions.

**Patterns to follow:**
- Existing `GraphQLError` usage in `packages/api/src/graphql/resolvers/deployments/shared.ts`.
- Existing side-effect ordering tests in
  `packages/api/src/graphql/resolvers/deployments/managed-applications.test.ts`.

**Test scenarios:**
- Error path: when the UI omits release fields and no Lambda release env exists,
  `ENABLE` for `twenty` throws the unresolved-release message before any insert,
  update, or Step Functions call.
- Happy path: when explicit valid release fields are provided, existing
  managed-app plan creation behavior is unchanged.
- Edge case: blank release env values are treated as unresolved rather than
  accepted as empty strings.
- Error path: non-64-hex manifest digest is rejected before side effects.

**Verification:**
- Managed-app resolver tests cover both rejection and existing successful plan
  creation behavior.

---

- U2. **Wire Selected Release Metadata to API Handlers**

**Goal:** Ensure normal Spaces managed-app plans have real release defaults in
customer environments such as TEI.

**Requirements:** R2, R5

**Dependencies:** U1

**Files:**
- Modify: `terraform/modules/app/lambda-api/variables.tf`
- Modify: `terraform/modules/app/lambda-api/handlers.tf`
- Modify: `terraform/modules/thinkwork/main.tf`

**Approach:**
- Add lambda-api module inputs for deployment release version, manifest URL,
  and manifest SHA-256.
- Forward the top-level ThinkWork deployment release variables into the
  lambda-api module.
- Add per-handler env vars for `deployment-sessions`, preserving its existing
  release payload behavior.
- Add only release version and manifest SHA-256 to `graphql-http`, because the
  managed-app plan resolver does not need the manifest URL.

**Patterns to follow:**
- Existing per-handler env maps in `terraform/modules/app/lambda-api/handlers.tf`.
- Existing release variable forwarding to
  `terraform/modules/app/deployment-control-plane` from
  `terraform/modules/thinkwork/main.tf`.

**Test scenarios:**
- Test expectation: none -- Terraform variable plumbing is covered by fmt and
  review, while behavior is exercised through U1 resolver tests using env
  defaults.

**Verification:**
- Terraform formatting passes for touched module files.
- Diff shows release vars scoped to `graphql-http` and `deployment-sessions`,
  not added to `common_env`.

---

- U3. **Cover UI-Default Release Flow**

**Goal:** Prove the exact Managed Applications UI path succeeds when Lambda env
provides a valid release pin.

**Requirements:** R1, R2, R4

**Dependencies:** U1, U2

**Files:**
- Test: `packages/api/src/graphql/resolvers/deployments/managed-applications.test.ts`

**Approach:**
- Add a resolver test that omits release fields, stubs
  `THINKWORK_RELEASE_VERSION` and `THINKWORK_RELEASE_MANIFEST_SHA256`, and
  asserts the Step Functions payload carries those values for a Twenty `ENABLE`
  operation.

**Patterns to follow:**
- Existing `mockStartExecution` payload assertions in the same test file.

**Test scenarios:**
- Happy path: `twenty` `ENABLE` with no input release fields but valid Lambda
  release env starts planning with the env-backed release version and digest.
- Integration: created job payload and Step Functions execution payload use the
  same release values.

**Verification:**
- Targeted deployment resolver tests pass.

---

## System-Wide Impact

- **Interaction graph:** Spaces Managed Applications -> GraphQL
  `startManagedApplicationPlan` -> Aurora deployment job rows -> Step Functions
  deployment runner. This plan changes only the GraphQL validation boundary and
  Lambda deployment config.
- **Error propagation:** Missing release metadata returns a GraphQL
  `FAILED_PRECONDITION` error before persistent side effects.
- **State lifecycle risks:** The fix prevents new partially installed failed
  jobs caused by unresolved release metadata. It does not mutate existing failed
  jobs.
- **API surface parity:** Explicit `releaseVersion` and `manifestDigest` inputs
  remain supported for direct clients.
- **Integration coverage:** Resolver tests exercise the cross-layer payload from
  GraphQL input/env defaults into Step Functions start payload.
- **Unchanged invariants:** The deployment runner still requires immutable
  release metadata and the UI still does not select releases inline.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `graphql-http` env size grows past AWS limit | Add only two short release vars to the handler-specific env map, not `common_env`. |
| TEI still has default `deployment_release_version = "unresolved"` in Terraform variables | Guard preserves fail-closed behavior; operators must deploy with real release variables for managed-app lifecycle to work. |
| Existing failed job remains visible | Leave historical failed state intact; retry creates a new job with resolved release metadata after deploy. |

---

## Documentation / Operational Notes

- No user-facing docs are required for the code fix.
- Deploying this change to TEI must include real
  `deployment_release_version` and `deployment_release_manifest_sha256` values.
- If the existing Twenty CRM row remains failed, use the page retry action after
  the fixed API deploys.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-06-06-github-free-customer-deployments-requirements.md`
- Related plan: `docs/plans/2026-06-06-001-feat-github-free-customer-deployments-plan.md`
- Related solution: `docs/solutions/architecture-patterns/github-free-customer-deployments-aws-control-plane-pattern-2026-06-06.md`
- Related solution: `docs/solutions/architecture-patterns/managed-app-mcp-oauth-lifecycle-2026-06-06.md`
