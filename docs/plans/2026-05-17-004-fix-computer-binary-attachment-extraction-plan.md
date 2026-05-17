---
title: "fix: Extract non-text attachments for Computer Slack turns"
type: fix
status: completed
date: 2026-05-17
---

# fix: Extract non-text attachments for Computer Slack turns

## Overview

Slack-thread files are now reaching ThinkWork thread metadata, but the native Computer runtime only inlines text-like attachments into the turn context. Binary business files, especially PDFs and Excel workbooks, are still surfaced to the Computer as unavailable content, so the Computer can answer "I don't see a file" even when Slack visibly shows one in the thread.

This plan adds bounded server-side extraction for non-text files before the Computer runtime receives the turn context. The existing Slack file materialization and thread attachment storage remain the source of truth; the change is the missing extraction layer plus regression tests.

---

## Problem Frame

The motivating user flow is a Slack thread containing a document or financial statement, followed by a prompt such as "summarize this file" or "run financial analysis." The Slack UI shows the file, and ThinkWork has a thread attachment row, but `packages/api/src/lib/computers/runtime-api.ts` currently only downloads files it classifies as text. Anything else returns `reason: "unsupported_mime_type"`, which leaves the Computer blind to PDFs and workbooks.

The correct behavior is not a new Slack storage model. The file is already attached to the ThinkWork thread. The API should extract a safe, compact text representation from supported binary formats and pass that text through the existing `ThreadTurnContext.attachments` prompt path.

---

## Requirements Trace

- R1. Slack-originated files attached to the current user turn, including files inherited from the source Slack thread, are available to the native Computer runtime as inline context when the format is supported.
- R2. Excel `.xlsx` financial statements produce a compact, readable workbook summary that includes sheet names, cells, and values within strict size limits.
- R3. PDF attachments produce extracted text within strict size limits.
- R4. Unsupported or unsafe binary files fail closed with a clear `reason` value, without breaking the Computer turn.
- R5. Existing text-like attachment behavior remains unchanged.
- R6. Regression tests cover text, `.xlsx`, `.pdf`, unsafe workbook, unsupported file, and prompt rendering paths.

---

## Scope Boundaries

- No new Slack file ingestion path. Slack download/materialization and `thread_attachments` rows remain unchanged.
- No full document intelligence pipeline. This is bounded text extraction for turn context, not OCR, layout reconstruction, or long-document retrieval.
- No legacy `.xls` parsing in this unit. `.xls` remains unsupported unless an existing safe parser path appears during implementation.
- No manual production mutation or deployment. Verification is local/unit-level, with normal PR/CI/deploy handling afterward.
- No changes to Slack attribution, placeholder editing, bot avatar, or thread routing.

---

## Context & Research

### Relevant Code and Patterns

- `packages/api/src/lib/computers/runtime-api.ts` already resolves `messages.metadata.attachments`, validates the tenant/thread S3 prefix, downloads text-like attachments from S3, and returns `ThreadTurnContext.attachments`.
- `packages/computer-runtime/src/computer-chat.ts` already builds a system-prompt attachment section and explicitly tells the model not to claim no file is attached.
- `packages/api/src/lib/attachments/content-validation.ts` already contains OOXML safety checks for `.xlsx` uploads: magic bytes, macro rejection, external-link rejection, and zip safety.
- `packages/api/src/handlers/slack/events.test.ts` already covers inherited Slack thread file refs reaching task input and materialization.
- `packages/api/package.json` already depends on `jszip`, and `pnpm-lock.yaml` already contains `pdf-parse` and `fast-xml-parser` as transitive packages. Current npm metadata checked during planning: `pdf-parse` 2.4.5 is Apache-2.0, `fast-xml-parser` 5.8.0 is MIT.

### Institutional Learnings

- No directly matching `docs/solutions/` learning exists for Slack attachment extraction. The closest applicable pattern is the existing attachment content validation code's fail-closed OOXML handling.

### External References

- npm registry package metadata for `pdf-parse` and `fast-xml-parser`, checked on 2026-05-17 for current version and license.

---

## Key Technical Decisions

- Extract in the API layer, not in `packages/computer-runtime`: The API already owns tenant validation, S3 access, attachment row resolution, and prompt payload assembly. Keeping extraction there avoids giving the runtime new S3/object-store responsibilities.
- Add a dedicated attachment extraction module: Move format detection, byte limits, parser caps, and reason values out of `runtime-api.ts` so the extraction behavior can be unit-tested directly.
- Reuse existing OOXML safety validation before parsing `.xlsx`: Slack-ingested files may bypass browser upload finalization, so extraction must defensively reject macros, external links, malformed zip content, and zip-bomb shapes.
- Parse `.xlsx` to text, not to JSON payloads: The Computer prompt path consumes text today. A compact markdown/CSV-like sheet summary is sufficient for natural-language summarization and financial analysis prompts.
- Keep text attachment behavior compatible: Text-like files still use the current range-limited download path and trimming behavior, with only shared helper extraction changing the implementation.
- PDF extraction is best-effort and bounded: If text cannot be extracted, return an unreadable attachment with a parser-specific reason rather than throwing the whole Computer turn.

