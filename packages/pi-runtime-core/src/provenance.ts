/**
 * Numeric provenance tracing (THINK-681) — the pure core shared by the two
 * analytics gates:
 *
 *  - the `emit_analytics_chart` runtime wrapper (`chart-runtime.ts`), and
 *  - the `tw:chart` / `tw:analysis` composer gate in
 *    `@thinkwork/pi-extensions` document-composer.
 *
 * The contract is deliberately PRAGMATIC, not cryptographic: a number a chart
 * presents must plausibly *trace* to data the turn actually saw (tool results,
 * plus the user's own message), either verbatim, rounded, or as a simple
 * derivation of two observed numbers (percentage, delta, sum, ratio). It cannot
 * prove the model used the right numbers; it reliably catches the failure mode
 * that matters — charting numbers nothing in the turn ever produced.
 *
 * Everything here is pure and dependency-free so both hosts can share it
 * without a new package edge (pi-extensions already depends on this package).
 */

/** Relative tolerance for a DERIVED match (percentage/delta/sum/ratio). */
export const PROVENANCE_DERIVED_TOLERANCE = 0.005;

/** Absolute floor so derivations landing near zero still compare sanely. */
const NEAR_ZERO_EPSILON = 1e-9;

/**
 * Upper bound on the corpus slice fed to the O(n²) derived-match scan. The
 * corpus is deduped first, so this caps a pathological tool result (a 10k-row
 * dump) at 200×200 pair checks per chart value rather than unbounded work.
 */
export const PROVENANCE_PAIR_SCAN_CAP = 200;

/** Hard ceiling on tokens pulled out of any single text blob. */
const MAX_TOKENS_PER_TEXT = 5000;

/**
 * Numeric tokens in free text. A token must not be glued to a letter or
 * underscore on either side, so identifiers like `Q3`, `id_42`, or `2xRevenue`
 * never enter the corpus (nor the chart-side value list) as data. Thousands
 * separators are stripped; percent signs are ignored (a `18%` reads as 18).
 */
const NUMERIC_TOKEN_RE = /-?\d[\d,]*(?:\.\d+)?(?:[eE][-+]?\d+)?/g;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z_]/.test(ch);
}

