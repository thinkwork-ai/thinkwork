/**
 * Plate conformance panel (THINK-189 U7) — per-section aggregate rates over
 * the plate's report corpus, rendered as a tab beside the preview in the
 * plate detail surface.
 *
 * Denominator discipline (AE4): structural rates present over reportCount;
 * judge-derived rates present over judgedRuns with an explicit "n of m
 * judged" framing, and show an unavailable label — never 0% — when nothing
 * has been judged yet. Small samples read as small ("2/3 runs", not "67%").
 */

import { useQuery } from "urql";
import { PlateConformanceQuery } from "@/lib/graphql-queries";

export interface ConformanceSectionStats {
  sectionId: string;
  runCount: number;
  presentCount: number;
  waivedCount: number;
  missingCount: number;
  directiveSuggestedRuns: number;
  directiveUsedRuns: number;
  judgedRuns: number;
  judgedThinRuns: number;
  assertedNotComputedRuns: number;
}

export interface ConformanceAnalysisStats {
  key: string;
  declaredRuns: number;
  computedRuns: number;
}

export interface ConformanceSummary {
  plateSlug: string;
  reportCount: number;
  judgedReportCount: number;
  pendingCount: number;
  errorCount: number;
  skippedCount: number;
  sections: ConformanceSectionStats[];
  analyses: ConformanceAnalysisStats[];
}

/** AWSJSON dual wire shape: strings over the wire, objects from seams. */
function parseJsonish<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value as T) ?? fallback;
}

export function parseConformanceSummary(
  raw: unknown,
): ConformanceSummary | null {
  if (raw === null || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  return {
    plateSlug: String(rec.plateSlug ?? ""),
    reportCount: Number(rec.reportCount ?? 0),
    judgedReportCount: Number(rec.judgedReportCount ?? 0),
    pendingCount: Number(rec.pendingCount ?? 0),
    errorCount: Number(rec.errorCount ?? 0),
    skippedCount: Number(rec.skippedCount ?? 0),
    sections: parseJsonish<ConformanceSectionStats[]>(rec.sections, []),
    analyses: parseJsonish<ConformanceAnalysisStats[]>(rec.analyses, []),
  };
}

export function rateLabel(count: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((count / total) * 100)}% (${count}/${total})`;
}

export interface PlateConformancePanelProps {
  tenantId: string | null;
  slug: string | null;
  /** Test seam: when provided, skips the live query. */
  summary?: ConformanceSummary | null;
  fetching?: boolean;
  errorMessage?: string;
}

export function PlateConformancePanel({
  tenantId,
  slug,
  summary: summaryProp,
  fetching: fetchingProp,
  errorMessage: errorProp,
}: PlateConformancePanelProps) {
  const seamed =
    summaryProp !== undefined ||
    fetchingProp === true ||
    errorProp !== undefined;
  const [result] = useQuery<{ plateConformance?: unknown }>({
    query: PlateConformanceQuery,
    variables: { tenantId, slug: slug ?? "" },
    requestPolicy: "cache-and-network",
    pause: seamed || !slug,
  });

  const summary = seamed
    ? (summaryProp ?? null)
    : parseConformanceSummary(result.data?.plateConformance ?? null);
  const fetching = seamed ? (fetchingProp ?? false) : result.fetching;
  const errorMessage = seamed ? errorProp : result.error?.message;

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-y-auto px-3 py-3"
      data-testid="plate-conformance-panel"
    >
      {errorMessage ? (
        <div
          className="flex h-full items-center justify-center px-6 py-12 text-sm text-muted-foreground"
          data-testid="plate-conformance-error"
        >
          Couldn&apos;t load conformance data: {errorMessage}
        </div>
      ) : fetching && !summary ? (
        <div
          className="flex h-full items-center justify-center px-6 py-12 text-sm text-muted-foreground"
          data-testid="plate-conformance-loading"
        >
          Loading conformance data…
        </div>
      ) : !summary || summary.reportCount === 0 ? (
        <div
          className="flex h-full items-center justify-center px-6 py-12 text-center text-sm text-muted-foreground"
          data-testid="plate-conformance-empty"
        >
          Not yet measured — no emissions recorded for this plate. Rates appear
          after documents are emitted against its contract.
        </div>
      ) : (
        <ConformanceBody summary={summary} />
      )}
    </div>
  );
}

function ConformanceBody({ summary }: { summary: ConformanceSummary }) {
  const judgeUnavailable = summary.judgedReportCount === 0;
  return (
    <div className="space-y-4">
      <div
        className="text-xs text-muted-foreground"
        data-testid="plate-conformance-totals"
      >
        {summary.reportCount} emission{summary.reportCount === 1 ? "" : "s"}{" "}
        measured
        {" · "}
        {judgeUnavailable
          ? "quality judging not available yet"
          : `${summary.judgedReportCount} judged`}
        {summary.pendingCount > 0 ? ` · ${summary.pendingCount} pending` : ""}
        {summary.errorCount > 0
          ? ` · ${summary.errorCount} judge error${summary.errorCount === 1 ? "" : "s"}`
          : ""}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs" data-testid="plate-conformance-table">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Section</th>
              <th className="px-2 py-1.5 font-medium">Present</th>
              <th className="px-2 py-1.5 font-medium">Waived</th>
              <th className="px-2 py-1.5 font-medium">Missing</th>
              <th className="px-2 py-1.5 font-medium">
                Suggested widgets used
              </th>
              <th className="px-2 py-1.5 font-medium">Judged thin</th>
            </tr>
          </thead>
          <tbody>
            {summary.sections.map((s) => (
              <tr
                key={s.sectionId}
                className="border-b border-border/60 last:border-b-0"
                data-testid={`plate-conformance-row-${s.sectionId}`}
              >
                <td className="px-2 py-1.5 font-medium">{s.sectionId}</td>
                <td className="px-2 py-1.5">
                  {rateLabel(s.presentCount, s.runCount)}
                </td>
                <td className="px-2 py-1.5">
                  {rateLabel(s.waivedCount, s.runCount)}
                </td>
                <td className="px-2 py-1.5">
                  {rateLabel(s.missingCount, s.runCount)}
                </td>
                <td className="px-2 py-1.5">
                  {s.directiveSuggestedRuns === 0
                    ? "—"
                    : rateLabel(s.directiveUsedRuns, s.directiveSuggestedRuns)}
                </td>
                <td
                  className="px-2 py-1.5"
                  data-testid={`plate-conformance-thin-${s.sectionId}`}
                >
                  {s.judgedRuns === 0
                    ? "Not judged yet"
                    : `${s.judgedThinRuns} of ${s.judgedRuns} judged runs`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {summary.analyses.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-xs font-medium">Declared analyses computed</div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table
              className="w-full text-xs"
              data-testid="plate-conformance-analyses"
            >
              <tbody>
                {summary.analyses.map((a) => (
                  <tr
                    key={a.key}
                    className="border-b border-border/60 last:border-b-0"
                  >
                    <td className="px-2 py-1.5 font-medium">{a.key}</td>
                    <td className="px-2 py-1.5">
                      computed in {rateLabel(a.computedRuns, a.declaredRuns)} of
                      declaring runs
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