---

## Open Questions

### Resolved During Planning

- Should files be mapped from Slack threads into ThinkWork attachments? Yes, that path already exists; this plan targets the remaining extraction gap.
- Should unsupported binary attachments block the Computer turn? No. They should remain attached with `readable: false` and a clear reason.

### Deferred to Implementation

- Exact parser dependency shape: Prefer direct dependencies on `pdf-parse` and `fast-xml-parser` if TypeScript import/build behavior requires it, even though both are already transitive in the lockfile.
- Exact `.xlsx` output formatting: Implementation may tune sheet/cell formatting to keep prompt content compact while preserving values.

---

## Implementation Units

- U1. **Attachment extraction module**

**Goal:** Create a reusable API helper that turns supported attachment bytes into bounded prompt text.

**Requirements:** R2, R3, R4, R5

**Dependencies:** None

**Files:**

- Create: `packages/api/src/lib/computers/attachment-extraction.ts`
- Test: `packages/api/src/lib/computers/attachment-extraction.test.ts`
- Modify: `packages/api/package.json`
- Modify: `pnpm-lock.yaml`

**Approach:**

- Define a typed extraction result with `readable`, `contentText`, `truncated`, `reason`, and optional `extractionKind`.
- Preserve text-like extraction for existing extensions and MIME types.
- For `.xlsx`, validate magic bytes and OOXML safety first, parse workbook XML with `jszip` plus XML parsing, and emit a compact sheet summary under row/cell/character caps.
- For `.pdf`, use a Node-compatible PDF text extractor under byte/character caps.
- Return fail-closed reason values such as `unsupported_mime_type`, `unsafe_ooxml`, `parse_failed`, `content_empty`, and `attachment_too_large`.

**Execution note:** Test-first around extraction edge cases.

**Patterns to follow:**

- `packages/api/src/lib/attachments/content-validation.ts`
- `packages/api/src/lib/attachments/__tests__/content-validation.test.ts`

**Test scenarios:**

- Happy path: text/markdown bytes extract to the same inline text behavior as today.
- Happy path: a minimal `.xlsx` containing revenue and EBITDA cells extracts sheet name and values.
- Happy path: a small PDF extracts visible text.
- Error path: an `.xlsx` with `xl/vbaProject.bin` returns unreadable with an unsafe workbook reason.
- Error path: an unsupported binary MIME returns unreadable with `unsupported_mime_type`.
- Edge case: oversized extracted text is truncated and marks `truncated: true`.

**Verification:**

- `pnpm --filter @thinkwork/api test -- src/lib/computers/attachment-extraction.test.ts`

---

- U2. **Computer turn attachment loader integration**

**Goal:** Replace the text-only branch in `loadComputerThreadTurnAttachments` with the extraction module, while preserving tenant/thread prefix checks and S3 failure handling.

**Requirements:** R1, R4, R5

**Dependencies:** U1

**Files:**

- Modify: `packages/api/src/lib/computers/runtime-api.ts`
- Test: `packages/api/src/lib/computers/runtime-api.test.ts`

**Approach:**

- Keep `resolveMessageAttachmentsForDispatch` as the entry point.
- Keep S3 key prefix validation before any object download.
- Download a bounded number of bytes appropriate to the detected format, then delegate to the extraction helper.
- Preserve per-attachment error isolation: one bad file cannot make the thread turn fail.
- Include extraction reason and truncation flags in the existing attachment payload shape.

**Patterns to follow:**

- Existing `loadComputerThreadTurnAttachments` prefix validation and S3 error logging.
- Existing `runtime-api.test.ts` mock queues for `messages`, `thread_attachments`, and S3 body handling.

**Test scenarios:**

- Integration: a `.xlsx` row referenced from message metadata downloads from S3 and returns `readable: true` with extracted financial values.
- Integration: a `.pdf` row downloads from S3 and returns extracted text.
- Error path: prefix mismatch still returns `prefix_mismatch` without S3 access.
- Error path: S3 download failure still returns `download_failed`.
- Regression: existing `.md` fixture remains readable with the same content text.

**Verification:**

- `pnpm --filter @thinkwork/api test -- src/lib/computers/runtime-api.test.ts`

---

- U3. **Prompt contract regression**

**Goal:** Ensure extracted binary content is rendered to the native Computer prompt in the same file-aware section as text attachments.

