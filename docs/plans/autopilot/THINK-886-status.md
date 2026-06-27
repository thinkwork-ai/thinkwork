# THINK-886 / THINK-86 Autopilot Status

## Scope Correction

- Requested Linear issue: `THINK-886`
- Linear lookup result: no issue with identifier `THINK-886` exists.
- Active implementation issue: `THINK-86`, "Open Engine Native: Work Item queue discipline"
- Reason: the provided plan and Linear document both describe the Open Engine Work Item queue validation work under `THINK-86`.

## Current Direction

We are pursuing **Open Engine Native On Work Items**. The main risk being validated is whether ThinkWork can own the queue substrate directly instead of requiring Linear as the foundation for Work Items. Linear remains a comparison target and interoperability option, but not the default source of truth for this validation.

## Implementation Units

1. U1: Add Open Engine queue state to native Work Items.
2. U2: Implement queue eligibility and atomic claim service.
3. U3: Add Open Engine receipt semantics.
4. U4: Expose minimal internal API contract.
5. U5: Add thin runner smoke.
6. U6: Produce native-vs-Linear verdict artifact.

## U1 Status

- Status: merged
- Branch: `codex/think-86-u1-open-engine-queue`
- Worktree: `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/think-86-u1-open-engine-queue`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/3025
- Merge commit: `a9e2733d0207580d958a07df406e0725a659d3d9`
- Decision: persist queue state directly on `work_items` so U2 can claim work with one conditional update against the Work Item row.

## U1 Validation Targets

- Open Engine-enabled Work Items can store queue key and routing metadata.
- Claim ownership and expiry are persisted but do not require a claim API yet.
- Human hold is independent from generic `blocked`.
- Dependency state is constrained to `ready` or `waiting`.
- Eligibility and claim indexes exist for the U2 atomic claim service.
- Manual migration drift markers cover all new columns, indexes, and constraints.

## U1 Verification

- `pnpm schema:build`
- `pnpm --filter thinkwork-cli codegen`
- `pnpm --filter @thinkwork/web codegen`
- `pnpm --filter @thinkwork/mobile codegen`
- `pnpm --filter @thinkwork/database-pg test -- __tests__/work-items-schema.test.ts`
- `pnpm --filter @thinkwork/database-pg typecheck`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter thinkwork-cli typecheck`
- `pnpm --filter @thinkwork/web typecheck`
- `bash scripts/db-migrate-manual.sh --dry-run packages/database-pg/drizzle/0191_open_engine_work_item_queue.sql`

Note: `@thinkwork/mobile` has no `typecheck` script in this checkout.

## U2 Status

- Status: merged
- Branch: `codex/think-86-u2-queue-claim`
- Worktree: `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/think-86-u2-queue-claim`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/3027
- Merge commit: `77f0c520fe17377a7eebed67187b095f33e181f5`
- Goal: add the internal queue eligibility and atomic claim service on top of U1 row-level queue state.

## U2 Validation Targets

- Eligibility excludes archived, completed, blocked, inapplicable, human-held, dependency-waiting, future-scheduled, and unexpired-claimed rows.
- Expired or malformed claims can be reclaimed.
- Claiming one item is a single conditional update with `FOR UPDATE SKIP LOCKED`.
- Claim lease timestamps are persisted atomically with the agent claim owner.
- No user-facing GraphQL mutation is added before U4.

## U2 Verification

- `pnpm --filter @thinkwork/api test -- src/lib/work-items/open-engine-queue-service.test.ts`
- `pnpm --filter @thinkwork/api typecheck`

## U3 Status

- Status: merged
- Branch: `codex/think-86-u3-open-engine-receipts`
- Worktree: `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/think-86-u3-open-engine-receipts`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/3028
- Merge commit: `bdbfb9e0fd2daad66627a4e940b1a44436214fae`
- Goal: add durable Open Engine receipt semantics on Work Item events.

## U3 Validation Targets

- Receipts are stored as Work Item `agent_action` events with Open Engine metadata.
- Blocked receipts create a human hold, preserve the blocker reason, and release the claim.
- Resumed receipts clear human hold state.
- Failed/completed receipts release the claim.
- Progress receipts record evidence without changing hold or claim state.

## U3 Verification

- `pnpm --filter @thinkwork/api test -- src/lib/work-items/open-engine-receipt-service.test.ts`
- `pnpm --filter @thinkwork/api typecheck`

## U4 Status

- Status: merged
- Branch: `codex/think-86-u4-open-engine-api`
- Worktree: `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/think-86-u4-open-engine-api`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/3030
- Merge commit: `164d9fcb65957f7c33010f81e1c24a09b0b244f4`
- Goal: expose a minimal GraphQL contract for Open Engine queue list, claim, and receipt operations.

## U4 Validation Targets

- Agents can query eligible Open Engine Work Items by queue key.
- Agents can claim at most one eligible Work Item through the atomic claim service.
- Agents can record Open Engine receipts with evidence metadata.
- GraphQL contract remains narrow and does not add a human UI surface.

## U4 Verification

- `pnpm schema:build`
- `pnpm --filter thinkwork-cli codegen`
- `pnpm --filter @thinkwork/web codegen`
- `pnpm --filter @thinkwork/mobile codegen`
- `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/work-items/openEngine.resolver.test.ts`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter thinkwork-cli typecheck`
- `pnpm --filter @thinkwork/web typecheck`

