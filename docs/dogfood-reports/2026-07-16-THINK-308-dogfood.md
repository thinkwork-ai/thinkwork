# THINK-308 dogfood verification — guarded finalize reconciliation + timed_out Retry

- Date: 2026-07-16
- Phase: Verification
- Target: deployed dev (`https://app.thinkwork.ai`)
- Implementation: PR #3855, squash `93faafe00`
- Deploy: GitHub Actions run 29526358146 (handoff reports success; independently rechecked before execution)
- Scope: diff-scoped U1–U3 only; four changed API files
- Verdict: **BLOCKED — no browser session is available to the verification worker**

## Executive verdict

The implementation and deploy gates are green, and the scenario matrix below was written before execution as required. Live execution cannot start: the connected browser runtime returned `No browser is available`; its required troubleshooting probe then returned an empty browser list (`[]`). This is not a product failure and no scenario was marked pass or fail.

The verification contract explicitly requires a real browser, screenshots, console/network inspection, and persisted-data correlation. Substituting API-only checks or a separate automation backend would not prove that contract. Re-dispatch verification after attaching an available in-app browser or Chrome session to the worker.

## Change and flow map

PR #3855 changes the shared chat-finalize status write and manual Retry's failed-turn evidence predicate:

1. An ordinary `queued`/`running` turn still finalizes through the guarded succeeded CAS and renders one answer.
2. A stall-monitor `timed_out` verdict racing a late natural finalize explicitly supersedes pending retry rows, checks for recovery blockers, flips to `succeeded` with the full payload and cleared timeout error, emits structured reconciliation evidence, and renders one answer.
3. A successfully finalizing retry attempt carrying `origin_turn_id` closes the origin's open retry row as `succeeded`, ending recovery state.
4. A permanently `timed_out` turn is accepted by the message Retry mutation, which redispatches a fresh linked turn without `BAD_USER_INPUT`; that fresh turn renders the answer.

The mapped user-visible ends are therefore: baseline answer delivery, reconciled late answer delivery, recovery-attempt answer delivery/queue closure, and manual Retry answer delivery. The plan's non-user-facing blocker/race branches remain covered by focused tests in the merged PR; live V1–V3 exercise every plan-required deployed flow.

## Scenario matrix (checkpoint written before execution)

| ID | Scenario | Seed / action | Functional acceptance | Experiential acceptance | Evidence planned | Functional | Experiential |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S0 | Baseline ordinary finalize | Send a freshly generated short chat turn and let it finish without DB intervention | One succeeded turn; one final answer; no error; no duplicate | Thread remains responsive and answer is readable | Browser URL + screenshot; console/network; DB turn/message rows | BLOCKED | BLOCKED |
| S1 / V1 | Stall verdict then late finalize | Start a fresh long-running turn; age `last_activity_at`; observe cron `timed_out` + pending retry; let natural finalize finish | Turn ends `succeeded`; `error`/`error_code` null; `result_json` populated; retry row `superseded`; exactly one `flipped_succeeded` log with one superseded row; one answer | No lingering failure surface, duplicate answer, or confusing transition after recovery | Browser before/after + screenshot; DB transition snapshots; CloudWatch line; console/network | BLOCKED | BLOCKED |
| S2 / V2 | Retry-attempt closure | Create a fresh timed-out origin, mark its row `dispatched`; start a fresh turn and stamp its `origin_turn_id`; let it finalize | Fresh turn succeeds and origin retry row ends `succeeded`; answer renders normally | Recovery completion presents as a normal single answer without stale recovering/error UI | Browser URL + screenshot; origin/attempt/retry DB rows; console/network | BLOCKED | BLOCKED |
| S3 / V3 | Manual Retry on timeout | Create a fresh permanently timed-out turn by aging it, wait for cron, then stamp `finalized_at`; click Retry | Failure surface offers Retry; mutation has no `BAD_USER_INPUT`; a fresh linked turn completes `succeeded`; answer remains linked to the same triggering message | Retry is discoverable and completion is understandable; current timeout copy may be logged as THINK-309-owned paper cut | Browser failure/recovery screenshots; network mutation; DB linked turns/messages; console | BLOCKED | BLOCKED |

## Execution evidence

Durable screenshots are copied to `/Users/ericodom/.thinkwork-factory/artifacts/THINK-308/` and referenced by filename below. Test IDs and timestamps will be added as each scenario completes.

### S0 — Baseline ordinary finalize

- Evidence: not executed; no browser session was available.
- Functional verdict: **BLOCKED**
- Experiential verdict: **BLOCKED**

### S1 / V1 — Stall verdict then late finalize

- Evidence: not executed; no browser session was available.
- Functional verdict: **BLOCKED**
- Experiential verdict: **BLOCKED**

### S2 / V2 — Retry-attempt closure

- Evidence: not executed; no browser session was available.
- Functional verdict: **BLOCKED**
- Experiential verdict: **BLOCKED**

### S3 / V3 — Manual Retry on timeout

- Evidence: not executed; no browser session was available.
- Functional verdict: **BLOCKED**
- Experiential verdict: **BLOCKED**

## Paper cuts

No product paper cuts observed; scenarios did not execute.

## Decisions for a human

1. Make a browser session available to the verification worker, then re-dispatch THINK-308 Verification. Recommended: attach an in-app browser session already authenticated to `https://app.thinkwork.ai`; Chrome is also acceptable if the worker is launched with that browser surface available. The next worker must resume from this matrix and execute S0–S3 with fresh output and durable screenshots.
