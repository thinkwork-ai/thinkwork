/**
 * Marker-comment matching (security hardening).
 *
 * Every daemon marker (`automation-ledger:`, `handoff:`, `dispatcher:`,
 * `factory-preflight:`, `factory-block:`, `factory-lane-conflict:`) must be
 * the comment's FIRST LINE. Substring matching (`body.includes(marker)`) let
 * any comment that merely QUOTED a marker mid-body impersonate the real
 * thing — a worker progress note quoting "post the handoff:X:Verification
 * comment" would falsely complete a phase, and a human comment quoting the
 * ledger marker would become THE ledger.
 *
 * The marker must also end at a token boundary, so `...:THINK-1` never
 * matches a `THINK-12` comment.
 */

/** True when `body`'s first non-blank line IS the marker (token-bounded). */
export function isMarkerComment(body: string, marker: string): boolean {
  const firstLine = (body.trimStart().split("\n", 1)[0] ?? "").trim();
  if (firstLine === marker) return true;
  if (!firstLine.startsWith(marker)) return false;
  // Allow trailing punctuation/whitespace but never an identifier character:
  // "automation-ledger:THINK-1" must not match "automation-ledger:THINK-12".
  const next = firstLine.charAt(marker.length);
  return !/[A-Za-z0-9_-]/.test(next);
}
