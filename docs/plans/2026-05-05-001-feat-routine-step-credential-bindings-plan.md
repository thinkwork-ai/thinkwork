---
title: "feat: Routine step credential bindings"
type: feat
status: active
date: 2026-05-05
origin: docs/brainstorms/2026-05-04-tenant-credential-vault-n8n-routine-migration-requirements.md
---

# feat: Routine step credential bindings

## Overview

Make credentials feel native at the routine step/node level. Routine authors should add one or more tenant-shared credentials to a code step from dropdowns, give each binding a safe variable alias, and then use `credentials.<alias>` in TypeScript or `credentials["alias"]` in Python. HTTP steps should use a single ThinkWork credential selector for EventBridge-backed authentication. The runtime must continue resolving secrets only at execution time and keep raw values out of visible routine config, ASL authoring buffers, and persisted logs.

This is a focused follow-on to `docs/plans/2026-05-04-002-feat-tenant-credential-vault-routine-migration-plan.md`. The vault, TypeScript recipe, ID-based credential dropdowns, and runtime resolver already exist; this slice polishes the authoring contract and closes the obvious gaps for code and HTTP steps.

## Problem Frame

The broad credential-vault work made credentials possible, but the routine step editor still treats bindings like a low-level JSON-ish advanced field. That is a poor fit for converting n8n workflows, where custom code and HTTP nodes usually need credentials attached directly to the node. Authors need a clear step-owned credential model with dropdowns, stable variable names, and visible runtime affordances before the PDI migration can be validated comfortably.

## Requirements Trace

- R3. Routine definitions, versions, ASL, visible config, and code buffers store credential references and aliases, not raw secret values.
- R7. Python and TypeScript code steps expose editable source plus environment and credential bindings.
- R8. Code steps receive credentials through declared bindings.
- R9. Code-step logs, outputs, errors, and previews avoid exposing secret values.
- R10. Routine code editing reuses the existing CodeMirror pattern.
- R13. Custom n8n nodes and n8n code nodes map to editable TypeScript/Python steps.
- R14. Missing credential mappings block test/activation with actionable errors.
- R16. Credentialed routine runs remain visible without exposing credentials.

## Scope

- Tenant-shared credentials only; per-user OAuth/run-as-user stays deferred.
- No raw secret reveal, no code-buffer secret interpolation, and no secret env-var injection.
- No new custom n8n node catalog.
- No new step-binding table; bindings remain recipe args in routine definitions and step manifests.
- HTTP remains one credential per HTTP step unless a concrete multi-auth use case appears.
- EventBridge Connection lifecycle hardening is a follow-up unless implementation discovers it is required for this UI slice to pass existing tests.

## Context And Patterns

- `packages/api/src/lib/routines/recipe-catalog.ts` is the canonical source for routine recipe args, config fields, ASL emission, and recipe validation.
- `apps/admin/src/components/routines/RoutineStepConfigEditor.tsx` already renders `credential_select` and `credential_bindings`, but the binding UI needs clearer variable semantics and safer defaults.
- `packages/api/src/lib/routines/credential-bindings.ts` collects code and HTTP credential references at publish time, validates tenant/status/kind, and replaces HTTP placeholders with EventBridge Connection ARNs.
- `packages/lambda/routine-credential-resolver.ts` resolves declared code bindings at runtime by tenant and credential ID/legacy slug.
- `packages/lambda/routine-task-python.ts` is the shared Python/TypeScript code-step wrapper and injects `credentials` and `input` into AgentCore Code Interpreter code.
- `docs/solutions/architecture-patterns/recipe-catalog-llm-dsl-validator-feedback-loop-2026-05-01.md` establishes recipe catalog metadata as the source of truth.
- `docs/solutions/developer-experience/routine-rebuild-closeout-checkpoints-2026-05-03.md` warns that routine authoring, versioning, and execution surfaces must line up; testing a deployed routine alone is not enough.

## Key Decisions

- **Step-owned recipe args are the binding model.** A binding belongs to the step that uses it, not to a separate routine-level credential map.
- **Aliases are code variables.** UI copy and validation should call them variable names or aliases and show the exact access pattern for the selected recipe language.
- **Dropdowns store credential IDs.** Legacy slugs may still resolve for old definitions, but new edits should persist credential IDs.
- **Runtime API is stable as `credentials`.** TypeScript uses `credentials.pdi` or `credentials["pdi"]`; Python uses `credentials["pdi"]`.
- **Required fields are validation hints, not secrets.** They are stored with the binding so a missing PDI `partnerId` or `password` fails before user code runs.
- **Publish/runtime both fail closed.** Authoring helpers should catch obvious shape problems early, but tenant ownership/status/HTTP compatibility remains enforced at publish and runtime.

## Implementation Units

### U1. Step Credential Binding Authoring Polish

**Goal:** Make multi-credential code-step bindings usable without asking authors to hand-edit JSON.

**Files:**

- `apps/admin/src/components/routines/RoutineStepConfigEditor.tsx`
- `apps/admin/src/components/routines/RoutineStepConfigEditor.test.ts`

**Approach:**

- Rename the visible alias input semantics to "Variable" while keeping the persisted key `alias`.
- Show a code-access hint derived from the step recipe: `credentials.<alias>` for TypeScript when safe, `credentials["alias"]` for Python or bracket-compatible fallback.
- Keep add/remove/dropdown behavior ID-based and preserve legacy slug display for existing definitions.
- Improve empty and no-credential states so authors understand they need to create a credential before adding bindings.
- Keep `requiredFields` editable as non-secret comma-separated validation fields.

