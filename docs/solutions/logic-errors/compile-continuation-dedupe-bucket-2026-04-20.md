---
title: "Compile continuation chain dies silently when the next dedupe bucket is recomputed from wall-clock or created_at"
date: "2026-04-20"
category: "logic-errors"
module: "packages/api/src/lib/wiki"
problem_type: "logic_error"
component: "background_job"
severity: "high"
symptoms:
  - "Bootstrap-scale compile chain stops mid-run; page count plateaus with no error logged"
  - "Continuation enqueue returns inserted=false via ON CONFLICT DO NOTHING, so failure is invisible to metrics"
  - "Chain advances on some steps but not others depending on runtime vs 5-minute bucket boundary"
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - database
  - tooling
tags:
  - wiki-compile
  - dedupe-key
  - continuation-chain
  - bucket-math
  - silent-failure
  - on-conflict-do-nothing
  - drizzle
  - postgres
---

# Compile continuation chain dies silently when the next dedupe bucket is recomputed from wall-clock or created_at

## Problem

Bootstrap-scale compile jobs (Marco rebuild, large Hindsight imports) exit early on any `cap_hit` without draining their cursor. To self-complete, `runCompileJob` enqueues a follow-up job into the NEXT 5-minute dedupe bucket, inheriting the parent's trigger. The continuation chain broke silently after 1–6 hops: `ON CONFLICT DO NOTHING` on the `wiki_compile_jobs.dedupe_key` unique index swallowed bucket-collision inserts, returning `inserted=false`. No metric incremented, no warning logged, no job status flipped. The bootstrap simply stopped producing pages.

## Symptoms

- Marco rebuild stopped producing pages after ~25 pages per job; only 1–5 jobs ran per chain before halting.
- All jobs reported `status='succeeded'`. No errors in CloudWatch logs.
- `metrics.continuation_enqueued` was `1` on some chain steps and absent on others — the absent ones were the silent collisions.
- Admin wiki page list UI froze at the exact `cap_hit` timestamp; no more pages appeared even though the cursor still had records queued.

## What Didn't Work

**Attempt 1 — PR #294: wall-clock `Date.now()`**

```ts
// BEFORE
const nextBucketSeconds =
  Math.floor(Date.now() / 1000) + CONTINUATION_BUCKET_OFFSET_SECONDS; // 300s
```

Why it failed: `Date.now()` at `completeCompileJob` time drifts inside the 5-minute bucket. When a chained job ran longer than ~100s, `floor((now + 300) / 300)` rounded into the bucket the child was itself occupying. Chain hopped 1→2 then died at step 2.

**Attempt 2 — PR #296: `job.created_at + 300s`**

```ts
// BEFORE
const jobCreatedEpoch = Math.floor(job.created_at.valueOf() / 1000);
const nextBucketSeconds = jobCreatedEpoch + 300;
```

Why it failed: `dedupe_key`'s bucket is stamped at **enqueue** time by the parent (via `nowEpochSeconds` override pointing at a future bucket). `created_at` is stamped by Postgres `default now()` at **insert** time — always an entire bucket behind the future one encoded in `dedupe_key`. `created_at + 300` then landed back in the child's own bucket.

Concrete case from dev (job `c1dcf644`):

| Field | Value | Bucket |
|---|---|---|
| `dedupe_key` | `...:5922342` | **5922342** (stamped by parent at 16:30:00 UTC) |
| `created_at` | 16:26:50 UTC | 5922341 (stamped by Postgres on INSERT) |
| `created_at + 300s` | — | **5922342** ← same bucket c1dcf644 itself occupies |

Chain hopped 4→5→6 then died at step 6.

**Shared failure mode (both attempts):** `onConflictDoNothing()` + `.returning()` returns `[]`, `inserted=false`, the caller's `if (inserted)` guard skips the metric bump and the `invokeWikiCompile` call. No exception, no warning, no metric. The only visible symptom was "pages stopped appearing."

## Solution — PR #299

Extract the bucket directly from the authoritative source: the parent's `dedupe_key` itself.

```ts
// AFTER — packages/api/src/lib/wiki/repository.ts
export const DEDUPE_BUCKET_SECONDS = 300;

/**
 * Parse the bucket number out of a compile dedupe_key.
 *
 * BUCKET = SOURCE OF TRUTH. The dedupe_key encodes the canonical bucket
 * the job belongs to, set at enqueue time by the parent. Never derive the
 * "next" bucket from `created_at` or `Date.now()` — both drift relative
 * to the key.
 *
 * Format: `{tenant}:{owner}:{bucket}`. Returns null for non-standard keys
 * (e.g. manually-seeded bootstrap one-shots like `marco-rebuild-<ts>`).
 */
export function parseCompileDedupeBucket(
  dedupeKey: string,
): number | null {
  const parts = dedupeKey.split(":");
  if (parts.length !== 3) return null;
  const bucket = Number(parts[2]);
  return Number.isInteger(bucket) ? bucket : null;
}
```

```ts
// AFTER — packages/api/src/lib/wiki/compiler.ts (continuation block)
// Wrapped in a try/catch that logs to console.warn on shipped code;
// omitted here for brevity — failures in the continuation path must
// never fail the parent job.
if (!cursorDrained) {
  const parentBucket =
    parseCompileDedupeBucket(job.dedupe_key) ??
    Math.floor(
      job.created_at.valueOf() / 1000 / DEDUPE_BUCKET_SECONDS,
    );
  const nextBucketSeconds = (parentBucket + 1) * DEDUPE_BUCKET_SECONDS;
  const { inserted, job: chained } = await enqueueCompileJob({
    tenantId: job.tenant_id,
    ownerId: job.owner_id,
    trigger: job.trigger,
    nowEpochSeconds: nextBucketSeconds,
  });
  if (inserted) {
    await invokeWikiCompile(chained.id).catch((err) => {
      console.warn(
        `[wiki-compiler] continuation invoke failed: ${(err as Error).message}`,
      );
    });
    metrics.continuation_enqueued =
      (metrics.continuation_enqueued ?? 0) + 1;
  }
}
```

