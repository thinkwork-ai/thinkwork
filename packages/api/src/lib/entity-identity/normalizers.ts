/**
 * Canonical identity normalizers (THINK-193 U4).
 *
 * Pure, deterministic string normalization + hashing used by the matcher,
 * the resolution queue's signature coalescing, and the backfill script.
 * Everything here is side-effect free so the identity pipeline's behavior
 * is unit-testable without a database.
 *
 * Normalization is deliberately conservative: it folds case/whitespace/
 * punctuation variants together but never strips meaning-bearing tokens
 * (no "Inc."/"LLC" stripping — that over-merges distinct companies and is
 * exactly the fuzzy territory V1 defers to the operator queue).
 */

import { createHash } from "node:crypto";

export type IdentityNormalization = "name" | "domain" | "email" | "exact";

/** Identity rule stored per entity type (identity_rules jsonb). */
export interface IdentityRule {
  slug: string;
  keyKind: string;
  normalization: IdentityNormalization;
  /** True when the approved rule says this key is unique in its scope. */
  unique: boolean;
  /** 'tenant' is the only V1 scope; kept explicit for forward-compat. */
  uniquenessScope: "tenant";
  /** Source systems ordered by precedence (first wins on conflict). */
  sourcePrecedence: string[];
  /** Only unique+autoLink rules may create links without an operator. */
  autoLink: boolean;
  version: number;
}

/**
 * Parse + validate an identity_rules jsonb payload.
 * Malformed entries are dropped (never thrown) — a bad operator edit must
 * not take down the ingest pipeline; the matcher just sees fewer rules.
 */
export function parseIdentityRules(raw: unknown): IdentityRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: IdentityRule[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const slug = typeof candidate.slug === "string" ? candidate.slug : null;
    const keyKind =
      typeof candidate.keyKind === "string" ? candidate.keyKind : null;
    const normalization =
      candidate.normalization === "name" ||
      candidate.normalization === "domain" ||
      candidate.normalization === "email" ||
      candidate.normalization === "exact"
        ? candidate.normalization
        : null;
    if (!slug || !keyKind || !normalization) continue;
    rules.push({
      slug,
      keyKind,
      normalization,
      unique: candidate.unique === true,
      uniquenessScope: "tenant",
      sourcePrecedence: Array.isArray(candidate.sourcePrecedence)
        ? candidate.sourcePrecedence.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
      autoLink: candidate.autoLink === true,
      version:
        typeof candidate.version === "number" &&
        Number.isInteger(candidate.version)
          ? candidate.version
          : 1,
    });
  }
  return rules;
}

/**
 * Conservative display-name normalization: unicode NFKC, lowercase,
 * punctuation → spaces, collapsed whitespace. "Acme, Inc." and "ACME Inc"
 * normalize identically; "Acme" and "Acme Labs" do not.
 */
export function normalizeEntityName(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Host-only domain normalization: strips scheme, path, port, and `www.`. */
export function normalizeDomain(raw: string): string {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  value = value.split(/[/?#]/, 1)[0] ?? ""; // path/query/fragment
  value = value.split("@").pop() ?? ""; // userinfo
  value = value.split(":", 1)[0] ?? ""; // port
  value = value.replace(/^www\./, "");
  return value.replace(/\.$/, "");
}

/** Lowercased, trimmed email. No plus-tag stripping (provider-specific). */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function applyNormalization(
  normalization: IdentityNormalization,
  raw: string,
): string {
  switch (normalization) {
    case "name":
      return normalizeEntityName(raw);
    case "domain":
      return normalizeDomain(raw);
    case "email":
      return normalizeEmail(raw);
    case "exact":
      return raw.trim();
  }
}

/** sha256 hex — fixed-length index material for natural-key values. */
export function hashIdentityValue(normalizedValue: string): string {
  return createHash("sha256").update(normalizedValue, "utf8").digest("hex");
}

export interface IdentitySignatureKey {
  keyKind: string;
  normalizedValue: string;
}

/**
 * Stable identity signature for resolution-case coalescing: same entity
 * type + same normalized key set (order-independent) → same signature, so
 * repeated ambiguous sightings of "Acme" fold into ONE open case instead
 * of flooding the queue.
 */
export function computeIdentitySignature(args: {
  entityTypeSlug: string;
  keys: IdentitySignatureKey[];
}): string {
  const parts = args.keys
    .map((key) => `${key.keyKind}=${key.normalizedValue}`)
    .sort();
  return hashIdentityValue(`${args.entityTypeSlug}|${parts.join("|")}`);
}