## U4 Review Notes

- Local structured review found that the initial GraphQL queue resolvers were tenant-scoped but not admin/service-gated like other internal automation surfaces.
- Fix applied before PR: `openEngineEligibleWorkItems`, `claimNextOpenEngineWorkItem`, and `recordOpenEngineWorkItemReceipt` now require `requireAdminOrServiceCaller` with operation-specific allowlist names, and resolver tests cover the rejection path before claim.

## U5 Status

- Status: merged
- Branch: `codex/think-86-u5-open-engine-runner-smoke`
- Worktree: `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/think-86-u5-open-engine-runner-smoke`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/3032
- Merge commit: `98cb0ceb2e5900b380017e5bf7c4e7b00c07c898`
- Goal: prove the Open Engine queue contract can be consumed by the existing AgentLoop dispatch ledger by claiming one Work Item and enqueueing exactly one runner action.

## U5 Validation Targets

- One eligible Work Item results in one claim, one claimed receipt, and one AgentLoop wakeup with Work Item context.
- No eligible Work Item results in no claim and no wakeup.
- Human-held or otherwise ineligible Work Items are not re-enqueued by a second runner scan.
- Dispatch failure records a failed receipt so the claim is released visibly.
- Dispatch idempotency prevents duplicate wakeups for the same Work Item claim.

## U5 Verification

- `pnpm --filter @thinkwork/api test -- src/lib/work-items/open-engine-runner.test.ts`
- `pnpm --filter @thinkwork/agent-loops-core test -- src/dispatcher.test.ts`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/agent-loops-core typecheck`

## U5 Review Notes

- Local structured review found that adding a new AgentLoop trigger family would violate the existing database check constraint on `agent_loop_runs.trigger_family`.
- Fix applied before PR: U5 uses the existing `api` trigger family with `triggerSource: "open_engine_queue"` and carries Open Engine identity in the run/wakeup input summary, avoiding a schema/migration expansion in the runner-smoke slice.

## U6 Status

- Status: in progress
- Branch: `codex/think-86-u6-open-engine-verdict`
- Worktree: `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/think-86-u6-open-engine-verdict`
- Goal: publish the native-vs-Linear verdict artifact and leave implementation-ready follow-up issues for the chosen path.

## U6 Validation Targets

- Verdict artifact explicitly answers whether native Work Items or Linear should be the Open Engine queue foundation.
- Verdict is backed by U1-U5 evidence instead of a product preference alone.
- Linear remains positioned as benchmark, adapter, and fallback rather than the default source of truth.
- Follow-up issues exist for the next work needed to make native Work Items usable by agents and humans.

## U6 Verdict

- Result: native Work Items pass with gaps.
- Decision: Work Items should be the Open Engine queue foundation for ThinkWork.
- Linear role: optional adapter and benchmark, not required substrate.
- Artifact: `docs/verification/open-engine-native-work-items-validation.md`
- Follow-up issues:
  - THINK-89: Open Engine Native: ThinkWork MCP queue tools.
  - THINK-90: Open Engine Native: human blocker and receipt surface.
  - THINK-91: Open Engine Native: queue operations hardening and observability.
