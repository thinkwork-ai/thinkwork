/**
 * Tool-approval display-summary redaction (THINK-302 U11 — R12, KTD-5).
 *
 * The data-minimization boundary: the parked-call ledger keeps the real
 * arguments only inside the ENCRYPTED execution payload. Everything a human
 * surface touches — the approval card, the Slack notification, logs, the
 * governance feed — reads THIS redacted, size-bounded display summary
 * instead. Raw argument values never appear outside the encrypted payload.
 *
 * The summary names the tool, the requester, the capability, and the
 * argument KEYS (never their values) plus a coarse value shape hint
 * (string/number/…, length bucket) so an operator can tell "launch which
 * pipeline" apart from an empty call without seeing secrets. Strings are
 * never echoed; a value that itself looks like a secret is marked as such.
 *
 * Pure + inert in U11a: no live caller until U11b's intake wires it.
 */

const MAX_SUMMARY_ARGS = 24;
const MAX_KEY_LEN = 80;

/** Coarse, value-free shape hint for one argument. */
export interface RedactedArgHint {
  key: string;
  type: "string" | "number" | "boolean" | "null" | "array" | "object";
  /** Bucketed size: string length, array length, or object key count. */
  sizeBucket?: "empty" | "small" | "medium" | "large";
  /** The value shape matched a secret pattern — flagged, never echoed. */
  secretLike?: boolean;
  /** Arrays/objects: element/key count (a count is not a value). */
  count?: number;
}

export interface RedactedApprovalSummary {
  toolName: string;
  callId: string;
  class: string;
  slug: string;
  /** Display name of the requesting user, when known (never an id/email leak). */
  requestedBy?: string;
  argHints: RedactedArgHint[];
  /** Set when the arg list was truncated to the cap. */
  argsOmitted?: number;
}

const SECRET_VALUE_RE =
  /^(?:AKIA[0-9A-Z]{16}|(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]+|-----BEGIN)/;

function bucketLength(n: number): RedactedArgHint["sizeBucket"] {
  if (n === 0) return "empty";
  if (n <= 32) return "small";
  if (n <= 256) return "medium";
  return "large";
}

function hintForValue(key: string, value: unknown): RedactedArgHint {
  const safeKey =
    key.length > MAX_KEY_LEN ? `${key.slice(0, MAX_KEY_LEN)}…` : key;
  if (value === null || value === undefined) {
    return { key: safeKey, type: "null" };
  }
  if (typeof value === "string") {
    return {
      key: safeKey,
      type: "string",
      sizeBucket: bucketLength(value.length),
      ...(SECRET_VALUE_RE.test(value) ? { secretLike: true } : {}),
    };
  }
  if (typeof value === "number") return { key: safeKey, type: "number" };
  if (typeof value === "boolean") return { key: safeKey, type: "boolean" };
  if (Array.isArray(value)) {
    return {
      key: safeKey,
      type: "array",
      count: value.length,
      sizeBucket: bucketLength(value.length),
    };
  }
  const keys = Object.keys(value as Record<string, unknown>);
  return {
    key: safeKey,
    type: "object",
    count: keys.length,
    sizeBucket: bucketLength(keys.length),
  };
}

export interface BuildSummaryInput {
  toolName: string;
  callId: string;
  class: string;
  slug: string;
  requestedBy?: string;
  args: unknown;
}

/**
 * Build the redacted display summary from raw tool-call arguments. The raw
 * `args` are consumed here and MUST NOT be persisted anywhere but the
 * encrypted execution payload — this function returns only value-free hints.
 */
export function buildRedactedApprovalSummary(
  input: BuildSummaryInput,
): RedactedApprovalSummary {
  const argHints: RedactedArgHint[] = [];
  let argsOmitted = 0;
  if (
    input.args &&
    typeof input.args === "object" &&
    !Array.isArray(input.args)
  ) {
    const entries = Object.entries(input.args as Record<string, unknown>);
    for (const [key, value] of entries.slice(0, MAX_SUMMARY_ARGS)) {
      argHints.push(hintForValue(key, value));
    }
    if (entries.length > MAX_SUMMARY_ARGS) {
      argsOmitted = entries.length - MAX_SUMMARY_ARGS;
    }
  } else if (Array.isArray(input.args)) {
    argHints.push({
      key: "(positional)",
      type: "array",
      count: input.args.length,
    });
  }
  return {
    toolName: input.toolName,
    callId: input.callId,
    class: input.class,
    slug: input.slug,
    ...(input.requestedBy ? { requestedBy: input.requestedBy } : {}),
    argHints,
    ...(argsOmitted > 0 ? { argsOmitted } : {}),
  };
}

/**
 * One-line human string for Slack/logs from the redacted summary — still
 * value-free. e.g. "dagster_launch_run (mcp/dagster) requested by Dana —
 * args: pipeline<string>, dry_run<boolean>".
 */
export function formatApprovalSummaryLine(
  summary: RedactedApprovalSummary,
): string {
  const who = summary.requestedBy ? ` requested by ${summary.requestedBy}` : "";
  const args =
    summary.argHints.length > 0
      ? summary.argHints
          .map(
            (hint) =>
              `${hint.key}<${hint.type}${hint.secretLike ? ":secret-like" : ""}>`,
          )
          .join(", ")
      : "no arguments";
  const omitted = summary.argsOmitted ? ` (+${summary.argsOmitted} more)` : "";
  return `${summary.toolName} (${summary.class}/${summary.slug})${who} — args: ${args}${omitted}`;
}
