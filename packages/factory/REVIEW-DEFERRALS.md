# Factory daemon — review findings deferred to U6/U7

The 2026-07-12 multi-agent code review (10 reviewers + Codex cross-model pass) on the U2–U5
walking skeleton surfaced several findings that are **already the explicit scope of U6/U7**, not
U5 bugs. They are recorded here so the sweep/reconciler work inherits them as acceptance criteria
rather than being re-discovered. Everything that undermined the M1 tracer or was a cheap
correctness/security win was fixed in the review commits.

## Deferred to U6 (no-orphan sweep: leases, stall/quota, recovery, nags, mutex)

- **QuotaCooldown is a terminal state but nothing waits on it** (attempts.ts / engine.ts).
  adversarial P1 c100 + Codex P1 c100 (cross-model agreement). The runner now correctly avoids
  *misclassifying* healthy runs as rate-limited (fixed in review), but once an attempt legitimately
  enters QuotaCooldown, the engine has no cooldown clock, so the next tick relaunches immediately —
  a 30s retry hammer against a throttling provider. U6 must surface the most-recent terminal
  attempt state + ended_at in StoreView and have decideAction return `wait` while the latest attempt
  is QuotaCooldown within a configurable cooldown window (this is exactly AE8 / R14).

- **No attempt ceiling — a permanently-failing launch relaunches every 30s with comment spam**
  (executor.ts / engine.ts). adversarial P1 c100. engine relaunches from status alone with no
  attempt count anywhere. U6 must add a per-issue+phase attempt ceiling (plan says: 2nd consecutive
  kill on the same phase escalates instead of a third launch — R15/AE5) sourced from
  MAX(attempt_number); decideAction blocks with Needs User / escalates when exceeded. Also move the
  launch-marker comment post to AFTER the bootstrap gate succeeds so a refused bootstrap doesn't spam.

- **Stall / silence-budget enforcement** — `wallClockSlaMinutes` is now wired into the result wait
  (fixed), but `silenceBudgetMinutes` and full stall detection (log-mtime silence past budget →
  Stalled → kill → relaunch) are U6 (R14/AE5). Date.now()-based deadlines must accumulate only
  observed-reachable time (R11) and survive host sleep/wake.

## Deferred to U7 (launchd packaging, reconciliation, watchdog)

- **Daemon death mid-attempt strands an issue in permanent wait** (daemon.ts:109).
  adversarial P1 c75 + correctness residual. A crash-orphaned attempt row (PreparingWorkspace, or
  Running with a now-dead pid) is treated as active forever; no reconciler ships before U7. U7's
  boot + periodic reconciler must, for each active attempt with a null/dead pid, run
  detectPhaseEvidence → Succeeded on evidence else Failed('orphaned by daemon restart'). This is
  F4 / AE6 and the Symphony `launch-recording-failed` repair.

## Residual risks (need design, not a mechanical fix — revisit before scale-up)

- **Concurrent Linear label edits are silently clobbered** (client.ts addLabel/removeLabel are
  read-modify-write over the full labelId set). Codex P2 c75 + adversarial residual. Single-writer
  daemon means the only racer is a human editing labels mid-tick; low probability. Linear has no
  atomic single-label add, so a real fix needs a re-read-and-retry or a diff-based update. Acceptable
  for the 2-host personal setup; note for any multi-writer future.

- **KTD-5 scrub is env-deep only; the worker runs same-UID with HOME passed through** so
  `~/.thinkwork-factory/` (plaintext config) and `~/.ssh` remain filesystem-readable to a worker.
  security P2 c75. Partially mitigated: `factoryd doctor` should refuse a group/other-readable
  config.json (add the perm check). True isolation (dedicated OS user or Keychain) is a scale-up
  item flagged in the plan's own risk section.

- **Prompt/argv exposure**: worker prompt passed as `-p <prompt>` is visible in `ps` and logged
  wholesale under `<stateDir>/logs`. Personal-automation acceptable; note before multi-tenant.

- **Legacy dispatcher SKILL.md files still teach the free-prose ledger convention** — a worker
  reading the OLD skill could clobber the fence. Mitigated for now by the newest-wins + first-line
  marker fix (daemon ledger always wins). The docs are retired in U11.

## Poll cost (found during first live wiring, 2026-07-12) — U6

- `listTeamIssues` drains the ENTIRE team, then N+1s `issue.state` + `issue.labels()`
  per issue (~2 extra round trips each). On the real ThinkWork team (~245 issues) a full
  unscoped poll takes 60s+ — unusable at the 30s cadence. Two fixes owed in U6:
  1. Server-side filter the issues query by lane-label + active-state (and Verification) so
     only candidate issues are returned, not the whole board.
  2. Include `state` + `labels` inline in that query (a raw GraphQL selection) to kill the
     N+1 — one request per page instead of ~2N.
  Also: only Done issues the daemon actually ENROLLED (present in its store) should be polled
  for compounding, rather than every historical Done issue — the compound cutoff (synthesized-
  ledger guard) already prevents mass-dispatch, but the daemon still pays to fetch them.
- The tracer / `--issue` scope sidesteps this by fetching named issues directly
  (`getIssuesByIdentifier`), so a scoped run is ~100ms. Unscoped production runs need the above.

## Testing gaps carried forward
- HostUnreachable transitions (U6/U10 scope) — no tests yet (expected).
- Concurrent-daemon / racing-begin() against the unique-active index — add when multi-host lands (U10).
