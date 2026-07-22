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
  LastmileTaskStatusChange,
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
  { label: "00-New", value: "NEW", color: "gray" },
  { label: "10-Working", value: "WORKING", color: "gray" },
  { label: "20-Contacted", value: "CONTACTED", color: "gray" },
  { label: "30-Nurturing", value: "NURTURING", color: "blue" },
  { label: "50-Qualified", value: "QUALIFIED", color: "blue" },
  { label: "90-Unqualified", value: "UNQUALIFIED", color: "gray" },
  { label: "Converted", value: "CONVERTED", color: "turquoise" },
  // Opportunity band
  { label: "10-Prospect", value: "PROSPECT", color: "sky" },
  { label: "20-Account Needs", value: "ACCOUNT_NEEDS", color: "sky" },
  { label: "30-Formulate Offer", value: "FORMULATE_OFFER", color: "turquoise" },
  { label: "40-Negotiation", value: "NEGOTIATION", color: "yellow" },
  { label: "50-Implementation", value: "IMPLEMENTATION", color: "orange" },
  { label: "60-Won", value: "WON", color: "green" },
  { label: "90-Lost", value: "LOST", color: "red" },
];

/** Retag map for the one-off `retag-stage-values.ts` migration: the original
 * import wrote LM_-prefixed values, which surface raw in the API, filters, and
 * reports. Labels never changed. */
export const LEGACY_STAGE_VALUE_MAP: Readonly<Record<string, string>> = {
  LM_00_NEW: "NEW",
  LM_10_WORKING: "WORKING",
  LM_20_CONTACTED: "CONTACTED",
  LM_30_NURTURING: "NURTURING",
  LM_50_QUALIFIED: "QUALIFIED",
  LM_90_UNQUALIFIED: "UNQUALIFIED",
  LM_CONVERTED: "CONVERTED",
  LM_10_PROSPECT: "PROSPECT",
  LM_20_ACCOUNT_NEEDS: "ACCOUNT_NEEDS",
  LM_30_FORMULATE_OFFER: "FORMULATE_OFFER",
  LM_40_NEGOTIATION: "NEGOTIATION",
  LM_50_IMPLEMENTATION: "IMPLEMENTATION",
  LM_60_WON: "WON",
  LM_90_LOST: "LOST",
};

/** Options from the abandoned first model, plus TEI's unused defaults, that no
 * record references. Removed by the retag so the picker is not a graveyard.
 * CUSTOMER is deliberately kept — the ThinkWork workflow triggers on it. */
export const OBSOLETE_STAGE_VALUES: readonly string[] = [
  "LEAD",
  "LEAD_WORKING",
  "LEAD_QUALIFIED",
  "LEAD_UNQUALIFIED",
  "QUALIFYING",
  "IDENTIFY_NEEDS",
  "NEGOTIATE",
  "MANAGE_IMPLEMENTATION",
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
  return { stage: "NEW", unknown: true };
}

// --- Record mappers ------------------------------------------------------

export interface MappedRecord {
  sourceId: string;
  /** Twenty create/update input, custom fields included, sourceHash excluded. */
  input: Record<string, unknown>;
  warnings: string[];
}

/**
 * A dispatch customer becomes a company exactly like an account does, keyed
 * `customer:<id>` — the id spaces never collide, and the caller drops
 * customers whose name already has an account-sourced company (unique-name
 * crosswalk) before mapping.
 */
