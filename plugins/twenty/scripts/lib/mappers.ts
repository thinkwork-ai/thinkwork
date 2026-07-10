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
  LastmileCrmTask,
  LastmileCustomerNote,
  LastmileOrganization,
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

/** Non-person sales_rep rows: house/dealer buckets, intercompany ledgers, and
 * placeholders. They must never receive a login. */
const NON_PERSON_REP_TOKENS = new Set([
  "house",
  "intercompany",
  "tbd",
  "undefined",
  "unknown",
  "unassigned",
  "buyback",
  "asc",
  "salesrep",
  "company",
  "fuel",
  "oil",
  "transport",
  "transportation",
  "hauling",
]);

/** A person's name part: letters, optionally hyphenated/apostrophed. Rejects
 * multi-word buckets ("Golden West Laredo"), digits, and underscores
 * ("Ervi_2"). */
const NAME_PART_RE = /^[a-z]+(?:['-][a-z]+)*$/;

/**
 * Reps missing an email in LastMile get `<first-initial><lastname>@<domain>`
 * (Eric's rule, 2026-07-10) — but only when both name parts look like a real
 * person's. 60 of 131 active reps have no email; most are house/intercompany
 * rows that must stay unprovisionable. Returns null for those.
 */
export function deriveRepEmail(
  firstName: string | null,
  lastName: string | null,
  domain: string,
): string | null {
  const first = (firstName ?? "").trim().toLowerCase();
  const last = (lastName ?? "").trim().toLowerCase();
  if (!NAME_PART_RE.test(first) || !NAME_PART_RE.test(last)) return null;
  if (NON_PERSON_REP_TOKENS.has(first) || NON_PERSON_REP_TOKENS.has(last)) {
    return null;
  }
  const localPart = `${first[0]}${last.replace(/['-]/g, "")}`;
  return normalizeEmail(`${localPart}@${domain}`);
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

/**
 * Pipeline stages are LastMile's own status names, verbatim (from the `status`
 * table, via `task.status_id`). Opportunity statuses and lead statuses share
 * one Twenty pipeline because leads become early-stage opportunities.
 *
 * Existing TEI options (NEW/SCREENING/MEETING/PROPOSAL/CUSTOMER) are preserved
 * by the merge — the ThinkWork workflow triggers on CUSTOMER — but nothing new
 * maps onto them.
 */
export const MIGRATION_STAGE_OPTIONS: Array<{
  label: string;
  value: string;
  color: string;
}> = [
  // Lead band
  { label: "00-New", value: "LM_00_NEW", color: "gray" },
  { label: "10-Working", value: "LM_10_WORKING", color: "gray" },
  { label: "20-Contacted", value: "LM_20_CONTACTED", color: "gray" },
  { label: "30-Nurturing", value: "LM_30_NURTURING", color: "blue" },
  { label: "50-Qualified", value: "LM_50_QUALIFIED", color: "blue" },
  { label: "90-Unqualified", value: "LM_90_UNQUALIFIED", color: "gray" },
  { label: "Converted", value: "LM_CONVERTED", color: "turquoise" },
  // Opportunity band
  { label: "10-Prospect", value: "LM_10_PROSPECT", color: "sky" },
  { label: "20-Account Needs", value: "LM_20_ACCOUNT_NEEDS", color: "sky" },
  {
    label: "30-Formulate Offer",
    value: "LM_30_FORMULATE_OFFER",
    color: "turquoise",
  },
  { label: "40-Negotiation", value: "LM_40_NEGOTIATION", color: "yellow" },
  {
    label: "50-Implementation",
    value: "LM_50_IMPLEMENTATION",
    color: "orange",
  },
  { label: "60-Won", value: "LM_60_WON", color: "green" },
  { label: "90-Lost", value: "LM_90_LOST", color: "red" },
];

const STAGE_VALUE_BY_STATUS_NAME = new Map(
  MIGRATION_STAGE_OPTIONS.map((option) => [
    option.label.toLowerCase(),
    option.value,
  ]),
);

/**
 * `task.status_id` -> status name -> stage value. Lead and opportunity status
 * names collide only on "00-New", which both bands share intentionally.
 * An unmapped status is reported rather than silently bucketed.
 */
export function mapTaskStatusToStage(statusName: string | null): {
  stage: string;
  unknown: boolean;
} {
  const value = STAGE_VALUE_BY_STATUS_NAME.get(
    (statusName ?? "").toLowerCase().trim(),
  );
  if (value) return { stage: value, unknown: false };
  return { stage: "LM_00_NEW", unknown: true };
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

/** Mobil-branded products, per line. Brands seen live: MOBIL, MOBIL - CVL,
 * GOLDEN WEST, FUEL, DEF, Hotsy. */
export function isMobilBrand(brand: string | null): boolean {
  return /mobil/i.test(brand ?? "");
}

export interface MappedOpportunityProduct extends MappedRecord {
  /** sourceId of the owning opportunity, resolved to a Twenty id by the loader. */
  opportunitySourceId: string;
}

/**
 * One product line on an opportunity (R1: multiple products per opportunity).
 * Identity is opportunity + position, so re-runs update lines in place rather
 * than duplicating them.
 */
export function mapOpportunityProduct(item: {
  opportunityId: string;
  index: number;
  brand: string | null;
  quantity: string | null;
  amount: string | null;
}): MappedOpportunityProduct {
  const warnings: string[] = [];
  const amountMicros = toAmountMicros(item.amount);
  if (item.amount && amountMicros === null) {
    warnings.push(`unparseable line amount ${item.amount} dropped`);
  }
  const quantity = toQuantity(item.quantity);
  if (item.quantity && quantity === null) {
    warnings.push(`unparseable line quantity ${item.quantity} dropped`);
  }
  const lineSourceId = `${sourceId("opportunity_item", item.opportunityId)}#${item.index}`;
  const input: Record<string, unknown> = {
    name: item.brand ?? `Line ${item.index + 1}`,
    ...(item.brand ? { product: item.brand } : {}),
    ...(quantity !== null ? { quantity } : {}),
    ...(amountMicros !== null
      ? { amount: { amountMicros, currencyCode: "USD" } }
      : {}),
    isMobil: isMobilBrand(item.brand),
    lineNumber: item.index + 1,
    sourceId: lineSourceId,
  };
  return {
    sourceId: lineSourceId,
    input,
    warnings,
    opportunitySourceId: sourceId("opportunity", item.opportunityId),
  };
}

/**
 * A CRM record as LastMile's `task` table sees it — the authority for status,
 * owner, organization, and products. Leads and opportunities both land in
 * Twenty's opportunity pipeline (AE3).
 */
export function mapCrmTask(
  task: LastmileCrmTask,
  ownerIndex: ReadonlyMap<string, string>,
  companyIdBySourceId: ReadonlyMap<string, string>,
  organizationIdBySourceId: ReadonlyMap<string, string>,
): MappedRecord {
  const warnings: string[] = [];

  const { stage, unknown } = mapTaskStatusToStage(task.statusName);
  if (unknown) {
    warnings.push(`unknown task status "${task.statusName}" mapped to 00-New`);
  }

  const ownerId = resolveOwner(task.assigneeRepId, ownerIndex);
  if (task.assigneeRepId && !ownerId) {
    warnings.push(
      `assignee rep ${task.assigneeRepId} not provisioned; no owner`,
    );
  } else if (!task.assigneeRepId) {
    warnings.push("task has no assignee; no owner");
  }

  // Leads pre-date an account: they carry only a typed company name.
  let companyId: string | null = null;
  if (task.accountId) {
    companyId =
      companyIdBySourceId.get(sourceId("account", task.accountId)) ?? null;
    if (!companyId) {
      warnings.push(`account ${task.accountId} not migrated; no company link`);
    }
  }

  let organizationId: string | null = null;
  if (task.organizationId) {
    organizationId =
      organizationIdBySourceId.get(
        sourceId("organization", task.organizationId),
      ) ?? null;
    if (!organizationId) {
      warnings.push(`organization ${task.organizationId} not migrated`);
    }
  }

  // The deal total is the sum of its product lines when they exist; otherwise
  // there is no reliable amount on the task.
  const amountMicros = sumLineAmountsMicros(task.items);

  const name =
    task.title ??
    task.leadCompanyName ??
    `${task.entityType === "lead" ? "Lead" : "Opportunity"} ${task.entityId}`;

  const input: Record<string, unknown> = {
    name,
    stage,
    ...(amountMicros !== null
      ? { amount: { amountMicros, currencyCode: "USD" } }
      : {}),
    ...(task.dueDate
      ? { closeDate: new Date(task.dueDate).toISOString() }
      : {}),
    ...(ownerId ? { ownerId } : {}),
    ...(companyId ? { companyId } : {}),
    ...(organizationId ? { organizationId } : {}),
    isMobil: (task.items ?? []).some((item) =>
      isMobilBrand(item.brand ?? null),
    ),
    sourceId: sourceId(task.entityType, task.entityId),
  };
  return { sourceId: input.sourceId as string, input, warnings };
}

export function sumLineAmountsMicros(
  items: LastmileCrmTask["items"],
): number | null {
  if (!items || items.length === 0) return null;
  let total = 0;
  let sawAny = false;
  for (const item of items) {
    const micros = toAmountMicros(
      item.amount === null || item.amount === undefined
        ? null
        : String(item.amount),
    );
    if (micros !== null) {
      total += micros;
      sawAny = true;
    }
  }
  return sawAny ? total : null;
}

/** LastMile branch/business unit ("Golden West Oil Co..San Antonio (300)",
 * shown in the UI as its `abbv`, "GWO 300"). */
export function mapOrganization(
  organization: LastmileOrganization,
): MappedRecord {
  return {
    sourceId: sourceId("organization", organization.id),
    input: {
      name: organization.abbv ?? organization.name ?? organization.id,
      fullName: organization.name ?? "",
      sourceId: sourceId("organization", organization.id),
    },
    warnings: [],
  };
}

/** Product lines belonging to a CRM task, keyed by the task's entity id. */
export function mapTaskProducts(
  task: LastmileCrmTask,
): MappedOpportunityProduct[] {
  return (task.items ?? []).map((item, index) =>
    mapOpportunityProduct({
      opportunityId: task.entityId,
      index,
      brand: item.brand ?? null,
      quantity:
        item.quantity === null || item.quantity === undefined
          ? null
          : String(item.quantity),
      amount:
        item.amount === null || item.amount === undefined
          ? null
          : String(item.amount),
    }),
  );
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
