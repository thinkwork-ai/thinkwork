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
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
}

export interface TwinKeyManifestDoc {
  formatVersion: typeof TWIN_KEY_MANIFEST_FORMAT;
  tenantId: string;
  generatedAt: string;
  keys: TwinKeyManifestEntry[];
}

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
      })
      .from(tenantMcpTwinKeys)
      .where(
        and(
          eq(tenantMcpTwinKeys.tenant_id, tenantId),
          isNull(tenantMcpTwinKeys.revoked_at),
        ),
      );

    const byHash = new Map<string, TwinKeyManifestEntry>();
    for (const extra of opts.extraKeys ?? []) {
      byHash.set(extra.keyHash, extra);
    }
    for (const row of rows) {
      byHash.set(row.key_hash, {
        keyHash: row.key_hash,
        keyId: row.id,
        name: row.name,
        createdAt: row.created_at ? row.created_at.toISOString() : null,
        expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
        securityGroups: row.security_groups ?? [],
        kbCollections: row.kb_collections ?? [],
      });
    }

    const doc: TwinKeyManifestDoc = {
      formatVersion: TWIN_KEY_MANIFEST_FORMAT,
      tenantId,
      generatedAt: (opts.now ?? (() => new Date()))().toISOString(),
      keys: [...byHash.values()],
    };

    const s3 = opts.s3 ?? new S3Client({});
    const key = buildTwinKeyManifestKey(tenantId);
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
