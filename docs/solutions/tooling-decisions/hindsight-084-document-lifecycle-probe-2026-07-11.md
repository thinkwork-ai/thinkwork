# Hindsight 0.8.4 document-lifecycle probe observations (THINK-193 U1)

Recorded 2026-07-11 from a disposable bank on the local memory-eval harness
(`ghcr.io/vectorize-io/hindsight:0.8.4`, schema `u1_lifecycle_probe`,
retain model Haiku 4.5). Raw step log:
`hindsight-084-document-lifecycle-probe-2026-07-11.json`. Probe script:
`packages/api/scripts/memory-sources/hindsight-lifecycle-probe.ts`.

This is the U1 evidence input to the U2 retraction-saga design. It is an
observations record, not the retraction go/no-go verdict — that verdict doc is
a U2 deliverable and production retraction stays disabled until it lands.

## Observations

1. **`update_mode=replace` fully supersedes prior extractions.** Retaining v2
   (HQ Austin, $9M ARR) under the same `document_id` left exactly one
   `documents` row; recalling the *old* value ("Reno headquarters") returned
   only the new Austin fact. No stale v1 unit survived.
2. **Replace duplicated the new units.** After the v2 replace, `memory_units`
   held 2 byte-identical Austin units for the one document. Not stale data,
   but U2's claim-support model should not assume unit-count stability across
   replaces (dedupe by content hash, not row count).
3. **A document-level HTTP delete exists and cascades.**
   `DELETE /v1/default/banks/<bankId>/documents/<documentId>` returned 200 and
   removed the document, its memory units, and links (post-delete residue 0 in
   `documents`, `memory_units`, `memory_links`; recall returned nothing).
   `DELETE .../memories/<documentId>` is 405 — not a surface.
4. **Recall response shape is `{results: [...]}`** on 0.8.4 (older builds used
   `memory_units`).

## Implication for U2

The retraction saga has a real vendor seam: pinned contract test around
`DELETE /v1/default/banks/<bankId>/documents/<documentId>` (200 + cascaded
cleanup + empty recall), with the schema-guarded SQL fallback
(`applier.ts`-style orphan-safe delete) kept as the degraded path.
