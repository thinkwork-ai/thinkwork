/**
 * Twenty CRM memory-source adapter (THINK-193 U1).
 *
 * Acquires companies (depth-1, ordered by updatedAt ascending with a
 * resumable cursor), normalizes each into a bounded snapshot, and renders
 * a deterministic customer-dossier markdown for projection into Hindsight.
 *
 * Twenty's REST filter/order support varies by version, so server-side
 * `filter`/`order_by` params are treated as best-effort hints and the same
 * ordering + cursor dedupe is re-applied client-side.
 */

import type { Database } from "@thinkwork/database-pg";

import {
  HttpError,
  resolveTwentyContext,
  TwentyRestClient,
} from "../../twenty/rest-client.js";
import { computeContentHash } from "../evidence.js";
import type {
  AcquiredPage,
  EvidenceUpsert,
  SharedTargetScope,
} from "../types.js";

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

/**
 * Resumable position over companies ordered by (updatedAt asc, id asc).
 * `lastId` breaks ties among records sharing the same updatedAt.
 */
export interface TwentyCompaniesCursor {
  lastUpdatedAt: string | null;
  lastId: string | null;
}

// ---------------------------------------------------------------------------
// Normalization bounds
// ---------------------------------------------------------------------------

const MAX_RELATION_ITEMS = 20;
const MAX_NOTE_BODY_CHARS = 2000;
const MAX_SNAPSHOT_BYTES = 64 * 1024;
const MAX_DOSSIER_CHARS = 16 * 1024;
const RELATION_KEYS = ["people", "opportunities", "notes"] as const;

/** Per-relation scalar identity fields we keep. Nothing else survives. */
const RELATION_FIELDS: Record<(typeof RELATION_KEYS)[number], string[]> = {
  people: [
    "id",
    "name",
    "jobTitle",
    "email",
    "emails",
    "createdAt",
    "updatedAt",
  ],
  opportunities: [
    "id",
    "name",
    "stage",
    "amount",
    "closeDate",
    "createdAt",
    "updatedAt",
  ],
  notes: ["id", "title", "body", "bodyV2", "createdAt", "updatedAt"],
};

// ---------------------------------------------------------------------------
// Small value helpers
// ---------------------------------------------------------------------------

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Assign only when the value is neither null nor undefined. */
function setIfPresent(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value !== null && value !== undefined) target[key] = value;
}

/** Twenty `domainName` is either a string or a `{primaryLinkUrl}` object. */
function normalizeDomainName(value: unknown): string | null {
  const direct = stringOrNull(value);
  if (direct) return direct;
  const record = recordOrNull(value);
  return stringOrNull(record?.primaryLinkUrl);
}

/** Twenty full-name composite (`{firstName,lastName}`) or plain string. */
function normalizeName(value: unknown): string | null {
  const direct = stringOrNull(value);
  if (direct) return direct;
  const record = recordOrNull(value);
  if (!record) return null;
  const parts = [record.firstName, record.lastName]
    .map(stringOrNull)
    .filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Twenty currency composite: `{amountMicros, currencyCode}`. */
function normalizeCurrency(value: unknown): Record<string, unknown> | null {
  const record = recordOrNull(value);
  if (!record) return null;
  const out: Record<string, unknown> = {};
  if (typeof record.amountMicros === "number") {
    out.amountMicros = record.amountMicros;
  } else {
    const parsed = Number(record.amountMicros);
    if (Number.isFinite(parsed) && record.amountMicros != null) {
      out.amountMicros = parsed;
    }
  }
  setIfPresent(out, "currencyCode", stringOrNull(record.currencyCode));
  return Object.keys(out).length > 0 ? out : null;
}

/** Twenty emails composite (`{primaryEmail, additionalEmails}`) or string. */
function normalizeEmail(value: unknown): string | null {
  const direct = stringOrNull(value);
  if (direct) return direct;
  const record = recordOrNull(value);
  return stringOrNull(record?.primaryEmail);
}

/** Note body: plain string, or `bodyV2` `{markdown}` / `{blocknote}`. */
function normalizeNoteBody(value: unknown): string | null {
  const direct = stringOrNull(value);
  if (direct) return direct;
  const record = recordOrNull(value);
  if (!record) return null;
  return stringOrNull(record.markdown) ?? stringOrNull(record.blocknote);
}

/**
 * Unwrap a depth-1 relation value: Twenty nests related records either as a
 * plain array or as a `{edges:[{node}]}` connection.
 */
function relationRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value
      .map(recordOrNull)
      .filter((rec): rec is Record<string, unknown> => rec !== null);
  }
  const connection = recordOrNull(value);
  if (connection && Array.isArray(connection.edges)) {
    return connection.edges
      .map((edge) => recordOrNull(recordOrNull(edge)?.node))
      .filter((rec): rec is Record<string, unknown> => rec !== null);
  }
  return [];
}