export function extractNumericTokens(text: string): number[] {
  if (!text) return [];
  const out: number[] = [];
  NUMERIC_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NUMERIC_TOKEN_RE.exec(text)) !== null) {
    if (out.length >= MAX_TOKENS_PER_TEXT) break;
    const start = match.index;
    const end = start + match[0].length;
    if (isWordChar(text[start - 1]) || isWordChar(text[end])) continue;
    const raw = match[0].replace(/,/g, "");
    const value = Number(raw);
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

/** Stringify an arbitrary tool result / value for token extraction. */
export function stringifyForProvenance(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * Build the turn's provenance corpus: every distinct finite number appearing in
 * any of the given sources (tool results, user message text, …), deduped in
 * first-seen order.
 */
export function buildProvenanceCorpus(
  sources: Iterable<unknown>,
): readonly number[] {
  const seen = new Set<number>();
  const corpus: number[] = [];
  for (const source of sources) {
    const text =
      typeof source === "string" ? source : stringifyForProvenance(source);
    for (const value of extractNumericTokens(text)) {
      if (seen.has(value)) continue;
      seen.add(value);
      corpus.push(value);
    }
  }
  return corpus;
}

function decimals(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const text = String(value);
  const dot = text.indexOf(".");
  if (dot < 0 || text.includes("e") || text.includes("E")) return 0;
  return text.length - dot - 1;
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** Math.min(places, 12);
  return Math.round(value * factor) / factor;
}

function closeEnough(a: number, b: number, tolerance: number): boolean {
  const diff = Math.abs(a - b);
  if (diff <= NEAR_ZERO_EPSILON) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return diff <= scale * tolerance;
}

/** Exact, or equal once either side is rounded to the other's precision. */
function matchesDirectly(value: number, corpusValue: number): boolean {
  if (value === corpusValue) return true;
  if (Math.abs(value - corpusValue) <= NEAR_ZERO_EPSILON) return true;
  const vd = decimals(value);
  const cd = decimals(corpusValue);
  if (vd < cd && roundTo(corpusValue, vd) === value) return true;
  if (cd < vd && roundTo(value, cd) === corpusValue) return true;
  return false;
}

/**
 * Derived match: the value is a simple, single-step function of two corpus
 * numbers — the derivations an analyst actually performs before charting.
 * `a * 100 / b` covers "percent of total"; `a - b` deltas; `a + b` roll-ups;
 * `a / b` rates and multiples.
 */
function matchesDerived(value: number, scan: readonly number[]): boolean {
  const tolerance = PROVENANCE_DERIVED_TOLERANCE;
  for (let i = 0; i < scan.length; i += 1) {
    const a = scan[i];
    for (let j = 0; j < scan.length; j += 1) {
      if (i === j) continue;
      const b = scan[j];
      if (closeEnough(value, a + b, tolerance)) return true;
      if (closeEnough(value, a - b, tolerance)) return true;
      if (b !== 0) {
        if (closeEnough(value, a / b, tolerance)) return true;
        if (closeEnough(value, (a * 100) / b, tolerance)) return true;
      }
    }
  }
  return false;
}

/**
 * Does `value` trace to the corpus? Direct match first (cheap, exact), then the
 * capped derived scan.
 */
export function tracesToCorpus(
  value: number,
  corpus: readonly number[],
): boolean {
  if (!Number.isFinite(value)) return true; // not a data claim we can check
  if (corpus.length === 0) return false;
  for (const corpusValue of corpus) {
    if (matchesDirectly(value, corpusValue)) return true;
  }
  const scan =
    corpus.length > PROVENANCE_PAIR_SCAN_CAP
      ? corpus.slice(0, PROVENANCE_PAIR_SCAN_CAP)
      : corpus;
  return matchesDerived(value, scan);
}

/** Split the presented values into traced / untraced (order preserved). */
export function partitionByProvenance(
  values: readonly number[],
  corpus: readonly number[],
): { traced: number[]; untraced: number[] } {
  const traced: number[] = [];
  const untraced: number[] = [];
  for (const value of values) {
    if (tracesToCorpus(value, corpus)) traced.push(value);
    else untraced.push(value);
  }
  return { traced, untraced };
}

/**
 * Enforcement outcome for one analytics emission. Mirrors the accept/reject
 * reason union shape of `decideEmitBinding` (json-render-runtime.ts) so both
 * gates read the same way.
 *
 * - `accept: traced` — nothing to check, or ≥half the values trace.
 * - `accept: post_rejection` — the loop guard: this emission was already
 *   provenance-rejected once this turn, so accept it with a warning rather than
 *   ping-pong forever.
 * - `reject: no_data_this_turn` — the turn fetched nothing; a chart's numbers
 *   cannot have come from anywhere checkable.
 * - `reject: untraced` — more than half the charted numbers match nothing the
 *   turn observed.
 */
export type ProvenanceEnforcement =
  | { decision: "accept"; reason: "traced"; untraced: number[] }
  | { decision: "accept"; reason: "post_rejection"; untraced: number[] }
  | { decision: "reject"; reason: "no_data_this_turn" }
  | {
      decision: "reject";
      reason: "untraced";
      untraced: number[];
      totalValues: number;
    };

/** Fraction of untraceable values above which an emission is rejected. */
export const PROVENANCE_UNTRACED_REJECT_RATIO = 0.5;

export function decideProvenance(input: {
  values: readonly number[];
  corpus: readonly number[];
  alreadyRejected: boolean;
}): ProvenanceEnforcement {
  const { values, corpus, alreadyRejected } = input;
  if (values.length === 0) {
    return { decision: "accept", reason: "traced", untraced: [] };
  }
  if (corpus.length === 0) {
    return alreadyRejected
      ? { decision: "accept", reason: "post_rejection", untraced: [...values] }
      : { decision: "reject", reason: "no_data_this_turn" };
  }
  const { untraced } = partitionByProvenance(values, corpus);
  if (untraced.length / values.length <= PROVENANCE_UNTRACED_REJECT_RATIO) {
    return { decision: "accept", reason: "traced", untraced };
  }
  if (alreadyRejected) {
    return { decision: "accept", reason: "post_rejection", untraced };
  }
  return {
    decision: "reject",
    reason: "untraced",
    untraced,
    totalValues: values.length,
  };
}

/** Up to `limit` untraceable values, verbatim, for the self-repair message. */
export function formatUntracedValues(
  untraced: readonly number[],
  limit = 5,
): string {
  return untraced
    .slice(0, limit)
    .map((value) => String(value))
    .join(", ");
}
