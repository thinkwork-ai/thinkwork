/**
 * Pure LastMile → Twenty mapping functions (no I/O), unit-tested first per the
 * plan's U5 execution note. Field shapes follow the U1 live-introspection
 * resolutions recorded in the plan: FullName{firstName,lastName},
 * Currency{amountMicros,currencyCode}, Emails{primaryEmail}, etc.
 */

import { createHash } from "node:crypto";

import type {
  LastmileAccount,
  LastmileContact,
  LastmileCrmComment,
  LastmileCustomerNote,
  LastmileLead,
  LastmileOpportunity,
} from "./lastmile-reader";

/**
 * Bump to force an update sweep after a mapper fix: previously "unchanged"
 * records re-hash differently and get rewritten (plan KTD3 / Risks).
 */
export const HASH_VERSION = "1";

/** sourceId values are namespaced by source table so leads and opportunities
 * (which share Twenty's opportunity object) can never collide. */
export function sourceId(table: string, id: string): string {
  return `${table}:${id}`;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(mapped: Record<string, unknown>): string {
  const { sourceHash: _ignored, ...rest } = mapped;
  return createHash("sha256")
    .update(`v${HASH_VERSION}:${stableStringify(rest)}`)
    .digest("hex");
}

/**
 * LastMile owner references are inconsistent: `rep_*` sales_rep ids, short
 * aliases ("jbake"), and full display names ("Jane Baker") all appear in the
 * same columns (live data, 2026-07-09). buildOwnerIndex expands the
 * provisioned rep→member map with alias and full-name keys, but ONLY when the
 * alias/name is unique across reps — ambiguous keys resolve to nobody and the
 * record is flagged instead (refuse to guess).
 */
export function buildOwnerIndex(
  reps: ReadonlyArray<{
    id: string;
    alias: string | null;
    firstName: string | null;
    lastName: string | null;
  }>,
  memberIdByRepId: ReadonlyMap<string, string>,
): Map<string, string> {
  const index = new Map<string, string>();
  const claim = (key: string | null, repId: string, ambiguous: Set<string>) => {
    if (!key) return;
    const normalized = key.toLowerCase().trim();
    if (!normalized || ambiguous.has(normalized)) return;
    const memberId = memberIdByRepId.get(repId);
    if (!memberId) return;
    if (index.has(normalized) && index.get(normalized) !== memberId) {
      ambiguous.add(normalized);
      index.delete(normalized);
      return;
    }
    index.set(normalized, memberId);
  };
  const ambiguous = new Set<string>();
  for (const rep of reps) {
    claim(rep.id, rep.id, ambiguous);
    claim(rep.alias, rep.id, ambiguous);
    const fullName = [rep.firstName, rep.lastName].filter(Boolean).join(" ");
    claim(fullName, rep.id, ambiguous);
    // LastMile derives usernames as first initial + first 4 letters of the
    // last name ("dembl" = Daniel Emblen); many sales_rep rows leave the alias
    // column empty while lead/opportunity owner refs use the derived form.
    if (rep.firstName && rep.lastName) {
      claim(
        `${rep.firstName[0]}${rep.lastName.slice(0, 4)}`,
        rep.id,
        ambiguous,
      );
    }
  }
  return index;
}

export function resolveOwner(
  ownerRef: string | null,
  ownerIndex: ReadonlyMap<string, string>,
): string | null {
  if (!ownerRef) return null;
  return (
    ownerIndex.get(ownerRef) ??
    ownerIndex.get(ownerRef.toLowerCase().trim()) ??
    null
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}

export interface NormalizedPhone {
  primaryPhoneNumber: string;
  primaryPhoneCallingCode: string;
  primaryPhoneCountryCode: string;
}

/**
 * Twenty validates phones with libphonenumber; bare national formats like
 * "512-825-8875" are rejected without a country code (observed live — 17k
 * person creates failed on it). LastMile numbers are US: normalize 10-digit
 * (or 1-prefixed 11-digit) numbers to number + "+1"/US parts; anything else
 * is dropped with a warning rather than failing the whole record.
 */
export function normalizePhone(
  raw: string | null | undefined,
): NormalizedPhone | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const national =
    digits.length === 10
      ? digits
      : digits.length === 11 && digits.startsWith("1")
        ? digits.slice(1)
        : null;
  // libphonenumber rejects US numbers whose area code starts with 0/1.
  if (!national || national[0] === "0" || national[0] === "1") return null;
  return {
    primaryPhoneNumber: national,
    primaryPhoneCallingCode: "+1",
    primaryPhoneCountryCode: "US",
  };
}

/** Dollars (numeric string or number) → integer micros. Returns null for
 * missing/unparsable amounts. */
export function toAmountMicros(
  raw: string | number | null | undefined,
): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const numeric =
    typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 1_000_000);
}

