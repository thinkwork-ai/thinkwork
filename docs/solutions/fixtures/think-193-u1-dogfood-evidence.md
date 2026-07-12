# THINK-193 U1 dogfood evidence — deployed dev, 2026-07-11

Real authorized Twenty CRM data processed into the shared Tenant Bank through
canonical Workflow executions on the deployed dev stack (account
487219502366). Companion fixture: `think-193-u1-twenty-dossier-fixture.json`
(synthetic probe company only — no customer records). Inspector:
`packages/api/scripts/memory-sources/inspect-run.ts`.

## Identifiers

| Thing | Value |
| --- | --- |
| Tenant | `0015953e-aa13-4cab-8398-2e70f73dda63` (sleek-squirrel-230) |
| Processor config | `0eb1c5c1-4acf-4bd1-b404-304b071d660e` (shared/tenant) |
| Source config | `44a5684b-f236-4f87-8336-6373c2e926da` (twenty) |
| Workflow | `c842fd57-41f1-456f-90c5-7ea6f5d4c40d` "Memory: Twenty proving slice (U1)" |
| Target bank | `tenant_0015953e-aa13-4cab-8398-2e70f73dda63` |
| Worker Lambda | `thinkwork-dev-api-memory-stage-worker` (deploy run 29175254162) |
| Probe company (Twenty) | `6bb03870-cd00-44ba-b945-b11001e2ca68` "Acme Probe (THINK-193 U1)" |

## Runs (workflow_runs; all `succeeded`, all four memory_stage tokens consumed per run)

1. **Bootstrap** `2e3a84a7-e5dc-4cf3-a4e8-8f6488fae0bd` — acquire changed=5,
   project 5, retain 5 (five active derivations with stable
   `external:<sourceConfigId>:company:<twentyId>` document ids), compound →
   `brain_dream_runs` `c999201c…` applied {consolidate: 1}. Checkpoint
   `companies` v1. Recall: "Acme Probe is a company with 42 employees."
2. **Replay** `8219e6b4-23b2-4974-a370-3952006443f4` — visible no-op:
   acquire changed=0/seen=0, project/retain noop, compound applied. No
   duplicate evidence rows or Hindsight documents.
3. **Change** `40134eb9-8e65-4cc6-9b5d-634864f3aabd` — after PATCHing the
   probe company employees 42→77: acquire changed=1 (only the changed
   record), old evidence version marked `superseded`, ONE active derivation
   updated in place (same document id, new source version), checkpoint CAS →
   v2, dream `328de5ab…` applied. Recall: "Acme Probe is a company with 77
   employees, identified as THINK-193 U1." — the replaced dossier, not an
   appended duplicate.

## Scenario coverage

- Bootstrap / replay / change: live above.
- Nil/empty: run 2 is the zero-changed-records visible no-op.
- Scope: worker rejects `user_*`/personal processors (unit-tested R11/AE7
  guard; shared-scope check runs before any source read or bank write).
- Error: 5xx retain surfaces retryable failure before checkpoint advance
  (contract test); acquire checkpoint advances only in the evidence-page
  transaction.
- Contract: Hindsight 0.8.4 replace/delete/orphan probe recorded in
  `docs/solutions/tooling-decisions/hindsight-084-document-lifecycle-probe-2026-07-11.md`.

## Fixture shape note for U2

The committed fixture is the synthetic probe company, whose depth-1 relations
(people/opportunities/notes) are empty. Real dev companies carried the same
envelope with `domainName`, `address`, `annualRecurringRevenue` composites;
U2's claim fingerprint/effective-date review should also exercise a
relation-bearing snapshot (re-run the inspector against a real company id in
dev — not committed here to keep customer data out of the repo).
