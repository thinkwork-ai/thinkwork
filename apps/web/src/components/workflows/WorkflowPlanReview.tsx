import { useMemo, useState } from "react";
import { Badge, Button, Input, Textarea } from "@thinkwork/ui";
import { jsonRecord } from "./workflow-ui";
import type { WorkflowEvidenceItem } from "./WorkflowEvidencePanel";

/**
 * Plan-review editor for memory-workflow approvals (THINK-193 U3, AE2).
 *
 * Renders the preflight stage's recorded plan (sources + grant status +
 * focus candidates) with NARROWING controls only: deselect sources, cap the
 * record budget, bound the time range. Everything shown was already inside
 * the saved configuration — nothing here can widen access, and the server
 * re-validates the override against the saved boundaries on approve.
 * Falls back to the generic approve/deny block when the run carries no
 * preflight plan (non-memory approvals).
 */

export interface ApprovalOverridePayload {
  sourceConfigIds?: string[];
  focusKeys?: string[];
  timeRangeFrom?: string | null;
  timeRangeTo?: string | null;
  maxRecords?: number | null;
}

interface PreflightPlanSource {
  sourceConfigId: string;
  sourceFamily: string;
  sourceBindingKey: string;
  enabled: boolean;
  grantStatus: string;
  effectiveMaxRecords: number | null;
  checkpointAdvancedAt: string | null;
  recentEvidenceCount: number;
  /** URL envelope for web (firecrawl) sources — exact URLs + domain rules. */
  boundaryUrls: string[];
}

interface PreflightPlan {
  generatedAt?: string;
  sources: PreflightPlanSource[];
  focus: Array<{ key: string; label: string }>;
}

/** Extract the preflight plan from the run's step_output evidence. */
export function preflightPlanFromEvidence(
  evidence: WorkflowEvidenceItem[],
): PreflightPlan | null {
  for (const item of evidence) {
    if (item.evidenceType !== "step_output") continue;
    const summary = jsonRecord(item.summary);
    const output = jsonRecord(summary.output);
    const plan = jsonRecord(output.plan);
    if (!Array.isArray(plan.sources)) continue;
    return {
      generatedAt:
        typeof plan.generatedAt === "string" ? plan.generatedAt : undefined,
      sources: plan.sources
        .map((raw) => jsonRecord(raw))
        .map((source) => ({
          sourceConfigId: String(source.sourceConfigId ?? ""),
          sourceFamily: String(source.sourceFamily ?? "unknown"),
          sourceBindingKey: String(source.sourceBindingKey ?? ""),
          enabled: source.enabled !== false,
          grantStatus: String(source.grantStatus ?? "unknown"),
          effectiveMaxRecords:
            typeof source.effectiveMaxRecords === "number"
              ? source.effectiveMaxRecords
              : null,
          checkpointAdvancedAt:
            typeof source.checkpointAdvancedAt === "string"
              ? source.checkpointAdvancedAt
              : null,
          recentEvidenceCount:
            typeof source.recentEvidenceCount === "number"
              ? source.recentEvidenceCount
              : 0,
          boundaryUrls: (() => {
            const urls = jsonRecord(source.boundary).urls;
            return Array.isArray(urls)
              ? urls.filter((url): url is string => typeof url === "string")
              : [];
          })(),
        }))
        .filter((source) => source.sourceConfigId),
      focus: Array.isArray(plan.focus)
        ? plan.focus
            .map((raw) => jsonRecord(raw))
            .map((entry) => ({
              key: String(entry.key ?? ""),
              label: String(entry.label ?? entry.key ?? ""),
            }))
            .filter((entry) => entry.key)
        : [],
    };
  }
  return null;
}

function grantBadgeVariant(status: string): "default" | "destructive" {
  return status === "active" ? "default" : "destructive";
}

