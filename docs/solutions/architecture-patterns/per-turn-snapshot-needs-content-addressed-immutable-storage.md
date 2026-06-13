---
module: workspace-renderer
date: 2026-06-13
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "a per-turn or per-event snapshot must serve as an immutable historical record"
  - "a snapshot references a storage key that is overwritten on re-render or re-compute"
  - "a record carries a fingerprint field (etag, sha, versionId) used for staleness or integrity checks"
  - "an eval or audit must reproduce exactly what a past turn or event saw, regardless of current state"
  - "verifying that a fingerprint or hash field is actually populated end-to-end, not silently null"
related_components:
  - database
  - testing_framework
  - documentation
tags:
  - content-addressed-storage
  - immutable-snapshot
  - write-once
  - etag
  - sha256
  - audit-trail
  - workspace-renderer
  - false-confidence
---

# Per-turn snapshots need content-addressed, write-once storage — not a reference to a mutable key

## Context

THNK-10 (Dynamic Workspace, PR #2405) added a per-turn **projection snapshot** recording what each agent turn was composed with, stored in `thread_turns.context_snapshot.workspace_projection`. The point of the snapshot is debugging and evals: reconstruct "what did this turn actually see" — including the rendered `AGENTS.md` with its generated routing tree — *regardless of the workspace's current state*.

It didn't deliver that, for two compounding reasons that only surfaced during live E2E validation:

1. **The snapshot referenced a mutable key.** For the rendered AGENTS.md it stored only `agentsMdKey = ${renderedPrefix}AGENTS.md`. The renderer overwrites that exact object on every re-render, so by the time a consumer dereferenced it, a later turn had clobbered the bytes. The debug panel could only show the *current* AGENTS.md with a hand-wavy "a later turn re-rendered this — content may have differed" caveat, and the eval assertion literally could not check a past turn's content.

2. **The mitigating fingerprint was always null.** An `agentsMdEtag` field existed to detect staleness, but the producing code path never populated it. In `sortedManifestFiles` (`packages/api/src/lib/workspace-renderer/compose-tuple.ts`), source-backed files set `etag: object.etag`, but the **generated-file** branch (which produces the AGENTS.md manifest entry) omitted `etag` entirely. So `agentsMdEtag` was `null` on 100% of snapshots, the etag-based staleness check silently never fired, and the panel always fell back to a `generatedAt` heuristic.

The net effect: the feature's headline capability — and the eval requirement to assert a historical turn's routing section regardless of current state — was structurally unsatisfiable, while two fields (`agentsMdKey`, `agentsMdEtag`) made it *look* covered.

## Guidance

When a snapshot must reconstruct "what the system saw at time T," reference storage that **cannot change after the snapshot is taken**. Two moves:

**1. Write a content-addressed, write-once copy.** Hash the rendered content and persist it under a content-addressed key. Identical renders dedup to the same object; the object is never overwritten with different bytes by construction. Write it on the **cache-miss render path only**, so steady-state cache hits add zero writes (any content that ever rendered post-deploy was first produced by a miss).

```ts
// packages/api/src/lib/workspace-renderer/compose-tuple.ts
const AGENTS_MD_HISTORY_DIR = ".agents-md-history";

export function agentsMdContentSha(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function agentsMdHistoryKey(renderedPrefix: string, sha: string): string {
  return `${renderedPrefix}${AGENTS_MD_HISTORY_DIR}/${sha}.md`;
}

// in the miss-path put loop, alongside writing the live AGENTS.md + manifest:
await objectStore.putText({
  bucket,
  key: agentsMdHistoryKey(renderedPrefix, agentsMdContentSha(agentsMd)),
  content: agentsMd,
  contentType: "text/markdown; charset=utf-8",
});
```

Store `agentsMdHistoryKey` in the snapshot. Consumers (eval assertion, debug UI) dereference **that** key for exact historical bytes — never `${renderedPrefix}AGENTS.md`.

**2. Make the fingerprint real and non-null.** Stamp the content sha as the generated manifest entry's `etag`, so the staleness signal is an actual fact rather than a perpetual null. This is also what lets the snapshot derive the history key (`agentsMdHistoryKey(renderedPrefix, etag)`).

```ts
// BEFORE — generated-file manifest entry: no etag → agentsMdEtag always null
for (const generatedFile of generatedFiles) {
  filesByPath.set(generatedFile.path, {
    path: generatedFile.path,
    owner: generatedFile.owner,
    sourceKey: generatedFile.key,
    sourcePath: generatedFile.path,
    readOnly: true,
    generated: true,
    size: Buffer.byteLength(generatedFile.content),
  });
}

// AFTER — content sha as the fingerprint
for (const generatedFile of generatedFiles) {
  filesByPath.set(generatedFile.path, {
    // ...same fields...
    etag: agentsMdContentSha(generatedFile.content), // real, non-null fingerprint
    readOnly: true,
    generated: true,
    size: Buffer.byteLength(generatedFile.content),
  });
}
```

**3. Degrade honestly across the transition window.** Turns rendered *before* the fix (still warm in cache) have no history object until the next re-render forces a miss. Consumers must show a specific reason ("this turn predates immutable history capture") rather than silently presenting the current render as if it were historical.

## Why This Matters

- **Replay/audit/eval correctness.** An eval that asserts on historical content is worthless if it reads the *current* render. Pointing at a mutable key turns "what did the agent see" into "what would the agent see if it ran now" — a different, usually wrong, question.
- **False-confidence fields are worse than missing ones.** A staleness fingerprint that is silently always null doesn't fail loudly — it passes everything, and reviewers and downstream code trust it. The gap hides until someone needs the guarantee it never provided. Here, two present-looking fields masked a completely absent capability.
- **The immutability is nearly free.** Content-addressing dedups identical renders, so storage is bounded by *distinct* contents, and miss-path-only writes keep cache hits on a pure read path. You buy an exact historical record for roughly the cost of the distinct bytes you'd want to keep anyway.

## When to Apply

Reach for this whenever something must reconstruct past state:

- **Per-turn / per-event snapshots** of rendered or composed artifacts — prompts, system messages, workspace manifests, compiled config.
- **Replay and eval systems** that assert on "what the system saw at time T."
- **Audit logs / provenance records** that reference an artifact by key — if that artifact is regenerated in place, the audit trail silently rots.
- **Any new fingerprint / etag / checksum field added to detect drift** — verify *every* producing branch populates it. Generated/synthetic branches frequently diverge from source-backed branches (exactly the gap here); a grep for the field's assignment across all branches is the cheapest guard.

The rule: **immutable record → write-once, content-addressed storage; mutable working copy → its own overwrite-in-place key.** Never let one key serve both roles, and never let a drift-detection field default to null on any path that produces the record.

## Examples

**Verifying the fix on real data (dev, 2026-06-13).** Two turns of one thread straddling a baseline edit. The string `fleet-caterpillar-456` appeared only in turn 1's content (turn 2 re-rendered it to `thinkwork/`). The eval assertion `workspace-projection-agents-md-contains "fleet-caterpillar-456"` on turn 1 **passed** — reading the immutable history object, not the current live AGENTS.md — proving the assertion reconstructs historical state. Each history object's actual `sha256` matched its key exactly (content-addressed integrity), and turn 1's bytes stayed distinct from the re-rendered live file.

**Generalization.** Swap "AGENTS.md" for any rendered artifact — a composed prompt at `${prefix}prompt.txt`, a compiled config at `${prefix}config.json`. The same two-key discipline applies: keep the live overwrite-in-place key for the runtime, add a content-addressed write-once sibling for the record, and make any drift field non-null on every branch.

## Related

- [`runtime-swap-tool-parity-and-record-contract.md`](./runtime-swap-tool-parity-and-record-contract.md) — sibling principle: the durable/replay record is a contract, and depending on transient-only data (there, tool rows from transient events; here, a null etag) gives false confidence. That doc covers the record *shape*; this one covers the storage *durability*.
- [`workspace-skills-load-from-copied-agent-workspace-2026-04-28.md`](./workspace-skills-load-from-copied-agent-workspace-2026-04-28.md) — prior art on S3 bucket versioning as recoverable workspace history. This doc argues for explicit content-addressed write-once copies over relying on bucket `versionId` alone (no versioned-read plumbing through the file-read API, natural dedup, and a normal-path read for consumers).
- Code: `packages/api/src/lib/workspace-renderer/compose-tuple.ts`, `packages/api/src/lib/workspace-projection-snapshot.ts`, `packages/api/src/lib/evals/workspace-projection-assertions.ts` (PRs #2405, #2422).
