/**
 * @thinkwork/namespace-registry — the customer domain namespace on
 * thinkwork.ai (plan 2026-06-12-002, U1).
 *
 * One implementation of check/claim/release against the Cloudflare apex
 * zone, consumed as a library (packages/api signup check, U5) and as an
 * ops CLI (src/cli.ts). The record-comment format in comment-format.ts is
 * the contract between the claim writer and every reader (R4).
 */

export {
  CLAIM_COMMENT_PATTERN,
  commentMatchesOwner,
  formatClaimComment,
  parseClaimComment,
  type ClaimComment,
  type ClaimKind,
} from "./comment-format.js";

export {
  CF_BASE,
  CF_ERROR_CODE_TOKEN_DRIFT,
  CloudflareApiError,
  CloudflareNamespaceClient,
  THINKWORK_APEX_ZONE,
  formatCloudflareError,
  type CloudflareClientOptions,
  type CreateRecordInput,
  type DnsRecord,
  type FetchLike,
  type NamespaceDnsApi,
} from "./cloudflare.js";

export {
  NS_TARGET_COUNT,
  RESERVATION_TXT_CONTENT,
  RESERVED_TENANT_SLUGS,
  TENANT_SLUG_PATTERN,
  checkName,
  claimName,
  isReservedTenantSlug,
  namespaceFqdn,
  releaseName,
  type CheckResult,
  type CheckStatus,
  type ClaimFailureReason,
  type ClaimRequest,
  type ClaimResult,
  type NamespaceDeps,
  type ReleaseRequest,
  type ReleaseResult,
  type TenantSlugSource,
} from "./core.js";

export {
  DEFAULT_TENANT_DB_STAGE,
  createStageTenantSource,
  resolveStageDatabaseUrl,
  type TenantSourceHandle,
} from "./db.js";

export { parseCliArgs, runCli, type CliDeps } from "./cli.js";
