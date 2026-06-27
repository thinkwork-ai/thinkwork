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

- Status: verified locally
- Branch: `codex/think-86-u1-open-engine-queue`
- Worktree: `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/think-86-u1-open-engine-queue`
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
