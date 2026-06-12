/**
 * Namespace check/claim/release core (plan 2026-06-12-002, U1).
 *
 * One implementation shared by the ops CLI (this package) and the
 * signup-path reader (packages/api). All effects go through injected
 * DNS + tenant-source interfaces so tests never touch the network.
 *
 * Claim is two-phase (KTD3):
 *   phase one — reserve the name with a comment-stamped TXT placeholder;
 *   phase two — `--set-targets` replaces the owner's TXT with 4 NS records.
 * Both phases post-write verify sole ownership against Cloudflare AND the
 * tenants table, self-releasing on a lost race (KTD4 / R14).
 */

import {
  RESERVED_TENANT_SLUGS,
  TENANT_SLUG_PATTERN,
  isReservedTenantSlug,
} from "@thinkwork/database-pg/utils/reserved-slugs";
import {
  commentMatchesOwner,
  formatClaimComment,
  type ClaimKind,
} from "./comment-format.js";
import {
  THINKWORK_APEX_ZONE,
  type DnsRecord,
  type NamespaceDnsApi,
} from "./cloudflare.js";

export { RESERVED_TENANT_SLUGS, TENANT_SLUG_PATTERN, isReservedTenantSlug };

/** Content of the phase-one TXT reservation placeholder record. */
export const RESERVATION_TXT_CONTENT = "thinkwork-namespace-reservation";

/** Number of NS delegation records a phase-two claim writes (range(4) shape). */
export const NS_TARGET_COUNT = 4;

export function namespaceFqdn(name: string): string {
  return `${name}.${THINKWORK_APEX_ZONE}`;
}

/** Read-only tenant-slug authority (the tenants table). */
export interface TenantSlugSource {
  slugExists(slug: string): Promise<boolean>;
}

export interface NamespaceDeps {
  dns: NamespaceDnsApi;
  /**
   * Tenants-table leg. Required for claim/release-side use; `checkName`
   * tolerates null only when `skipDb` is set (read-only ops escape hatch).
   */
  tenants: TenantSlugSource | null;
  /** Injection point for the claim-comment date. Defaults to today (UTC). */
  today?: () => string;
}

function todayIso(deps: NamespaceDeps): string {
  if (deps.today) return deps.today();
  return new Date().toISOString().slice(0, 10);
}