function normalizeRelationItem(
  kind: (typeof RELATION_KEYS)[number],
  item: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of RELATION_FIELDS[kind]) {
    const raw = item[field];
    if (raw === null || raw === undefined) continue;
    switch (field) {
      case "name":
        setIfPresent(out, "name", normalizeName(raw));
        break;
      case "email":
      case "emails":
        setIfPresent(out, "email", normalizeEmail(raw));
        break;
      case "amount":
        setIfPresent(out, "amount", normalizeCurrency(raw));
        break;
      case "body":
      case "bodyV2": {
        const body = normalizeNoteBody(raw);
        if (body && out.body === undefined) {
          out.body = body.slice(0, MAX_NOTE_BODY_CHARS);
        }
        break;
      }
      default:
        setIfPresent(out, field, raw);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// normalizeCompany
// ---------------------------------------------------------------------------

/**
 * Pure: reduce a raw depth-1 Twenty company record to a stable, bounded
 * plain object. Scalar identity fields plus at most 20 items each of
 * people/opportunities/notes (scalar identity fields only, note bodies
 * truncated). Null/undefined keys are dropped; no token/credential fields
 * are ever copied (only allow-listed fields survive). The serialized
 * snapshot is capped at ~64KB by dropping relation tails, recording
 * `truncated: true` when anything was cut.
 */
export function normalizeCompany(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  setIfPresent(out, "id", stringOrNull(record.id));
  setIfPresent(out, "name", normalizeName(record.name));
  setIfPresent(out, "domainName", normalizeDomainName(record.domainName));
  setIfPresent(
    out,
    "address",
    recordOrNull(record.address) ?? stringOrNull(record.address),
  );
  setIfPresent(
    out,
    "employees",
    typeof record.employees === "number" ? record.employees : null,
  );
  setIfPresent(
    out,
    "annualRecurringRevenue",
    normalizeCurrency(record.annualRecurringRevenue),
  );
  setIfPresent(out, "createdAt", stringOrNull(record.createdAt));
  setIfPresent(out, "updatedAt", stringOrNull(record.updatedAt));

  let truncated = false;
  for (const key of RELATION_KEYS) {
    const items = relationRecords(record[key]);
    if (items.length === 0) continue;
    if (items.length > MAX_RELATION_ITEMS) truncated = true;
    out[key] = items
      .slice(0, MAX_RELATION_ITEMS)
      .map((item) => normalizeRelationItem(key, item));
  }

  // Size cap: drop relation tails (largest relations first would be smarter,
  // but deterministic fixed order keeps hashes stable) until under budget.
  while (serializedByteLength(out) > MAX_SNAPSHOT_BYTES) {
    const dropped = dropOneRelationTail(out);
    if (!dropped) break;
    truncated = true;
  }
  if (truncated) out.truncated = true;
  return out;
}

function serializedByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

/** Remove the last item of the longest relation array. False when empty. */
function dropOneRelationTail(out: Record<string, unknown>): boolean {
  let longestKey: string | null = null;
  let longestLength = 0;
  for (const key of RELATION_KEYS) {
    const value = out[key];
    if (Array.isArray(value) && value.length > longestLength) {
      longestKey = key;
      longestLength = value.length;
    }
  }
  if (!longestKey || longestLength === 0) return false;
  const list = out[longestKey] as unknown[];
  list.pop();
  if (list.length === 0) delete out[longestKey];
  return true;
}

// ---------------------------------------------------------------------------
// Dossier rendering
// ---------------------------------------------------------------------------

function formatCurrency(value: unknown): string | null {
  const record = recordOrNull(value);
  if (!record) return null;
  const micros =
    typeof record.amountMicros === "number" ? record.amountMicros : null;
  if (micros === null) return stringOrNull(record.currencyCode);
  const amount = micros / 1_000_000;
  const formatted = Number.isInteger(amount)
    ? amount.toLocaleString("en-US")
    : amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
  const code = stringOrNull(record.currencyCode);
  return code ? `${formatted} ${code}` : formatted;
}

function formatAddress(value: unknown): string | null {
  const direct = stringOrNull(value);
  if (direct) return direct;
  const record = recordOrNull(value);
  if (!record) return null;
  const parts = [
    record.addressStreet1,
    record.addressStreet2,
    record.addressCity,
    record.addressState,
    record.addressPostcode,
    record.addressCountry,
  ]
    .map(stringOrNull)
    .filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(", ") : null;
}

function sortById<T extends Record<string, unknown>>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    String(a.id ?? "").localeCompare(String(b.id ?? "")),
  );
}

