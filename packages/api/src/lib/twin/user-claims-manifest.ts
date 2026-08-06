/**
 * Company Brain per-user claims manifest publisher (THINK-625).
 *
 * The Brain MCP server is DB-free. For `tkt_` keys it reads
 * `twin-mcp-keys/<tenantId>/latest.json`; for signed-in humans on the OAuth
 * lane it reads THIS document — `user-claims/<tenantId>/latest.json`, format
 * `user-claims/v1` — with the same ≤60s cache. Whoever is in the manifest is
 * who the Brain thinks exists; a claims change that never reaches S3 has not
 * happened.
 *
 * Contract notes that are load-bearing, not stylistic:
 *
 *   - **Disabled users are EMITTED, not omitted.** An absent entry means
 *     "no entry" to the reader, which is a different (and in a
 *     manifest-present tenant, still fail-closed) branch than an explicit
 *     `disabled: true`. Omitting a revoked member would make revocation
 *     depend on the reader's default rather than on our statement.
 *   - **`toolAllowlist: null` is not `[]`.** Null = the Brain's surface
 *     default applies; `[]` = no tools at all. Never coalesce.
 *   - **No secrets, ever.** No key hashes, no tokens, no passwords. Emails
 *     are PII but not credentials; the bucket is private, versioned, KMS'd.
 *
 * The per-tenant `tenant_settings.brain_user_claims_enabled` flag is the
 * safety interlock and the kill switch in one: while it is false this
 * publisher writes NOTHING and instead deletes any object it finds, so
 * flipping the flag off returns the tenant to the Brain's legacy
 * group-mapping behavior within one cache window. That is also why the
 * delete lives here rather than in the settings mutation — every caller
 * gets the correct behavior for the tenant's current flag state for free.
 *
 * Publish failures NEVER block the mutation that triggered them — mirror
 * `publishTwinKeyManifest`: log loud, return a structured non-throwing
 * result, and let the caller surface it in the mutation payload.
 */
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { getConfig } from "@thinkwork/runtime-config";
import {
  tenantMembers,
  tenantSettings,
  userBrainClaims,
  users,
} from "@thinkwork/database-pg/schema";

import { db as defaultDb } from "../../graphql/utils.js";
import { userClaimsManifestKey } from "./artifact-keys.js";

type DbLike = typeof defaultDb;
type ManifestS3Client = Pick<S3Client, "send">;

export const USER_CLAIMS_MANIFEST_FORMAT = "user-claims/v1";

export { userClaimsManifestKey };

export interface UserClaimsManifestEntry {
  userId: string;
  /** Cognito sub; null until `users.cognito_sub` is backfilled. */
  subject: string | null;
  /** Lowercased email; the reader's fallback match key. */
  email: string | null;
  /** True when the claims row or the tenant membership is not active. */
  disabled: boolean;
  operator: boolean;
  securityGroups: string[];
  kbCollections: string[];
  kbBundles: Record<string, string[]>;
  defaultKbBundle: string | null;
  /** Null = Brain surface default; `[]` = no tools. */
  toolAllowlist: string[] | null;
  kbTrace: boolean;
}

export interface UserClaimsManifestDoc {
  formatVersion: typeof USER_CLAIMS_MANIFEST_FORMAT;
  tenantId: string;
  generatedAt: string;
  users: UserClaimsManifestEntry[];
}

export interface PublishUserClaimsManifestResult {
  published: boolean;
  /** S3 object key when published (or targeted by the flag-off delete). */
  key?: string;
  userCount?: number;
  /** True when the flag-off branch removed the object. */
  deleted?: boolean;
  /** Why publish was skipped or failed (never thrown). */
  reason?: string;
}

export interface PublishUserClaimsManifestOptions {
  db?: DbLike;
  s3?: ManifestS3Client;
  bucket?: string;
  now?: () => Date;
}

function resolveBucket(override?: string): string | null {
  if (override) return override;
  try {
    return getConfig("BRAIN_ARTIFACTS_BUCKET") ?? null;
  } catch {
    return null;
  }
}

