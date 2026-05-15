---
title: "feat(computer): Finance analysis pilot — Excel attachments + lifted Anthropic skills"
type: feat
status: active
date: 2026-05-14
origin: docs/brainstorms/2026-05-14-finance-analysis-pilot-requirements.md
---

# feat(computer): Finance analysis pilot — Excel attachments + lifted Anthropic skills

## Summary

Wire the existing AI Elements attachment subsystem into Computer's composers, upload attached files via presigned-PUT to a thread-scoped S3 prefix, persist refs in the **existing `thread_attachments` table** (already populated through `Thread.attachments` on the GraphQL `Thread` type and rendered by the admin Thread Detail), stage them per turn into `/tmp/turn-<id>/attachments/` inside the Lambda-hosted Strands container, lift three financial-analysis skills from `anthropics/financial-services` into `packages/skill-catalog/`, register three new Compliance event types covering uploads / skill activation / artifacts, and ship an operator install script for the prospect tenant. EFS is documented as the v1.5 upgrade path once a VPC migration is on the roadmap (the runtime is Lambda-image-hosted; Lambda supports EFS access points with VPC).

---

## Problem Frame

A specific Thinkwork prospect wants to perform financial analysis on internal Excel statements. The brainstorm (`docs/brainstorms/2026-05-14-finance-analysis-pilot-requirements.md`) scoped this to a pilot: one prospect, customer brings their own data, Excel attachments + a narrow content lift from Anthropic's open-source `financial-services` repo. No external data connectors, no xlsx output authoring, no vertical pack abstraction.

Research surfaced that the technical scope is substantially smaller than the brainstorm framing implied — three pieces of existing infrastructure shrink the work:

1. **AI Elements attachment subsystem is already complete.** `apps/computer/src/components/ai-elements/prompt-input.tsx` exposes drag-drop, paste-to-upload, file picker, `FileUIPart` chips, and constraint props (`accept`, `maxFiles`, `maxFileSize`). The consumer composers (`ComputerComposer.tsx` and the `FollowUpComposer` inside `TaskThreadView.tsx`) currently discard `message.files` on submit, and `use-chat-appsync-transport.ts` silently drops `FileUIPart` parts before the GraphQL mutation. The work is wiring, not building.
2. **`thread_attachments` table + GraphQL surface already exists.** `packages/database-pg/src/schema/threads.ts:154` declares the `thread_attachments` table with relations on `Thread`. `packages/database-pg/graphql/types/threads.graphql:71,95` declares `Thread.attachments: [ThreadAttachment!]!` and the `ThreadAttachment` type. `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx:346` already reads `thread?.attachments` and renders the list — only the upload action is a `TODO`. U2 should INSERT rows into `thread_attachments`; the existing resolver returns them automatically; admin Thread Detail picks them up.
3. **Strands already registers `file_read`** from `strands_tools` at `server.py:1485–1492`. No new tool needed.

Two prior architectural directions were considered and rejected before this v3:
- **In-prefix under agent workspace** (v1): writes attachments under `tenants/<t>/agents/<a>/workspace/.threads/<id>/attachments/`, relies on `bootstrap_workspace.py`'s flat S3 sync. Rejected because every Strands invocation re-downloads every historical attachment across every thread — catastrophic at scale.
- **AgentCore Runtime sessionStorage mount** (v2): `filesystem_configurations.session_storage { mount_path = "/mnt/workspace" }`, per-session sticky filesystem. Rejected because the runtime is **not** an AgentCore Runtime resource — `terraform/modules/app/agentcore-runtime/main.tf:329` is `aws_lambda_function` with Image package_type; `chat-agent-invoke.ts:89` uses `LambdaClient` from `@aws-sdk/client-lambda`. There is no `runtimeSessionId`, no `/mnt/workspace`, and the `filesystem_configurations` Terraform attribute belongs to a resource type this stack does not use. Lambda functions cannot mount the AgentCore-Runtime sessionStorage feature.

The v3 design works **with** the Lambda + image substrate that exists:
- Attachments live durably in S3 at a thread-scoped prefix (not under the agent workspace).
- `thread_attachments` rows are inserted at upload time, joined to the message and the tenant.
- `chat-agent-invoke` extracts attachments for the current message via the existing `thread_attachments` table (joined by `messageId`), passes refs in the invoke payload.
- `_execute_agent_turn` downloads only this turn's attachments to `/tmp/turn-<turnId>/attachments/<file>` once at turn entry; `/tmp` is per-Lambda-container ephemeral storage, naturally scoped per invocation, with no impact on `bootstrap_workspace`.
- System prompt preamble points at `/tmp/turn-<turnId>/attachments/<file>`; existing `file_read` covers the read.

The skill-content side is unchanged: `packages/skill-catalog/` already supports `execution: context` skills; the agentskills.io contract makes the Anthropic lift compatible. License compatibility on `anthropics/financial-services` remains a prerequisite gate, not implementation work.

The real new substrate work lives in Compliance audit: three event types are added — `attachment.received`, `skill.activated`, `output.artifact_produced` — each requiring the standard 4-file Compliance migration pattern (schema enum + redaction allow-list + drift test + drainer validator). The `skill.activated` event fires per-turn from inside the Strands loop and has high cardinality; the plan addresses this via per-turn deduplication in U4.

---

## Requirements Trace

Origin: `docs/brainstorms/2026-05-14-finance-analysis-pilot-requirements.md`. R-IDs below are the origin's.

- R1 (Excel/CSV attachments in prompt input) — U1, U2
- R2 (files reachable from Strands during the same turn) — U2, U3, U4
- R3 (clear feedback when file is received / processing / available; visible in transcript and admin Thread Detail) — U1, U9
- R4 (pilot skill bundle in `packages/skill-catalog/` per agentskills.io) — U5
- R5 (initial lift narrows to statement-analysis: 3-statement, audit-xls, ratios/trends/anomaly) — U5
- R6 (adapted skills retain Anthropic content, activate via workspace presence) — U5, U7
- R7 (response grounded in file contents) — U4, U5
- R8 (output in existing artifact substrate, no xlsx authoring) — relies on existing path; no code change
- R9 (operator-installable into prospect tenant without platform code changes) — U7
- R10 (pilot supports at least one prospect tenant end-to-end) — U7
- R11 (audit: file uploads + skill activations + artifacts) — U6
- R12 (operator can re-open a session and inspect what the agent did, including attachments) — U6 (rides existing Compliance event log + session detail UI), U9 (admin Thread Detail attachments panel)

Acceptance Examples: AE1 → U1 + U2 + U3 + U4 + U5 end-to-end; AE2 → U5; AE3 → U6 + U7 + U9.

Actors A1 (prospect end-user), A2 (Thinkwork operator), A3 (Computer agent) are all reflected: A1 in U1's UI scenarios, A2 in U7's install script + runbook, A3 in U3/U4's prompt + skill activation paths.

Key Flows: F1 (upload-and-analyze) → U1 + U2 + U3 + U4 + U5; F2 (provisioning) → U5 + U7; F3 (audit & review) → U6 + U9.

---

## High-Level Technical Design

End-to-end flow once all units land:

```
[Operator UI — apps/computer]
  PromptInput (AI Elements, already complete)
   ├─ user drops .xlsx
   └─ message.files: FileUIPart[]
       │
       ▼
  ComputerComposer / FollowUpComposer
   forwards message.files on submit (currently dropped)
       │
       ▼
  use-chat-appsync-transport (two-step presigned-PUT, modeled on plugin-upload.ts)
   step 1 — per file: POST /api/threads/{thread}/attachments/presign
              ◄ returns { signedPutUrl, stagingKey, attachmentId (UUID) }
   step 2 — per file: PUT signedPutUrl ─► S3 direct (client → S3, no Lambda body in flight)
              s3://thinkwork-<stage>-attachments/tenants/{t}/computers/{c}/threads/{thread}/attachments/{attachmentId}/{safeFilename}
   step 3 — per file: POST /api/threads/{thread}/attachments/finalize
              { attachmentId, stagingKey, name, mimeType, sizeBytes, messageRef }
              ◄ server validates (size, MIME, magic bytes, OOXML scan), INSERTs thread_attachments row,
                emits attachment.received audit event
   sendMessage(metadata.attachments: [{ attachmentId, name, mimeType, sizeBytes }, ...])
       │
       ▼
[GraphQL — packages/api]
  sendMessage.mutation → message row insert (metadata carries the attachmentId list as a reference;
                          thread_attachments is the authoritative store)
   ─► enqueueComputerThreadTurn
       │
       ▼
[Lambda — chat-agent-invoke]
  ├─ for the message being dispatched, SELECT thread_attachments WHERE message_id = ?
  │    → list of { attachmentId, s3_key, mime_type, size_bytes, name }
  ├─ payload.message_attachments = that list
  └─ LambdaClient.InvokeCommand(agentcore-lambda, payload)
       │
       ▼
[Strands Lambda container — server.py]
  Per-turn entry inside _execute_agent_turn:
   - turn_id = uuid4()
   - turn_dir = f"/tmp/turn-{turn_id}/attachments/"
   - for each ref in payload["message_attachments"]:
       boto3 download from s3_key → turn_dir/<name>   (per turn; ephemeral)
   - message_attachments rides directly on the payload dict (NOT through apply_invocation_env)
   - _build_system_prompt injects "Files attached this turn:" preamble pointing at turn_dir/<name>
   model loop:
     - Skill(name="finance-statement-analysis", ...) loads SKILL.md body
     - skill body instructs file_read(turn_dir + "<name>")
     - skill_meta_tool fires audit event skill.activated (deduped per-turn)
     - agent produces output (text + tables + JSX/shadcn charts)
     - MessageArtifact row insert fires audit event output.artifact_produced

[Storage / lifecycle]
  - S3 is the durable store. Bucket-level lifecycle policy ages attachments after N days (Terraform-configured).
  - thread_attachments rows persist for thread lifetime; admin Thread Detail reads them directly.
  - /tmp/turn-<id>/ is ephemeral; cleared on next cold start, ignored across warm invocations (unique per turn_id).
  - No filesystem mount, no VPC change, no AgentCore Runtime control-plane involvement.
```

