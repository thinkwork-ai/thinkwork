# Bedrock KB indexes nothing from scanned pages and screenshot SOPs (2026-07-25)

## Symptom

McPherson's CX knowledge base retrieved the correct document but the agent
could not cite its contents. The reported example was CX-0215 — "Setting Up New
Reason Code for Credit and Rebill" — where the agent said the source "was
scanned at poor quality and the step-by-step content is largely illegible".

## What was actually wrong

Three separate things, only one of which matched the report.

**1. The premise was wrong.** CX-0215 is not a poor-quality scan. It is a
clean, sharp 150-DPI scan of *handwriting* on notebook paper — one page, zero
extractable characters, one embedded image. Re-scanning it would not have
helped. No OCR-grade problem existed; there was no text layer at all.

**2. The platform never asked Bedrock to parse anything.**
`knowledge-base-manager.ts` builds every data source without a
`parsingConfiguration`, so all of them use Bedrock's default parser, which per
AWS docs "only parses text in text files" — no OCR, no visual extraction.
`knowledge_base_sources.parsing_strategy` existed, defaulted to `'DEFAULT'`,
and was read by nothing.

**3. The blast radius was far larger than the one reported document.** Triage
of all 80 CX PDFs (760 pages, 1,863 embedded images):

| Class | Count | What it is | Indexed before |
|---|---|---|---|
| MIXED | 59 | Scribe-style SOPs: one caption line per step plus a JDE screenshot | captions only |
| IMAGE_ONLY | 12 | 1–2 page handwritten notes | nothing |
| TEXT | 9 | genuinely textual | fine |

**71 of 80 (89%) kept most of their substance inside images.** The screenshot
SOP is the dominant document shape in this corpus, not an edge case.

It was also a **correctness** bug, not merely a coverage gap. CX-0215 says to
add a new reason code at the **bottom** of the list; only *Default* belongs at
the top. The KB answered "always insert it at the top", which would
misconfigure a JDE reason code.

## Findings worth keeping

**Conventional OCR fails here, and its confidence score lies.** Docling with
RapidOCR returned `nowiaatar` / `Seareh` / `Alwoaus add mmu Code ooton` on
CX-0215 — numbering lost, "UDC" lost, "42/RC" reduced to "RC" — and graded that
output **`FAIR`, not `POOR`** (`ocr_score` 0.798). Any design that escalates
"only when OCR confidence is low" would not have fired on the single most
important page in the corpus. Do not gate on OCR confidence. Route on signals
you can audit — characters and images per page.

Worse, that garbage would have been *indexed as if it were content*. Bad OCR is
more dangerous than no OCR.

**Claude reads PDF pages natively — do not rasterize.** Bedrock's
`invoke_model` accepts a `document` content block with a base64 PDF
(`anthropic_version: bedrock-2023-05-31`). Sending a single-page PDF costs the
same ~1,630 input tokens as sending a rendered image of it and requires no
rasterizer. This removed an OCR engine, a 1–2 GB model bundle, a
`modelscope.cn` (China-hosted CDN) runtime fetch, an ECR repo and an
ECS/Fargate tier from the design. `pdf-lib` (MIT) splits pages with no native
dependencies.

**Bundled `pdfjs-dist` dies at runtime in Lambda.** It resolves a separate
`pdf.worker.mjs` module at call time, and bundling breaks that path:
`Error: Setting up fake worker failed`. This only surfaced when smoking the
**built zip** — the source-tree run passed. Use `unpdf` (already a repo
dependency), which packages pdf.js for serverless with no separate worker.

**Model availability is per-account and must be a ladder.** On the McPherson
account in `us-east-1`, `us.anthropic.claude-opus-5` and `-4-8` both return
`AccessDeniedException` ("not available for this account"); Sonnet 4.6 works
and is accurate. Haiku 4.5 works but misread `42/RC` as `42/PC`. Resolve the
model from a configured ordered ladder, cache the probe **as a shared promise**
so concurrent page workers do not each re-walk the blocked tiers, and record
which model actually ran.

**Character count alone under-routes.** A page with 439 native characters sat
just above a 400-char "this is a text page" threshold while carrying two
screenshots — it would have been silently passed through untranscribed while
its neighbours expanded 10×. Count image XObjects too, and let any image force
transcription. `pdf-lib` can read them straight off the page resource
dictionary (`Resources → XObject → Subtype /Image`); the counts match a pdf.js
operator-list scan exactly, with no render pass.

**Switching parsing strategy strands the old ingestion.** A document
previously ingested whole stays in Bedrock under its bare key. The sync plan
never lists it for deletion because the S3 object is still live, so the stale
copy keeps serving the old (empty) text alongside the new page documents. The
strategy switch has to delete it explicitly.

## Shape of the fix

`kb-transcribe` Lambda: split each page (`pdf-lib`), read per-page text and
image counts (`unpdf` + `pdf-lib`), transcribe image-bearing pages via the
Bedrock PDF document block, write `pages/<n>.md` + `report.json` to the
workspace bucket under a prefix keyed by (document key, etag, pipeline
version). `report.json` is written **last** so a partially written page set
never looks ready.

The manager ingests one `IN_LINE` Bedrock document per page under
`<key>#p=<n>` with `page_number` / `doc_title` / `transcribed` metadata, folds
per-page statuses back to the base key for the manifest (one row per source
document), and fans deletion out over page ids. Transcription is
fire-and-forget; a sync ingests what is ready and reports the rest as
`TRANSCRIBING`, converging across runs rather than blocking on model calls.

## Economics

~1,630 input + ~340 output tokens and ~3–10s per page. The full 760-page
corpus is roughly **$8 one-time**. That is cheap enough that gating was never
worth its complexity — transcribe every image-bearing page.

## See also

- `docs/solutions/database-issues/` — hand-rolled migrations must be applied to
  dev before merge; the Migration Drift Precheck gate enforces it.
- Account cap: at most 10 concurrent Ingest/Delete document operations. Page
  documents multiply document count ~10×, so the existing drain/throttle
  batching in `syncS3ConnectSource` is load-bearing here.