Marco rebuild then chained 8 hops cleanly, breaking only on unrelated Bedrock JSON-parsing flakes.

## Why This Works

1. The bucket number in `dedupe_key` is **the same value the unique index enforces**. Incrementing it guarantees a distinct key — by construction, not by clock hope.
2. `(parentBucket + 1) * DEDUPE_BUCKET_SECONDS` produces a bucket-aligned epoch, keeping the encode/decode pair in lockstep with the index key space.
3. The fallback to `created_at` preserves correctness for manually-seeded keys that don't follow the `{tenant}:{owner}:{bucket}` format — operators can still trigger bootstrap jobs with human-readable dedupe keys and continuation still works.

This fix is a natural corollary of a decision made during the April 15 PRD redline (session history): `dedupe_key` was chosen as an explicit `text NOT NULL` column — instead of a composite unique index on nullable columns — **specifically so it would be the authoritative source of truth**. The three PRs it took to get the continuation math right were three missteps in re-deriving what was already encoded in the key. (session history)

## Prevention

**1. Bucket = source of truth — documented in JSDoc.**

Any "next bucket" math MUST parse the parent's `dedupe_key`. `Date.now()` and `created_at` drift relative to the key; never derive continuation scheduling from a clock. The JSDoc on `parseCompileDedupeBucket` (above) states this rule explicitly so future readers of the code inherit it.

**2. Log silent dedupe collisions.**

The silent-failure half of this bug is independent of the math half — even with correct math, a future edge case could still conflict against an unrelated job in the same bucket. Make collisions visible without needing a metric breadcrumb:

```ts
// Inside enqueueCompileJob, after the insert returns inserted=false.
// Identifiers bound from the function's `args` on shipped code.
if (!inserted) {
  console.warn("[wiki-enqueue] dedupe collision", {
    dedupe_key: dedupeKey,
    tenant_id: args.tenantId,
    owner_id: args.ownerId,
    trigger: args.trigger,
  });
}
```

Both Attempts 1 and 2 would have surfaced on the first Marco rebuild had this log existed, instead of after three PR iterations.

**3. Round-trip invariant tests for encode/decode pairs.**

Whenever two functions encode and decode the same structured string (dedupe keys, cache keys, S3 paths, ARNs), the `build → parse → compare` test is cheaper than the debugging session that proves you need it:

```ts
it("parseCompileDedupeBucket round-trips with buildCompileDedupeKey", () => {
  const bucket = 5922342;
  const key = buildCompileDedupeKey({
    tenantId: "t",
    ownerId: "o",
    nowEpochSeconds: bucket * DEDUPE_BUCKET_SECONDS,
  });
  expect(parseCompileDedupeBucket(key)).toBe(bucket);
});
```

**4. Diagnostic output that looks asymmetric *is* the bug signature.**

Three chain hops showing `continuation_enqueued=1`, two showing the metric absent, is not "noise in metrics pipeline" — it is a direct signal that the enqueue code path disagrees with itself. Query the conflicting columns on a SINGLE failing row before theorising. Comparing `dedupe_key` and `created_at` on job `c1dcf644` surfaced the bucket mismatch in one SQL query. Matches the repo's standing "read diagnostic logs literally" + "verify wire format empirically" conventions. (auto memory [claude])

**5. Related operational guardrail — async Lambda retries.**

Prior session history (April 19 bootstrap work) hit an adjacent "action was supposed to happen once but happened multiple times silently" class: invoking a bootstrap Lambda with `--invocation-type Event` caused AWS to retry twice after the 15-minute timeout, double-ingesting Amy's journal into Marco's Hindsight bank. Whenever a Lambda is invoked fire-and-forget from a compile-adjacent path, set `--maximum-retry-attempts 0` at the invoke site. The continuation-chain code uses `InvocationType: "Event"` and relies on job-row idempotency (`dedupe_key` unique index) for the single-execution invariant, but operators kicking one-shot bootstraps from the CLI should pass the retry flag. (session history)

## Related Issues

- **PR #294** feat(wiki): compile ops readiness — Units 3b, 3c, 9, 10 — introduced continuation chaining.
- **PR #295** fix(wiki): continuation chains on any early loop exit, not just records cap — clarified the trigger condition (superseded by #296).
- **PR #296** fix(wiki): anchor continuation bucket on `job.created_at`, not wall-clock — superseded by #299.
- **PR #299** fix(wiki): continuation bucket = `parent.dedupe_bucket + 1`, not `created_at + 300` — the final fix; introduces `parseCompileDedupeBucket`.

Adjacent dedupe work that does **not** overlap with this problem:

- PR #288 — trigram-fuzzy alias dedupe on newPages (alias axis, not job axis).
- PR #190 — PR 2 original adapter cursor + `maybeEnqueuePostTurnCompile`, where the 5-minute dedupe bucket was introduced.

Related concept docs:

- `docs/src/content/docs/concepts/knowledge/compounding-memory-pipeline.mdx` — documents the dedupe-key format in the post-retain path; does not yet mention the continuation chain's `bucket + 1` invariant. Candidate for a 1–2 line addendum.
- `docs/src/content/docs/guides/compounding-memory-operations.mdx` — ops guide touching `wiki_compile_jobs` and bootstrap import.
