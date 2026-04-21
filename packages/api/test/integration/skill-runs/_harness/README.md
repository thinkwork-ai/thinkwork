# Integration test harness — skill-runs

Shared harness for the 8 integration tests Unit 9 deferred to Unit 8
(see `docs/solutions/best-practices/defer-integration-tests-until-shared-harness-exists-2026-04-21.md`).
Each test composes the harness into a scenario; the harness itself is
dumb — it captures calls, returns scripted responses, and never talks
to real infra.

## Pieces

| File | Role |
|------|------|
| `stub-agentcore.ts` | Recorder for `invokeComposition` envelopes. Lets tests script per-envelope outcomes (success with rendered deliverable, critical-branch failure, cancellation mid-tick). |
| `stub-agentcore-memory.ts` | In-memory `recall` / `reflect`. Seeds prior learnings; captures new learnings written by a run. |
| `stub-task-system.ts` | Holds the tasks the `act` sub-skill creates. Tracks `existing_tasks` between ticks. The reconciler-HITL loop test uses this to assert no duplicate creates. |
| `mock-graphql-client.ts` | Minimal typed client for `startSkillRun` / `cancelSkillRun` / `compositionFeedbackSummary`. Each test injects whichever GraphQL resolvers it needs. |
| `mock-db.ts` | Drizzle-shaped mock — `select/insert/update/delete` chains with per-test scripted return rows. Matches the same mock shape used across the Lambda handler tests. |

## Shape invariants the harness preserves

The tests exist to catch regressions in the runtime boundary. Any
change that makes the harness less faithful to production behavior
weakens every test that uses it. Three invariants to maintain:

1. **`skill_runs` dedup collapses identical concurrent inserts.** The
   mock-db's `onConflictDoNothing` contract returns `[]` when the
   test's scripted state says "same hash already in `running`." Tests
   rely on this for dedup assertions.
2. **`invokeComposition` is RequestResponse.** The harness's stub
   resolves synchronously so an error in the invoke path surfaces
   back to `startSkillRun` and the run row transitions to `failed`.
3. **`compound.recall` sees only the learnings the stub was seeded
   with before the run.** Reflections from the same run do NOT feed
   back into recall — that's a next-run effect and the
   learnings-roundtrip test exercises it across two runs explicitly.

If a test needs to break one of these invariants it should be
rewritten instead. Do not parameterize the invariants into knobs.
