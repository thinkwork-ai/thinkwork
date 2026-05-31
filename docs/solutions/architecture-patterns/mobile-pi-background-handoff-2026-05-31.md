# Mobile Pi Background Handoff

Date: 2026-05-31

Mobile Pi remains the default host for mobile turns. Background handoff is a
best-effort continuity path for the moment when the app stops heartbeating long
enough that iOS may have suspended or killed the local host.

## Shape

- The mobile host starts a durable `/api/mobile/turn-session` lease before model
  work. The lease is the existing `thread_turns.id`; no separate migration
  runtime exists.
- For agent-enabled new threads, mobile seeds that lease through `createThread`
  itself with `mobileTurnClientId` and `mobileTurnUserText`. That keeps thread
  creation, the visible user message, checkpoint 0, and the running turn in one
  server-side transaction before iOS can suspend the app.
- Mobile heartbeats while foregrounded and checkpoints safe transcript evidence
  as local Pi events arrive.
- App backgrounding records activity only. It does not immediately launch
  AgentCore; the same no-heartbeat stale rule applies.
- The server stall monitor scans running mobile Pi turns after the heartbeat has
  been stale for 30 seconds, claims ownership once, then dispatches managed
  AgentCore Pi with `existingThreadTurnId`.
- Mobile and AgentCore race to finalize the same logical turn. `finalized_at`
  plus the mobile ownership check ensure only one visible assistant answer is
  created.
- If the app stays foregrounded, the local harness reuses the seeded
  `clientTurnId`, and `/api/mobile/turn-session` returns the existing turn
  idempotently instead of creating a duplicate.

## Checkpoint Rules

- Checkpoint 0 is created at start and contains the original user prompt plus
  runtime identity.
- Safe checkpoints can carry text, workspace reads, web search results, MCP
  read-only evidence, file/image evidence, and bash output as transcript
  evidence.
- Unsafe checkpoints represent in-flight or mutating work. The managed runtime
  falls back to the latest safe checkpoint and records
  `mobile_pi_unsafe_checkpoint_skipped`.
- Local bash output is evidence, not proof that durable side effects should be
  replayed.

## UI Evidence

The mobile UI shows this as one turn. Regular users can see the mobile Pi
activity row, including local start, checkpoints, background grace, managed
claim, unsafe fallback, and completion or failure activity. It should not render
a failed mobile turn followed by a separate cloud turn for the same prompt.

## Operational Notes

- Expect handoff to take longer than a foreground local turn. The stale threshold
  is 30 seconds, but the v1 watchdog runs on the existing roughly one-minute
  cadence.
- The smoke harness prints `thread.id`, `thread.identifier`, and `threadTurnId`
  for every handoff row so operators can open the thread and inspect the exact
  activity sequence.
- Missing deployed credentials should skip deployed smoke with an explicit
  message. Dry-run rows exist so CI can still validate the matrix shape without
  AWS/Cognito credentials.

## What V1 Does Not Do

- It does not serialize a live Hermes process, local bash process, or mobile OS
  permission state.
- It does not replay mutating tool calls.
- It does not ask for human confirmation while the app is backgrounded.
- It does not move desktop local Pi onto this lease contract yet, although the
  vocabulary is intentionally compatible.
