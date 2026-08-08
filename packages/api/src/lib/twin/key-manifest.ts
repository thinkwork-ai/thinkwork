/**
 * Twin MCP key manifest publisher (repo-consolidation plan U14, U12 KTD
 * amendment).
 *
 * The Company Brain platform repo takes over serving the Brain MCP server;
 * product-minted `tkt_` keys are verified platform-side against a
 * hashed-key manifest this module publishes to the brain-artifacts bucket
 * at `twin-mcp-keys/<tenantId>/latest.json` (format-gated, consumed with
 * a ≤60s cache). Raw keys NEVER leave this repo — only SHA-256 hashes.
 *
 * Rotation contract: both the outgoing and incoming hashes must be live in
 * the manifest during a rotation, so provisioning publishes twice — once
 * with the just-rotated hash carried as a grace entry (`extraKeys`), then
 * active-only at the end of the ceremony. The platform's cache window is
 * the overlap; the manifest never holds zero valid keys mid-rotation.
 *
 * Publish failures NEVER block the provisioning mutation — mirror the
 * identity-snapshot exporter (uploadIdentitySnapshot): log loud, return a
 * structured non-throwing result, and let the caller surface it in the
 * mutation's response metadata.
 *
 * ── twin-mcp-keys/v2: per-key grants (Brain Security, THINK-412) ────────
 *
 * v2 adds `keyId`, `name`, `securityGroups` and `kbCollections` to each
 * entry. The reader is company-brain `brain-mcp/src/auth.ts` (shipped in
 * company-brain#246), which accepts BOTH v1 and v2 and treats missing
 * grant fields as "PUBLIC graph only, no KB" — so this bump is safe in
 * either deploy order. The wire shape is a cross-repo contract: change it
 * in lockstep with that reader or not at all.
 *
 * ── trustedSubsystem (THINK-626) ────────────────────────────────────────
 *
 * `trustedSubsystem: true` rides v2's `additionalProperties: true` with no
 * formatVersion bump, in the safe direction: an older reader ignores it,
 * honours no assertion, and every call keeps running under the key itself.
 * The canonical shape is vendored byte-identical from company-brain at
 * `contracts/key-manifest.v2.{schema,golden}.json` and asserted by
 * key-manifest.test.ts — the producer half of that one shared artifact.
 */
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, eq, isNull } from "drizzle-orm";
import { getConfig } from "@thinkwork/runtime-config";
import { tenantMcpTwinKeys } from "@thinkwork/database-pg/schema";

import { db as defaultDb } from "../../graphql/utils.js";
import { twinKeyManifestKey as buildTwinKeyManifestKey } from "./artifact-keys.js";

type DbLike = typeof defaultDb;
type ManifestS3Client = Pick<S3Client, "send">;

export const TWIN_KEY_MANIFEST_FORMAT = "twin-mcp-keys/v2";

/** Grant value meaning "every group" / "every collection". */
export const TWIN_KEY_GRANT_WILDCARD = "*";

// Re-exported from artifact-keys so this module's many importers keep their
// import site; the derivation itself is shared with the user-claims manifest
// (THINK-625) so the two paths cannot drift apart.
export { twinKeyManifestKey } from "./artifact-keys.js";

export interface TwinKeyManifestEntry {
  /** SHA-256 hex digest of the raw `tkt_` key. */
  keyHash: string;
  createdAt: string | null;
  /** Stable id of the tenant_mcp_twin_keys row (audit attribution). */
  keyId?: string;
  /** Human label, as shown in the console. */
  name?: string;
  /**
   * NULL/absent = never expires. Additive to twin-mcp-keys/v1; the
   * platform verifier skips entries whose expiresAt is in the past.
   */
  expiresAt?: string | null;
  /**
   * Graph security groups granted, on top of the always-visible PUBLIC
   * group. Absent/empty = PUBLIC only; `["*"]` = every group.
   */
  securityGroups?: string[];
  /**
   * KB collection slugs granted. KB is grant-only: absent/empty = no KB;
   * `["*"]` = every collection.
   */
  kbCollections?: string[];
  /**
   * Trusted-subsystem marker (THINK-626): the key may assert
   * `on_behalf_of` per tools/call, so the call runs under the named
   * signed-in human's user-claims entry instead of this key's own grants.
   * Read literal-true-only by the platform (absent/false/non-boolean =
   * cannot assert), so this is emitted ONLY when the row is flagged —
   * every ordinary key's entry stays byte-identical to before.
   */
  trustedSubsystem?: true;
  /**
   * Analytics-channel visibility (THINK-656 D4): the key's brain_ask loop
   * may consult the mart_analytics briefing tools. Tool visibility only,
   * never a data grant. Read literal-true-only by the platform, so it is
   * emitted only when the row's default-true column is set.
   */
  analyticsKey?: true;
  /**
   * Operator-side fields set by hand directly in the published manifest
   * (kbTrace, operatorKey, …) ride `additionalProperties: true` and are
   * PRESERVED across republish — see mergePreserved below.
   */
  [extra: string]: unknown;
}