*This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

---

## Key Technical Decisions

- **Wire the existing AI Elements attachment primitive rather than build new.** `prompt-input.tsx` already has drag-drop + paste + file-picker + chips + constraints. Only the consumers and transport need wiring. Building a parallel UI would discard validated work.
- **`thread_attachments` table is the authoritative store; reuse it rather than inventing parallel infrastructure.** The Drizzle schema, GraphQL `ThreadAttachment` type, `Thread.attachments` field, and admin Thread Detail rendering all already exist (`packages/database-pg/src/schema/threads.ts:154`; `packages/database-pg/graphql/types/threads.graphql:71,95`; `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx:346`). U2 inserts rows at finalize time; the existing `Thread.attachments` resolver returns them; admin Thread Detail picks them up. **No new GraphQL type, no new resolver, no `messages.metadata`-derived list.** `messages.metadata.attachments` carries `attachmentId` references only — the source of truth is the row.
- **S3 is the durable store at a thread-scoped prefix, NOT inside the agent workspace.** Path: `s3://thinkwork-<stage>-attachments/tenants/<tenantSlug>/computers/<computerId>/threads/<threadId>/attachments/<attachmentId>/<safeFilename>`. The path is `computers/` not `agents/` — the user-facing noun in Thinkwork is "Computer" (per `project_thinkwork_computer_strands_decision`); the agent workspace prefix is deliberately not touched. The `<attachmentId>/` directory segment ensures unique S3 keys even with identical filenames across messages, and the UUID is also the GraphQL `id`.
- **Upload via presigned PUT (client → S3 direct), not multipart through Lambda.** Pattern modeled on `packages/api/src/handlers/plugin-upload.ts`. Three steps: (a) `POST /api/threads/<thread>/attachments/presign` returns `{signedPutUrl, stagingKey, attachmentId}`; (b) client PUTs file bytes directly to S3; (c) `POST /api/threads/<thread>/attachments/finalize` validates content (size, MIME, magic bytes, OOXML scan), inserts a `thread_attachments` row, emits the `attachment.received` audit event. Rationale: API Gateway has a 10 MB request body cap and Lambda sync invokes are limited to 6 MB — multipart-to-Lambda would fail at 25 MB regardless of the configured `maxFileSize`.
- **Per-turn fetch from S3 → `/tmp/turn-<turnId>/attachments/` inside the Lambda container.** The runtime is `aws_lambda_function` with Image package_type (`terraform/modules/app/agentcore-runtime/main.tf:329`), not a Bedrock AgentCore Runtime resource — there is no `sessionStorage`, no `runtimeSessionId`, no `/mnt/workspace` mount. Lambda `/tmp` is ephemeral per-invocation (warm or cold), so unique `turn_id` per invocation guarantees no cross-turn contamination. The Strands `_execute_agent_turn` SELECTs `thread_attachments` for the current `messageId`, downloads each to `/tmp/turn-<turnId>/attachments/<name>` once, references those paths from the system-prompt preamble. No bootstrap_workspace impact; no cross-thread bandwidth amplification.
- **EFS is the documented v1.5 upgrade path for cross-thread sharing.** Lambda functions support EFS access points (the runtime is Lambda, so this is the natural upgrade lane). Requires VPC migration of the Strands Lambda — a separate, sizable project. When that lands, switch from per-turn `/tmp` staging to a long-lived EFS mount and skip the per-turn S3 download. Pilot horizon does not need cross-thread sharing.
- **`SendMessageInput.metadata` carries `attachmentId` references without schema change.** `metadata: AWSJSON` already exists in `packages/database-pg/graphql/types/messages.graphql:64–73`. The shape is minimal: `metadata.attachments = [{ attachmentId }]` — just the UUID, since `thread_attachments` carries the durable fields.
- **`messageAttachments` rides directly on the invoke payload dict, NOT through `apply_invocation_env`.** Per the feasibility review, `apply_invocation_env` is an `os.environ` setter for scalar string keys; it cannot serialize an array of `{s3_key, name, mimeType, sizeBytes}` records. The field is consumed directly by `_execute_agent_turn(payload)` alongside existing fields like `message`, `mcp_configs`, and `model`. This is the architectural correction to the v2 allowlist-extension framing.
- **Attachment `id` is a UUID minted at presign time and persisted on the row.** Used as the GraphQL `ThreadAttachment.id`, the URL segment in download endpoints, and the S3-key prefix. Eliminates ordinal-enumeration risk; one stable identifier across S3, DB, GraphQL, and audit-event payload.
- **Three new Compliance event types, full slate** (user-confirmed during planning): `attachment.received`, `skill.activated`, `output.artifact_produced`. Each follows the 4-file migration pattern. `attachment.received` payload references the `attachmentId` (UUID) — not raw `s3_key` — to keep operational metadata out of the audit log.
- **`skill.activated` cardinality mitigated by per-turn dedup in `skill_meta_tool.py`.** Emit once per distinct skill slug per turn, not per `Skill(...)` invocation. Dedup state is coroutine-scoped via `ContextVar[set[str]]`, not module-level, to preserve cross-tenant safety under async Strands turns.
- **License verification on `anthropics/financial-services` is a prerequisite gate, not a planning unit.** U5 cannot ship its lifted content until license compatibility is confirmed. Backup plan: re-author the two lifted skills as Thinkwork-originals covering the same methods.
- **No feature flag, no per-tenant gate** (per origin Key Decision). Attachments ship as a general capability; pilot is the first consumer, not the only one. Inert-first seam-swap (`docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md`) handles multi-PR sequencing safely without flags.
- **Compliance event substrate lands before consumer emits.** U6's schema + redaction + drift test ship first; U2's and U4's emit paths wire on the next deploy. Avoids "emit throws into DLQ until enum catches up" during normal rollout.
- **No new Strands tool.** Existing `file_read` from `strands_tools` covers attachment reads against `/tmp/turn-<turnId>/attachments/`. Per `docs/solutions/best-practices/injected-built-in-tools-are-not-workspace-skills-2026-04-28.md`, lifted skills are filesystem content, not platform-owned tools.

---

## Implementation Units

### U1. Wire attachments through Computer composers and the AppSync transport

**Goal:** Render the attachment UI in both Computer composers and stop discarding `FileUIPart`s in the transport, so attached files reach the GraphQL mutation as S3 refs.

**Requirements:** R1, R3.

**Dependencies:** U2 (upload endpoint must exist for the transport to call).

**Files:**
- `apps/computer/src/components/computer/ComputerComposer.tsx` (modify)
- `apps/computer/src/components/computer/ComputerComposer.test.tsx` (modify)
- `apps/computer/src/components/computer/TaskThreadView.tsx` (`FollowUpComposer`, modify)
- `apps/computer/src/components/computer/TaskThreadView.test.tsx` (modify)
- `apps/computer/src/lib/use-composer-state.ts` (modify — wire `files`/`addFile`/`removeFile` to `PromptInput` attachment context)
- `apps/computer/src/lib/use-chat-appsync-transport.ts` (modify — upload `FileUIPart`s, append refs to `metadata.attachments`)
- `apps/computer/src/lib/use-chat-appsync-transport.test.ts` (add or modify)

**Approach:**
- Both composers render `<PromptInputActionAddAttachments />` in the action row plus `<PromptInputAttachments>` chip row above the textarea. Pass `label="Attach file"` and override the default `ImageIcon` to `IconPaperclip` from `@tabler/icons-react` (`stroke={2}`); the default "Add photos or files" / image affordance signals image upload, which is the wrong mental model for the Excel/CSV primary use case.
- `use-composer-state.ts` already exposes `files`, `addFile`, `removeFile`, `clearFiles`; U1 wires these into the `PromptInputProvider`'s `AttachmentsContext` inside each composer (the state layer is not new work).
- On submit, composers forward `message.files` (not just `text`) to the mutation entry point.
- `use-chat-appsync-transport.ts`: for each `FileUIPart` in the outgoing message, POST to the upload endpoint (U2), receive `{path, mimeType, sizeBytes}`, append to `metadata.attachments`. Strip the `FileUIPart` from the wire payload (only refs travel through GraphQL).
- Accepted types: `.xlsx`, `.xls`, `.csv` initially; `.pdf` optional follow-on. Constants for `maxFileSize` (start at 25 MB) and `maxFiles` (start at 5) live in `use-chat-appsync-transport.ts`.
- Visible feedback: chip row shows attached files; chip transitions from "uploading…" to "ready" once upload resolves; error toast on upload failure with a retry affordance.

**Patterns to follow:**
- `apps/computer/src/lib/use-composer-state.ts` invariants (per Vercel-AI-SDK transport adoption decisions in `project_computer_ai_elements_adoption`); keep submission single-source-of-truth.
- AI Elements RSC-friendly `"use client"` discipline.
- `@tabler/icons-react` (`stroke={2}`) for any new icons (per `feedback_computer_tabler_icons_preference`); existing `lucide-react` references in `prompt-input.tsx` stay untouched.

