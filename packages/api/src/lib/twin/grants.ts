/**
 * Shared Company Brain grant-list validation (THINK-625).
 *
 * Lifted verbatim out of `handlers/brain-api-keys.ts` so the `tkt_` key lane
 * and the per-user claims lane cannot disagree about what a grant list is.
 * Both lanes publish into manifests the Brain treats as authoritative, so a
 * value one side accepts and the other mangles is an authorization bug, not
 * a formatting one.
 *
 * Behavior is unchanged from the handler's original inline version: an array
 * of non-empty strings, `"*"` allowed as the all-of wildcard, trimmed and
 * de-duplicated with order preserved, and an error string (never a silent
 * repair) on rejection.
 */

/** Grant value meaning "every group" / "every collection". */
export const GRANT_WILDCARD = "*";

/** Grant list guards — a manifest entry is not a place to dump free text. */
export const MAX_GRANT_ENTRIES = 100;
export const MAX_GRANT_LENGTH = 200;

export type ParsedGrantList = { values: string[] } | { error: string };

/**
 * Validate one grant list (`securityGroups` / `kbCollections` /
 * `toolAllowlist`): an array of non-empty strings, `"*"` allowed as the
 * all-of wildcard. Trims and de-duplicates, order preserved. Returns an
 * error string on rejection — fail the request rather than silently storing
 * a grant we mangled.
 */
export function parseGrantList(value: unknown, field: string): ParsedGrantList {
  if (!Array.isArray(value))
    return { error: `${field}: array of non-empty strings required` };
  if (value.length > MAX_GRANT_ENTRIES)
    return { error: `${field}: max ${MAX_GRANT_ENTRIES} entries` };
  const values: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string")
      return { error: `${field}: array of non-empty strings required` };
    const trimmed = entry.trim();
    if (!trimmed)
      return { error: `${field}: array of non-empty strings required` };
    if (trimmed.length > MAX_GRANT_LENGTH)
      return { error: `${field}: each entry max ${MAX_GRANT_LENGTH} chars` };
    if (!values.includes(trimmed)) values.push(trimmed);
  }
  return { values };
}
