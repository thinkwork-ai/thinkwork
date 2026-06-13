/**
 * MCP tool read/write classification by name heuristic (Evaluations Trust
 * Core U14).
 *
 * Eval replay needs to run an agent's MCP tools so a flagged thread can
 * actually exercise them — but replaying a real conversation must never
 * trigger a side-effect (create/update/delete/send) against a live system.
 * MCP discovery only caches `{name, description, inputSchema}` (no
 * `readOnlyHint`/annotation data), so the only signal available at
 * selection time is the tool's NAME.
 *
 * This classifier inspects the tool's local name (after any server
 * namespace) and decides whether it is read-shaped (safe to run on replay
 * by default) or write-shaped (blocked on replay unless an operator
 * force-allows it). The default is intentionally CONSERVATIVE: anything
 * that does not clearly read is classified "write", so replay only runs a
 * tool automatically when its name unambiguously signals a read.
 */

export type McpToolAccess = "read" | "write";

/**
 * Read-shaped verb prefixes. A tool whose local name starts with one of
 * these (followed by `_`, `-`, `.`, a word boundary, or end-of-name) is
 * treated as read-only. Matched case-insensitively.
 */
export const READ_TOOL_PREFIXES: readonly string[] = [
  "list",
  "get",
  "search",
  "read",
  "find",
  "query",
  "fetch",
  "describe",
  "show",
  "lookup",
  "count",
  "export",
  "view",
];

/**
 * Write-shaped verb prefixes (informational + symmetry — the classifier
 * defaults to "write" for anything not matched as read, so this list is
 * not strictly required for correctness, but documents the recognized
 * mutating verbs and lets callers reason about why a tool is blocked).
 */
export const WRITE_TOOL_PREFIXES: readonly string[] = [
  "create",
  "update",
  "delete",
  "send",
  "write",
  "remove",
  "set",
  "patch",
  "put",
  "insert",
  "add",
  "archive",
  "cancel",
  "approve",
  "reject",
  "execute",
  "run",
  "sync",
  "post",
  "upsert",
  "move",
  "assign",
  "trigger",
];

/**
 * Strip a server namespace prefix from a tool name so the verb sits at the
 * front. MCP tools surface variously namespaced (e.g. `lastmile--crm.list`,
 * `crm__list_opportunities`, `crm/get_contact`); we split on the common
 * separators and classify the LAST segment's leading verb. The separators
 * checked are `.`, `/`, and `__` (double-underscore, a common MCP
 * namespacing convention). Single `_`/`-` are treated as word separators
 * WITHIN a name, not namespace boundaries.
 */
function localToolName(toolName: string): string {
  let name = toolName.trim();
  // Namespace separators, longest-first so `__` wins over `_`.
  for (const sep of [".", "/", "__"]) {
    const idx = name.lastIndexOf(sep);
    if (idx >= 0 && idx + sep.length < name.length) {
      name = name.slice(idx + sep.length);
    }
  }
  return name;
}

/**
 * The set of characters that terminate a leading verb. A prefix matches
 * only when it is the whole name or is immediately followed by one of
 * these — so `list` and `list_opportunities` match `list`, but
 * `listings_create` does NOT (the verb there is the trailing `create`,
 * which is write-shaped anyway).
 */
function startsWithVerb(name: string, verb: string): boolean {
  if (!name.startsWith(verb)) return false;
  if (name.length === verb.length) return true;
  const next = name.charAt(verb.length);
  return next === "_" || next === "-";
}

/**
 * Classify an MCP tool's access shape from its name.
 *
 *   - Returns "read" when the tool's local name begins with a recognized
 *     read verb (see READ_TOOL_PREFIXES).
 *   - Returns "write" otherwise — including unrecognized/ambiguous names
 *     and every write verb. This is the safe default: replay only runs a
 *     tool automatically when its name clearly reads.
 *
 * Matching order:
 *   1. A recognized LEADING verb wins (`list_opportunities` → read,
 *      `create_opportunity` → write — the canonical <verb>_<noun> shape).
 *   2. Otherwise, segments are inspected for the <noun>_<verb> shape some
 *      servers use (`opportunities_list` → read). A write verb in any
 *      segment wins (safe default); else a read verb in any segment is
 *      "read".
 *   3. No recognized verb anywhere → "write".
 */
export function classifyMcpToolAccess(toolName: string): McpToolAccess {
  const name = localToolName(toolName).toLowerCase();
  if (!name) return "write";

  const readSet = new Set(READ_TOOL_PREFIXES);
  const writeSet = new Set(WRITE_TOOL_PREFIXES);

  // Leading verb wins first (the canonical <verb>_<noun> shape).
  for (const verb of READ_TOOL_PREFIXES) {
    if (startsWithVerb(name, verb)) return "read";
  }
  for (const verb of WRITE_TOOL_PREFIXES) {
    if (startsWithVerb(name, verb)) return "write";
  }

  // No recognized leading verb. Inspect segments for a trailing-verb
  // shape (<noun>_<verb>, e.g. `opportunities_list`). A write verb in any
  // segment wins (safe default); otherwise a read verb in any segment
  // classifies "read".
  const segments = name.split(/[_\-.]+/).filter(Boolean);
  if (segments.some((seg) => writeSet.has(seg))) return "write";
  if (segments.some((seg) => readSet.has(seg))) return "read";

  // Ambiguous / no recognized verb → write (only run if force-allowed).
  return "write";
}