export interface TwinKeyManifestDoc {
  formatVersion: typeof TWIN_KEY_MANIFEST_FORMAT;
  tenantId: string;
  generatedAt: string;
  keys: TwinKeyManifestEntry[];
  /**
   * Operator-published top-level fields (most importantly `machineClients`,
   * the THINK-628 m2m lanes) are carried forward verbatim from the
   * previously published manifest — the product has no model of them and
   * must not wipe them on republish.
   */
  [extra: string]: unknown;
}

/**
 * Entry fields the PRODUCT owns: recomputed from the database on every
 * publish. Everything else found on a previously published entry with the
 * same keyHash (hand-set kbTrace, operatorKey, …) is carried forward.
 */
const PRODUCT_OWNED_ENTRY_FIELDS = new Set([
  "keyHash",
  "keyId",
  "name",
  "createdAt",
  "expiresAt",
  "securityGroups",
  "kbCollections",
  "trustedSubsystem",
  "analyticsKey",
]);

/** Top-level fields the PRODUCT owns; the rest is carried forward. */
const PRODUCT_OWNED_TOP_FIELDS = new Set([
  "formatVersion",
  "tenantId",
  "generatedAt",
  "keys",
]);

export interface PublishTwinKeyManifestResult {
  published: boolean;
  /** S3 object key when published. */
  key?: string;
  keyCount?: number;
  /** Why publish was skipped or failed (never thrown). */
  reason?: string;
}

export interface PublishTwinKeyManifestOptions {
  db?: DbLike;
  s3?: ManifestS3Client;
  bucket?: string;
  now?: () => Date;
  /**
   * Grace entries merged into the manifest alongside the ACTIVE rows —
   * used mid-rotation to keep the just-revoked hash valid while the
   * secret repoint propagates. Active rows win on hash collision.
   */
  extraKeys?: TwinKeyManifestEntry[];
}

function resolveBucket(override?: string): string | null {
  if (override) return override;
  try {
    return getConfig("BRAIN_ARTIFACTS_BUCKET") ?? null;
  } catch {
    return null;
  }
}

/** Error raised when the currently published manifest cannot be read. */
class ExistingManifestUnreadable extends Error {}

function isMissingObjectError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  const status =
    typeof err === "object" && err !== null
      ? (err as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode
      : undefined;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

/**
 * Fetch the currently published manifest, or null when none exists yet.
 *
 * The 2026-08-07 analytics go-live proved operators legitimately publish
 * things the product database does not model — the `machineClients` m2m
 * lanes (THINK-628), hand-added key entries (no keyId), and hand-set flags
 * like kbTrace/operatorKey on product-owned entries. A wholesale rewrite
 * from the DB silently destroys all of it, so a publish that cannot READ
 * the existing object (other than a clean 404) must FAIL rather than
 * clobber — throwing ExistingManifestUnreadable, surfaced as
 * `{ published: false }`.
 */
async function readExistingManifest(
  s3: ManifestS3Client,
  bucket: string,
  key: string,
): Promise<Record<string, unknown> | null> {
  let body: string;
  try {
    const response = (await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    )) as { Body?: { transformToString: () => Promise<string> } };
    if (!response.Body) return null;
    body = await response.Body.transformToString();
  } catch (err: unknown) {
    if (isMissingObjectError(err)) return null;
    const message = err instanceof Error ? err.message : String(err);
    throw new ExistingManifestUnreadable(
      `existing manifest unreadable (refusing to clobber): ${message}`,
    );
  }
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Unparseable JSON: nothing recoverable to preserve — publish fresh.
  }
  return null;
}

/** The previous entry's operator-set fields (everything the product does not own). */
function preservedEntryExtras(
  prev: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!prev) return {};
  const extras: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(prev)) {
    if (!PRODUCT_OWNED_ENTRY_FIELDS.has(field)) extras[field] = value;
  }
  return extras;
}

/**
 * Publish the hashed-key manifest for one tenant: every ACTIVE
 * (revoked_at IS NULL) row of tenant_mcp_twin_keys, plus any grace
 * `extraKeys`, to `twin-mcp-keys/<tenantId>/latest.json`.
 *
 * Never throws — failures come back as `{ published: false, reason }`
 * after a loud console.error, so key mutations are never blocked on S3.
 */
