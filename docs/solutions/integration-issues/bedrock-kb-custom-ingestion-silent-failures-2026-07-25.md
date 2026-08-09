---
module: packages/api
date: 2026-07-25
last_updated: 2026-07-25
category: integration-issues
problem_type: integration_issue
component: knowledge_base
severity: high
related_components:
  - bedrock
  - aurora
  - lambda
applies_when:
  - "Ingesting documents into a Bedrock knowledge base through a CUSTOM data source with IngestKnowledgeBaseDocuments"
  - "The knowledge base vector store is RDS/Aurora pgvector (knowledge-base-manager.ts hardcodes type: 'RDS')"
  - "Attaching inlineAttributes metadata to inline or S3-located custom documents"
  - "Fanning one source document out into many ingested documents (per-page, per-chunk, per-section)"
  - "A preprocessing step writes an idempotency record that later syncs use to skip work"
tags:
  - bedrock
  - knowledge-base
  - custom-data-source
  - rds-vector-store
  - inline-metadata
  - idempotency
  - throttling
  - convergence
---

# Bedrock KB custom ingestion fails silently on an RDS vector store

## Context

`packages/api/knowledge-base-manager.ts` ingests documents into Bedrock
knowledge bases through a **`CUSTOM` data source**, using
`IngestKnowledgeBaseDocuments` / `DeleteKnowledgeBaseDocuments` /
`ListKnowledgeBaseDocuments`. Every knowledge base the platform creates uses
an **RDS/Aurora pgvector** store — `type: "RDS"` is hardcoded — so the
constraints below apply to all of them, not to one tenant's configuration.

This document collects four failure modes found while shipping page-level
transcription for McPherson's CX SOP corpus (80 PDFs → 760 page documents).
All four share a property that makes them expensive: **they do not raise.**
The API accepts the call, reports success or a status with no message, and the
damage is only visible by reading back state.

## Symptom 1 — documents go to FAILED with an empty `statusReason`

Ingested page documents landed in `FAILED`. `ListKnowledgeBaseDocuments`
returned the failure with **`statusReason` empty** — no message, no code, no
CloudWatch entry explaining it.

### Root cause

The RDS vector store writes **each inline metadata attribute to its own table
column**. Any attribute without a matching column fails the insert, and that
failure is not surfaced through the ingestion API.

Isolated with a four-way probe, which is the technique worth reusing:

| Probe document               | Metadata          | Result    |
| ---------------------------- | ----------------- | --------- |
| `zz-probe-plain`             | none              | `INDEXED` |
| `zz-probe-meta`              | inline attributes | `FAILED`  |
| `zz-probe-hash.pdf#p=1`      | none              | `INDEXED` |
| `zz-probe-hash-meta.pdf#p=1` | inline attributes | `FAILED`  |

The `#p=<n>` id shape was innocent; **metadata was the whole cause**. Two
variables, four cells — do not guess which one matters when you can afford
four probes.

### Fix

Page documents carry **no inline metadata**. Identity travels in the document
id itself (`<s3key>#p=<n>`), and the manifest join supplies everything else.
See PR #4097.

If you genuinely need queryable metadata on an RDS-backed KB, the columns
must exist in the vector store table first — adding attributes is a schema
change, not a request-shape change.

## Symptom 2 — a throttled page freezes bad output into the idempotency record

The transcription worker wrote `report.json` as its idempotency record: if the
report exists for a given `etag + preprocessor_version`, later syncs skip the
document. Under Bedrock throttling, a per-page fallback wrote **caption-only
text** for the throttled page and then wrote the report anyway.

The result is worse than a crash: the document is permanently marked done,
holding degraded content, and **no later sync will ever retry it**. Nothing
fails, so nothing alerts.

### Fix

Classify failures as retryable vs permanent (`isThrottle`, `isLadderExhausted`),
retry with jittered exponential backoff, and **refuse to write the idempotency
record when any page failed retryably**. An absent report means the next sync
redoes the work — which is the correct outcome.

The general rule: _an idempotency record is a claim that the work succeeded.
Never write one on a partial result._

## Symptom 3 — per-document fan-out never converges

Syncing 80 documents into 760 page documents hit the Lambda's 900 s ceiling
with 370/760 pages ingested — and **all 80 manifest rows still `etag IS NULL`**,
because the manifest was stamped only after the whole loop finished. The next
sync therefore restarted from page one, forever. Wall-clock grows with corpus
size; the manifest update didn't.

### Fix

Stamp the manifest **per document, inside the ingestion loop**, so a timed-out
run keeps everything it finished. Convergence then holds by induction: each run
strictly reduces the remaining set.

Verified in production — the resync settled in three rounds:

```
round 1: complete=28  remaining=50
round 2: complete=68  remaining=10
round 3: complete=80  remaining=0   CONVERGED
```

See PR #4099. When one logical unit fans out into many API calls, checkpoint at
the unit boundary, never at the end of the batch.

## Symptom 4 — stale whole-document copies leak

A document switching from `DEFAULT` to `TRANSCRIBE` parsing gets ingested as
page documents, but its **original whole-document copy stays indexed**. The S3
object is still live, so the sync plan never marks it deleted, and retrieval
keeps returning the untranscribed version alongside the good pages.

### Fix

Explicitly delete the stale base document id as part of switching a document to
page-level ingestion. Deletion driven purely by "is the source object gone?"
cannot see a representation change.

## Two older findings from the same subsystem

Both are load-bearing and were previously recorded only as code comments:

- **As-role S3 listing.** Listing a customer-connected bucket must assume the
  connected role; listing with the Lambda's own credentials silently returns an
  empty or partial set rather than an access error.
- **The 10-operation in-flight cap.** Bedrock rejects work beyond ~10
  concurrent ingestion operations per knowledge base. `drainInFlight()` /
  `sendWithThrottleRetry()` in `knowledge-base-manager.ts` encode this
  live-discovered limit — it is not documented, and raising the batch size
  reintroduces throttling.

## How to verify any change here

Do not trust a `200` from the ingestion call. Read state back:

```python
# Status counts + stale-base detection across every data source
c.list_knowledge_base_documents(knowledgeBaseId=kb, dataSourceId=ds)
#   -> assert Counter(status) == {"INDEXED": N}
#   -> assert no id ending in .pdf remains once its pages exist
```

For retrieval, assert on **rank**, not merely presence — see
[hybrid retrieval](../architecture-patterns/kb-hybrid-retrieval-for-sop-corpora-2026-07-25.md).

## Related

- [Bedrock KB indexes nothing from scanned pages and screenshot SOPs](./bedrock-kb-image-bearing-pdfs-2026-07-25.md)
  — why page-level transcription exists at all, and its measured economics
- [Rank, not presence, is the retrieval metric on SOP corpora](../architecture-patterns/kb-hybrid-retrieval-for-sop-corpora-2026-07-25.md)
- [A release-version bump does NOT update the Pi runtime image](../operations/pi-runtime-image-decoupled-from-release-version.md)
- `packages/api/knowledge-base-manager.ts` — sync, ingestion, deletion settlement
- `packages/api/src/handlers/kb-transcribe.ts` — the preprocessing worker
- `packages/database-pg/drizzle/0278_kb_page_transcription.sql` — manifest columns
- PRs #4094, #4096, #4097, #4099