function normalizeTarget(target: string): string {
  return target.trim().toLowerCase().replace(/\.$/, "");
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

export type CheckStatus =
  | "available"
  | "invalid"
  | "reserved"
  | "taken-cloudflare"
  | "taken-tenant";

export interface CheckResult {
  name: string;
  fqdn: string;
  status: CheckStatus;
  /** Cloudflare records found at the name (taken-cloudflare only). */
  records: DnsRecord[];
  /** False when the tenants-table leg was skipped (`check --skip-db`). */
  dbChecked: boolean;
}

export async function checkName(
  deps: NamespaceDeps,
  name: string,
  options: { skipDb?: boolean } = {},
): Promise<CheckResult> {
  const fqdn = namespaceFqdn(name);
  const base = { name, fqdn, records: [] as DnsRecord[], dbChecked: false };
  if (!TENANT_SLUG_PATTERN.test(name)) {
    return { ...base, status: "invalid" };
  }
  if (isReservedTenantSlug(name)) {
    return { ...base, status: "reserved" };
  }
  const records = await deps.dns.listRecords(fqdn);
  if (records.length > 0) {
    return { ...base, status: "taken-cloudflare", records };
  }
  if (options.skipDb) {
    return { ...base, status: "available" };
  }
  if (!deps.tenants) {
    throw new Error(
      "checkName: tenants source is required unless skipDb is set",
    );
  }
  if (await deps.tenants.slugExists(name)) {
    return { ...base, status: "taken-tenant", dbChecked: true };
  }
  return { ...base, status: "available", dbChecked: true };
}

// ---------------------------------------------------------------------------
// claim
// ---------------------------------------------------------------------------

export interface ClaimRequest {
  /** The namespace name being claimed (label under thinkwork.ai). */
  name: string;
  /**
   * The customer stack's tenant slug (KTD8). The claim refuses, before any
   * read or write, when it differs from `name` — email-inbound resolves
   * tenants by the subdomain label, so a mismatch silently drops all
   * inbound mail.
   */
  tenantSlug: string;
  kind: ClaimKind;
  /** Owner identity stamped into record comments. */
  owner: string;
  /** Phase two: exactly 4 NS targets. Omitted = phase-one TXT reservation. */
  targets?: string[];
  dryRun?: boolean;
}

export type ClaimFailureReason =
  | "invalid-name"
  | "reserved"
  | "tenant-slug-mismatch"
  | "invalid-targets"
  | "taken"
  | "lost-race";

export type ClaimResult =
  | {
      ok: true;
      action: "reserved" | "targets-set" | "noop" | "dry-run";
      fqdn: string;
      detail: string;
    }
  | {
      ok: false;
      reason: ClaimFailureReason;
      fqdn: string;
      /** Which source rejected the claim, when applicable. */
      source?: "cloudflare" | "tenants";
      detail: string;
    };

interface OwnershipPartition {
  own: DnsRecord[];
  foreign: DnsRecord[];
}

function partitionByOwner(
  records: DnsRecord[],
  kind: ClaimKind,
  owner: string,
): OwnershipPartition {
  const own: DnsRecord[] = [];
  const foreign: DnsRecord[] = [];
  for (const record of records) {
    if (commentMatchesOwner(record.comment, kind, owner)) own.push(record);
    else foreign.push(record);
  }
  return { own, foreign };
}

/**
 * A tenant row conflicts with a claim unless the claimer IS that tenant
 * (kind "tenant", owner === name — the ses_tenant_slugs path claims names
 * for tenants that already hold the slug).
 */
async function tenantRowConflicts(
  tenants: TenantSlugSource,
  name: string,
  kind: ClaimKind,
  owner: string,
): Promise<boolean> {
  if (kind === "tenant" && owner === name) return false;
  return tenants.slugExists(name);
}

export async function claimName(
  deps: NamespaceDeps,
  request: ClaimRequest,
): Promise<ClaimResult> {
  const { name, kind, owner } = request;
  const fqdn = namespaceFqdn(name);

  // Local validations — strictly before any remote call (reserved-list
  // rejection must not consume a Cloudflare request; KTD8 refuses before
  // any write or read).
  if (!TENANT_SLUG_PATTERN.test(name)) {
    return {
      ok: false,
      reason: "invalid-name",
      fqdn,
      detail: `"${name}" does not match the tenant slug pattern ${TENANT_SLUG_PATTERN}`,
    };
  }
  if (isReservedTenantSlug(name)) {
    return {
      ok: false,
      reason: "reserved",
      fqdn,
      detail: `"${name}" is on the reserved list (RESERVED_TENANT_SLUGS)`,
    };
  }
  if (name !== request.tenantSlug) {
    return {
      ok: false,
      reason: "tenant-slug-mismatch",
      fqdn,
      detail:
        `claimed name "${name}" must equal the customer stack's tenant slug ` +
        `("${request.tenantSlug}") — email-inbound resolves tenants by the ` +
        "subdomain label, so a mismatch silently drops all inbound mail (KTD8)",
    };
  }

  let targets: string[] | undefined;
  if (request.targets !== undefined) {
    targets = request.targets.map(normalizeTarget).filter((t) => t.length > 0);
    const unique = new Set(targets);
    if (targets.length !== NS_TARGET_COUNT || unique.size !== NS_TARGET_COUNT) {
      return {
        ok: false,
        reason: "invalid-targets",
        fqdn,
        detail: `--set-targets requires exactly ${NS_TARGET_COUNT} distinct nameservers, got: ${JSON.stringify(request.targets)}`,
      };
    }
  }

  if (!deps.tenants) {
    throw new Error(
      "claimName: the tenants-table leg is required on the claim path (no --skip-db)",
    );
  }

  // Cloudflare leg: any record we don't own means taken; write nothing.
  const existing = await deps.dns.listRecords(fqdn);
  const { own, foreign } = partitionByOwner(existing, kind, owner);
  if (foreign.length > 0) {
    return {
      ok: false,
      reason: "taken",
      fqdn,
      source: "cloudflare",
      detail: `${fqdn} already has ${foreign.length} record(s) not owned by ${kind}:${owner}`,
    };
  }

  // Tenants-table leg.
  if (await tenantRowConflicts(deps.tenants, name, kind, owner)) {
    return {
      ok: false,
      reason: "taken",
      fqdn,
      source: "tenants",
      detail: `a tenant row already holds the slug "${name}"`,
    };
  }

  const comment = formatClaimComment({ kind, owner, created: todayIso(deps) });

  if (targets === undefined) {
    return claimPhaseOne(deps, request, fqdn, own, comment);
  }
  return claimPhaseTwo(deps, request, fqdn, own, targets, comment);
}

/** Phase one: write the TXT reservation placeholder. */
async function claimPhaseOne(
  deps: NamespaceDeps,
  request: ClaimRequest,
  fqdn: string,
  own: DnsRecord[],
  comment: string,
): Promise<ClaimResult> {
  const { name, kind, owner } = request;

  // Idempotent re-claim by the same owner (KTD4).
  if (own.length > 0) {
    return {
      ok: true,
      action: "noop",
      fqdn,
      detail: `${fqdn} is already claimed by ${kind}:${owner} (${own.length} record(s)); nothing to do`,
    };
  }

  if (request.dryRun) {
    return {
      ok: true,
      action: "dry-run",
      fqdn,
      detail: `would CREATE TXT ${fqdn} "${RESERVATION_TXT_CONTENT}" comment="${comment}"`,
    };
  }

  await deps.dns.createRecord({
    type: "TXT",
    name: fqdn,
    content: RESERVATION_TXT_CONTENT,
    comment,
  });

  const lost = await postWriteVerify(deps, name, fqdn, kind, owner);
  if (lost) return lost;

  return {
    ok: true,
    action: "reserved",
    fqdn,
    detail: `reserved ${fqdn} with a TXT placeholder (comment: ${comment})`,
  };
}

/** Phase two: replace the owner's TXT (and any stale NS) with 4 NS records. */
async function claimPhaseTwo(
  deps: NamespaceDeps,
  request: ClaimRequest,
  fqdn: string,
  own: DnsRecord[],
  targets: string[],
  comment: string,
): Promise<ClaimResult> {
  const { name, kind, owner } = request;

  const ownNs = own.filter((r) => r.type === "NS");
  const ownOther = own.filter((r) => r.type !== "NS");
  const currentNsContents = new Set(
    ownNs.map((r) => normalizeTarget(r.content)),
  );
  const wantedContents = new Set(targets);

  const alreadyCorrect =
    ownOther.length === 0 &&
    currentNsContents.size === wantedContents.size &&
    [...wantedContents].every((t) => currentNsContents.has(t));

  // Repeat invocation with identical targets: idempotent success, no writes.
  if (alreadyCorrect) {
    return {
      ok: true,
      action: "noop",
      fqdn,
      detail: `${fqdn} already delegates to the requested nameservers; nothing to do`,
    };
  }

  const toCreate = targets.filter((t) => !currentNsContents.has(t));
  const toDelete = [
    ...ownOther, // the phase-one TXT placeholder (and any other own record)
    ...ownNs.filter((r) => !wantedContents.has(normalizeTarget(r.content))),
  ];

  if (request.dryRun) {
    const lines = [
      ...toCreate.map(
        (t) => `would CREATE NS ${fqdn} → ${t} comment="${comment}"`,
      ),
      ...toDelete.map((r) => `would DELETE ${r.type} ${fqdn} → ${r.content}`),
    ];
    return { ok: true, action: "dry-run", fqdn, detail: lines.join("\n") };
  }

  // Create the new NS records first so the name never goes unclaimed,
  // then remove the placeholder/stale records.
  for (const target of toCreate) {
    await deps.dns.createRecord({
      type: "NS",
      name: fqdn,
      content: target,
      comment,
    });
  }
  for (const record of toDelete) {
    await deps.dns.deleteRecord(record.id);
  }

  const lost = await postWriteVerify(deps, name, fqdn, kind, owner);
  if (lost) return lost;

  return {
    ok: true,
    action: "targets-set",
    fqdn,
    detail: `${fqdn} now delegates to: ${targets.join(", ")}`,
  };
}

/**
 * KTD4 / R14 — post-write verification closes both races. Lists the name's
 * records and re-checks the tenants table; on any foreign claim, deletes
 * our own records and reports the loss.
 */
async function postWriteVerify(
  deps: NamespaceDeps,
  name: string,
  fqdn: string,
  kind: ClaimKind,
  owner: string,
): Promise<ClaimResult | null> {
  const after = await deps.dns.listRecords(fqdn);
  const { own, foreign } = partitionByOwner(after, kind, owner);

  if (foreign.length > 0) {
    for (const record of own) {
      await deps.dns.deleteRecord(record.id);
    }
    return {
      ok: false,
      reason: "lost-race",
      fqdn,
      source: "cloudflare",
      detail:
        `post-write verify found ${foreign.length} record(s) at ${fqdn} not owned ` +
        `by ${kind}:${owner}; released our own record(s) — the name is taken`,
    };
  }

  if (
    deps.tenants &&
    (await tenantRowConflicts(deps.tenants, name, kind, owner))
  ) {
    for (const record of own) {
      await deps.dns.deleteRecord(record.id);
    }
    return {
      ok: false,
      reason: "lost-race",
      fqdn,
      source: "tenants",
      detail:
        `post-write verify found a tenant row holding the slug "${name}"; ` +
        "released our own record(s) — the name is taken",
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// release
// ---------------------------------------------------------------------------

export interface ReleaseRequest {
  name: string;
  kind: ClaimKind;
  owner: string;
  dryRun?: boolean;
}

export type ReleaseResult =
  | {
      ok: true;
      action: "released" | "noop" | "dry-run";
      fqdn: string;
      deleted: number;
      /** Records left in place because another owner's comment holds them. */
      foreignRemaining: number;
      detail: string;
    }
  | {
      ok: false;
      reason: "owned-by-other";
      fqdn: string;
      detail: string;
    };

export async function releaseName(
  deps: NamespaceDeps,
  request: ReleaseRequest,
): Promise<ReleaseResult> {
  const { name, kind, owner } = request;
  const fqdn = namespaceFqdn(name);

  const records = await deps.dns.listRecords(fqdn);
  if (records.length === 0) {
    return {
      ok: true,
      action: "noop",
      fqdn,
      deleted: 0,
      foreignRemaining: 0,
      detail: `${fqdn} has no records; nothing to release`,
    };
  }

  const { own, foreign } = partitionByOwner(records, kind, owner);
  if (own.length === 0) {
    return {
      ok: false,
      reason: "owned-by-other",
      fqdn,
      detail:
        `refusing to release ${fqdn}: its ${foreign.length} record(s) are not ` +
        `owned by ${kind}:${owner} (comments do not match)`,
    };
  }

  if (request.dryRun) {
    return {
      ok: true,
      action: "dry-run",
      fqdn,
      deleted: 0,
      foreignRemaining: foreign.length,
      detail: own
        .map((r) => `would DELETE ${r.type} ${fqdn} → ${r.content}`)
        .join("\n"),
    };
  }

  for (const record of own) {
    await deps.dns.deleteRecord(record.id);
  }

  return {
    ok: true,
    action: "released",
    fqdn,
    deleted: own.length,
    foreignRemaining: foreign.length,
    detail:
      `released ${fqdn}: deleted ${own.length} record(s) owned by ${kind}:${owner}` +
      (foreign.length > 0
        ? `; left ${foreign.length} record(s) owned by another claim in place`
        : ""),
  };
}
