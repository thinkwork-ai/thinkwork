/**
 * Gmail provider for the email memory-source family (THINK-193 U6).
 *
 * Provider-specific pieces only — the provider-neutral email adapter shell
 * (./email.ts) owns projection/subject identity, dossier rendering, and
 * claim extraction. This module owns:
 *
 *  - READINESS: the source binding key IS a connection id; it must be an
 *    ACTIVE google_productivity connection owned by the processor's owning
 *    user, its OAuth token must resolve (5-min refresh buffer, Secrets
 *    Manager write-back), and the granted scopes must include Gmail read.
 *  - ACQUISITION: incremental `history.list` from the durable checkpoint
 *    cursor (seeded from connections.metadata.gmail_history_id written at
 *    connect time). A 404 on the start history id means Gmail expired the
 *    history window — fall back to a bounded, label-filtered, budget-capped
 *    full resync with a VISIBLE run item, then store the fresh history id.
 *  - NORMALIZATION: thread-level. Subject, deduped participants, bounded
 *    per-message plain text with quoted-history stripping, and attachments
 *    as METADATA ONLY (filename/mime/size — never content).
 *
 * PRIVACY (AE4, hard): message content NEVER lands inline in Postgres. The
 * full normalized thread snapshot is uploaded S3-FIRST (encrypted
 * brain-artifacts bucket, erase-fence pre/post checks with exact-version
 * compensation) and the evidence row keeps only a content-free skeleton
 * (ids, label ids, counts, content hash — `contentFree: true`) plus
 * sensitivity 'personal_communication'. All mail text is HOSTILE input.
 */

import type { S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import type { Database } from "@thinkwork/database-pg";
import { connections } from "@thinkwork/database-pg/schema";

// oauth-token.js is imported LAZILY: it constructs a db client and AWS
// SDK clients at module scope, which must not enter the module graph of
// every stages.ts consumer (and their unit-test mocks) just because the
// email adapter is registered.
import {
  computeContentHash,
  recordAcquiredPage,
  recordRunItem,
} from "../evidence.js";
import {
  advanceCheckpoint,
  ensureCheckpoint,
  getCheckpoint,
} from "../repository.js";
import {
  assertSourceWritable,
  rearmEraseCleanup,
  SourceEraseFencedError,
} from "../erase-fence.js";
import {
  clampSnapshotTtlDays,
  deleteEvidenceSnapshotVersion,
  putEvidenceSnapshot,
  resolveSnapshotBucket,
  snapshotKeyFor,
  verifyNoSnapshotVersions,
} from "../snapshots.js";
import { effectiveLimit } from "../acquire-helpers.js";
import type { EvidenceUpsert } from "../types.js";
import type {
  AdapterAcquireArgs,
  AdapterAcquireOutcome,
  AdapterReadinessArgs,
} from "./registry.js";

// Defaults/caps track BOUNDARY_SCHEMAS.email (policy.ts).
export const DEFAULT_MAX_MESSAGES = 50;
export const MAX_MESSAGES_CEILING = 500;
export const DEFAULT_HISTORY_PAGE_SIZE = 25;
export const MAX_HISTORY_PAGE_SIZE = 100;

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_PROVIDER_NAME = "google_productivity";
/** Any of these granted scopes permits reading mail. */
const GMAIL_READ_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://mail.google.com/",
];