**Test scenarios:**
- Happy path: given a thread is open, when the operator drags an `.xlsx` into the composer, types text, and submits, the transport POSTs the file to the upload endpoint, receives an S3 key, appends to `metadata.attachments`, and calls `sendMessage` with the text content and the metadata refs only (no base64 payload).
- Multiple files: given two `.csv` files attached, when submitted, each is uploaded separately, both appear in `metadata.attachments` in order, and the chip row clears.
- Backspace pops attachment: given the textarea is empty and one chip is rendered, when the operator presses Backspace, the chip removes (existing primitive behavior; verify the consumer doesn't break it).
- Paste-to-upload: given the operator pastes a file blob from clipboard, the chip appears, and submission paths it through the upload route.
- `maxFileSize` exceeded: a 30 MB Excel file dropped fires `onError({ code: "max_file_size" })`; the chip does not render.
- Wrong file type: a `.exe` fires `onError({ code: "accept" })`; no upload attempted.
- Upload failure: given the upload endpoint returns 500, the chip transitions to error state with a retry affordance and the submit button stays disabled (or surface error before submit can complete).
- Transport drops `FileUIPart` from wire: given a submission with `FileUIPart` parts, the GraphQL mutation payload contains only `text` parts plus `metadata.attachments` — never the base64 data URL.
- Empty `message.files`: behavior is unchanged from today; metadata is absent or empty.
- *Covers AE1.* End-to-end: a real attached `.xlsx`, a real user prompt, and a real mutation lands; subsequent agent turn cites a value from the file.

**Verification:**
- Both composer test suites pass with new attachment paths covered.
- Manual smoke in dev: the upload endpoint receives the file, the mutation lands with attachment refs in metadata, the assistant response references at least one value from the uploaded file.

---

### U2. Thread-attachment upload endpoint

**Goal:** A pair of tenant-scoped REST endpoints (`presign` + `finalize`) that upload an attachment directly to S3 via presigned PUT and persist a row in the existing `thread_attachments` table.

**Requirements:** R1, R2.

**Dependencies:** U6 (event-type registered) must land first in each target environment; U2's `finalize` audit emit throws on missing enum entry per the inert-first pattern.

**Files:**
- `packages/api/src/handlers/thread-attachments-presign.ts` (new — `POST /api/threads/<threadId>/attachments/presign`)
- `packages/api/src/handlers/thread-attachments-finalize.ts` (new — `POST /api/threads/<threadId>/attachments/finalize`)
- `packages/api/src/__tests__/handlers/thread-attachments-presign.test.ts` (new)
- `packages/api/src/__tests__/handlers/thread-attachments-finalize.test.ts` (new)
- `terraform/modules/app/lambda-api/handlers.tf` (modify — declare the two new routes; pattern mirrors the existing `plugin-upload` presign route)
- `terraform/modules/app/agentcore-runtime/main.tf` (modify — IAM grant Lambda role `s3:PutObject` and `s3:GetObject` on the attachments prefix; bucket lifecycle policy for attachments)
- `terraform/modules/app/storage.tf` or equivalent (modify — declare/extend the attachments bucket + per-tenant prefix lifecycle policy)
- `scripts/build-lambdas.sh` (entries for both new handlers per `feedback_lambda_zip_build_entry_required`)

**Approach:**
- Modeled on `packages/api/src/handlers/plugin-upload.ts` (the existing presigned-PUT pattern in the repo). Two endpoints, two Lambda handlers.
- **`POST /api/threads/<threadId>/attachments/presign`:**
  - Auth: Cognito JWT. Resolve tenant via `resolveCallerTenantId(ctx)` per `feedback_oauth_tenant_resolver`. Resolve `threadId → (tenantId, computerId)` from the `threads` table; assert resolved `tenantId === resolveCallerTenantId(ctx)`. Return identical `404` for both "thread does not exist" and "thread exists in another tenant" to eliminate the enumeration oracle.
  - Validate: declared MIME in allowlist (`.xlsx`, `.xls`, `.csv`; optionally `.pdf` follow-on); declared size ≤ `maxFileSize` (start at 25 MB); filename sanitized for path traversal AND prompt injection (strip newlines, control characters, U+202E direction overrides, zero-width chars; cap length to 255 bytes after sanitization). Reject `.xlsm` outright at declared-MIME check.
  - Mint `attachmentId` = UUID. Compose staging S3 key: `tenants/<tenantSlug>/computers/<computerId>/threads/<threadId>/attachments/<attachmentId>/<safeFilename>` (all components DB-resolved, never caller-supplied except the sanitized filename).
  - Return `{ signedPutUrl, stagingKey, attachmentId, expiresAt }`. Presigned PUT TTL = 5 minutes.
  - Do NOT insert a `thread_attachments` row yet; do NOT emit audit event. The row + event come at `finalize`, after content validation.
- **`POST /api/threads/<threadId>/attachments/finalize`:**
  - Body: `{ attachmentId, stagingKey, name, declaredMimeType, declaredSizeBytes }`. No `messageId` — the message↔attachment link lives in `messages.metadata.attachments`, NOT on the row. `thread_attachments` has no `message_id` column (verified in v3 round-3 doc review).
  - Same tenant-pin discipline as `presign`.
  - Verify the S3 object exists at `stagingKey`. Fetch actual size and content-type from S3 HEAD; reject if either disagrees with declared values beyond tolerance.
  - **Server-side content sniffing:** download first 64 KB; verify magic bytes (`.xlsx` → `PK\x03\x04`; `.xls` → `0xD0CF11E0` CFBF). For `.xlsx`, parse the OOXML zip container; reject if `xl/vbaProject.bin` (macros) or `xl/externalLinks/` present; cap decompressed-size ratio (zip-bomb defense).
  - Insert a row into the existing `thread_attachments` table (`packages/database-pg/src/schema/threads.ts:154-172`) with `(id=attachmentId, tenant_id, thread_id, name, s3_key, mime_type, size_bytes, uploaded_by, created_at)` — exactly the columns the schema defines. No `message_id` field is written. Use the existing schema; do not invent a new table; **no schema migration on this table for the pilot**.
  - Emit `attachment.received` audit event via `emitAuditEvent` inside the same transaction. Payload references `attachmentId` only — not raw `s3_key`. Until U6 ships, emit throws on missing enum entry (deliberate visible failure per inert-first pattern).
  - Response: `{ attachmentId, name, mimeType, sizeBytes }` — the client puts the `attachmentId` into `metadata.attachments = [{attachmentId}]` on the next `sendMessage` mutation. That metadata array is the message↔attachment link.
- S3 bucket configuration: presigned URLs generated with `ResponseContentDisposition: 'attachment; filename="<safeFilename>"'` baked in (download safety; same pattern reused in U9). `X-Content-Type-Options: nosniff` set at the bucket level via CORS / object headers.
- Bucket lifecycle policy ages attachments out after the configured retention (Terraform-set, default 90 days). Documented in Scope Boundaries.

**Patterns to follow:**
- `packages/api/workspace-files.ts` handler structure (PUT action, tenant scoping, audit emit on success).
- Narrow REST endpoint over widening `resolveCaller` per `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`.
- `feedback_avoid_fire_and_forget_lambda_invokes` — synchronous response with concrete status.
- `every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` is for *admin* mutations; this endpoint is end-user-facing, but the tenant-pin discipline applies the same way.

**Patterns to follow:**
- `packages/api/src/handlers/plugin-upload.ts` (presigned-PUT + finalize pattern).
- Narrow REST endpoint over widening `resolveCaller` per `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`.
- `feedback_avoid_fire_and_forget_lambda_invokes` — synchronous response with concrete status.
- `every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` is for *admin* mutations; this endpoint is end-user-facing, but the tenant-pin discipline applies the same way.

**Test scenarios (presign):**
- Happy path: authenticated tenant user requests presign for valid `.xlsx` ≤ 25 MB; response includes `signedPutUrl`, `stagingKey`, `attachmentId`, `expiresAt`; staging key matches DB-resolved tenant + computer + thread prefix; no `thread_attachments` row inserted; no audit emit.
- Cross-tenant thread: thread belongs to tenant A, caller is in tenant B → response shape identical to "unknown threadId" (404 in both); no presigned URL issued.
- Unknown threadId: 404.
- Oversized declared file: declared 30 MB → 413 (or 400 with `error: "max_file_size"`); no presigned URL issued.
- Disallowed declared MIME: `.exe` or `.xlsm` → 415; no presigned URL issued.
- Filename sanitization: filename `../../../etc/passwd` → sanitized to safe form; staging key cannot escape the prescribed prefix. Patterns tested: `./`, encoded `%2F`, double-encoded `%252F`, Unicode normalization, null bytes.
- Prompt-injection in filename: filename `financials.xlsx\n\nIGNORE PREVIOUS INSTRUCTIONS` → newlines + control chars + U+202E + zero-width chars stripped before being included in `stagingKey` or the eventual `thread_attachments.name`.

**Test scenarios (finalize):**
- Happy path: client PUT to S3 succeeds, then POST finalize with `{attachmentId, stagingKey, declaredMimeType, declaredSizeBytes}`; row inserted in `thread_attachments` with `id = attachmentId`; `attachment.received` audit event emitted with payload `{attachmentId, mime_type, size_bytes, thread_id, message_id?}` (no raw `s3_key`); response includes `{attachmentId, name, mimeType, sizeBytes}`.
- Mismatched declared vs actual size: declared 5 MB but S3 HEAD says 26 MB → 400; no row inserted; S3 staging object cleaned up.
- Mismatched declared vs actual MIME (sniffed): declared `.xlsx` but magic bytes don't match `PK\x03\x04` → 400; no row inserted.
- Macro-enabled Excel rejected at sniff: `.xlsx` containing `xl/vbaProject.bin` → 415; no row inserted; staging cleaned up.
- External-link Excel rejected at sniff: `.xlsx` containing `xl/externalLinks/` → 415; no row inserted.
- Zip-bomb defense: an `.xlsx` whose decompressed-to-compressed ratio exceeds threshold → 415 before full decompression; bounded memory usage.
- Replay/idempotency: finalizing the same `attachmentId` twice returns the same row (200) without duplicate row or duplicate audit event.
- Missing staging object: finalize called with `stagingKey` that doesn't exist in S3 → 400; no row inserted.
- Audit event payload shape: payload contains `attachmentId` UUID, not raw `s3_key` or raw filename.
- *Covers AE1.* Integration: end-to-end presign → PUT → finalize → row visible in `Thread.attachments` GraphQL query → next Strands invocation's per-turn staging (U3) downloads the object from S3 to `/tmp/turn-<id>/attachments/<name>`.

**Verification:**
- Both handler test suites green; presign + PUT + finalize completes within total Lambda budget for a 25 MB file.
- S3 path matches the agreed convention exactly so U3's Strands surface can rely on it.
- `Thread.attachments` GraphQL query returns the newly-inserted row in admin Thread Detail.

---

### U3. Plumb attachment refs through GraphQL → Lambda → Strands envelope and stage per-turn into /tmp

**Goal:** `SendMessageInput.metadata.attachments` (list of `attachmentId` UUIDs) is resolved to the full attachment records in `chat-agent-invoke`, passed in the invoke payload, and downloaded by Strands into `/tmp/turn-<turnId>/attachments/<name>` at turn entry. The agent's system prompt receives a "Files attached this turn:" preamble referencing those absolute paths.

**Requirements:** R2.

**Dependencies:** U2 (`thread_attachments` table populated by finalize; presign endpoint live).

**Files:**
- `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.ts` (modify — accept `metadata.attachments: [{attachmentId}]`, persist on the message row's `metadata` JSON. NO `thread_attachments` row write; NO `message_id` backfill. The metadata array is the link.)
- `packages/api/src/lib/computers/thread-cutover.ts` (modify — for the cutover message, read `message.metadata.attachments`, SELECT `thread_attachments WHERE id = ANY(:attachmentIds) AND tenant_id = :tenantId`, pass rows to `invokeChatAgent` as `messageAttachments`)
- `packages/api/src/handlers/chat-agent-invoke.ts` (modify — accept `messageAttachments: Array<{attachmentId, s3_key, name, mimeType, sizeBytes}>`, include in invoke payload dict)
- `packages/api/src/handlers/__tests__/chat-agent-invoke.test.ts` (modify)
- `packages/agentcore-strands/agent-container/container-sources/server.py` (modify — `_execute_agent_turn` reads `payload["message_attachments"]`, downloads to per-turn `/tmp` directory, injects preamble in `_build_system_prompt`)
- `packages/agentcore-strands/agent-container/test_attachment_staging.py` (new — verify per-turn S3-fetch behavior with mocked boto3)
- `packages/agentcore-strands/agent-container/test_attachment_prompt.py` (new — verify preamble shape and content)

**Approach:**
- **GraphQL → Lambda.** `sendMessage.mutation.ts` accepts `metadata.attachments: [{attachmentId}]` (just the UUID list). The metadata is persisted on the message row; no `thread_attachments` write happens here (the row was already inserted at U2 finalize time). The `messages.metadata.attachments` array is the **only** message↔attachment link — there is no `thread_attachments.message_id` column.
- **Lambda → invoke.** `thread-cutover.ts`'s `dispatchComputerThreadTurn` loads the cutover message; reads `message.metadata.attachments` to get the list of `attachmentId` UUIDs for this turn; SELECTs `thread_attachments WHERE id = ANY(?) AND tenant_id = ?` (defense-in-depth tenant pin); passes the rows into `invokeChatAgent` as `messageAttachments`. `enqueueComputerThreadTurn`'s signature does NOT widen — the row data is fetched at dispatch time. If the metadata array is empty or missing, `messageAttachments` is an empty list and the agent turn proceeds without an attachment preamble.
- **Lambda → Strands.** `chat-agent-invoke.ts` puts `messageAttachments` on the invoke payload dict (sibling to `message`, `mcp_configs`, `model`). The current runtime is `LambdaClient.InvokeCommand` against `agentcore-lambda` — no `runtimeSessionId` is involved; this is a plain Lambda invoke.
- **`message_attachments` rides directly on the payload dict**, NOT through `apply_invocation_env`. The helper is an `os.environ` setter for scalar string keys and cannot serialize an array of records. `_execute_agent_turn` reads `payload["message_attachments"]` directly. **No allowlist extension; the v2 framing was wrong.**
- **Per-turn `/tmp` staging** inside `_execute_agent_turn`:
  - `turn_id = uuid.uuid4().hex`
  - `turn_dir = f"/tmp/turn-{turn_id}/attachments/"`; `os.makedirs(turn_dir, exist_ok=True)`
  - For each ref in `payload["message_attachments"]`:
    - Sanity-check `s3_key` starts with the expected `tenants/<tenantSlug>/computers/<computerId>/threads/<threadId>/attachments/` prefix (defense-in-depth against any envelope tampering).
    - `local_path = os.path.realpath(os.path.join(turn_dir, ref["name"]))`. Verify `local_path.startswith(os.path.realpath(turn_dir))` (path-escape defense).
    - `boto3.client("s3").download_file(bucket, ref["s3_key"], local_path)`. Log structured warnings on fetch failures and proceed (model gracefully reports unreadable files; better than fabricating).
  - After the turn completes (or fails), `shutil.rmtree(turn_dir, ignore_errors=True)` — explicit cleanup, no reliance on Lambda /tmp eviction.
- **Env snapshot.** Snapshot `THINKWORK_API_URL`, `API_AUTH_SECRET`, `TENANT_ID`, and `CURRENT_USER_ID` at coroutine entry per `feedback_completion_callback_snapshot_pattern` and `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md`. The tenant-identity snapshot is essential because `compliance.ts`'s tenant guard at `POST /api/compliance/events` accepts caller-supplied `tenantId` as authoritative for `actorType=agent` — a stale env var from a warm container could attribute one tenant's emit to another.
- **System prompt preamble.** `_build_system_prompt` injects, immediately after `CONTEXT.md` load, a short preamble: `Files attached to this turn:\n  - /tmp/turn-<turnId>/attachments/<name>\n  - /tmp/turn-<turnId>/attachments/<name>`. The filename component is the sanitized name from U2 (no control characters, no injectable sequences).

**Patterns to follow:**
- Existing `_execute_agent_turn` env-snapshot discipline.
- Test the full chat-agent-invoke path, not direct Lambda invoke, per `feedback_bare_lambda_invoke_not_e2e`.
- `feedback_verify_wire_format_empirically` — verify camelCase TS / snake_case Python field naming with an integration test, not just type checks.

**Test scenarios:**
- Mutation persists attachment references: `SendMessage` with `metadata.attachments: [{attachmentId}]` results in the message row carrying the list; `thread_attachments` rows for those IDs get `message_id` updated.
- Dispatch query: `dispatchComputerThreadTurn` for a message with two attachments produces an invoke payload containing `messageAttachments` with both rows fully populated (`attachmentId`, `s3_key`, `name`, `mimeType`, `sizeBytes`).
- Cross-tenant defense in dispatch: a crafted `messageId` whose `thread_attachments` rows belong to a different tenant returns no rows (the WHERE includes `tenant_id`); invoke payload is empty.
- Strands payload read: an invoke payload containing `message_attachments` is read by `_execute_agent_turn` as a Python list of dicts; no key drops.
- Per-turn staging downloads files: given a payload with one attachment, the file lands at `/tmp/turn-<turnId>/attachments/<name>` before the model loop starts. Verify with mocked boto3 download_file.
- Per-turn isolation: two consecutive turns in the same Lambda container produce two distinct `turn_id` directories; the first is cleaned up after the first turn completes.
- Path-escape defense: a maliciously-crafted `name` containing `../` or absolute path components is rejected by the `os.path.realpath` startswith check; the file is not downloaded.
- S3-key prefix defense: a `messageAttachments` ref whose `s3_key` does not start with the expected tenant/computer/thread prefix is rejected; structured warning logged; turn proceeds.
- System prompt preamble: given a turn with one attachment, the assembled prompt contains the absolute `/tmp/turn-<turnId>/...` path. Fixture-driven assertion on prompt body.
- No attachments: given a turn with no attachments, the preamble line is absent (no empty "Files attached this turn:" block).
- Download failure: simulate `download_file` throwing; the turn proceeds, structured warning logged, model receives a preamble that omits the failed file (or marks it as unavailable).
- *Covers AE1.* End-to-end: upload via U2, send via U3, the model's response cites a value found in the file via `file_read`.

**Verification:**
- TS + Python tests pass.
- Manual smoke: upload an `.xlsx`, send a message, the model's response references content from the file.

---

### U4. Strands attachment-aware prompt and `skill.activated` audit emit

**Goal:** Strands' `skill_meta_tool.py` audits each distinct skill activation once per turn; the system prompt preamble shape is finalized based on first-smoke observations.

**Requirements:** R7, R11 (skill-activation half).

**Dependencies:** U3 (preamble lives there), U5 (skills must exist to activate), U6 (event-type registered).

**Files:**
- `packages/agentcore-strands/agent-container/container-sources/skill_meta_tool.py` (modify — `skill.activated` audit emit with per-turn dedup)
- `packages/agentcore-strands/agent-container/container-sources/server.py` (modify if preamble wording needs iteration beyond U3)
- `packages/agentcore-strands/agent-container/test_skill_activation_audit.py` (new)
- `packages/agentcore-strands/agent-container/test_attachment_prompt.py` (extend from U3)

**Approach:**
- `skill_meta_tool.py`: on each `Skill(name=...)` call, check a coroutine-scoped `activated_this_turn: set[str]` keyed on skill slug. First activation of a slug per turn emits `skill.activated` via `compliance_client.emit_event`; subsequent invocations of the same slug in the same turn skip the emit.
- Snapshot `THINKWORK_API_URL` + `API_AUTH_SECRET` at coroutine entry per `feedback_completion_callback_snapshot_pattern`; never re-read `os.environ` after the agent turn starts.
- Emit failure (audit POST returns non-2xx) is logged but does not fail the turn. The hash chain integrity check at drainer time catches dropped events separately.
- Denied activations (skill not in the allowlist intersection) still emit, with `payload.outcome: "denied"` + `payload.denied_reason: <short label>`.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/container-sources/compliance_client.py` for event emission shape.
- Per-turn dedup via coroutine-scoped state, not module-level, to preserve cross-tenant safety.

**Test scenarios:**
- Single skill, three calls in one turn → one `skill.activated` event emitted.
- Two distinct skills in one turn → two events emitted, in invocation order.
- Denied activation: model calls a skill blocked by template-kill-switch; one event emitted with `outcome: "denied"` and a reason.
- Env snapshot at coroutine entry: simulate `os.environ["THINKWORK_API_URL"]` change mid-turn; the emit uses the snapshot-time value. Mirrors the regression test from `agentcore-completion-callback-env-shadowing-2026-04-25.md`.
- Emit failure non-fatal: simulate a 500 response from `/api/compliance/events`; the turn completes; failure is logged.
- Cross-coroutine isolation: two concurrent agent invocations (different tenants) each have independent `activated_this_turn` sets; one's activations do not suppress the other's emits.

**Verification:**
- `skill.activated` events visible in `compliance.audit_events` after a real demo run.
- Per-skill cardinality verified to be exactly 1 per turn even under repeated `Skill(...)` calls.

---

### U5. Lift three financial-analysis skills into `packages/skill-catalog/`

**Goal:** Three `execution: context` skills present in the catalog, agentskills.io-shaped, retaining Anthropic's domain content (where lifted), ready for workspace install.

**Requirements:** R4, R5, R6.

**Dependencies:** License-verification gate (prerequisite — see Dependencies).

**Files:**
- `packages/skill-catalog/finance-3-statement-model/SKILL.md` (new — lifted from `anthropics/financial-services/plugins/vertical-plugins/financial-analysis/skills/3-statement-model.md`)
- `packages/skill-catalog/finance-3-statement-model/README.md` (new)
- `packages/skill-catalog/finance-3-statement-model/references/<phase>.md` (new as needed)
- `packages/skill-catalog/finance-audit-xls/SKILL.md` (new — lifted from `audit-xls.md`)
- `packages/skill-catalog/finance-audit-xls/README.md` (new)
- `packages/skill-catalog/finance-audit-xls/references/<phase>.md` (new as needed)
- `packages/skill-catalog/finance-statement-analysis/SKILL.md` (new — Thinkwork-authored ratios/trends/anomaly skill)
- `packages/skill-catalog/finance-statement-analysis/README.md` (new)
- `packages/skill-catalog/finance-statement-analysis/references/<phase>.md` (new as needed)
- `packages/skill-catalog/__tests__/skill-md-frontmatter.test.ts` (modify only if a fixture case is needed)

**Approach:**
- Each `SKILL.md` carries Thinkwork's frontmatter shape (mirrors `packages/skill-catalog/account-health-review/SKILL.md`): `name`, `display_name`, `description`, `license` (set per the verified Anthropic license), `metadata.author` (`"thinkwork (adapted from anthropic/financial-services)"` for lifted skills; `"thinkwork"` for the new one), `metadata.version: "0.1.0"`, `execution: context`, `version: 2`.
- `triggers.chat_intent.examples` lists phrases the model matches on (e.g., "analyze this income statement", "what stands out in the trend", "audit this model").
- `requires_skills: []` initially.
- `allowed-tools: []` — runtime defaults apply.
- Body content:
  - `finance-3-statement-model`: keep the 3-statement-build methodology; strip DCF / comps / LBO sections (out of pilot scope).
  - `finance-audit-xls`: lift the Excel-audit methodology; tighten to "audit an uploaded model" rather than the broader investment-banking review.
  - `finance-statement-analysis`: Thinkwork-authored. Covers trend extraction across periods, ratio panel (margin, current ratio, leverage), and anomaly callouts. Instructs the model to read attached files at the preamble paths and cite specific values back.
- Naming: `finance-` prefix on all three slugs to avoid collisions with future generic `audit-xls` / `statement-analysis` skills (per `docs/solutions/workflow-issues/skill-catalog-slug-collision-execution-mode-transitions-2026-04-21.md`).
- All three pass `pnpm --filter @thinkwork/skill-catalog test` (frontmatter + census + tier1-metadata-shape) and `scripts/validate-skill-catalog.sh`.

**Patterns to follow:**
- `packages/skill-catalog/account-health-review/` for directory shape and frontmatter conventions.
- `docs/solutions/architecture-patterns/workspace-skills-load-from-copied-agent-workspace-2026-04-28.md` — workspace skill activation contract.
- `docs/solutions/best-practices/injected-built-in-tools-are-not-workspace-skills-2026-04-28.md` — these are filesystem content, not platform tools.

**Execution note:** License verification must complete before this unit's PR opens. If `anthropics/financial-services` license is incompatible, the lifted bodies must be reauthored from public-domain finance method references instead.

**Test scenarios:**
- Frontmatter validity: all three SKILL.md files pass `skill-md-frontmatter.test.ts` (valid slug, required keys, `execution: context`, `version: 2`).
- Census coverage: all three appear in the catalog census test.
- Body sanity: each SKILL.md body has at least one section header, parses as valid Markdown, contains no absolute paths.
- No platform-tool leakage: none of the three skills reference platform-only tools (e.g., `code_interpreter`); they target `file_read` plus model reasoning.
- Workspace install round-trip: given a test tenant, when each skill is POSTed to `/api/workspaces/files`, the file lands, `deriveAgentSkills` fires, `agent_skills` reflects the new slug. Integration test under `packages/skill-catalog/scripts/__tests__/`.
- *Covers AE2.* Operator-perspective: after the install script runs (U7), the three Thinkwork-shaped skill directories exist under the prospect's workspace; no comps / DCF / LBO / pitchbook skills present.

**Verification:**
- All catalog tests green; `sync-catalog-db.ts` succeeds in dev; an operator can install via U7's script.

---

### U6. Three new Compliance event types: `attachment.received`, `skill.activated`, `output.artifact_produced`

**Goal:** The three event types are registered in the schema, redaction allow-list covers their payload shapes, drift tests enumerate them, the drainer validator accepts them, and TS-side emit paths fire.

**Requirements:** R11, R12.

**Dependencies:** None — independent infra migration; lands first or in parallel with U2.

**Files:**
- `packages/database-pg/src/schema/compliance.ts` (modify — append three new entries to `COMPLIANCE_EVENT_TYPES`)
- `packages/database-pg/drizzle/NNNN_compliance_event_types_finance_pilot.sql` (generated via `pnpm --filter @thinkwork/database-pg db:generate`; hand-rolled with `-- creates:` markers per `feedback_handrolled_migrations_apply_to_dev` if `db:generate` does not emit enum changes for this schema)
- `packages/api/src/lib/compliance/redaction.ts` (modify — payload schemas for the three new types)
- `packages/api/src/__tests__/compliance-event-type-drift.test.ts` (modify — update expected list)
- `packages/api/src/lib/compliance/__tests__/event-types.test.ts` (modify — add cases for each new type)
- `packages/api/src/handlers/compliance.ts` (modify only if payload-shape switch needs new cases; otherwise the validator is data-driven)
- `packages/api/src/handlers/messages.ts` (modify — emit `output.artifact_produced` at the `MessageArtifact` row-insert site around lines 243-262)
- `packages/api/src/lib/compliance/event-schemas.ts` (modify — register payload schemas for `attachment.received`, `skill.activated`, `output.artifact_produced`)

**Approach:**
- Substrate-first inert→live per `docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md`: ship the schema enum + redaction + drift test first; consumers (U2's `attachment.received` emit, U4's `skill.activated` emit, the artifact-row-insert emit in this unit) wire in subsequent deploys.
- Payload shapes (minimal, redaction-friendly):
  - `attachment.received`: `{ attachmentId, thread_id, message_id?, mime_type, size_bytes }` (UUID reference only — raw `s3_key` is intentionally excluded to keep operational metadata out of audit log).
  - `skill.activated`: `{ thread_id, agent_id, skill_slug, outcome: "allowed" | "denied", denied_reason?: string }`.
  - `output.artifact_produced`: `{ thread_id, message_id, artifact_id, artifact_type, size_bytes?: number }`.
- Cardinality mitigation for `skill.activated`: per-turn dedup in Python lives in U4.
- TSC mapping is doc-side only (extend the brainstorm's Control / Evidence table); no code change.
- For the artifact emit, TS-side at `MessageArtifact` row insertion is the single source of truth — not Python-side from inside the turn (the row is the durable evidence; mid-turn references may not become rows).

**Patterns to follow:**
- 4-file Compliance migration pattern from `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md`.
- `feedback_handrolled_migrations_apply_to_dev` — if the migration is hand-rolled, apply via `psql -f` to dev before merge, with `-- creates: public.X` markers in the file header so the drift reporter can check.

**Execution note:** Schema + redaction + drift test land *before* U2 and U4 ship their emit paths.

**Test scenarios:**
- Drift test: enumerates the three new types; fails on a branch that omits any one of them.
- Redaction round-trip: each new type's representative payload survives `redactEvent` and renders in the auditor view.
- Schema migration applies cleanly to dev: `db:migrate-manual` reports no drift; `psql` apply succeeds without conflicts.
- TS emit happy path (`attachment.received`): given U2's handler call, a row lands in `compliance.audit_outbox` with the correct event_type and payload.
- TS emit happy path (`output.artifact_produced`): given a `MessageArtifact` insert, a row lands with the correct event_type and payload.
- Python emit happy path (`skill.activated`): given U4's emit, the POST to `/api/compliance/events` succeeds and the drainer moves the event to `compliance.audit_events`.
- Hash chain integrity preserved: a full drain cycle after the new types are added passes the per-tenant hash-chain check.
- *Covers AE3.* Operator-perspective: after a pilot session, the Compliance log filtered to the prospect tenant shows all three event types in chronological order.

**Verification:**
- Drift test green; one event of each type visible in dev `compliance.audit_events` after a smoke run.
- Auditor view renders all three.

---

### U7. Operator install script + pilot smoke-test runbook

**Goal:** A one-shot script an operator runs to install the three pilot skills into a specified prospect tenant, plus a short runbook for the demo flow.

**Requirements:** R9, R10.

**Dependencies:** U1, U2, U3, U4, U5, U6 all live in the target environment.

**Files:**
- `packages/skill-catalog/scripts/install-finance-pilot.ts` (new — installs the three skills into a target tenant via `POST /api/workspaces/files`)
- `packages/skill-catalog/scripts/__tests__/install-finance-pilot.test.ts` (new — mocks the API client, asserts the correct PUTs)
- `docs/runbooks/finance-pilot-operator-guide.md` (new — brief operator-facing runbook for the demo)

**Approach:**
- Script accepts `--stage`, `--tenant-slug`, `--agent-slug` (or `--template-slug` for template-workspace install). Reads files from `packages/skill-catalog/finance-*` and POSTs each to `/api/workspaces/files`.
- Auth: uses the operator's Cognito session via the existing CLI auth flow (mirrors `apps/cli` patterns).
- Idempotent: re-running overwrites existing files (matching existing `workspace-files.ts` PUT semantics).
- Runbook covers:
  1. Operator runs the install script against the prospect tenant.
  2. Operator opens Computer in the prospect tenant.
  3. Operator drops a sample `internal_financial_statements.xlsx` into the composer.
  4. Asks: "what stands out in the trend?"
  5. Verifies the model response cites specific numbers from the file.
  6. Operator opens the Compliance log filtered to the prospect tenant and confirms `attachment.received`, `skill.activated` (one per distinct skill used), and `output.artifact_produced` events are present in chronological order.
  7. Operator re-opens the thread via the Computer / threads UI to confirm session re-entry works.
  8. Operator opens the admin Thread Detail view (`/threads/<threadId>`) and confirms the ATTACHMENTS panel lists every uploaded file with filename + size + timestamp, and that the download action returns the original bytes.

**Patterns to follow:**
- HTTP-calling CLI command patterns from `apps/cli/src/commands/` (Cognito JWT + stage-resolved base URLs). `packages/skill-catalog/scripts/sync-catalog-db.ts` writes to the DB directly and is NOT the right model for this script.
- `feedback_bootstrap_script_excludes_dev_artifacts` — keep installed files clean.

**Execution note:** The runbook is operator-facing and brief (one page). Do not over-invest; this is a pilot artifact.

**Test scenarios:**
- Script PUTs the correct files: given `--tenant=prospect-co --agent=ag-pilot`, the script issues exactly N PUTs (3 skills × {SKILL.md, README.md, references/*} matching actual file count) at the expected workspace paths.
- Idempotent re-run: re-running the script overwrites without error and does not duplicate any audit emits (verify by counting `workspace.governance_file_edited` / equivalent events).
- Auth failure surface: an expired Cognito session causes the script to fail fast with a specific message (not a silent 401).
- Missing source file: if one of the local SKILL.md files is absent, the script fails with an error naming that file.

**Verification:**
- Script unit tests green.
- Manual end-to-end smoke run on dev stage matches the documented operator flow; all three audit event types appear in `compliance.audit_events`; admin Thread Detail's ATTACHMENTS panel lists the uploaded files.

---

### U8. DROPPED — AgentCore Runtime sessionStorage filesystem configuration

**Status:** Dropped in v3 re-cut on 2026-05-14.

**Reason:** The Strands runtime is `aws_lambda_function` (Image package_type) per `terraform/modules/app/agentcore-runtime/main.tf:329`, not a Bedrock AgentCore Runtime resource (`aws_bedrockagentcore_agent_runtime`). The `filesystem_configurations.session_storage` API belongs to AgentCore Runtime — Lambda functions cannot use it. There is no `runtimeSessionId`, no `/mnt/workspace`, and no AgentCore Runtime control plane in this stack. The v3 architecture stages attachments per-turn into Lambda `/tmp/turn-<turnId>/` (covered in U3); no Terraform-side mount change is required.

Per the plan's U-ID stability rule, U8 is left as a gap in the sequence rather than renumbered. EFS access points on Lambda remain the v1.5 upgrade path (see Scope Boundaries → Deferred to Follow-Up Work) and would be U10 (or later) when scheduled.

---

### U9. Admin Thread Detail — populate the ATTACHMENTS panel with real attachments

**Goal:** Wire the existing admin Thread Detail ATTACHMENTS panel for download AND patch a pre-existing tenant-pin gap in the `Thread.attachments` GraphQL resolver. The list-rendering surface already exists (`Thread.attachments` → `apps/admin/.../$threadId.tsx:346` already maps `thread?.attachments`), but the existing resolver at `packages/api/src/graphql/resolvers/threads/thread.query.ts` does NOT enforce tenant pinning (verified in v3 round-3 doc review). Reusing this resolver for the pilot without a tenant-pin patch would expose every tenant's attachments to any authenticated user who can guess a thread UUID. **U9 is therefore P0-class** — the resolver patch must land before any pilot data exists in `thread_attachments`.

**Requirements:** R3 (visible feedback in operator surfaces), R12 (operator can re-open a session and inspect what was attached).

**Dependencies:** U2 (presign + finalize endpoints + `thread_attachments` row inserts).

**Files:**
- `packages/api/src/graphql/resolvers/threads/thread.query.ts` (modify — patch tenant-pin gap: add `eq(threads.tenant_id, resolveCallerTenantId(ctx))` to the outer threads query AND add `eq(threadAttachments.tenant_id, callerTenantId)` to the nested attachments query as defense-in-depth)
- `packages/api/src/__tests__/graphql/resolvers/threads/thread.query.test.ts` (modify or add — cover cross-tenant access denial; both outer + nested)
- `packages/database-pg/graphql/types/threads.graphql` (modify — remove `s3Key: String` from the `ThreadAttachment` type per F3 resolution; the audit-hardening discipline ("no raw s3_key in audit log") is consistent only if `s3Key` also isn't readable from GraphQL. Clients use the new download endpoint URL instead of constructing S3 paths.)
- `apps/admin/src/lib/graphql-queries.ts` (modify — drop `s3Key` from the `ThreadDetailQuery` attachment selection set; regenerate codegen)
- All consumers of `ThreadAttachment.s3Key` audited — only the admin Thread Detail rendering uses it today, and U9's download-endpoint wiring replaces that use
- `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx` (modify — replace `TODO: Wire to attachment upload mutation when available` at lines 403, 413 with calls to U2's `presign` + S3 PUT + `finalize` flow; replace the chip's download click with a fetch to the new download endpoint)
- `apps/admin/src/routes/_authed/_tenant/threads/$threadId.test.tsx` (modify or add — verify upload + download interactions; empty / single / multi-attachment rendering already covered by existing component, but extend tests for the new actions)
- `packages/api/src/handlers/thread-attachment-download.ts` (new — `GET /api/threads/<threadId>/attachments/<attachmentId>/download` returns a 302 redirect to a short-lived presigned S3 GET URL; tenant-pinned same as U2)
- `packages/api/src/__tests__/handlers/thread-attachment-download.test.ts` (new)
- `terraform/modules/app/lambda-api/handlers.tf` (modify — declare the download route)
- `scripts/build-lambdas.sh` (entry for the new download handler)
- `apps/admin/src/lib/graphql-queries.ts` (verify only — `ThreadDetailQuery` already selects `attachments { id, name, s3Key, mimeType, sizeBytes, uploadedBy, createdAt }`; no change unless F3's `s3Key` resolution removes the field)

**Approach:**
- **No new GraphQL surface, but the existing one needs a tenant-pin patch.** `Thread.attachments` and `ThreadAttachment` already exist in the schema; the existing resolver already returns rows from `thread_attachments`; the existing `ThreadDetailQuery` selects them; the admin component already renders them. **However, the existing `thread.query.ts` resolver performs NO `tenant_id` check** on either the outer threads query or the nested `threadAttachments` query — verified during v3 round-3 doc review. Patching this resolver is a load-bearing part of U9; without it, any authenticated user with a thread UUID can read another tenant's attachments via GraphQL, regardless of any tenant-pin discipline on the new REST endpoints.
- **Patch `thread.query.ts`:**
  - Outer query: change `db.select().from(threads).where(eq(threads.id, args.id))` to add `and(eq(threads.tenant_id, callerTenantId))`. Return `null` for cross-tenant requests (identical to "thread not found" — no enumeration oracle).
  - Nested attachments query: change `db.select().from(threadAttachments).where(eq(threadAttachments.thread_id, args.id))` to add `and(eq(threadAttachments.tenant_id, callerTenantId))` — defense-in-depth, in case the outer query is bypassed via a future resolver entrypoint.
  - Resolve `callerTenantId` via `resolveCallerTenantId(ctx)` per `feedback_oauth_tenant_resolver` (Google-federated users have `ctx.auth.tenantId === null` until the Cognito pre-token trigger lands).
- **Remove `s3Key` from the GraphQL `ThreadAttachment` type.** Per F3 resolution: the audit-payload hardening that keeps raw S3 keys out of `attachment.received` is undercut while `s3Key` is freely readable from the GraphQL surface. Drop the field from `packages/database-pg/graphql/types/threads.graphql`'s `ThreadAttachment`. Admin Thread Detail consumes the download endpoint URL (`/api/threads/<t>/attachments/<id>/download`) instead of constructing S3 URLs from `s3Key`. Audit each consumer of `ThreadAttachment.s3Key` before landing the schema change — the admin component is the known consumer; codegen regeneration in `apps/admin` is required.
- **Wire the upload `TODO`s** at `apps/admin/.../$threadId.tsx:403,413` to the U2 flow:
  1. Operator picks file(s) from the upload button (or drag-drops onto the panel).
  2. For each file: client calls `POST /api/threads/<threadId>/attachments/presign` → receives `{signedPutUrl, stagingKey, attachmentId}`.
  3. Client PUTs file bytes to `signedPutUrl`.
  4. Client calls `POST /api/threads/<threadId>/attachments/finalize` with `{attachmentId, stagingKey, name, declaredMimeType, declaredSizeBytes}` (no `messageId` — admin-attached files aren't bound to a specific message).
  5. On success, refetch `ThreadDetailQuery` to update the attachment list. Show an error toast on any step failure.
- **Download endpoint:** `GET /api/threads/<threadId>/attachments/<attachmentId>/download`. Tenant-pinned: resolve `threadId → tenantId`; verify `attachmentId` belongs to that thread (cross-thread enumeration defense); verify caller's tenant matches; return identical `404` for any unauthorized request. On success, issue a presigned S3 GET URL with `ResponseContentDisposition: 'attachment; filename="<safeName>"'` (5-minute TTL) and 302 redirect the client.
- **Render polish (minimal):** the existing list shows attachments. Make the row clickable to trigger the download. Use `@tabler/icons-react`'s `IconPaperclip` (`stroke={2}`) per the project's icon preference.
- **Upload affordance scope:** this is a small operator nicety in the existing admin surface — it's the wired version of the `TODO` already in the code. Not pilot-blocking; the prospect end-user uploads via Computer composers (U1), not the admin view. The admin upload exists primarily for operators to seed reference files into a thread mid-pilot.

**Patterns to follow:**
- `packages/api/src/handlers/plugin-upload.ts` for the presigned-URL pattern (download mirrors upload; same SDK call shape; same TTL).
- Admin Thread Detail current attachment-rendering code (existing in branch); the upload `TODO` at lines 403 + 413 is the explicit wire-point.
- GraphQL resolver tenant-pin discipline (already in place on `Thread.attachments`; verify the read path enforces it).

**Test scenarios:**
- **Resolver cross-tenant defense (outer):** caller in tenant A queries `thread(id: <tenant-B-thread-uuid>)` → returns `null` (identical shape to unknown thread); no leak. Test for both Cognito-tenanted and Google-federated callers.
- **Resolver cross-tenant defense (nested):** simulate a code path that loads a Thread row without tenant pinning and resolves `.attachments` on it; the nested query still filters by `tenant_id`; cross-tenant rows do not appear. Defense-in-depth verified.
- **Existing list rendering** still works for in-tenant callers after the resolver patch.
- **`s3Key` no longer in GraphQL response:** schema introspection on `ThreadAttachment` returns no `s3Key` field; `ThreadDetailQuery` selects `{id, name, mimeType, sizeBytes, uploadedBy, createdAt}` only (no `s3Key`). Existing tests that compared a serialized `s3Key` value are updated.
- **Admin Thread Detail download path:** click on an attachment row issues `GET /api/threads/<t>/attachments/<id>/download` and receives the file. No client-side S3 URL construction.
- Upload happy path (admin): operator picks a `.xlsx` from the panel's upload button; presign + PUT + finalize complete; `ThreadDetailQuery` refetches; new attachment appears in the list.
- Upload failure surface: presign returns 415 (unsupported MIME); operator sees a clear inline error; no S3 PUT attempted.
- Upload failure surface: S3 PUT fails (signed URL expired); operator sees retry affordance.
- Download happy path: operator clicks an attachment row; receives a download stream of the original bytes; SHA-256 matches the upload.
- Download cross-tenant defense: attachment belongs to tenant A; tenant B admin requests download → 404 (identical to "unknown attachmentId"); no presigned URL issued.
- Download cross-thread defense: `attachmentId` exists but belongs to a different thread → 404 (the URL embeds `threadId`; the lookup must verify both belong together).
- Download presigned-URL safety: the issued S3 URL includes `ResponseContentDisposition: attachment` — verified by reading the URL query string.
- *Covers AE3.* Operator inspection: after a pilot session, the admin view shows the Excel files the prospect uploaded; clicking each downloads the original bytes (verified by SHA-256 of downloaded content vs. uploaded content).

**Verification:**
- Admin Thread Detail tests green for upload + download interactions.
- Manual: open a real pilot thread; upload an `.xlsx` from the admin panel; verify it appears in the list; click to download and verify file integrity.

---

## Scope Boundaries

### Deferred to Follow-Up Work

- **Lambda EFS access point for cross-thread attachment caching (v1.5).** The Strands runtime is a Lambda function (Image package_type). Lambda supports EFS access points behind a VPC. When a VPC migration of the Strands Lambda is on the roadmap, mount an EFS access point at `/mnt/attachments/` and skip the per-turn S3 → /tmp download — files persist across invocations and across threads. Requires VPC for the Lambda (significant work: NAT for Bedrock egress, EFS in private subnets, EFS access point IAM, SG TCP 2049 ingress on EFS). Out of pilot scope; documented in Key Technical Decisions as the upgrade lane. The plan does NOT propose Bedrock AgentCore Runtime's `sessionStorage` — that's a different control-plane resource type and migrating to it is its own (larger) project.
- `xlsx-author` / `pptx-author` skills using `openpyxl` / `python-pptx` in the Strands container (Excel / PowerPoint output authoring).
- ERP MCP connectors (NetSuite, SAP, QuickBooks).
- Plugin importer / translator from Anthropic's Claude Code plugin format to Thinkwork SKILL.md (the lift in U5 is one-time and manual).
- Marketplace install UX in admin (browse/search/install per-template); the script in U7 is the operator path.
- Compliance UI lens for filtering by `attachment.received` / `skill.activated` / `output.artifact_produced` — the events land in the existing log; a dedicated lens is follow-on.
- Admin Thread Detail "Upload attachment" affordance (the panel will display attachments in U9; operator-initiated uploads from the admin view are a v1.5 nicety).
- Comps, DCF, LBO skill lifts (different prospect class).
- PDF attachment support (beyond stub — primary types are `.xlsx`, `.xls`, `.csv`).
- (Stale entry — superseded by the v3 presigned-PUT design in U2 and the presigned-GET design in U9. Upload now uses presign + S3 direct + finalize; multipart-to-Lambda was rejected on Lambda body-limit grounds.)

### True Non-Goals

- External financial data MCP connectors (FactSet, Moody's, Capital IQ, PitchBook, Daloopa, Morningstar).
- KYC / AML / compliance-screening agents.
- Investment-banking flows (Pitch Builder, Valuation Reviewer, Meeting Preparer).
- Microsoft 365 add-in deployment path.
- `/v1/agents` API parity with Anthropic's Managed Agents — Thinkwork AgentCore-Strands fills the same role.
- A general industry-vertical-pack abstraction.

---

## System-Wide Impact

- **GraphQL API.** `SendMessageInput.metadata` gains a documented attachment-id-reference shape (`metadata.attachments = [{attachmentId}]`). No schema break on `metadata` (`AWSJSON` already exists). **No new GraphQL types or queries** — `Thread.attachments` and `ThreadAttachment` already exist. **Schema change**: `ThreadAttachment.s3Key` field is removed (per F3 resolution — operational metadata should not be readable from GraphQL while the audit-payload hardening keeps it out of the log). Resolver patch on `thread.query.ts`: tenant pinning added to both the outer `threads` query and the nested `threadAttachments` query (closes the cross-tenant read leak that existed before this plan).
- **`thread_attachments` table.** Already exists at `packages/database-pg/src/schema/threads.ts:154-172` with columns `id, thread_id, tenant_id, name, s3_key, mime_type, size_bytes, uploaded_by, created_at`. **No `message_id` column** — verified during round-3 doc review. The message↔attachment link lives in `messages.metadata.attachments = [{attachmentId}]`, NOT on the row. No schema migration on this table for the pilot. The row's `id` (UUID minted at presign) is the durable attachment identifier used across S3, GraphQL, and audit-event payload.
- **New REST endpoints.** `POST /api/threads/<threadId>/attachments/presign`, `POST /api/threads/<threadId>/attachments/finalize`, `GET /api/threads/<threadId>/attachments/<attachmentId>/download`. All tenant-pinned via `resolveCallerTenantId(ctx)` + `threadId → tenantId` DB lookup. Multipart-to-Lambda is NOT used (Lambda body limits).
- **Strands invoke envelope.** `messageAttachments` field on the existing Lambda invoke payload dict (sibling to `message`, `mcp_configs`, `model`). Carried directly on the dict, not through `apply_invocation_env`. No `runtimeSessionId` involved — the runtime is `aws_lambda_function`, not AgentCore Runtime; the `LambdaClient.InvokeCommand` path is unchanged otherwise.
- **S3 attachment storage.** New thread-scoped prefix `tenants/<tenantSlug>/computers/<computerId>/threads/<threadId>/attachments/<attachmentId>/<safeFilename>` in a new (or stage-suffixed) attachments bucket. Bucket-level lifecycle policy ages attachments after configured retention (default 90 days). The agent workspace prefix is **untouched** — `bootstrap_workspace.py` is not modified.
- **Compliance schema.** Three new event types; one Drizzle migration; redaction allow-list updates; drift test updates. Hash chain integrity preserved. Payloads reference `attachmentId` (UUID), not raw `s3_key`.
- **Strands Lambda container image.** Changes to `server.py` (per-turn S3-fetch into `/tmp/turn-<turnId>/attachments/`, env snapshot, system-prompt preamble) and `skill_meta_tool.py` (`skill.activated` audit emit). Per `docs/solutions/workflow-issues/agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md`, deploy must explicitly bump the Lambda image after merge — ECR push alone is invisible. **No Terraform-side `filesystem_configurations` change** (that's for AgentCore Runtime resources; this is a Lambda).
- **Computer UI.** Composer behavior changes; chip row newly visible. No keyboard shortcut conflicts (the Backspace-pops behavior is already in the AI Elements primitive).
- **Admin Thread Detail UI.** Existing ATTACHMENTS panel already renders `thread.attachments`. U9 wires the upload `TODO`s (lines 403, 413) to the new presign/finalize endpoints and the download click to the new download endpoint.
- **Skill catalog.** Three new skill directories; `sync-catalog-db` picks them up on next deploy.

---

## Risk Analysis & Mitigation

- **License on `anthropics/financial-services`.** If incompatible with Apache-2.0, U5 must pivot to Thinkwork-authored bodies for the lifted skills. *Mitigation:* verify before U5 PR opens; pre-write fallback bodies referencing public-domain finance methodology sources.
- **Per-turn skill activation cardinality.** Even with per-turn dedup, sustained sessions across many threads grow `compliance.audit_events` row counts. *Mitigation:* dedup in U4; monitor row growth after first pilot run; if growth is problematic, downgrade `skill.activated` to a per-thread summary event in a follow-on (schema change kept reversible).
- **Per-turn S3 download latency.** Each invocation downloads every attached file fresh into `/tmp/turn-<turnId>/` — no caching across turns. For a 25 MB file on a typical Lambda-to-S3 same-region link (~50–100 MB/s), expected ~0.5 sec per file, ~5 sec worst case for 5 max attachments. *Mitigation:* parallelize downloads (`asyncio.gather` or a thread pool of boto3 clients); document expected latency in U3 verification; lift the cap or move to EFS (v1.5) only if the prospect demo reveals the latency as painful.
- **Lambda /tmp eviction during long turns.** Lambda /tmp persists across warm invocations but is bounded (default 512 MB, configurable to 10 GB). A pathological warm-container sequence could accumulate `/tmp/turn-<id>/` directories. *Mitigation:* explicit `shutil.rmtree(turn_dir, ignore_errors=True)` cleanup after every turn (in a `try/finally`), regardless of success/failure path; add a periodic boot-time sweep that removes any `/tmp/turn-*` directories older than 1 hour (defensive — catches turns that crashed before cleanup ran).
- **Cross-tenant leakage via path traversal.** Filename sanitization in U2 is a security boundary. *Mitigation:* explicit test scenarios for traversal patterns (relative paths, encoded `%2F`, double-encoded); treat the upload endpoint with the same scrutiny as auth boundaries.
- **AgentCore runtime image not bumped after merge.** Standard footgun per `feedback_watch_post_merge_deploy_run`. *Mitigation:* explicit runtime-update step in U7's runbook and in every container-side PR's description.
- **GraphQL Lambda deploy via direct update.** Per `feedback_graphql_deploy_via_pr`, never `aws lambda update-function-code graphql-http` directly. *Mitigation:* noted; PR to main and let merge pipeline handle deploy.
- **Inert-first emit window.** Between U6 (event types registered) and U2 / U4 deploying their emit paths, no emits exist for the new types. *Mitigation:* sequence U6 first; treat the window as deliberate. Conversely, U2's emit must throw (not no-op) if its enum entry is missing in the deployed environment.
- **Strands per-turn dedup state leaking across coroutines.** Module-level dedup state would suppress emits for tenant B if tenant A activated the same skill earlier. *Mitigation:* coroutine-scoped state; explicit cross-coroutine isolation test in U4.

---

## Dependencies / Assumptions

- **License verification (PREREQUISITE GATE).** Anthropic's `financial-services` repo license must be confirmed compatible with Apache-2.0 inclusion in `packages/skill-catalog/` before U5's PR opens.
- **`thread_attachments` table + `Thread.attachments` GraphQL field are populated end-to-end by the existing resolver.** Verified during planning at `packages/database-pg/src/schema/threads.ts:154`, `packages/database-pg/graphql/types/threads.graphql:71,95`, and `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx:346`. U2 INSERTs rows; U9 reads via the existing GraphQL surface. If a future schema migration drops or renames `thread_attachments`, U2 + U9 break in lockstep.
- **Compliance event log substrate.** Assumed in place per `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md`. If still inert in any environment the pilot targets, audit emits will route to DLQ; verify before pilot deploy.
- **AI Elements `prompt-input.tsx` API stability.** Assumes `FileUIPart`, `AttachmentsContext`, and submit-pipeline APIs do not break between plan-write and U1 ship. Low risk; worth a glance before opening U1's PR.
- **AppSync subscription chunk schema unchanged.** Plan assumes `use-chat-appsync-transport.ts`'s adapter signature is stable. Verify on first U1 PR.
- **Strands runtime substrate is Lambda + Image package, not AgentCore Runtime.** Verified during planning at `terraform/modules/app/agentcore-runtime/main.tf:329` and `packages/api/src/handlers/chat-agent-invoke.ts:89`. The plan does not introduce `runtimeSessionId`, `/mnt/workspace`, or `filesystem_configurations`; if a future change migrates the runtime to a Bedrock AgentCore Runtime resource, U3's staging path may simplify (it could switch to sessionStorage), but the plan as written does not depend on that migration.
- **Prospect tenant exists with a Computer template.** U7's install script targets a real tenant/computer slug; operator provisions the workspace beforehand.
- **Operator CLI auth current.** U7 script uses Cognito session; operator must have `thinkwork login -s <stage>` completed.

---

## Phased Delivery

- **Phase A — Substrate (lands first, in parallel where independent).**
  - **U9-resolver-patch (P0 SECURITY)** — patch `thread.query.ts` to enforce tenant pinning on both the outer `threads` query and the nested `threadAttachments` query, AND remove `s3Key` from the `ThreadAttachment` GraphQL type. **Must ship before any pilot data exists in `thread_attachments`.** This is a load-bearing security fix carved out of U9; the rest of U9 (admin UI wire-up + download endpoint) ships in Phase C.
  - U6 (Compliance event types — schema + redaction + drift test).
  - U2 (presign + finalize endpoints, with inert-throwing emit until U6 deploys). U2 INSERTs into `thread_attachments` but the table has no `message_id` column (per F1 resolution: the message↔attachment link lives in `messages.metadata.attachments`).
  - U5 (skill content lift — license-gated).
- **Phase B — Plumbing.**
  - U3 (envelope plumbing + per-turn S3 → `/tmp/turn-<id>/` staging in Strands Lambda). Dispatch reads `message.metadata.attachments`, then SELECTs `thread_attachments` by ID list with tenant pin.
- **Phase C — Surface.**
  - U4 (Strands `skill.activated` emit + per-turn dedup).
  - U1 (Computer composer + transport wiring; the user-visible turn).
  - U9-remainder (admin Thread Detail upload wiring via U2 presign/finalize + new presigned-download endpoint at `/api/threads/<t>/attachments/<id>/download`).
- **Phase D — Operations.**
  - U7 (install script + runbook; pilot dry-run on dev).

(U8 was dropped in v3 — see the U8 entry above.)

Within Phase A:
1. **U9-resolver-patch ships FIRST.** No `thread_attachments` rows exist yet for the pilot, so the security gap has zero exposure window. Ship as a small, focused PR before U2 starts writing data.
2. **U6** schema migration must be dev-applied before U2 ships (U2's finalize emit throws on missing enum entry per the inert-first pattern).
3. **U2** ships after U6 + U9-resolver-patch.

Phase B (U3) requires U2 live so the `thread_attachments` rows it reads at dispatch time exist. Phase C requires A + B live. Phase D requires C live. **Explicit pre-pilot gate**: verify Strands Lambda image SHA matches HEAD of main + smoke test that one full upload → finalize → stage → read → audit → download cycle completes end-to-end before the prospect demo.

---

## Outstanding Questions

### Deferred to Implementation

- [Affects U2][Technical] `maxFileSize` (25 MB suggested) and `maxFiles` (5 suggested) — resolve based on actual prospect-statement sizes during first smoke.
- [Affects U2][Technical] Attachments bucket Terraform shape — new dedicated bucket (`thinkwork-<stage>-attachments`) vs stage-suffixed prefix in the existing workspace bucket. No existing attachments bucket today (verified round 3). Resolve at U2 PR time based on operations preference.
- [Affects U2][Technical] Attachment retention (S3 lifecycle policy default): 90 days suggested; finance-PII context may warrant shorter or longer. Resolve with the prospect before pilot demo if they have a retention requirement.
- [Affects U2][Technical] Replay-protection on presigned PUT URLs. A 5-min presigned PUT is a write capability to a known S3 key; if leaked, anyone can overwrite. Should finalize verify content hasn't been swapped between PUT and finalize (compare PUT-time ETag against a stored expected ETag, or require client-supplied SHA-256)? Resolve when implementing U2.
- [Affects U2][Technical] Orphaned-S3-object cleanup. Client uploads via presigned PUT but never calls finalize (tab close, network failure). Bucket lifecycle policy covers it eventually; should there be a sooner sweep (e.g., scheduled Lambda that lists staging-only keys older than 1 hour and deletes)? Resolve at U2 PR time.
- [Affects U3][Technical] Lambda `ephemeral_storage` size for the agentcore runtime. Default is 512 MB; 5 × 25 MB attachments + workspace bootstrap content can stress this. Bump to 1024 MB or 2048 MB via `terraform/modules/app/agentcore-runtime/main.tf`. Resolve when implementing U3.
- [Affects U3][Technical] Parallel vs sequential per-turn S3 downloads. Plan defaults to sequential for simplicity; switch to `asyncio.gather` or thread-pool parallel if turn latency profiling shows it matters. Resolve when implementing U3.
- [Affects U3][Technical] Wire-format casing: TS `messageAttachments` vs Python `message_attachments`. Should be codified as an explicit integration-test assertion (per `feedback_verify_wire_format_empirically`) rather than implicit. Add to U3 test scenarios at implementation time.
- [Affects U3][Technical] /tmp boot-time sweep for orphaned `turn-*` directories from crashed prior invocations. Plan mentions in Risk Analysis but does not codify as a U3 code requirement. Add at implementation time.
- [Affects U4][Technical] System prompt preamble wording. Likely needs iteration based on first smoke with prospect data; resolve via fast iteration during demo prep, not at plan time.
- [Affects U6][Technical] Whether `output.artifact_produced` emit lives on `MessageArtifact` row insert (TS) or inside the Strands turn (Python). Plan recommends TS-side; revisit only if mid-turn artifact emission outpaces row inserts.
- [Affects U6][Technical] Hash-chain retro-replay test — verify pre-migration audit events drain correctly through the post-migration drainer (carried open from rounds 2 + 3). Add as an explicit U6 test scenario at implementation time.
- [Affects U7][Operational] Pre-pilot gate — concrete operator-facing checklist step in `docs/runbooks/finance-pilot-operator-guide.md`: "Run `aws lambda get-function --function-name thinkwork-<stage>-agentcore --query Configuration.ImageUri`; confirm the SHA suffix matches `git rev-parse origin/main`." Add at implementation time.
- [Affects U9][Operational] Presigned-GET URL referer leak during screen-share — finance-PII demo risk. Mitigation options: reduce TTL to 60 seconds, stream bytes through Lambda instead of 302-redirecting, or document the limitation in the operator runbook ("don't screen-share the redirect window"). Resolve at U9 implementation time.
- [Affects U6, U7][Operational] Audit-event outbox→drainer lag. Operator running the runbook back-to-back may see the attachment in the admin panel before the audit event surfaces in `compliance.audit_events`. Document expected lag in the runbook or wait for drain before step 6.
- [Affects U5][Needs research] Anthropic `financial-services` repo license — verify before U5 PR opens (PREREQUISITE GATE, restated for visibility). **Owner: Eric. Completion artifact: a `LICENSE-NOTES.md` in `packages/skill-catalog/finance-*/` directories citing the upstream LICENSE file SPDX identifier and commit SHA, included in U5's PR description.**