type DossierSection = { heading: string; lines: string[] };

/**
 * Pure, deterministic customer dossier markdown from a normalized company
 * snapshot. No timestamps are injected; ambiguous orderings fall back to
 * id sort. Output is kept under ~16KB by truncating note bodies first,
 * then trimming people/opportunities lists, with explicit "…truncated"
 * markers.
 */
/** Inline-scalar guard for dossier interpolation: CRM text must not inject
 * markdown structure (headings/bullets) via embedded newlines. */
function inlineText(value: string | null): string | null {
  return value === null ? null : value.replace(/\s*\r?\n\s*/g, " ").trim();
}

export function buildCompanyDossier(snapshot: Record<string, unknown>): {
  markdown: string;
  title: string;
} {
  const title =
    inlineText(stringOrNull(snapshot.name)) ??
    inlineText(stringOrNull(snapshot.id)) ??
    "Company";

  const overviewLines: string[] = [];
  const domain = inlineText(stringOrNull(snapshot.domainName));
  if (domain) overviewLines.push(`- Domain: ${domain}`);
  const address = inlineText(formatAddress(snapshot.address));
  if (address) overviewLines.push(`- Address: ${address}`);
  if (typeof snapshot.employees === "number") {
    overviewLines.push(
      `- Employees: ${snapshot.employees.toLocaleString("en-US")}`,
    );
  }
  const arr = formatCurrency(snapshot.annualRecurringRevenue);
  if (arr) overviewLines.push(`- Annual recurring revenue: ${arr}`);

  const people = Array.isArray(snapshot.people)
    ? sortById(snapshot.people.filter(isPlainRecord))
    : [];
  const opportunities = Array.isArray(snapshot.opportunities)
    ? sortById(snapshot.opportunities.filter(isPlainRecord))
    : [];
  const notes = Array.isArray(snapshot.notes)
    ? [...snapshot.notes.filter(isPlainRecord)].sort(byNewestThenId)
    : [];

  const build = (bounds: {
    noteBody: number;
    people: number;
    opps: number;
    notes: number;
  }) => {
    const sections: DossierSection[] = [];
    if (overviewLines.length > 0) {
      sections.push({ heading: "Overview", lines: overviewLines });
    }
    if (people.length > 0) {
      const lines = people.slice(0, bounds.people).map((person) => {
        const parts = [
          inlineText(stringOrNull(person.name)),
          inlineText(stringOrNull(person.jobTitle)),
          inlineText(stringOrNull(person.email)),
        ].filter((part): part is string => part !== null);
        return `- ${parts.join(" — ") || String(person.id ?? "unknown")}`;
      });
      if (people.length > bounds.people) lines.push("- …truncated");
      sections.push({ heading: "People", lines });
    }
    if (opportunities.length > 0) {
      const lines = opportunities.slice(0, bounds.opps).map((opp) => {
        const parts = [
          inlineText(stringOrNull(opp.name)) ?? String(opp.id ?? "unknown"),
          inlineText(stringOrNull(opp.stage)),
          formatCurrency(opp.amount),
          inlineText(stringOrNull(opp.closeDate))
            ? `closes ${inlineText(stringOrNull(opp.closeDate))}`
            : null,
        ].filter((part): part is string => part !== null);
        return `- ${parts.join(" — ")}`;
      });
      if (opportunities.length > bounds.opps) lines.push("- …truncated");
      sections.push({ heading: "Opportunities", lines });
    }
    if (notes.length > 0) {
      const lines: string[] = [];
      for (const note of notes.slice(0, bounds.notes)) {
        const noteTitle =
          inlineText(stringOrNull(note.title)) ?? String(note.id ?? "Note");
        lines.push(`- **${noteTitle}**`);
        const body = stringOrNull(note.body);
        if (body) {
          const clipped =
            body.length > bounds.noteBody
              ? `${body.slice(0, bounds.noteBody)} …truncated`
              : body;
          lines.push(`  ${clipped.replace(/\r?\n/g, " ")}`);
        }
      }
      if (notes.length > bounds.notes) lines.push("- …truncated");
      sections.push({ heading: "Notes", lines });
    }
    const blocks = [`# ${title}`];
    for (const section of sections) {
      blocks.push(`## ${section.heading}\n${section.lines.join("\n")}`);
    }
    return blocks.join("\n\n");
  };

  // Progressive truncation: notes bodies first, then list lengths.
  const attempts = [
    { noteBody: MAX_NOTE_BODY_CHARS, people: 20, opps: 20, notes: 20 },
    { noteBody: 500, people: 20, opps: 20, notes: 20 },
    { noteBody: 200, people: 20, opps: 20, notes: 10 },
    { noteBody: 200, people: 10, opps: 10, notes: 5 },
    { noteBody: 100, people: 5, opps: 5, notes: 3 },
  ];
  let markdown = build(attempts[0]!);
  for (const bounds of attempts.slice(1)) {
    if (markdown.length <= MAX_DOSSIER_CHARS) break;
    markdown = build(bounds);
  }
  if (markdown.length > MAX_DOSSIER_CHARS) {
    markdown = `${markdown.slice(0, MAX_DOSSIER_CHARS)}\n\n…truncated`;
  }
  return { markdown, title };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return recordOrNull(value) !== null;
}