const MAX_SUBJECT_CHARS = 300;
const MAX_MESSAGE_TEXT_CHARS = 4000;
const MAX_ADDRESS_CHARS = 320;
const MAX_FILENAME_CHARS = 200;
const MAX_MESSAGES_PER_THREAD = 25;
const MAX_ATTACHMENTS_PER_MESSAGE = 20;
/** Snapshot budget mirrors the twenty/firecrawl ~64KB bound. */
const MAX_SNAPSHOT_BYTES = 64 * 1024;
export const EMAIL_EXTRACTION_RECIPE_VERSION = "u6.1";
/** Evidence sensitivity stamped on every email evidence row. */
export const EMAIL_SENSITIVITY = "personal_communication";
/** Checkpoint partition for the incremental history cursor. */
export const EMAIL_PARTITION_KEY = "history";

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export interface GmailClient {
  provider: "gmail";
  tenantId: string;
  connectionId: string;
  accessToken: string;
  /** connections.metadata.gmail_history_id — the FIRST run's cursor seed. */
  seedHistoryId: string | null;
  /** Test seams (default: global fetch / oauth-token markConnectionExpired). */
  fetchImpl?: typeof fetch;
  onAuthFailure?: (reason: string) => Promise<void>;
}

/**
 * Fail-closed readiness: connection active + owned by the owner user +
 * token resolvable + Gmail read scope granted.
 */
export async function checkGmailReadiness(
  db: Database,
  args: AdapterReadinessArgs,
): Promise<
  { ready: true; client: GmailClient } | { ready: false; reason: string }
> {
  if (!args.userId) {
    return {
      ready: false,
      reason:
        "the processor has no owning user — a mailbox can only be read as its owner",
    };
  }
  const { resolveConnectionForUserById, resolveOAuthTokenDetails } =
    await import("../../oauth-token.js");
  const connection = await resolveConnectionForUserById({
    tenantId: args.tenantId,
    userId: args.userId,
    providerName: GMAIL_PROVIDER_NAME,
    connectionId: args.bindingKey,
  });
  if (!connection) {
    return {
      ready: false,
      reason: `no ACTIVE Google connection ${args.bindingKey} owned by the processor owner — connect Google in Settings → Integrations, then bind that connection`,
    };
  }
  const details = await resolveOAuthTokenDetails(
    connection.connectionId,
    args.tenantId,
    connection.providerId,
  );
  if (!details) {
    return {
      ready: false,
      reason:
        "the Google OAuth token could not be resolved or refreshed — reconnect Google in Settings → Integrations",
    };
  }
  const hasReadScope = details.grantedScopes.some((scope) =>
    GMAIL_READ_SCOPES.includes(scope),
  );
  if (!hasReadScope) {
    return {
      ready: false,
      reason:
        "the Google connection's granted scopes do not include Gmail read access — reconnect Google and approve the Gmail scope",
    };
  }
  const [row] = await db
    .select({ metadata: connections.metadata })
    .from(connections)
    .where(eq(connections.id, connection.connectionId))
    .limit(1);
  const metadata = (row?.metadata ?? {}) as Record<string, unknown>;
  const seedHistoryId =
    typeof metadata.gmail_history_id === "string" && metadata.gmail_history_id
      ? metadata.gmail_history_id
      : null;
  return {
    ready: true,
    client: {
      provider: "gmail",
      tenantId: args.tenantId,
      connectionId: connection.connectionId,
      accessToken: details.accessToken,
      seedHistoryId,
    },
  };
}

// ---------------------------------------------------------------------------
// Gmail REST via fetch (no new SDK dependency)
// ---------------------------------------------------------------------------

export class GmailApiError extends Error {
  readonly name: string = "GmailApiError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class GmailAuthError extends GmailApiError {
  override readonly name = "GmailAuthError";
  constructor(message: string) {
    super(message, 401);
  }
}

