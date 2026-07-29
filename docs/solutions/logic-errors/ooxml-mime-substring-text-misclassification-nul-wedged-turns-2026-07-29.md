---
title: "PPTX attachment decoded as text wedges turn persistence — 'Stall detected' masks a Postgres NUL rejection"
date: 2026-07-29
category: logic-errors
module: "pi-extensions/attachments + api/chat-finalize"
problem_type: logic_error
component: attachment_extraction
severity: high
last_updated: 2026-07-29
applies_when:
  - "A user attaches a .pptx/.docx and the turn ends with 'Agent dispatch failed: Stall detected: no activity for 5 minutes'"
  - "chat-finalize logs 'invalid byte sequence for encoding \"UTF8\": 0x00' (22021) or '\\u0000 cannot be converted to text' (22P05)"
  - "Writing MIME-type detection logic that branches on substring matches"
  - "A turn shows real cost ($) and a real response in finalize logs but the user sees a timeout"
related_components:
  - packages/pi-extensions/src/attachments.ts
  - packages/api/src/lib/chat-finalize/sanitize.ts
  - packages/api/src/lib/chat-finalize/process-finalize.ts
  - packages/api/src/lib/chat-finalize/notify.ts
  - packages/api/src/handlers/crons/stall-monitor.ts
tags: [attachments, pptx, docx, ooxml, mime, nul-bytes, postgres, stall-monitor, chat-finalize]
---

# PPTX decoded as text wedges turn persistence; stall monitor mislabels it (PR #4139)

## Symptom

TEI, 2026-07-29: user attached a 7.6MB `.pptx` and asked for analysis. UI showed
"Timed out after 8m24s · $0.1739" then "Agent dispatch failed: Stall detected:
no activity for 5 minutes". CloudWatch showed the opposite of a stall: the Pi
runtime **completed in ~3 minutes with a correct 2,109-char summary**, then
chat-finalize failed both persistence writes:

- `Failed to update thread_turn: invalid byte sequence for encoding "UTF8": 0x00` (22021)
- `Failed to insert assistant message: \u0000 cannot be converted to text` (22P05) — the
  JSON literally contained `{"type":"text","text":"PK\u0000...` (raw ZIP bytes)

The turn stayed `running`, so the stall-monitor cron timed it out 5 minutes
later and the successful, billed run was discarded.

## Root causes (two stacked)

1. **MIME substring trap.** `isTextLike` used `mime.includes("xml")`. Every
   OOXML MIME type contains "xml" *inside the word "openxmlformats"* —
   `application/vnd.openxmlformats-officedocument.presentationml.presentation`
   — so `.pptx`/`.docx` ZIP binaries were UTF-8-decoded as "readable" text and
   the NUL-sniff backstop never ran. (`.xlsx` was saved only because the
   spreadsheet branch matched first.)
2. **NULs are fatal at the persistence boundary.** Postgres rejects U+0000 in
   `text`/`jsonb`. Once garbage entered the transcript, *every* finalize write
   failed, and a persistence failure is indistinguishable from a stall to the
   stall monitor (`status = 'running'` past threshold).

## Fix (PR #4139)

- XML MIME detection is exact/suffix only: `application/xml`, `text/xml`,
  `*+xml`. Never substring-match MIME types.
- Real PPTX/DOCX extraction: they are ZIPs of XML — unzip (jszip, lazy-loaded)
  and pull `<a:t>` runs per `ppt/slides/slideN.xml` / `<w:t>` runs from
  `word/document.xml`. Pure TS so the text-only desktop sandbox keeps the
  `file_read` contract.
- Defense in depth: `stripNulDeep` (`packages/api/src/lib/chat-finalize/sanitize.ts`)
  sanitizes all strings at the finalize persistence boundary, and text
  extractions strip U+0000 at the source.

## Durable lessons

- **Never substring-match MIME types.** "xml", "json", "csv" checks must be
  exact type or `+suffix` matches; OOXML types poison substring checks.
- **"Stall detected" can mask a persistence failure.** When a turn times out
  but shows real cost, check chat-finalize logs before assuming the runtime
  hung — the run may have succeeded and failed only at the DB write.
- **Sanitize NULs before any Postgres text/jsonb write of model/tool output.**
  Tool results are attacker-shaped data; one NUL wedges the whole turn.