**Requirements:** R1, R6

**Dependencies:** U1, U2

**Files:**

- Modify: `packages/computer-runtime/src/api-client.ts`
- Modify: `packages/computer-runtime/src/computer-chat.ts`
- Test: `packages/computer-runtime/src/computer-chat.test.ts`

**Approach:**

- Extend the runtime attachment type only if implementation adds fields such as `extractionKind`; otherwise leave the API contract unchanged.
- Update prompt wording only as needed to avoid implying that extracted spreadsheet/PDF text is original raw file text.
- Keep the "Do not say that no file is attached" instruction.

**Patterns to follow:**

- Existing `buildAttachmentPrompt` behavior in `packages/computer-runtime/src/computer-chat.ts`.

**Test scenarios:**

- Happy path: extracted `.xlsx` content appears in the prompt under the file name.
- Happy path: extracted `.pdf` content appears in the prompt under the file name.
- Error path: unsupported binary still renders as attached but unavailable with the reason.
- Regression: existing markdown attachment prompt test still passes.

**Verification:**

- `pnpm --filter @thinkwork/computer-runtime test -- src/computer-chat.test.ts`

---

- U4. **Slack attachment regression coverage**

**Goal:** Prove Slack thread file refs continue to flow into Computer task input and now survive through extraction when the file is binary.

**Requirements:** R1, R6

**Dependencies:** U1, U2

**Files:**

- Modify: `packages/api/src/handlers/slack/events.test.ts`
- Modify or create: `packages/api/src/lib/slack/file-attachments.test.ts`

**Approach:**

- Add an inherited-thread-file regression for a non-text file such as `financials.xlsx`.
- Assert the Slack dispatcher still calls `materializeSlackFiles` and enqueues file refs from prior thread messages when the current prompt does not directly include the file.
- Where the file materialization test harness supports content fixtures, add a binary fixture path that stores the S3 attachment metadata expected by U2.

**Patterns to follow:**

- Existing inherited Slack file ref tests in `packages/api/src/handlers/slack/events.test.ts`.

**Test scenarios:**

- Integration: a user replies "review this file" in a Slack thread whose root message has `financials.xlsx`; the enqueued task includes that inherited file ref.
- Integration: a Slack file materialization row for `.xlsx` uses the thread-scoped S3 prefix that `loadComputerThreadTurnAttachments` accepts.
- Regression: text file inheritance behavior from the existing `.md` case remains unchanged.

**Verification:**

- `pnpm --filter @thinkwork/api test -- src/handlers/slack/events.test.ts src/lib/slack/file-attachments.test.ts`

---

## System-Wide Impact

- **Interaction graph:** Slack events still enqueue Computer tasks; Computer runtime still polls `loadThreadTurnContext`; only the attachment payload content is richer.
- **Error propagation:** Parser/download errors are per-attachment reason values, not task-level failures.
- **State lifecycle risks:** No new database rows or S3 prefixes. Extraction is transient and derived from existing attachment objects.
- **API surface parity:** Admin/mobile thread attachments benefit automatically when they dispatch through the same native Computer loader.
- **Integration coverage:** Slack inherited-file tests plus runtime loader tests cover the path that previously produced "I don't see a file attached."
- **Unchanged invariants:** Tenant/thread S3 prefix validation remains mandatory before object download; unsupported files remain attached but unreadable.

---

## Risks & Dependencies

| Risk                                                                          | Mitigation                                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| PDF parser adds bundle size or ESM/CJS friction                               | Keep parser isolated behind the extraction helper and verify `@thinkwork/api` typecheck/build before PR. |
| Workbook parsing accidentally trusts unsafe OOXML                             | Reuse `validateOoxmlSafety` before reading workbook XML.                                                 |
| Large files overload prompt context                                           | Apply byte, sheet, row, cell, and character caps with explicit `truncated` markers.                      |
| Extraction silently drops values users expect                                 | Regression fixture includes financial values and assertions for those exact values.                      |
| Slack files from prior thread messages still not attached to the current turn | U4 keeps coverage on inherited Slack file refs and materialization metadata.                             |

---

## Documentation / Operational Notes

- No user-facing docs needed for this narrow fix.
- If a supported file cannot be extracted, the Computer will still see the filename and reason so it can ask for a different format instead of claiming no file exists.

---

## Sources & References

- User request in this thread: "Add attachment extraction for non-text files" and "Add regression tests."
- Related code: `packages/api/src/lib/computers/runtime-api.ts`
- Related code: `packages/computer-runtime/src/computer-chat.ts`
- Related code: `packages/api/src/lib/attachments/content-validation.ts`
- Related tests: `packages/api/src/handlers/slack/events.test.ts`
