/**
 * Structured rolling-ledger block (R13).
 *
 * The ledger lives in the Linear comment whose body starts with the marker
 * `automation-ledger:<ISSUE_ID>`. Machine state is a fenced YAML block right
 * under the marker; prose for humans stays beneath the fence.
 *
 * The parser NEVER hard-fails on a ledger comment: absent comments, legacy
 * prose-only ledgers, and empty/malformed YAML fences all synthesize a fresh
 * default block while preserving the original human text as prose so nothing
 * is lost when the writer next round-trips the comment. Unknown enum values
 * are preserved verbatim but surfaced as warnings — the daemon parses the
 * ledger, it does not interpret prose.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { BLOCKER_LABELS, LANE_LABELS } from "../domain/statuses.js";
import type { LinearCommentSnapshot } from "./client.js";
import { isMarkerComment } from "./markers.js";

export const LEDGER_MARKER_PREFIX = "automation-ledger:";

/** Known pipeline phases. Unknown values are preserved but flagged. */
export const KNOWN_PHASES = [
  "todo",
  "brainstorm",
  "plan",
  "implement",
  "verify",
  "compound",
  "done",
] as const;

/** Known lanes (canonical lane labels). `unassigned` is the synthesized default. */
export const KNOWN_LANES = [...LANE_LABELS, "unassigned"] as const;

export interface LedgerWorker {
  /** Worker id (pid or thread id, lane-specific). */
  id: string;
  /** Host name from the host registry (e.g. "mini", "laptop"). */
  host: string;
}

export interface Ledger {
  phase: string;
  lane: string;
  worker: LedgerWorker | null;
  attempt: number;
  blocker: string | null;
  compounded: boolean;
}

export interface ParsedLedger {
  ledger: Ledger;
  /** Human prose preserved beneath the fence (may be empty). */
  prose: string;
  /** True when no structured block existed and defaults were synthesized. */
  synthesized: boolean;
  /** Unknown enum values / coerced fields, for logging — never fatal. */
  warnings: string[];
}

export const DEFAULT_LEDGER: Ledger = {
  phase: "todo",
  lane: "unassigned",
  worker: null,
  attempt: 0,
  blocker: null,
  compounded: false,
};

export function ledgerMarker(issueIdentifier: string): string {
  return `${LEDGER_MARKER_PREFIX}${issueIdentifier}`;
}

/**
 * True when a comment body IS this issue's ledger comment: the marker must
 * be the first line (a comment merely quoting the marker mid-body must never
 * become THE ledger — hijack hardening).
 */
export function isLedgerComment(
  issueIdentifier: string,
  body: string,
): boolean {
  return isMarkerComment(body, ledgerMarker(issueIdentifier));
}

/**
 * The authoritative ledger comment: the NEWEST matching comment (comments
 * are chronological, Linear returns ascending). A daemon-authored ledger
 * always wins over any older comment that happens to parse as one.
 */
export function findLedgerComment(
  issueIdentifier: string,
  comments: readonly LinearCommentSnapshot[],
): LinearCommentSnapshot | null {
  for (let i = comments.length - 1; i >= 0; i--) {
    if (isLedgerComment(issueIdentifier, comments[i].body)) return comments[i];
  }
  return null;
}

const FENCE_OPEN = "```yaml";
const FENCE_CLOSE = "```";

/**
 * Render the canonical ledger comment: marker line, fenced YAML block, then
 * prose. `parseLedgerComment(render(...))` returns the identical ledger and
 * prose, and re-rendering that parse reproduces the identical string.
 */
export function renderLedgerComment(
  issueIdentifier: string,
  ledger: Ledger,
  prose = "",
): string {
  // Fixed key order so the writer is byte-stable across round-trips.
  const doc = {
    phase: ledger.phase,
    lane: ledger.lane,
    worker:
      ledger.worker === null
        ? null
        : { id: ledger.worker.id, host: ledger.worker.host },
    attempt: ledger.attempt,
    blocker: ledger.blocker,
    compounded: ledger.compounded,
  };
  const yaml = stringifyYaml(doc).trimEnd();
  const parts = [
    ledgerMarker(issueIdentifier),
    "",
    FENCE_OPEN,
    yaml,
    FENCE_CLOSE,
  ];
  const trimmedProse = prose.replace(/^\n+/, "").trimEnd();
  if (trimmedProse !== "") parts.push("", trimmedProse);
  return parts.join("\n");
}