/** Normalize the jsonb bundle map, dropping anything that isn't string[]. */
export function normalizeKbBundles(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [bundle, collections] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (!Array.isArray(collections)) continue;
    const values = collections.filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    );
    out[bundle] = values;
  }
  return out;
}

/**
 * Publish the per-user claims manifest for one tenant: every
 * user_brain_claims row, joined to the user record for identity and to the
 * membership row for the disabled determination.
 *
 * Never throws — failures come back as `{ published: false, reason }` after
 * a loud console.error, so claims mutations are never blocked on S3.
 */
export async function publishUserClaimsManifest(
  tenantId: string,
  opts: PublishUserClaimsManifestOptions = {},
): Promise<PublishUserClaimsManifestResult> {
  const key = userClaimsManifestKey(tenantId);
  try {
    const bucket = resolveBucket(opts.bucket);
    if (!bucket) {
      console.error(
        `user claims manifest: BRAIN_ARTIFACTS_BUCKET not configured — manifest for tenant ${tenantId} NOT published`,
      );
      return { published: false, reason: "no_bucket" };
    }

    const db = opts.db ?? defaultDb;
    const s3 = opts.s3 ?? new S3Client({});

    const [settings] = await db
      .select({ enabled: tenantSettings.brain_user_claims_enabled })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenant_id, tenantId));

    // Interlock: no row yet counts as off. Delete rather than merely skip so
    // flipping the flag off actually revokes within one cache window.
    if (!settings?.enabled) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      return {
        published: false,
        reason: "claims_disabled",
        deleted: true,
        key,
      };
    }

    const rows = await db
      .select({
        user_id: userBrainClaims.user_id,
        security_groups: userBrainClaims.security_groups,
        kb_collections: userBrainClaims.kb_collections,
        kb_bundles: userBrainClaims.kb_bundles,
        default_kb_bundle: userBrainClaims.default_kb_bundle,
        tool_allowlist: userBrainClaims.tool_allowlist,
        is_operator: userBrainClaims.is_operator,
        kb_trace: userBrainClaims.kb_trace,
        enabled: userBrainClaims.enabled,
        cognito_sub: users.cognito_sub,
        email: users.email,
        member_status: tenantMembers.status,
      })
      .from(userBrainClaims)
      .innerJoin(users, eq(users.id, userBrainClaims.user_id))
      .leftJoin(
        tenantMembers,
        and(
          eq(tenantMembers.tenant_id, userBrainClaims.tenant_id),
          eq(tenantMembers.principal_id, userBrainClaims.user_id),
          eq(tenantMembers.principal_type, "user"),
        ),
      )
      .where(eq(userBrainClaims.tenant_id, tenantId));

    const doc: UserClaimsManifestDoc = {
      formatVersion: USER_CLAIMS_MANIFEST_FORMAT,
      tenantId,
      generatedAt: (opts.now ?? (() => new Date()))().toISOString(),
      users: rows.map((row) => ({
        userId: row.user_id,
        subject: row.cognito_sub ?? null,
        email: row.email ? row.email.toLowerCase() : null,
        // A claims row whose membership was disabled or removed is still
        // published — as an explicit revocation, not as silence.
        disabled: row.enabled === false || row.member_status !== "active",
        operator: row.is_operator === true,
        securityGroups: row.security_groups ?? [],
        kbCollections: row.kb_collections ?? [],
        kbBundles: normalizeKbBundles(row.kb_bundles),
        defaultKbBundle: row.default_kb_bundle ?? null,
        toolAllowlist: row.tool_allowlist ?? null,
        kbTrace: row.kb_trace === true,
      })),
    };

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(doc, null, 2),
        ContentType: "application/json",
      }),
    );
    return { published: true, key, userCount: doc.users.length };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `user claims manifest: publish FAILED for tenant ${tenantId}: ${message}`,
    );
    return { published: false, reason: message };
  }
}