export async function publishTwinKeyManifest(
  tenantId: string,
  opts: PublishTwinKeyManifestOptions = {},
): Promise<PublishTwinKeyManifestResult> {
  try {
    const bucket = resolveBucket(opts.bucket);
    if (!bucket) {
      console.error(
        `twin key manifest: BRAIN_ARTIFACTS_BUCKET not configured — manifest for tenant ${tenantId} NOT published`,
      );
      return { published: false, reason: "no_bucket" };
    }

    const db = opts.db ?? defaultDb;
    const rows = await db
      .select({
        id: tenantMcpTwinKeys.id,
        key_hash: tenantMcpTwinKeys.key_hash,
        name: tenantMcpTwinKeys.name,
        created_at: tenantMcpTwinKeys.created_at,
        expires_at: tenantMcpTwinKeys.expires_at,
        security_groups: tenantMcpTwinKeys.security_groups,
        kb_collections: tenantMcpTwinKeys.kb_collections,
        trusted_subsystem: tenantMcpTwinKeys.trusted_subsystem,
        analytics_key: tenantMcpTwinKeys.analytics_key,
      })
      .from(tenantMcpTwinKeys)
      .where(
        and(
          eq(tenantMcpTwinKeys.tenant_id, tenantId),
          isNull(tenantMcpTwinKeys.revoked_at),
        ),
      );

    const s3 = opts.s3 ?? new S3Client({});
    const key = buildTwinKeyManifestKey(tenantId);

    // Preservation read — see readExistingManifest. A read failure (other
    // than a clean 404) aborts the publish instead of clobbering.
    const previous = await readExistingManifest(s3, bucket, key);
    const previousKeys: Record<string, unknown>[] = Array.isArray(
      previous?.keys,
    )
      ? (previous.keys as unknown[]).filter(
          (entry): entry is Record<string, unknown> =>
            !!entry && typeof entry === "object" && !Array.isArray(entry),
        )
      : [];
    const previousByHash = new Map<string, Record<string, unknown>>();
    for (const entry of previousKeys) {
      if (typeof entry.keyHash === "string" && entry.keyHash.length > 0) {
        previousByHash.set(entry.keyHash, entry);
      }
    }

    const byHash = new Map<string, TwinKeyManifestEntry>();
    for (const extra of opts.extraKeys ?? []) {
      byHash.set(extra.keyHash, {
        ...preservedEntryExtras(previousByHash.get(extra.keyHash)),
        ...extra,
      });
    }
    for (const row of rows) {
      byHash.set(row.key_hash, {
        // Operator-set fields (kbTrace, operatorKey, …) hand-edited onto
        // this entry in S3 survive the republish; product-owned fields
        // below are always recomputed from the database.
        ...preservedEntryExtras(previousByHash.get(row.key_hash)),
        keyHash: row.key_hash,
        keyId: row.id,
        name: row.name,
        createdAt: row.created_at ? row.created_at.toISOString() : null,
        expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
        securityGroups: row.security_groups ?? [],
        kbCollections: row.kb_collections ?? [],
        // Emitted only when true: `trustedSubsystem: false` and an absent
        // field mean the same thing to the reader, and omitting keeps
        // every ordinary key's entry byte-identical to twin-mcp-keys/v2
        // as it shipped.
        ...(row.trusted_subsystem ? { trustedSubsystem: true as const } : {}),
        // Same literal-true-only shape (THINK-656 D4); the DB column
        // defaults true, so every product-minted key carries analytics
        // unless an operator opts the row out.
        ...(row.analytics_key ? { analyticsKey: true as const } : {}),
      });
    }

    // Hand-added entries: a previously published key entry with NO keyId
    // was never minted by the product (product entries always carry one),
    // so the database cannot re-derive it — carry it forward verbatim.
    // Entries WITH a keyId that are gone from the DB are dropped on
    // purpose: revocation IS removal from the manifest.
    const preservedHandAdded: TwinKeyManifestEntry[] = [];
    for (const entry of previousKeys) {
      const hash = typeof entry.keyHash === "string" ? entry.keyHash : null;
      const isMachineRow = entry.kind === "m2m";
      if (isMachineRow || (hash && entry.keyId == null && !byHash.has(hash))) {
        preservedHandAdded.push(entry as unknown as TwinKeyManifestEntry);
      }
    }

    // Top-level operator fields (machineClients above all) survive too.
    const preservedTop: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(previous ?? {})) {
      if (!PRODUCT_OWNED_TOP_FIELDS.has(field)) preservedTop[field] = value;
    }

    const doc: TwinKeyManifestDoc = {
      formatVersion: TWIN_KEY_MANIFEST_FORMAT,
      tenantId,
      generatedAt: (opts.now ?? (() => new Date()))().toISOString(),
      keys: [...byHash.values(), ...preservedHandAdded],
      ...preservedTop,
    };

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(doc, null, 2),
        ContentType: "application/json",
      }),
    );
    return { published: true, key, keyCount: doc.keys.length };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `twin key manifest: publish FAILED for tenant ${tenantId}: ${message}`,
    );
    return { published: false, reason: message };
  }
}