async function gmailGet(
  client: GmailClient,
  path: string,
  params: Record<string, string | number | string[] | undefined> = {},
): Promise<Record<string, unknown>> {
  const url = new URL(`${GMAIL_API_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  const doFetch = client.fetchImpl ?? fetch;
  const response = await doFetch(url.toString(), {
    headers: { Authorization: `Bearer ${client.accessToken}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new GmailAuthError(
      `Gmail rejected the access token (${response.status}) for ${path}`,
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new GmailApiError(
      `Gmail ${path} failed (${response.status}): ${body.slice(0, 300)}`,
      response.status,
    );
  }
  return (await response.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Normalization (pure)
// ---------------------------------------------------------------------------

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Bounded single-line hostile text: control chars and newlines collapse. */
function inlineBounded(value: string, max: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

export function decodeBase64Url(data: string): string {
  try {
    return Buffer.from(
      data.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
  } catch {
    return "";
  }
}

function headerValue(headers: unknown, name: string): string | null {
  if (!Array.isArray(headers)) return null;
  for (const raw of headers) {
    const header = recordOrNull(raw);
    if (
      header &&
      typeof header.name === "string" &&
      header.name.toLowerCase() === name.toLowerCase()
    ) {
      return stringOrNull(header.value);
    }
  }
  return null;
}

/**
 * PURE: strip quoted history from one message body — reply chains repeat
 * the whole thread, so dedupe keeps the projection stable as messages
 * enter/leave scope. Cuts at common reply markers and drops `>` quote
 * lines; the remainder is still hostile text.
 */
export function stripQuotedHistory(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    // Attribution line ("On … wrote:") or forwarded/original blocks start
    // the quoted tail — stop keeping content there.
    if (/^\s*On .{0,200}wrote:\s*$/.test(line)) break;
    if (
      /^\s*-{2,}\s*(Original Message|Forwarded message)\s*-{2,}\s*$/i.test(line)
    ) {
      break;
    }
    if (/^\s*>/.test(line)) continue; // quoted line
    kept.push(line);
  }
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Walk MIME parts depth-first collecting text/plain bodies. */
function collectPlainText(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  const chunks: string[] = [];
  const walk = (part: Record<string, unknown>): void => {
    const mimeType = stringOrNull(part.mimeType) ?? "";
    const body = recordOrNull(part.body);
    const data = stringOrNull(body?.data);
    if (mimeType.startsWith("text/plain") && data) {
      chunks.push(decodeBase64Url(data));
    }
    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        const record = recordOrNull(child);
        if (record) walk(record);
      }
    }
  };
  walk(payload);
  return chunks.join("\n");
}

/** Attachments as METADATA ONLY — content is never fetched or stored. */
function collectAttachmentMetadata(
  payload: Record<string, unknown> | null,
): Array<{ filename: string; mimeType: string; sizeBytes: number }> {
  if (!payload) return [];
  const out: Array<{ filename: string; mimeType: string; sizeBytes: number }> =
    [];
  const walk = (part: Record<string, unknown>): void => {
    if (out.length >= MAX_ATTACHMENTS_PER_MESSAGE) return;
    const filename = stringOrNull(part.filename);
    if (filename) {
      const body = recordOrNull(part.body);
      out.push({
        filename: inlineBounded(filename, MAX_FILENAME_CHARS),
        mimeType: inlineBounded(
          stringOrNull(part.mimeType) ?? "application/octet-stream",
          100,
        ),
        sizeBytes: typeof body?.size === "number" ? body.size : 0,
      });
    }
    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        const record = recordOrNull(child);
        if (record) walk(record);
      }
    }
  };
  walk(payload);
  return out;
}

/** Parse an RFC-2822 address-list header into {email, name?} entries. */
export function parseAddressList(
  value: string | null,
): Array<{ email: string; name?: string }> {
  if (!value) return [];
  const out: Array<{ email: string; name?: string }> = [];
  for (const raw of value.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const angled = /<([^<>\s]+@[^<>\s]+)>/.exec(part);
    if (angled) {
      const name = inlineBounded(
        part.slice(0, angled.index).replace(/["']/g, ""),
        MAX_ADDRESS_CHARS,
      );
      const entry: { email: string; name?: string } = {
        email: inlineBounded(angled[1]!.toLowerCase(), MAX_ADDRESS_CHARS),
      };
      if (name) entry.name = name;
      out.push(entry);
      continue;
    }
    if (part.includes("@")) {
      out.push({
        email: inlineBounded(
          part.replace(/["'<>]/g, "").toLowerCase(),
          MAX_ADDRESS_CHARS,
        ),
      });
    }
  }
  return out;
}

export interface NormalizedEmailMessage {
  id: string;
  from: string | null;
  sentAt: string | null;
  labelIds: string[];
  text: string;
  attachments: Array<{ filename: string; mimeType: string; sizeBytes: number }>;
  truncated?: boolean;
  [key: string]: unknown;
}

export interface NormalizedEmailThread {
  threadId: string;
  historyId: string | null;
  subject: string | null;
  participants: Array<{ email: string; name?: string }>;
  messages: NormalizedEmailMessage[];
  latestMessageAt: string | null;
  truncated?: boolean;
  [key: string]: unknown;
}

/**
 * PURE: normalize one raw Gmail thread (threads.get format=full) under the
 * EFFECTIVE label set. Messages carrying none of the effective labels are
 * EXCLUDED (the label envelope is the read boundary, not a cosmetic
 * filter); a thread with zero in-scope messages returns null. Deterministic
 * for identical inputs; total size bounded to ~64KB.
 */
export function normalizeGmailThread(
  thread: Record<string, unknown>,
  effectiveLabels: readonly string[],
): NormalizedEmailThread | null {
  const threadId = stringOrNull(thread.id);
  if (!threadId) return null;
  const labelSet = new Set(effectiveLabels);
  const rawMessages = Array.isArray(thread.messages) ? thread.messages : [];

  const messages: NormalizedEmailMessage[] = [];
  const participants = new Map<string, { email: string; name?: string }>();
  let subject: string | null = null;
  let latestMs = 0;

  for (const raw of rawMessages) {
    const message = recordOrNull(raw);
    const id = stringOrNull(message?.id);
    if (!message || !id) continue;
    const labelIds = Array.isArray(message.labelIds)
      ? message.labelIds.filter(
          (label): label is string =>
            typeof label === "string" && labelSet.has(label),
        )
      : [];
    if (labelIds.length === 0) continue; // out of the granted+configured scope
    if (messages.length >= MAX_MESSAGES_PER_THREAD) break;

    const payload = recordOrNull(message.payload);
    const headers = payload?.headers;
    if (!subject) {
      const rawSubject = headerValue(headers, "Subject");
      if (rawSubject) subject = inlineBounded(rawSubject, MAX_SUBJECT_CHARS);
    }
    for (const headerName of ["From", "To", "Cc"]) {
      for (const entry of parseAddressList(headerValue(headers, headerName))) {
        if (!participants.has(entry.email)) {
          participants.set(entry.email, entry);
        }
      }
    }
    const fromEntry = parseAddressList(headerValue(headers, "From"))[0] ?? null;

    const internalDate = Number(stringOrNull(message.internalDate) ?? NaN);
    const sentAt = Number.isFinite(internalDate)
      ? new Date(internalDate).toISOString()
      : null;
    if (Number.isFinite(internalDate) && internalDate > latestMs) {
      latestMs = internalDate;
    }

    const rawText = stripQuotedHistory(collectPlainText(payload));
    const truncated = rawText.length > MAX_MESSAGE_TEXT_CHARS;
    messages.push({
      id,
      from: fromEntry?.email ?? null,
      sentAt,
      labelIds: [...labelIds].sort(),
      text: rawText.slice(0, MAX_MESSAGE_TEXT_CHARS),
      attachments: collectAttachmentMetadata(payload),
      ...(truncated ? { truncated: true } : {}),
    });
  }

  if (messages.length === 0) return null;

  const out: NormalizedEmailThread = {
    threadId,
    historyId: stringOrNull(thread.historyId),
    subject,
    participants: [...participants.values()].sort((a, b) =>
      a.email.localeCompare(b.email),
    ),
    messages,
    latestMessageAt: latestMs > 0 ? new Date(latestMs).toISOString() : null,
  };

  // Total-size bound: shave the longest message texts until under budget.
  let guard = 0;
  while (
    Buffer.byteLength(JSON.stringify(out), "utf8") > MAX_SNAPSHOT_BYTES &&
    guard < 200
  ) {
    guard += 1;
    const longest = out.messages.reduce(
      (best, message) =>
        message.text.length > (best?.text.length ?? 0) ? message : best,
      null as NormalizedEmailMessage | null,
    );
    if (!longest || longest.text.length === 0) break;
    longest.text = longest.text.slice(
      0,
      Math.max(0, Math.floor(longest.text.length / 2)),
    );
    longest.truncated = true;
    out.truncated = true;
  }
  return out;
}

/**
 * PURE: the CONTENT-FREE inline skeleton stored in Postgres alongside the
 * S3 snapshot ref (AE4). Ids, label ids, counts, timestamps, and the
 * content hash only — no subject, no bodies, no addresses, no snippets.
 */
export function buildEmailSkeleton(
  snapshot: NormalizedEmailThread,
  contentHash: string,
): Record<string, unknown> {
  return {
    contentFree: true,
    threadId: snapshot.threadId,
    historyId: snapshot.historyId,
    messageIds: snapshot.messages.map((message) => message.id),
    labelIds: [
      ...new Set(snapshot.messages.flatMap((message) => message.labelIds)),
    ].sort(),
    participantCount: snapshot.participants.length,
    messageCount: snapshot.messages.length,
    latestMessageAt: snapshot.latestMessageAt,
    contentHash,
  };
}

/**
 * Content-sensitive edition version: unchanged thread content (after
 * normalization) hashes identically and dedupes as a 'seen' no-op even
 * when Gmail's historyId advanced for unrelated reasons. The historyId
 * itself lives in the snapshot/skeleton for lineage.
 */
export function emailEvidenceVersionFor(contentHash: string): string {
  return `hash#${contentHash.slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// Acquisition
// ---------------------------------------------------------------------------

function historyIdFrom(
  cursor: Record<string, unknown> | null | undefined,
): string | null {
  const raw = cursor?.historyId;
  return typeof raw === "string" && raw ? raw : null;
}

/** Collect thread ids referenced by one history.list page. */
function threadIdsFromHistoryPage(page: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const history = Array.isArray(page.history) ? page.history : [];
  for (const raw of history) {
    const record = recordOrNull(raw);
    if (!record) continue;
    const messages = Array.isArray(record.messages) ? record.messages : [];
    for (const rawMessage of messages) {
      const message = recordOrNull(rawMessage);
      const threadId = stringOrNull(message?.threadId);
      if (threadId) out.add(threadId);
    }
  }
  return [...out];
}

export async function runGmailAcquire(
  args: AdapterAcquireArgs,
): Promise<AdapterAcquireOutcome> {
  const { db, processor, source, boundary, budget, options, override, counts } =
    args;
  const client = args.client as GmailClient;
  const onAuthFailure =
    client.onAuthFailure ??
    (async (reason: string) => {
      const { markConnectionExpired } = await import("../../oauth-token.js");
      await markConnectionExpired(client.connectionId, client.tenantId, reason);
    });

  // EFFECTIVE label set: the saved boundary (already proven a subset of the
  // grant envelope by the runner). An empty set reads NOTHING — fail closed.
  const labels = Array.isArray(boundary.labels)
    ? (boundary.labels as string[]).filter(
        (label) => typeof label === "string" && label.length > 0,
      )
    : [];
  if (labels.length === 0) {
    return {
      ok: true,
      summary: {
        family: source.source_family,
        threads: 0,
        note: "no mailbox labels configured in the source boundary — an empty label set reads nothing",
      },
    };
  }

  const maxMessages = effectiveLimit(
    [
      boundary.maxMessages,
      budget.maxMessages,
      options.maxMessages,
      override?.maxRecords,
    ],
    DEFAULT_MAX_MESSAGES,
    1,
    MAX_MESSAGES_CEILING,
  );
  const pageSize = effectiveLimit(
    [boundary.pageSize, budget.pageSize, options.pageSize],
    DEFAULT_HISTORY_PAGE_SIZE,
    1,
    MAX_HISTORY_PAGE_SIZE,
  );
  const ttlDays = clampSnapshotTtlDays(
    budget.snapshotTtlDays ?? boundary.snapshotTtlDays,
  );

  let checkpoint = await ensureCheckpoint(db, {
    tenantId: processor.tenant_id,
    sourceConfigId: source.id,
    partitionKey: EMAIL_PARTITION_KEY,
  });
  const startHistoryId =
    historyIdFrom(checkpoint.cursor) ?? client.seedHistoryId;

  let messagesBudget = maxMessages;
  let threadsRecorded = 0;
  let threadsExcluded = 0;
  let resync = false;
  let budgetExhausted = false;

  /** Fetch, normalize, upload S3-first, and commit ONE thread. Returns how
   * the thread settled; throws GmailAuthError/GmailApiError upward. */
  const processThread = async (
    threadId: string,
  ): Promise<"recorded" | "excluded"> => {
    // Grant re-check before EVERY provider read (Codex U2 #2).
    await args.revalidateGrant();
    const rawThread = await gmailGet(client, `threads/${threadId}`, {
      format: "full",
    });
    counts.pages += 1;
    const rawCount = Array.isArray(rawThread.messages)
      ? rawThread.messages.length
      : 0;
    messagesBudget -= Math.max(1, rawCount);

    const normalized = normalizeGmailThread(rawThread, labels);
    if (!normalized) {
      // AE3: out-of-envelope mail is a VISIBLE exclusion, never silent.
      threadsExcluded += 1;
      await recordRunItem(db, {
        tenantId: processor.tenant_id,
        workflowRunId: args.workflowRunId,
        sourceConfigId: source.id,
        sourceItemId: threadId,
        stage: "acquire",
        result: "noop",
        detail: {
          reason: `thread has no messages within the approved label set [${labels.join(", ")}] — excluded`,
        },
      });
      return "excluded";
    }

    const contentHash = computeContentHash(normalized);
    const sourceVersion = emailEvidenceVersionFor(contentHash);

    // S3-FIRST snapshot upload (AE4): raw thread content never touches
    // Postgres. Erase-fence pre-check, put, post-check with exact-version
    // compensation (mirrors offloadSnapshots, round-6 P1).
    const bucket = resolveSnapshotBucket();
    const key = snapshotKeyFor({
      tenantId: processor.tenant_id,
      sourceConfigId: source.id,
      sourceItemId: normalized.threadId,
      sourceVersion,
    });
    const fence = {
      tenantId: processor.tenant_id,
      sourceConfigId: source.id,
      expectedEraseGeneration: args.eraseFence.expectedEraseGeneration,
    };
    await assertSourceWritable(db, fence);
    const { ref, expiresAt, versionId } = await putEvidenceSnapshot(
      args.s3 as S3Client | undefined,
      {
        bucket,
        key,
        snapshot: normalized as unknown as Record<string, unknown>,
        ttlDays,
      },
    );
    try {
      await assertSourceWritable(db, fence);
    } catch (err) {
      if (err instanceof SourceEraseFencedError) {
        try {
          await deleteEvidenceSnapshotVersion(args.s3 as S3Client | undefined, {
            bucket,
            key,
            versionId,
          });
          const clean = await verifyNoSnapshotVersions(
            args.s3 as S3Client | undefined,
            { bucket, key },
          );
          if (!clean) {
            throw new Error(
              `snapshot versions remain for ${key} after compensation`,
            );
          }
        } catch (compensationErr) {
          console.error(
            `[memory-sources:gmail] snapshot write compensation failed for ${key} — reopening erase marker: ${(compensationErr as Error)?.message}`,
          );
          await rearmEraseCleanup(db, {
            tenantId: fence.tenantId,
            sourceConfigId: fence.sourceConfigId,
          });
        }
      }
      throw err;
    }

    const item: EvidenceUpsert = {
      sourceItemId: normalized.threadId,
      sourceVersion,
      sourceTimestamp: normalized.latestMessageAt
        ? new Date(normalized.latestMessageAt)
        : null,
      contentHash,
      // Full content goes ONLY to S3; Postgres keeps the content-free
      // skeleton (evidence.ts stores inlineSkeleton when snapshotRef set).
      normalizedSnapshot: null,
      snapshotRef: ref,
      inlineSkeleton: buildEmailSkeleton(normalized, contentHash),
      sensitivity: EMAIL_SENSITIVITY,
      extractionRecipe: {
        source: "gmail",
        kind: "email_thread",
        recipeVersion: EMAIL_EXTRACTION_RECIPE_VERSION,
      },
      targetScope: processor.target_scope,
      targetId: processor.target_id,
    };
    // Commit WITHOUT advancing the history cursor — the caller advances it
    // once a whole history page (or the resync) has fully settled, so a
    // budget stop mid-window never skips unread threads.
    const recorded = await recordAcquiredPage(db, {
      tenantId: processor.tenant_id,
      sourceConfigId: source.id,
      workflowRunId: args.workflowRunId,
      partitionKey: EMAIL_PARTITION_KEY,
      expectedCheckpointVersion: checkpoint.version,
      nextCursor: (checkpoint.cursor ?? {}) as Record<string, unknown>,
      items: [item],
      skipCheckpointAdvance: true,
      eraseFence: args.eraseFence,
    });
    counts.changed += recorded.changed.length;
    counts.seen += recorded.seen;
    void expiresAt;
    threadsRecorded += 1;
    return "recorded";
  };

  /** CAS-advance the durable history cursor; a lost CAS re-reads. */
  const advanceHistoryCursor = async (historyId: string): Promise<void> => {
    const advanced = await advanceCheckpoint(db, {
      sourceConfigId: source.id,
      partitionKey: EMAIL_PARTITION_KEY,
      expectedVersion: checkpoint.version,
      cursor: { historyId },
    });
    if (advanced) {
      checkpoint = advanced;
      return;
    }
    // Concurrent advance: evidence is durable and dedupes; re-read.
    checkpoint =
      (await getCheckpoint(db, {
        sourceConfigId: source.id,
        partitionKey: EMAIL_PARTITION_KEY,
      })) ??
      (await ensureCheckpoint(db, {
        tenantId: processor.tenant_id,
        sourceConfigId: source.id,
        partitionKey: EMAIL_PARTITION_KEY,
      }));
  };

  /**
   * Bounded, label-filtered FULL RESYNC (history expired or never seeded):
   * per approved label, list recent message ids (budget-capped), process
   * their threads, then store the CURRENT mailbox history id. Visible via
   * a dedicated run item — a resync is an auditable event, not silence.
   */
  const runBoundedResync = async (
    reason: string,
  ): Promise<AdapterAcquireOutcome | null> => {
    resync = true;
    const threadIds = new Set<string>();
    for (const label of labels) {
      if (messagesBudget <= 0) {
        budgetExhausted = true;
        break;
      }
      await args.revalidateGrant();
      const listing = await gmailGet(client, "messages", {
        labelIds: label,
        maxResults: Math.min(Math.max(messagesBudget, 1), 500),
      });
      counts.pages += 1;
      const messages = Array.isArray(listing.messages) ? listing.messages : [];
      for (const raw of messages) {
        const record = recordOrNull(raw);
        const threadId = stringOrNull(record?.threadId);
        if (threadId) threadIds.add(threadId);
      }
    }
    for (const threadId of threadIds) {
      if (messagesBudget <= 0) {
        budgetExhausted = true;
        break;
      }
      await processThread(threadId);
    }
    // Store the fresh mailbox history id so the next run is incremental.
    const profile = await gmailGet(client, "profile");
    const newHistoryId = stringOrNull(profile.historyId);
    if (!newHistoryId) {
      return {
        ok: false,
        error:
          "Gmail full resync could not read a current historyId from the profile — cursor unchanged; re-run the stage",
      };
    }
    await advanceHistoryCursor(newHistoryId);
    // The visible resync ledger row (bounded coverage is explicit).
    await recordRunItem(db, {
      tenantId: processor.tenant_id,
      workflowRunId: args.workflowRunId,
      sourceConfigId: source.id,
      sourceItemId: `resync:${newHistoryId}`,
      stage: "acquire",
      result: "changed",
      detail: {
        reason,
        labels,
        threads: threadIds.size,
        recorded: threadsRecorded,
        excluded: threadsExcluded,
        budgetExhausted,
        newHistoryId,
      },
    });
    return null;
  };

  try {
    if (!startHistoryId) {
      const failure = await runBoundedResync(
        "no history cursor exists yet — initial bounded label sync",
      );
      if (failure) return failure;
    } else {
      // Incremental history walk, one page at a time. The cursor advances
      // only after ALL of a page's threads settled.
      let pageToken: string | null = null;
      let currentHistoryId = startHistoryId;
      for (;;) {
        if (messagesBudget <= 0) {
          budgetExhausted = true;
          break;
        }
        await args.revalidateGrant();
        let page: Record<string, unknown>;
        try {
          page = await gmailGet(client, "history", {
            startHistoryId: currentHistoryId,
            maxResults: pageSize,
            ...(pageToken ? { pageToken } : {}),
          });
        } catch (err) {
          if (err instanceof GmailApiError && err.status === 404) {
            // Expired history window: bounded full resync replaces the walk.
            const failure = await runBoundedResync(
              `Gmail expired the history window at ${currentHistoryId} (404) — bounded label resync`,
            );
            if (failure) return failure;
            break;
          }
          throw err;
        }
        counts.pages += 1;
        const threadIds = threadIdsFromHistoryPage(page);
        for (const threadId of threadIds) {
          if (messagesBudget <= 0) {
            budgetExhausted = true;
            break;
          }
          await processThread(threadId);
        }
        if (budgetExhausted) break; // cursor untouched for the unread rest

        // Page fully settled: advance the durable cursor to this page's
        // high-water history id (the response historyId is the mailbox's
        // current id — only correct to store once no further pages remain).
        const nextToken = stringOrNull(page.nextPageToken);
        const pageHistoryId = stringOrNull(page.historyId);
        if (!nextToken) {
          if (pageHistoryId) await advanceHistoryCursor(pageHistoryId);
          break;
        }
        pageToken = nextToken;
      }
    }
  } catch (err) {
    if (err instanceof GmailAuthError) {
      // Expired/revoked token mid-run: mark the connection so the UI shows
      // the reconnect prompt; the stage fails visibly and is resumable.
      await onAuthFailure("gmail_unauthorized").catch((markErr) =>
        console.error(
          `[memory-sources:gmail] markConnectionExpired failed: ${(markErr as Error)?.message}`,
        ),
      );
      return {
        ok: false,
        error:
          `Gmail rejected the connection's access token — the connection was marked expired; reconnect Google and re-run (${err.message})`.slice(
            0,
            500,
          ),
      };
    }
    if (err instanceof GmailApiError) {
      // Rate limit / transient provider error: visible resumable failure,
      // cursor untouched for anything unread.
      return { ok: false, error: err.message.slice(0, 500) };
    }
    throw err;
  }

  return {
    ok: true,
    summary: {
      family: source.source_family,
      labels,
      threads: threadsRecorded,
      excluded: threadsExcluded,
      resync,
      budgetExhausted,
      checkpointVersion: checkpoint.version,
    },
  };
}
