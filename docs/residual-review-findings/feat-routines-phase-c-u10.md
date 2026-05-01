# Residual Review Findings — feat/routines-phase-c-u10

**Plan**: docs/plans/2026-05-01-006-feat-routines-phase-c-authoring-plan.md (U10)
**Branch**: feat/routines-phase-c-u10
**Review**: self-review + always-on lenses (correctness, testing, maintainability, project-standards, agent-native, learnings, kieran-typescript)

The diff is mostly prompt-rewrite + dead-code removal. No P0/P1 findings; no autofix-able cleanups. The items below are P3 polish for downstream-resolver follow-ups.

## Residual findings

- **P3 [maintainability] `existingRoutine` typed via inline cast** — `apps/mobile/app/routines/edit.tsx:54` and `apps/mobile/app/routines/builder.tsx` cast `routineData?.routine` to a hand-written shape `{ documentationMd?: string | null; currentVersion?: number | null }` instead of importing the codegen `Routine` type from `lib/gql/graphql`. Switching to the generated type eliminates drift the next time the schema changes.

- **P3 [testing] no unit-test coverage for the prompt itself** — `apps/mobile/prompts/routine-builder.ts` is now the canonical reference for the chat agent's contract (recipe vocabulary, JSONata syntax, HITL phrase set, single-tool-call discipline). A regression test that asserts the prompt mentions specific load-bearing strings ("publishRoutineVersion", "JSONata", "inbox_approval", "Build phase") would catch silent edits that drift the contract.

- **P3 [advisory] live validator wiring is gated on chat infrastructure** — Plan U10's "live validator feedback loop" guidance lives in the prompt today, but `createSession`/`sendToSession` are stubbed (TODO migrate to GraphQL). The prompt instructs the agent to retry on validator errors; until the chat session is real, that loop doesn't fire. Not a regression — the chat infra was stubbed before this PR. Worth tracking as a Phase C follow-up before declaring U10's full verification clause met ("New routine creation flow works end-to-end on dev tenant").

- **P3 [advisory] buildStatus drop assumed the field is fully removed** — `executeUpdateRoutine({ id, buildStatus: "building" })` was deleted from edit.tsx after the type system rejected it (the `UpdateRoutineInput` GraphQL type no longer includes that field). This PR doesn't audit other surfaces that may still write to a `build_status` column or read from a `buildStatus` GraphQL field — they'd surface as TS errors elsewhere or as silent ignores. A grep across packages confirms no remaining mobile callers, but admin or backend may still reference it.

## Advisory

- **[learnings] mobile prompt rewrites are routinely silent on chat-infra dependencies** — When the chat session itself is stubbed, prompt rewrites are easy to "ship" without anyone exercising the contract. A lightweight smoke test (when chat infra lands) that runs the new prompt against a small ASL fixture and validates the output would close the loop.
