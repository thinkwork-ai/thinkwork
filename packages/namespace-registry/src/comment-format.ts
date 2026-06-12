/**
 * Record-comment contract for the customer domain namespace (R4).
 *
 * Every record the claim tool writes into the Cloudflare `thinkwork.ai`
 * zone carries a comment identifying kind, owner, and creation date:
 *
 *   deployment:<owner> created:<YYYY-MM-DD>
 *   tenant:<owner> created:<YYYY-MM-DD>
 *
 * This module is the single source of truth for that format. Both the
 * claim writer (this package's CLI) and the signup reader
 * (packages/api tenantSlugValidation) parse against it — do NOT
 * duplicate the format elsewhere; import from here.
 */

export type ClaimKind = "deployment" | "tenant";

export interface ClaimComment {
  kind: ClaimKind;
  owner: string;
  /** ISO date, YYYY-MM-DD. */
  created: string;
}

/**
 * The exported comment-format constant (R4). Anchored, full-string match.
 * Owner is a tenant-slug-shaped token; created is an ISO date.
 */
export const CLAIM_COMMENT_PATTERN =
  /^(deployment|tenant):([a-z0-9][a-z0-9-]*) created:(\d{4}-\d{2}-\d{2})$/;

export function formatClaimComment(comment: ClaimComment): string {
  return `${comment.kind}:${comment.owner} created:${comment.created}`;
}

/**
 * Parses a Cloudflare record comment. Returns null for anything that is
 * not a well-formed claim comment (including null/undefined/empty) —
 * callers must treat unparseable comments as foreign claims.
 */
export function parseClaimComment(
  comment: string | null | undefined,
): ClaimComment | null {
  if (!comment) return null;
  const match = CLAIM_COMMENT_PATTERN.exec(comment);
  if (!match) return null;
  return {
    kind: match[1] as ClaimKind,
    owner: match[2]!,
    created: match[3]!,
  };
}

/**
 * True iff the comment parses AND identifies exactly this kind+owner.
 * Creation date is identity-irrelevant: a re-claim by the same owner on a
 * different day still owns its earlier records.
 */
export function commentMatchesOwner(
  comment: string | null | undefined,
  kind: ClaimKind,
  owner: string,
): boolean {
  const parsed = parseClaimComment(comment);
  return parsed !== null && parsed.kind === kind && parsed.owner === owner;
}