export function WorkflowPlanReview({
  plan,
  busy,
  error,
  onDecide,
}: {
  plan: PreflightPlan;
  busy: boolean;
  error: string | null;
  onDecide: (
    approve: boolean,
    note: string | null,
    override: ApprovalOverridePayload | null,
  ) => void;
}) {
  const [note, setNote] = useState("");
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [removedFocus, setRemovedFocus] = useState<Set<string>>(new Set());
  const [maxRecords, setMaxRecords] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [localError, setLocalError] = useState<string | null>(null);

  const selectable = plan.sources.filter(
    (source) => source.enabled && source.grantStatus === "active",
  );
  const selectedIds = selectable
    .map((source) => source.sourceConfigId)
    .filter((id) => !deselected.has(id));

  // The visible cap is the largest saved boundary among selected sources —
  // the override may only narrow below it.
  const maxCap = useMemo(() => {
    const caps = plan.sources
      .filter((source) => selectedIds.includes(source.sourceConfigId))
      .map((source) => source.effectiveMaxRecords)
      .filter((cap): cap is number => cap != null);
    return caps.length > 0 ? Math.max(...caps) : null;
  }, [plan.sources, selectedIds]);

  const keptFocus = plan.focus.filter((entry) => !removedFocus.has(entry.key));

  const buildOverride = (): ApprovalOverridePayload | null => {
    const override: ApprovalOverridePayload = {};
    if (deselected.size > 0) {
      override.sourceConfigIds = selectedIds;
    }
    if (removedFocus.size > 0 && keptFocus.length > 0) {
      override.focusKeys = keptFocus.map((entry) => entry.key);
    }
    if (maxRecords.trim()) {
      const parsed = Number(maxRecords);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("Record limit must be a positive whole number.");
      }
      if (maxCap != null && parsed > maxCap) {
        throw new Error(
          `Record limit can only narrow the saved boundary (at most ${maxCap}).`,
        );
      }
      override.maxRecords = parsed;
    }
    if (from) override.timeRangeFrom = new Date(from).toISOString();
    if (to) override.timeRangeTo = new Date(to).toISOString();
    if (
      override.timeRangeFrom &&
      override.timeRangeTo &&
      override.timeRangeFrom > override.timeRangeTo
    ) {
      throw new Error("The start of the time range must not be after its end.");
    }
    return Object.keys(override).length > 0 ? override : null;
  };

  const approve = () => {
    setLocalError(null);
    if (selectedIds.length === 0 && selectable.length > 0) {
      setLocalError(
        "Every source is deselected — approve at least one source, or cancel the run.",
      );
      return;
    }
    let override: ApprovalOverridePayload | null;
    try {
      override = buildOverride();
    } catch (err) {
      setLocalError((err as Error).message);
      return;
    }
    onDecide(true, note.trim() || null, override);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Review the proposed plan before this run reads anything. You can narrow
        the sources, focus areas, record budget, and time range — never widen
        them beyond the saved configuration.
      </p>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Sources</h4>
        <ul className="space-y-2">
          <li className="flex items-start gap-3 rounded-md border border-border/70 p-3">
            <input
              type="checkbox"
              className="mt-1"
              aria-label="Include Threads source"
              checked
              disabled
              readOnly
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Threads</span>
                <Badge variant="default" className="text-[10px]">
                  always included
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Completed Thread conversations are already retained in memory;
                this run compounds that memory bank.
              </p>
            </div>
          </li>
          {plan.sources.length === 0 ? (
            <li className="rounded-md border border-dashed border-border/70 p-3 text-sm text-muted-foreground">
              No optional external sources are configured. Gmail, Twenty CRM,
              and web nodes will be skipped.
            </li>
          ) : (
            plan.sources.map((source) => {
              const blocked =
                !source.enabled || source.grantStatus !== "active";
              const checked =
                !blocked && !deselected.has(source.sourceConfigId);
              return (
                <li
                  key={source.sourceConfigId}
                  className="flex items-start gap-3 rounded-md border border-border/70 p-3"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    aria-label={`Include ${source.sourceFamily} source ${source.sourceBindingKey}`}
                    checked={checked}
                    disabled={blocked || busy}
                    onChange={(event) => {
                      setDeselected((prev) => {
                        const next = new Set(prev);
                        if (event.target.checked) {
                          next.delete(source.sourceConfigId);
                        } else {
                          next.add(source.sourceConfigId);
                        }
                        return next;
                      });
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {source.sourceFamily}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {source.sourceBindingKey}
                      </span>
                      <Badge
                        variant={grantBadgeVariant(source.grantStatus)}
                        className="text-[10px]"
                      >
                        {source.grantStatus === "active"
                          ? "authorized"
                          : `grant ${source.grantStatus}`}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {source.effectiveMaxRecords != null
                        ? `Up to ${source.effectiveMaxRecords} records`
                        : "Default record budget"}
                      {source.checkpointAdvancedAt
                        ? ` · last synced ${new Date(source.checkpointAdvancedAt).toLocaleString()}`
                        : " · never synced"}
                      {` · ${source.recentEvidenceCount} recent items`}
                    </p>
                    {source.boundaryUrls.length > 0 ? (
                      <ul className="mt-1 space-y-0.5">
                        {source.boundaryUrls.map((url) => (
                          <li
                            key={url}
                            className="truncate font-mono text-[11px] text-muted-foreground"
                          >
                            {url}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>

      {plan.focus.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Focus areas</h4>
          <div className="flex flex-wrap gap-1.5">
            {keptFocus.map((entry) => (
              <Badge key={entry.key} variant="secondary" className="gap-1">
                {entry.label}
                <button
                  type="button"
                  aria-label={`Remove focus ${entry.label}`}
                  className="ml-1 opacity-60 hover:opacity-100"
                  disabled={busy}
                  onClick={() =>
                    setRemovedFocus((prev) => new Set(prev).add(entry.key))
                  }
                >
                  ×
                </button>
              </Badge>
            ))}
            {keptFocus.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                All focus areas removed — the run keeps its normal breadth.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>Record limit{maxCap != null ? ` (max ${maxCap})` : ""}</span>
          <Input
            type="number"
            min={1}
            {...(maxCap != null ? { max: maxCap } : {})}
            value={maxRecords}
            placeholder="Saved boundary"
            disabled={busy}
            onChange={(event) => setMaxRecords(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>From</span>
          <Input
            type="date"
            value={from}
            disabled={busy}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>To</span>
          <Input
            type="date"
            value={to}
            disabled={busy}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
      </div>

      <Textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Add an optional note for the record…"
        rows={2}
        disabled={busy}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={approve}>
          Approve plan
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onDecide(false, note.trim() || null, null)}
        >
          Cancel run
        </Button>
      </div>
      {localError || error ? (
        <p className="text-sm text-destructive">{localError ?? error}</p>
      ) : null}
    </div>
  );
}