export function toQuantity(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const numeric = Number(String(raw).replace(/[,\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

// --- Stage mapping -------------------------------------------------------

/** Existing TEI options (NEW/SCREENING/MEETING/PROPOSAL/CUSTOMER) are
 * preserved verbatim — the ThinkWork workflow triggers on CUSTOMER. These are
 * the options the migration adds, merged into the live array (full-replace
 * write semantics confirmed by U1). */
export const MIGRATION_STAGE_OPTIONS: Array<{
  label: string;
  value: string;
  color: string;
}> = [
  { label: "Lead", value: "LEAD", color: "gray" },
  { label: "Lead - Working", value: "LEAD_WORKING", color: "gray" },
  { label: "Lead - Qualified", value: "LEAD_QUALIFIED", color: "blue" },
  { label: "Lead - Unqualified", value: "LEAD_UNQUALIFIED", color: "gray" },
  { label: "Prospect", value: "PROSPECT", color: "sky" },
  { label: "Qualifying", value: "QUALIFYING", color: "sky" },
  { label: "Identify Needs", value: "IDENTIFY_NEEDS", color: "turquoise" },
  { label: "Formulate Offer", value: "FORMULATE_OFFER", color: "turquoise" },
  { label: "Negotiate to Close", value: "NEGOTIATE", color: "yellow" },
  {
    label: "Manage Implementation",
    value: "MANAGE_IMPLEMENTATION",
    color: "orange",
  },
  { label: "Won", value: "WON", color: "green" },
  { label: "Lost", value: "LOST", color: "red" },
];

/** Live lead.status values observed 2026-07-09 (case-insensitive, prefix
 * digits vary). Unknown statuses fall back to LEAD and are reported. */
export function mapLeadStatusToStage(status: string | null): {
  stage: string;
  unknown: boolean;
} {
  const normalized = (status ?? "").toLowerCase().replace(/^\d+-/, "").trim();
  switch (normalized) {
    case "":
    case "new":
      return { stage: "LEAD", unknown: false };
    case "working":
    case "contacted":
    case "nurturing":
      return { stage: "LEAD_WORKING", unknown: false };
    case "qualified":
      return { stage: "LEAD_QUALIFIED", unknown: false };
    case "unqualified":
      return { stage: "LEAD_UNQUALIFIED", unknown: false };
    case "converted":
      // Converted leads became opportunities in LastMile; the lead row keeps
      // its history at the qualified end of the lead band.
      return { stage: "LEAD_QUALIFIED", unknown: false };
    default:
      return { stage: "LEAD", unknown: true };
  }
}

export function mapOpportunityStage(opportunity: {
  stage: string | null;
  closed: string | null;
  won: string | null;
}): { stage: string; unknown: boolean } {
  const normalized = (opportunity.stage ?? "")
    .toLowerCase()
    .replace(/^\d+-/, "")
    .trim();
  switch (normalized) {
    case "new":
      return { stage: "NEW", unknown: false };
    case "prospect":
      return { stage: "PROSPECT", unknown: false };
    case "qualifying":
      return { stage: "QUALIFYING", unknown: false };
    case "identify account needs":
      return { stage: "IDENTIFY_NEEDS", unknown: false };
    case "formulate offer":
      return { stage: "FORMULATE_OFFER", unknown: false };
    case "negotiate to close":
    case "negotiation to close":
      return { stage: "NEGOTIATE", unknown: false };
    case "manage implementation":
      return { stage: "MANAGE_IMPLEMENTATION", unknown: false };
    case "won":
      return { stage: "WON", unknown: false };
    case "lost":
      return { stage: "LOST", unknown: false };
    case "": {
      // Blank stage: fall back to the closed/won flags.
      if (opportunity.closed === "true" && opportunity.won === "true") {
        return { stage: "WON", unknown: false };
      }
      if (opportunity.closed === "true") {
        return { stage: "LOST", unknown: false };
      }
      return { stage: "NEW", unknown: false };
    }
    default:
      return { stage: "NEW", unknown: true };
  }
}

// --- Record mappers ------------------------------------------------------

export interface MappedRecord {
  sourceId: string;
  /** Twenty create/update input, custom fields included, sourceHash excluded. */
  input: Record<string, unknown>;
  warnings: string[];
}

export function mapAccount(
  account: LastmileAccount,
  ownerMap: ReadonlyMap<string, string>,
): MappedRecord {
  const warnings: string[] = [];
  const accountOwnerId = resolveOwner(account.ownerRepId, ownerMap);
  if (account.ownerRepId && !accountOwnerId) {
    warnings.push(
      `owner ${account.ownerRepId} not provisioned; company has no accountOwner`,
    );
  }
  const input: Record<string, unknown> = {
    name: account.name ?? `Account ${account.id}`,
    ...(accountOwnerId ? { accountOwnerId } : {}),
    sourceId: sourceId("account", account.id),
  };
  return { sourceId: input.sourceId as string, input, warnings };
}

export function mapContact(
  contact: LastmileContact,
  companyIdBySourceId: ReadonlyMap<string, string>,
): MappedRecord {
  const warnings: string[] = [];
  const email = normalizeEmail(contact.email);
  if (contact.email && !email)
    warnings.push(`invalid email ${contact.email} dropped`);
  let companyId: string | null = null;
  if (contact.accountId) {
    companyId =
      companyIdBySourceId.get(sourceId("account", contact.accountId)) ?? null;
    if (!companyId)
      warnings.push(
        `account ${contact.accountId} not found; person has no company`,
      );
  }
  const rawPhone = contact.phone ?? contact.phoneCellular;
  const phone = normalizePhone(rawPhone);
  if (rawPhone && !phone)
    warnings.push(`unparseable phone ${rawPhone} dropped`);
  const input: Record<string, unknown> = {
    name: {
      firstName: contact.firstName ?? "",
      lastName: contact.lastName ?? "",
    },
    ...(email ? { emails: { primaryEmail: email } } : {}),
    ...(phone ? { phones: phone } : {}),
    ...(contact.title ? { jobTitle: contact.title } : {}),
    ...(companyId ? { companyId } : {}),
    sourceId: sourceId("contact", contact.id),
  };
  return { sourceId: input.sourceId as string, input, warnings };
}

function isMobilProduct(opportunity: {
  productType: string | null;
  brand: string | null;
}): boolean {
  return /mobil/i.test(
    `${opportunity.productType ?? ""} ${opportunity.brand ?? ""}`,
  );
}

export function mapOpportunity(
  opportunity: LastmileOpportunity,
  ownerMap: ReadonlyMap<string, string>,
  companyIdBySourceId: ReadonlyMap<string, string>,
): MappedRecord {
  const warnings: string[] = [];
  const { stage, unknown } = mapOpportunityStage(opportunity);
  if (unknown)
    warnings.push(`unknown stage "${opportunity.stage}" mapped to NEW`);
  const ownerId = resolveOwner(opportunity.ownerRepId, ownerMap);
  if (opportunity.ownerRepId && !ownerId) {
    warnings.push(
      `owner ${opportunity.ownerRepId} not provisioned; opportunity has no owner`,
    );
  }
  let companyId: string | null = null;
  if (opportunity.accountId) {
    companyId =
      companyIdBySourceId.get(sourceId("account", opportunity.accountId)) ??
      null;
    if (!companyId) {
      warnings.push(
        `account ${opportunity.accountId} not found; opportunity has no company`,
      );
    }
  }
  const amountMicros = toAmountMicros(opportunity.amount);
  const input: Record<string, unknown> = {
    name: opportunity.name ?? `Opportunity ${opportunity.id}`,
    stage,
    ...(amountMicros !== null
      ? { amount: { amountMicros, currencyCode: "USD" } }
      : {}),
    ...(opportunity.expectedCloseDate
      ? { closeDate: `${opportunity.expectedCloseDate}T00:00:00.000Z` }
      : {}),
    ...(ownerId ? { ownerId } : {}),
    ...(companyId ? { companyId } : {}),
    ...(opportunity.productType ? { product: opportunity.productType } : {}),
    ...(toQuantity(opportunity.quantity) !== null
      ? { quantity: toQuantity(opportunity.quantity) }
      : {}),
    isMobil: isMobilProduct(opportunity),
    sourceId: sourceId("opportunity", opportunity.id),
  };
  return { sourceId: input.sourceId as string, input, warnings };
}

/** Leads land in the same Twenty opportunity pipeline at the lead-band stages
 * (AE3): never as bare person/company records. */
export function mapLead(
  lead: LastmileLead,
  ownerMap: ReadonlyMap<string, string>,
): MappedRecord {
  const warnings: string[] = [];
  const { stage, unknown } = mapLeadStatusToStage(lead.status);
  if (unknown)
    warnings.push(`unknown lead status "${lead.status}" mapped to LEAD`);
  const ownerId = resolveOwner(lead.ownerRepId, ownerMap);
  if (lead.ownerRepId && !ownerId) {
    warnings.push(
      `owner ${lead.ownerRepId} not provisioned; lead has no owner`,
    );
  }
  const personName = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  const name = lead.companyName ?? (personName || `Lead ${lead.id}`);
  const input: Record<string, unknown> = {
    name,
    stage,
    ...(ownerId ? { ownerId } : {}),
    isMobil: false,
    sourceId: sourceId("lead", lead.id),
  };
  return { sourceId: input.sourceId as string, input, warnings };
}

export interface MappedNote {
  sourceId: string;
  title: string;
  bodyMarkdown: string;
  /** Twenty sourceId of the record the note targets. */
  targetSourceId: string;
  targetKind: "opportunity" | "company";
  isDeleted: boolean;
}

export function mapCrmComment(comment: LastmileCrmComment): MappedNote {
  const text = comment.content ?? "";
  const firstLine = text.split("\n", 1)[0].trim();
  return {
    sourceId: sourceId("task_comment", comment.id),
    title: firstLine.slice(0, 60) || "LastMile note",
    bodyMarkdown: text,
    targetSourceId: sourceId(comment.entityType, comment.entityId),
    targetKind: "opportunity",
    isDeleted: comment.isDeleted,
  };
}

/** Customer notes reach Twenty only when their dispatch customer name matches
 * exactly one CRM account (plan resolution); the caller reports the rest as
 * gaps. */
export function mapCustomerNote(note: LastmileCustomerNote): MappedNote | null {
  if (!note.matchedAccountId) return null;
  const text = note.noteText ?? "";
  const firstLine = text.split("\n", 1)[0].trim();
  return {
    sourceId: sourceId("note", note.id),
    title: firstLine.slice(0, 60) || "LastMile customer note",
    bodyMarkdown: text,
    targetSourceId: sourceId("account", note.matchedAccountId),
    targetKind: "company",
    isDeleted: false,
  };
}