**Test scenarios:**

- Adding a binding from a display name generates a safe unique alias and stores the credential ID.
- TypeScript hint renders dot access for safe aliases and bracket access when needed.
- Python hint renders bracket access.
- Parsing/stringifying bindings never includes secret values.
- Duplicate alias, missing credential, and invalid required-field validation remain enforced.

### U2. Recipe Metadata And Validation Tightening

**Goal:** Keep HTTP and code recipe credential controls explicit in the recipe catalog.

**Files:**

- `packages/api/src/lib/routines/recipe-catalog.ts`
- `packages/api/src/lib/routines/recipe-catalog.test.ts`
- `packages/api/src/lib/routines/credential-bindings.ts`
- `packages/api/src/graphql/resolvers/routines/routine-credential-bindings.test.ts`

**Approach:**

- Ensure Python and TypeScript recipes expose `credentialBindings` as editable metadata with help text that names the `credentials` runtime object.
- Ensure HTTP recipe exposes `credentialId` as the only tenant-authored ThinkWork credential selector.
- Validate duplicate/unsafe code credential aliases and invalid required fields before publish, then preserve publish-time tenant/status/kind checks.
- Keep ASL output free of raw auth material; HTTP ASL uses placeholders until publish resolves them.

**Test scenarios:**

- Python and TypeScript arg schemas accept multiple valid bindings and reject unsafe aliases.
- HTTP recipe emits a placeholder for `credentialId` and does not emit secret-looking auth headers.
- Publish validation rejects duplicate aliases, inactive/missing/cross-tenant credentials, HTTP-incompatible kinds, and missing EventBridge Connection ARNs.

### U3. Code-Step Runtime Contract

**Goal:** Make the code-step runtime injection contract reliable and documented through tests.

**Files:**

- `packages/lambda/routine-task-python.ts`
- `packages/lambda/routine-credential-resolver.ts`
- `packages/lambda/__tests__/routine-task-python.test.ts`
- `packages/lambda/__tests__/routine-credential-resolver.test.ts`
- `packages/lambda/__tests__/routine-output-redactor.test.ts`

**Approach:**

- Preserve the current shared Python/TypeScript wrapper and `credentials` runtime object.
- Ensure multiple bindings resolve into a map keyed by alias and mark every touched credential as used.
- Keep exact secret leaf values in the redaction set before stdout/stderr previews, S3 log writes, and step callback payloads.
- Fail before invoking AgentCore when credential resolution fails.

**Test scenarios:**

- TypeScript receives multiple aliases under `credentials`.
- Python receives multiple aliases under `credentials`.
- Missing required fields fail with a non-secret error.
- Resolved secret values and token-shaped output are redacted before preview/S3 persistence.

### U4. HTTP Credential Selection Boundary

**Goal:** Keep HTTP steps simple and safe: one credential selector maps to one EventBridge Connection.

**Files:**

- `packages/api/src/lib/routines/credential-bindings.ts`
- `packages/api/src/lib/tenant-credentials/eventbridge-connections.ts`
- `packages/api/src/graphql/resolvers/tenant-credentials/createTenantCredential.mutation.ts`
- `packages/api/src/graphql/resolvers/tenant-credentials/updateTenantCredential.mutation.ts`
- `packages/api/src/graphql/resolvers/routines/routine-credential-bindings.test.ts`

**Approach:**

- Use existing publish-time placeholder replacement for HTTP `credentialId`.
- If implementation verifies EventBridge Connection lifecycle is still a stub, do not fake success; either keep the current publish error explicit or add the smallest real creation/update path for API key/basic/bearer credentials.
- Keep SOAP/arbitrary JSON credentials code-step-only until a first-class HTTP mapping exists.

**Test scenarios:**

- API key/basic/bearer credentials with connection ARNs can publish HTTP steps.
- SOAP/json credentials are rejected for native HTTP authentication with an actionable message.
- Credentials without EventBridge Connection ARNs fail before Step Functions deployment.

## Verification

- `pnpm --filter @thinkwork/admin test -- RoutineStepConfigEditor`
- `pnpm --filter @thinkwork/api test -- recipe-catalog routine-credential-bindings`
- `pnpm --filter @thinkwork/lambda test -- routine-task-python routine-credential-resolver routine-output-redactor`
- `pnpm --filter @thinkwork/admin typecheck`
- Browser verification on the admin routine editor: add a TypeScript step, attach two credentials from dropdowns, confirm variable hints and saved args; add an HTTP step and confirm credential dropdown behavior.

## Risks And Follow-Ups

- Current AgentCore invocation serializes resolved credentials into the interpreter code prelude. That preserves the sandbox boundary but is weaker than a future non-source-context injection path; track as security hardening after this slice.
- EventBridge Connection lifecycle may still block new HTTP credentials. If not solved in this slice, leave the failure explicit and prioritize it before validating HTTP-heavy n8n workflows.
- Usage visibility is still shallow; later work should derive credential usage from published step manifests and ASL versions, not string-search visible config.
- IAM remains broader than ideal in existing Lambda/Step Functions roles. Do not widen it in this slice.