function coerceLedger(
  raw: Record<string, unknown>,
  warnings: string[],
): Ledger {
  const out: Ledger = { ...DEFAULT_LEDGER };

  if (typeof raw.phase === "string" && raw.phase.trim() !== "") {
    out.phase = raw.phase;
    if (!(KNOWN_PHASES as readonly string[]).includes(raw.phase))
      warnings.push(`unknown phase: ${raw.phase}`);
  } else if (raw.phase !== undefined) {
    warnings.push(
      `invalid phase (${JSON.stringify(raw.phase)}); defaulted to "${out.phase}"`,
    );
  }

  if (typeof raw.lane === "string" && raw.lane.trim() !== "") {
    out.lane = raw.lane;
    if (!(KNOWN_LANES as readonly string[]).includes(raw.lane))
      warnings.push(`unknown lane: ${raw.lane}`);
  } else if (raw.lane !== undefined) {
    warnings.push(
      `invalid lane (${JSON.stringify(raw.lane)}); defaulted to "${out.lane}"`,
    );
  }

  const worker = raw.worker;
  if (worker === null || worker === undefined) {
    out.worker = null;
  } else if (
    typeof worker === "object" &&
    typeof (worker as Record<string, unknown>).id === "string" &&
    typeof (worker as Record<string, unknown>).host === "string"
  ) {
    const w = worker as Record<string, unknown>;
    out.worker = { id: w.id as string, host: w.host as string };
  } else {
    out.worker = null;
    warnings.push(
      `invalid worker (${JSON.stringify(worker)}); defaulted to null`,
    );
  }

  if (typeof raw.attempt === "number" && Number.isFinite(raw.attempt)) {
    out.attempt = raw.attempt;
  } else if (raw.attempt !== undefined) {
    warnings.push(
      `invalid attempt (${JSON.stringify(raw.attempt)}); defaulted to 0`,
    );
  }

  if (raw.blocker === null || raw.blocker === undefined) {
    out.blocker = null;
  } else if (typeof raw.blocker === "string") {
    out.blocker = raw.blocker;
    if (
      !(BLOCKER_LABELS as readonly string[]).includes(raw.blocker) &&
      parseWaitingOn(raw.blocker) === null
    )
      warnings.push(`unknown blocker: ${raw.blocker}`);
  } else {
    warnings.push(
      `invalid blocker (${JSON.stringify(raw.blocker)}); defaulted to null`,
    );
  }

  if (typeof raw.compounded === "boolean") {
    out.compounded = raw.compounded;
  } else if (raw.compounded !== undefined) {
    warnings.push(
      `invalid compounded (${JSON.stringify(raw.compounded)}); defaulted to false`,
    );
  }

  return out;
}

/**
 * Parse a ledger comment body. Tolerant by construction:
 * - `undefined`/`null` body → synthesized defaults, empty prose;
 * - marker + valid YAML fence → structured ledger, prose = text after fence;
 * - marker + no/empty/malformed fence (legacy prose ledger) → synthesized
 *   defaults, ALL original text after the marker preserved as prose so the
 *   writer re-emits it beneath the fresh fence.
 */
export function parseLedgerComment(
  issueIdentifier: string,
  body: string | null | undefined,
): ParsedLedger {
  if (body === null || body === undefined || body.trim() === "") {
    return {
      ledger: { ...DEFAULT_LEDGER },
      prose: "",
      synthesized: true,
      warnings: [],
    };
  }

  const marker = ledgerMarker(issueIdentifier);
  const markerIdx = body.indexOf(marker);
  // Text after the marker line (or the whole body for marker-less input).
  const afterMarker =
    markerIdx === -1
      ? body
      : body.slice(markerIdx + marker.length).replace(/^[^\S\n]*\n/, "");

  const lines = afterMarker.split("\n");
  const openIdx = lines.findIndex((l) => l.trim() === FENCE_OPEN);
  let closeIdx = -1;
  if (openIdx !== -1) {
    for (let i = openIdx + 1; i < lines.length; i++) {
      if (lines[i].trim() === FENCE_CLOSE) {
        closeIdx = i;
        break;
      }
    }
  }

  const legacy = (prose: string): ParsedLedger => ({
    ledger: { ...DEFAULT_LEDGER },
    prose: prose.replace(/^\n+/, "").trimEnd(),
    synthesized: true,
    warnings: [],
  });

  if (openIdx === -1 || closeIdx === -1) {
    // Legacy prose ledger: no parseable fence at all.
    return legacy(afterMarker);
  }

  const yamlText = lines.slice(openIdx + 1, closeIdx).join("\n");
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch {
    parsed = undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    // Empty or malformed fence — treat as legacy; keep the broken fence
    // content in the prose so nothing is silently dropped.
    return legacy(afterMarker);
  }

  const warnings: string[] = [];
  const ledger = coerceLedger(parsed as Record<string, unknown>, warnings);
  const prose = lines
    .slice(closeIdx + 1)
    .join("\n")
    .replace(/^\n+/, "")
    .trimEnd();
  return { ledger, prose, synthesized: false, warnings };
}

/**
 * Cross-issue dependency blocker: a worker gated on another issue records
 * `waiting-on: THINK-x` in the ledger blocker field and ends its run. The
 * engine then WAITS quietly and relaunches the phase automatically when the
 * dependency reaches Done — never `Needs User`, never a burned Failed attempt
 * (LFG doctrine: an issue with a known next action is never stuck on a human).
 * Returns the dependency identifier, or null when the blocker is not a
 * waiting-on marker.
 */
export function parseWaitingOn(blocker: string | null | undefined): string | null {
  if (blocker == null) return null;
  const m = /^waiting-on:?\s+([A-Za-z]+-\d+)\b/i.exec(blocker.trim());
  return m ? m[1].toUpperCase() : null;
}