/** Newest first by createdAt/updatedAt, id-sort tiebreak (deterministic). */
function byNewestThenId(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  const timeOf = (rec: Record<string, unknown>) =>
    stringOrNull(rec.createdAt) ?? stringOrNull(rec.updatedAt) ?? "";
  const byTime = timeOf(b).localeCompare(timeOf(a));
  if (byTime !== 0) return byTime;
  return String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

// ---------------------------------------------------------------------------
// Projection identity
// ---------------------------------------------------------------------------

/** Stable projection key: one dossier per company. */
export function projectionKeyForCompany(companyId: string): string {
  return `company:${companyId}`;
}

/** Stable Hindsight document id for a source config's projection key. */
export function hindsightDocumentIdFor(
  sourceConfigId: string,
  projectionKey: string,
): string {
  return `external:${sourceConfigId}:${projectionKey}`;
}

// ---------------------------------------------------------------------------
// Acquisition
// ---------------------------------------------------------------------------

/** Client-side (updatedAt asc, id asc) comparator matching the cursor order. */
function byUpdatedAtThenId(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  const timeA = stringOrNull(a.updatedAt) ?? "";
  const timeB = stringOrNull(b.updatedAt) ?? "";
  const byTime = timeA.localeCompare(timeB);
  if (byTime !== 0) return byTime;
  return String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

/** True when the record is already covered by (i.e., at or before) cursor. */
function coveredByCursor(
  record: Record<string, unknown>,
  cursor: TwentyCompaniesCursor,
): boolean {
  if (!cursor.lastUpdatedAt) return false;
  const updatedAt = stringOrNull(record.updatedAt) ?? "";
  if (updatedAt < cursor.lastUpdatedAt) return true;
  if (updatedAt > cursor.lastUpdatedAt) return false;
  // Equal updatedAt: id tiebreak — covered when id <= lastId.
  return cursor.lastId !== null && String(record.id ?? "") <= cursor.lastId;
}

/**
 * Acquire one page of companies from Twenty, ordered by updatedAt
 * ascending. The server-side `filter`/`orderBy` are best-effort (Twenty
 * REST support varies by version); ordering and cursor dedupe are always
 * re-applied client-side. `nextCursor` is null when the raw page came back
 * shorter than `pageSize` (no more data) — unless `boundary.maxRecords`
 * trimmed the kept items, in which case the cursor points at the last
 * kept record so the remainder is picked up next run.
 */
export async function acquireCompaniesPage(
  client: TwentyRestClient,
  args: {
    cursor: TwentyCompaniesCursor | null;
    pageSize: number;
    boundary?: { maxRecords?: number };
    targetScope: SharedTargetScope;
    targetId: string;
    recipeVersion?: string;
    /**
     * Opaque Twenty pageInfo.endCursor from the PREVIOUS page of this run.
     * Threading it is what lets acquisition advance through a cohort of
     * records sharing one updatedAt (bulk imports) — the gte filter alone
     * would return the same first page forever.
     */
    startingAfter?: string | null;
  },
): Promise<AcquiredPage<TwentyCompaniesCursor>> {
  const { records, pageInfo } = await client.listPage("companies", {
    limit: args.pageSize,
    depth: 1,
    orderBy: "updatedAt[AscNullsFirst]",
    startingAfter: args.startingAfter ?? undefined,
    filter:
      !args.startingAfter && args.cursor?.lastUpdatedAt
        ? `updatedAt[gte]:${args.cursor.lastUpdatedAt}`
        : undefined,
  });
  const rawCount = records.length;

  // Defensive client-side ordering + cursor dedupe.
  let kept = [...records].sort(byUpdatedAtThenId);
  if (args.cursor) {
    const cursor = args.cursor;
    kept = kept.filter((record) => !coveredByCursor(record, cursor));
  }

  const maxRecords = args.boundary?.maxRecords;
  const trimmedByBoundary =
    maxRecords !== undefined && kept.length > maxRecords;
  if (trimmedByBoundary) kept = kept.slice(0, maxRecords);

  const items: EvidenceUpsert[] = kept.map((record) => {
    const normalizedSnapshot = normalizeCompany(record);
    const contentHash = computeContentHash(normalizedSnapshot);
    const updatedAt = stringOrNull(record.updatedAt);
    const parsed = updatedAt ? new Date(updatedAt) : null;
    return {
      sourceItemId: String(record.id ?? ""),
      sourceVersion: updatedAt ?? contentHash.slice(0, 16),
      sourceTimestamp:
        parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
      contentHash,
      normalizedSnapshot,
      extractionRecipe: {
        source: "twenty",
        kind: "company_dossier",
        recipeVersion: args.recipeVersion ?? "u1.1",
        depth: 1,
      },
      targetScope: args.targetScope,
      targetId: args.targetId,
    };
  });

  const last = kept[kept.length - 1];
  const shortPage = rawCount < args.pageSize;
  const nextCursor: TwentyCompaniesCursor | null =
    shortPage && !trimmedByBoundary
      ? null
      : last
        ? {
            lastUpdatedAt: stringOrNull(last.updatedAt),
            lastId: stringOrNull(last.id) ?? String(last.id ?? ""),
          }
        : (args.cursor ?? null);

  return {
    items,
    nextCursor,
    rawCount,
    pageToken:
      pageInfo?.hasNextPage && pageInfo.endCursor ? pageInfo.endCursor : null,
  };
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export type TwentyReadiness =
  | { ready: true; client: TwentyRestClient }
  | { ready: false; reason: string };

/**
 * Resolve the tenant's Twenty deployment + the caller's token into a
 * usable REST client. Missing managed app / MCP server and unconnected
 * accounts (403) come back as `{ready:false, reason}`; anything else
 * (network failure, 5xx) rethrows so the caller can retry.
 */
export async function checkTwentyReadiness(
  db: Database,
  args: { tenantId: string; userId: string },
): Promise<TwentyReadiness> {
  try {
    const context = await resolveTwentyContext(db, {
      tenantId: args.tenantId,
      userId: args.userId,
      logPrefix: "[memory-sources:twenty]",
      unauthorizedMessage:
        "the processor owner has no connected Twenty CRM account — connect Twenty before running memory ingestion",
    });
    if (!context) {
      return {
        ready: false,
        reason:
          "no approved Twenty managed application/MCP server for this tenant",
      };
    }
    return {
      ready: true,
      client: new TwentyRestClient(context.baseUrl, context.token),
    };
  } catch (err) {
    if (err instanceof HttpError && err.status === 403) {
      return { ready: false, reason: err.message };
    }
    throw err;
  }
}
