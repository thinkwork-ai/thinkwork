---
date: 2026-05-04
topic: tenant-credential-vault-n8n-routine-migration
---

# Tenant Credential Vault and n8n Routine Migration

## Problem Frame

ThinkWork Routines are becoming the durable replacement for complex n8n workflows, but n8n's execution model assumes workflow nodes can access stored credentials at runtime. ThinkWork cannot safely migrate those workflows until tenant-owned credentials are first-class platform objects that routines and agents can reference without embedding secrets in routine definitions, generated ASL, logs, or code editor buffers.

The migration path should start with tenant-shared service credentials, then convert one n8n workflow at a time into Step Functions-backed routines. Custom n8n nodes and code nodes should not become a large cloned node library. They should become editable code steps, with TypeScript added beside the existing Python escape hatch so operators and engineers can preserve domain-specific behavior while ThinkWork learns which patterns deserve first-class recipes later.

---

## Actors

- A1. Tenant operator: Creates, rotates, revokes, and audits tenant-shared service credentials.
- A2. Routine author or migration operator: Converts n8n workflows into ThinkWork routines and edits migrated steps.
- A3. Routine runtime: Executes Step Functions-backed routines and resolves credential references only when allowed.
- A4. Agent runtime: Uses approved tenant-shared credentials when creating, invoking, or maintaining routines on behalf of the tenant.
- A5. ThinkWork engineer: Adds migration recipes and promotes repeated code patterns into first-class routine steps over time.

---

## Key Flows

- F1. Tenant-shared credential setup
  - **Trigger:** A tenant operator needs a service credential for a routine, such as PDI, FleetIO, Samsara, LastMile, or a webhook signing secret.
  - **Actors:** A1, A3, A4
  - **Steps:** The operator creates a credential, selects a supported credential shape, enters secret values, assigns a clear display name and intended use, and saves it to the tenant vault. ThinkWork stores only references in routine definitions and exposes non-secret metadata for selection.
  - **Outcome:** Routines and authorized agents can reference the credential by handle; raw secret values are never visible in routine ASL, logs, step config, or generated code.
  - **Covered by:** R1, R2, R3, R4, R8

- F2. One-workflow n8n migration
  - **Trigger:** A routine author chooses one n8n workflow to replace, starting with `PDI Fuel Order`.
  - **Actors:** A2, A3, A5
  - **Steps:** The workflow graph is inspected, supported built-in nodes map to routine recipes, custom n8n nodes and code nodes map to TypeScript or Python code steps, missing credentials are surfaced as setup tasks, and the resulting routine can be tested against representative payloads before activation.
  - **Outcome:** The migrated routine preserves the workflow's runtime contract while becoming observable in ThinkWork.
  - **Covered by:** R5, R6, R7, R10, R11, R12

- F3. Credentialed routine execution
  - **Trigger:** A webhook, schedule, manual test, or agent invocation starts a routine that references tenant credentials.
  - **Actors:** A3, A4
  - **Steps:** The runtime starts a Step Functions execution, resolves credential handles for the current tenant, injects secrets only into the step wrapper or sandbox boundary that needs them, records step status and non-secret output, and redacts accidental secret-like values from logs and previews.
  - **Outcome:** The routine can call external systems without exposing credentials and with enough traceability to debug failures.
  - **Covered by:** R3, R4, R8, R9, R13, R14

---

## Requirements

**Tenant credential vault**
- R1. ThinkWork must support tenant-shared service credentials as the v1 credential scope for routines and agents.
- R2. Tenant credentials must support common service-auth shapes needed by n8n migrations, including API key/header tokens, bearer tokens, basic auth username/password, SOAP-style username/password/partner fields, webhook signing secrets, and arbitrary JSON for uncommon services.
- R3. Routine definitions, routine versions, ASL JSON, visible step config, and code editor buffers must store credential references or variable names, not raw secret values.
- R4. Tenant operators must be able to create, inspect non-secret metadata, rotate, disable, and delete tenant-shared credentials from an operator-facing surface.
- R5. Per-user delegated credentials are explicitly deferred; v1 must not attempt "run as user" OAuth semantics.

**Routine code steps**
- R6. Routines must add a TypeScript code step as a peer to the existing Python code step.
- R7. TypeScript and Python code steps must be first-class routine recipes with editable source, timeout controls, network access policy, environment/credential bindings, captured stdout/stderr previews, and Step Functions step status.
- R8. Code steps must receive credentials through declared bindings, not by copying secret values into code.
- R9. Code-step logs, outputs, errors, and persisted previews must avoid exposing secret values.
- R10. The admin routine editor should reuse the existing CodeMirror-based editing pattern for code-backed step config, with language-appropriate highlighting and validation/lint feedback where practical.

**n8n migration model**
- R11. ThinkWork should migrate workflows vertically, one workflow at a time, rather than attempting an up-front clone of the full custom n8n node catalog.
- R12. Built-in n8n nodes should map to existing or newly added first-class routine recipes only when the mapping is stable and reusable.
- R13. Custom n8n nodes and n8n code nodes should initially map to TypeScript or Python code steps, preserving behavior while avoiding custom-node sprawl.
- R14. The migration workflow must surface missing credential mappings before a routine can be tested or activated.
- R15. The first migration target is the n8n `PDI Fuel Order` workflow: POST webhook -> LastMile transform -> PDI add fuel order -> webhook response.