export function mapDispatchCustomer(
  customer: {
    id: string;
    name: string | null;
    ownerRepId: string | null;
  },
  ownerMap: ReadonlyMap<string, string>,
): MappedRecord {
  const warnings: string[] = [];
  const accountOwnerId = resolveOwner(customer.ownerRepId, ownerMap);
  if (customer.ownerRepId && !accountOwnerId) {
    warnings.push(
      `owner ${customer.ownerRepId} not provisioned; company has no accountOwner`,
    );
  }
  const input: Record<string, unknown> = {
    name: customer.name ?? `Customer ${customer.id}`,
    ...(accountOwnerId ? { accountOwnerId } : {}),
    sourceId: sourceId("customer", customer.id),
  };
  return { sourceId: input.sourceId as string, input, warnings };
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

/**
 * Twenty enforces a unique primary email on Person, but LastMile does not:
 * among the scoped contacts, 17 addresses are shared by 2-8 people
 * ("test@test.com" x8, a rep's own address x8). The first contact by id keeps
 * the address; the rest migrate without one, so no person is lost to a
 * duplicate-key error. The caller reports each dropped address.
 */
export function dedupeContactEmails<
  T extends { id: string; email: string | null },
>(contacts: readonly T[]): T[] {
  const claimed = new Set<string>();
  return [...contacts]
    .sort((left, right) => (left.id < right.id ? -1 : 1))
    .map((contact) => {
      const email = normalizeEmail(contact.email);
      if (!email) return contact;
      if (claimed.has(email)) return { ...contact, email: null };
      claimed.add(email);
      return contact;
    });
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

/**
 * TEI's seven product lines, exactly as LastMile's "Product Line" picker shows
 * them. The `items[].brand` free-text field holds 19 variants of these seven
 * (MOBIL, Mobil, "MOBIL - CVL", "GWO - PVL", ...), which is why products became
 * a catalog object rather than a text field.
 */
export const PRODUCT_CATALOG: readonly string[] = [
  "Ancillary",
  "DEF",
  "Fuel",
  "Golden West",
  "Hotsy",
  "Mighty",
  "Mobil",
];

/**
 * Collapse a LastMile brand string onto a catalog product. Sub-line suffixes
 * (CVL, PVL, INDUSTRIAL) denote the channel, not the product, so they fold into
 * the parent. Returns null for "UNKNOWN" and blanks (173 lines): the line still
 * migrates with its quantity and amount, but carries no product, and every one
 * is listed in the report rather than silently bucketed.
 */
export function normalizeProductName(brand: string | null): string | null {
  const raw = (brand ?? "").trim();
  if (!raw) return null;
  const base = raw.split("-")[0].trim().toLowerCase();
  switch (base) {
    case "mobil":
      return "Mobil";
    case "golden west":
    case "gwo":
      return "Golden West";
    case "fuel":
      return "Fuel";
    case "def":
      return "DEF";
    case "mighty":
      return "Mighty";
    case "ancillary":
      return "Ancillary";
    case "hotsy":
      return "Hotsy";
    default:
      return null;
  }
}

/** Mobil-branded products, per line — driven by the catalog name, not the raw
 * brand string, so "MOBIL - CVL" and "Mobil" agree. */
export function isMobilBrand(brand: string | null): boolean {
  return normalizeProductName(brand) === "Mobil";
}

/** A catalog product record. Name is the identity; the sourceId keeps re-runs
 * idempotent. */
export function mapProduct(name: string): MappedRecord {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return {
    sourceId: sourceId("product", key),
    input: { name, sourceId: sourceId("product", key) },
    warnings: [],
  };
}

export function productSourceId(name: string): string {
  return sourceId("product", name.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
}

export interface MappedOpportunityProduct extends MappedRecord {
  /** sourceId of the owning opportunity, resolved to a Twenty id by the loader. */
  opportunitySourceId: string;
  /** sourceId of the catalog product, or null when the brand did not map. */
  productSourceId: string | null;
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
  const productName = normalizeProductName(item.brand);
  if (!productName) {
    warnings.push(
      `line ${item.index + 1}: brand ${JSON.stringify(item.brand ?? "")} does not map to a product`,
    );
  }

  const lineSourceId = `${sourceId("opportunity_item", item.opportunityId)}#${item.index}`;
  const input: Record<string, unknown> = {
    // The chip in Twenty's UI reads the name, so an unmapped line says "Line 2",
    // never "Untitled".
    name: productName ?? `Line ${item.index + 1}`,
    ...(quantity !== null ? { quantity } : {}),
    ...(amountMicros !== null
      ? { amount: { amountMicros, currencyCode: "USD" } }
      : {}),
    isMobil: productName === "Mobil",
    lineNumber: item.index + 1,
    sourceId: lineSourceId,
  };
  return {
    sourceId: lineSourceId,
    input,
    warnings,
    opportunitySourceId: sourceId("opportunity", item.opportunityId),
    productSourceId: productName ? productSourceId(productName) : null,
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
    // Replay LastMile's true creation time onto Twenty so "created" reads
    // correctly and the record sorts by real age, not import time. Twenty
    // accepts createdAt on create and update (proven by the notes path), so
    // records seeded before this behaviour existed heal on the next sweep.
    ...(task.createdAt ? { createdAt: toIsoTimestamp(task.createdAt) } : {}),
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
  /** When the note was written in LastMile — replayed onto Twenty's createdAt
   * so the activity timeline is chronologically correct. */
  createdAt: string | null;
  /** LastMile author; Twenty's actor is not settable via the API. */
  authorName: string | null;
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
    createdAt: toIsoTimestamp(comment.createdAt),
    authorName: comment.authorName,
  };
}

/**
 * A LastMile pipeline transition ("00-New" -> "10-Prospect") reconstructed as a
 * dated Note on the Twenty opportunity, so the activity feed shows when each
 * status change actually happened. Returns null when the event carries no
 * destination stage name (nothing meaningful to record). Stage names arrive
 * already clean ("10-Prospect", "60-Won") — the same labels Twenty uses — so no
 * LM_ stripping is needed. The `task_activity.id` gives a stable sourceId, so
 * re-runs upsert the same note rather than duplicating it.
 */
export function mapTaskStatusActivity(
  activity: LastmileTaskStatusChange,
): MappedNote | null {
  if (!activity.newStatusName) return null;
  const body = activity.oldStatusName
    ? `${activity.oldStatusName} → ${activity.newStatusName}`
    : `Set to ${activity.newStatusName}`;
  return {
    sourceId: sourceId("task_activity", activity.id),
    title: `Stage → ${activity.newStatusName}`,
    bodyMarkdown: body,
    targetSourceId: sourceId(activity.entityType, activity.entityId),
    targetKind: "opportunity",
    isDeleted: false,
    createdAt: toIsoTimestamp(activity.createdAt),
    authorName: activity.authorName,
  };
}

/** Twenty wants an ISO-8601 DateTime; LastMile hands us a Date or null. */
export function toIsoTimestamp(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
    createdAt: toIsoTimestamp(note.dateCreated),
    authorName: null,
  };
}