**Execution and observability**
- R16. Credentialed routine runs must remain visible in ThinkWork's routine execution UI, including step status, step timing, non-secret inputs/outputs, and failure messages.
- R17. A migrated webhook routine must preserve the caller-facing response contract of the original n8n webhook where that workflow expects a synchronous response.
- R18. Repeated code-step patterns should be observable enough for ThinkWork engineers to identify candidates for future first-class recipes.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R4.** Given a tenant operator creates a PDI credential with API URL, username, password, and partner ID, when a routine step references that credential, the routine version stores only the credential handle and non-secret label.
- AE2. **Covers R6, R7, R8, R9.** Given a TypeScript step needs a PDI credential, when it runs, the wrapper resolves the bound credential for the current tenant and exposes it only through the declared runtime binding; stdout and step events do not contain raw secret values.
- AE3. **Covers R11, R12, R13, R14, R15.** Given the n8n `PDI Fuel Order` workflow is selected for migration, when the importer or migration operator maps the graph, the webhook and response nodes map to routine/webhook behavior, the LastMile transform and PDI SOAP node become code steps unless a stable recipe already exists, and missing LastMile/PDI credential bindings block activation with actionable setup guidance.
- AE4. **Covers R16, R17.** Given a migrated `PDI Fuel Order` routine receives a POST payload, when the PDI call succeeds, the caller receives the expected response and the ThinkWork execution detail shows each step without exposing credentials.
- AE5. **Covers R18.** Given several migrated workflows contain nearly identical PDI SOAP submission code, when engineers inspect code-step usage, the repeated pattern is visible as a candidate for a future `pdi_add_fuel_order` recipe.

---

## Success Criteria

- n8n replacement work can begin without hand-placing secrets in code, ASL, Lambda env vars, or workflow config.
- A tenant operator can understand which service credentials exist, whether they are active, and which routines are expected to use them.
- The `PDI Fuel Order` workflow can be migrated as the first vertical slice without creating permanent custom node clones for LastMile or PDI.
- Planning can split the work into a credential-foundation phase, a TypeScript-code-step phase, and a first-workflow migration phase without inventing product scope.

---

## Scope Boundaries

- V1 is tenant-shared credentials only; per-user OAuth credentials and "run as user" semantics are deferred.
- V1 does not recreate the full n8n custom node catalog in ThinkWork.
- V1 does not require a general-purpose fully automated n8n importer before migrating the first workflow.
- V1 does not expose raw ASL editing as the primary migration surface.
- V1 does not promise browser-based secret reveal after save.
- V1 does not make customer-authored first-class recipes; repeated code patterns are promoted through ThinkWork engineering review.
- V1 does not solve cross-tenant credential sharing, credential marketplace distribution, or per-environment secret promotion.

---

## Key Decisions

- Credential vault first: Credential handling is the foundation for integrations, routines, and agents, so it precedes workflow migration.
- Tenant-shared first: n8n replacement needs unattended service credentials; per-user OAuth belongs in a later version modeled after existing MCP OAuth flows.
- Vertical migration: Convert one workflow at a time and let real migrations reveal which recipes are worth promoting.
- Code steps over custom-node cloning: Custom n8n nodes and code nodes should become editable TypeScript/Python steps unless their behavior proves broadly reusable.
- TypeScript beside Python: TypeScript is the lowest-friction bridge for n8n custom nodes because the source behavior is already TypeScript.

---

## Dependencies / Assumptions

- ThinkWork already has Step Functions-backed routine execution, routine versioning, recipe metadata, and a Python escape-hatch recipe.
- ThinkWork admin already uses CodeMirror in other editing surfaces, so routine code-step editing should reuse that product pattern.
- Existing per-user OAuth and MCP credential work remains separate from tenant-shared routine credentials.
- The referenced n8n `PDI Fuel Order` workflow was inspected in the n8n database and has four nodes: webhook, LastMile transform, PDI add fuel order, and webhook response.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1-R4][Technical] Decide the storage model and metadata shape for tenant-shared credentials, including whether to extend existing integration tables or create a dedicated routine credential vault.
- [Affects R4][Technical] Decide which admin route owns tenant-shared credential management and how routine usage is displayed.
- [Affects R6-R10][Technical] Decide the TypeScript execution substrate, sandbox boundary, dependency policy, timeout behavior, and whether type/lint feedback runs client-side, server-side, or both.
- [Affects R8-R9][Technical] Decide the exact credential binding API exposed to code steps.
- [Affects R11-R15][Technical] Decide whether the first n8n migration is manual-assisted, import-from-JSON, or a thin workflow-inspection tool that emits a draft routine plus TODOs.
- [Affects R17][Technical] Validate Step Functions/webhook response constraints for synchronous migrated webhook workflows.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
