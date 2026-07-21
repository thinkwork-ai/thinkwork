/**
 * Curated analysis picker (THINK-188 U6): operators attach plate-declared,
 * server-computed analyses from human-labeled templates — registry vocabulary
 * (op keys, presentation directives) stays under the hood.
 *
 * Picking a template appends an INLINE expanded row (no nested dialog inside
 * the already-modal plate editor) where the operator names the analysis (the
 * key derives from the name) and picks a presentation scoped to the plate's
 * allowed directives. Floor analyses render locked; the server's gate 1b
 * remains the authority on presentation restrictions.
 */

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Input,
  Label,
  Select,
  Textarea,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import {
  headingSlugClient,
  nextRowKey,
  PLATE_ANALYSIS_TEMPLATES,
  type AnalysisRowState,
  type PlateAnalysisTemplate,
} from "./plate-support";

export interface PlateAnalysisPickerProps {
  analyses: AnalysisRowState[];
  /** null = all directive kinds allowed. */
  allowedDirectives: string[] | null;
  onChange: (rows: AnalysisRowState[]) => void;
}

export function PlateAnalysisPicker({
  analyses,
  allowedDirectives,
  onChange,
}: PlateAnalysisPickerProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const chartsAllowed =
    allowedDirectives == null || allowedDirectives.includes("chart");
  const statsAllowed =
    allowedDirectives == null || allowedDirectives.includes("stats");

  function addFromTemplate(template: PlateAnalysisTemplate) {
    const directive =
      template.defaultPresentation.directive === "chart" && !chartsAllowed
        ? "stats"
        : template.defaultPresentation.directive;
    onChange([
      ...analyses,
      {
        rowKey: nextRowKey(),
        key: "",
        op: template.op,
        presentation:
          directive === "chart"
            ? {
                directive,
                chartType:
                  template.defaultPresentation.chartType ??
                  template.chartTypes?.[0],
              }
            : { directive },
        source: "tenant",
        guidance: "",
      },
    ]);
    setPickerOpen(false);
  }

  function updateRow(rowKey: string, patch: Partial<AnalysisRowState>) {
    onChange(
      analyses.map((row) =>
        row.rowKey === rowKey ? { ...row, ...patch } : row,
      ),
    );
  }

  function removeRow(rowKey: string) {
    onChange(analyses.filter((row) => row.rowKey !== rowKey));
  }

  /** Tenant rows reorder among themselves; floor rows keep platform order. */
  function moveRow(rowKey: string, delta: -1 | 1) {
    const movable = analyses.filter((r) => r.source === "tenant");
    const fixed = analyses.filter((r) => r.source === "platform");
    const idx = movable.findIndex((r) => r.rowKey === rowKey);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= movable.length) return;
    const next = [...movable];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange([...fixed, ...next]);
  }

  return (
    <div className="space-y-2" data-testid="plate-analyses">
      <div className="text-sm font-medium">Computed analyses</div>
      <p className="text-xs text-muted-foreground">
        Analyses are calculated by the platform from data the agent supplies —
        the numbers in the document come from the computation, never from the
        agent&apos;s prose.
      </p>
      {analyses.length === 0 ? (
        <p
          className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground"
          data-testid="plate-analyses-empty"
        >
          No analyses declared.
        </p>
      ) : null}
      <div className="space-y-3">
        {analyses.map((row) => {
          const template = PLATE_ANALYSIS_TEMPLATES.find(
            (t) => t.op === row.op,
          );
          const isFloor = row.source === "platform";
          const derivedKey = row.key || "(name it below)";
          const duplicateKey =
            !isFloor &&
            row.key.length > 0 &&
            analyses.some((a) => a.rowKey !== row.rowKey && a.key === row.key);
          return (
            <div
              key={row.rowKey}
              className="space-y-2 rounded-md border border-border p-3"
              data-testid={`plate-analysis-row-${row.key || row.op}`}
            >
              <div className="flex items-center gap-2 text-sm">
                <span className="grow font-medium">
                  {template?.label ?? row.op}
                </span>
                {isFloor ? null : (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      onClick={() => moveRow(row.rowKey, -1)}
                      aria-label="Move analysis up"
                      data-testid="plate-analysis-move-up"
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      onClick={() => moveRow(row.rowKey, 1)}
                      aria-label="Move analysis down"
                      data-testid="plate-analysis-move-down"
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-destructive"
                      onClick={() => removeRow(row.rowKey)}
                      aria-label="Remove analysis"
                      data-testid="plate-analysis-remove"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                )}
              </div>
              {template ? (
                <p className="text-[11px] text-muted-foreground">
                  {template.description}
                </p>
              ) : null}
              {isFloor ? (
                <p className="text-[11px] text-muted-foreground">
                  Key: <code className="font-mono">{row.key}</code>
                </p>
              ) : (
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
                  <Label className="text-xs text-muted-foreground">Name</Label>
                  <div className="space-y-1">
                    <Input
                      value={row.key}
                      onChange={(e) =>
                        updateRow(row.rowKey, {
                          key: headingSlugClient(e.target.value),
                        })
                      }
                      placeholder="pipeline-conversion"
                      className="h-8 font-mono text-xs"
                      data-testid="plate-analysis-key"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Referenced as <code>{derivedKey}</code> when the agent
                      authors this analysis.
                    </p>
                    {duplicateKey ? (
                      <p
                        className="text-xs text-destructive"
                        data-testid="plate-analysis-duplicate"
                      >
                        Another analysis already uses this name.
                      </p>
                    ) : null}
                  </div>
                  <Label className="text-xs text-muted-foreground">
                    Show as
                  </Label>
                  <PresentationPicker
                    row={row}
                    template={template}
                    chartsAllowed={chartsAllowed}
                    statsAllowed={statsAllowed}
                    onChange={(presentation) =>
                      updateRow(row.rowKey, { presentation })
                    }
                  />
                  <Label className="self-start pt-1.5 text-xs text-muted-foreground">
                    Instructions
                  </Label>
                  <Textarea
                    value={row.guidance}
                    onChange={(e) =>
                      updateRow(row.rowKey, { guidance: e.target.value })
                    }
                    placeholder="What the agent should compute and how to source the inputs — the agent reads this when authoring."
                    className="min-h-16 text-xs"
                    data-testid="plate-analysis-guidance"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pickerOpen ? (
        <div
          className="grid gap-2 sm:grid-cols-2"
          data-testid="plate-analysis-templates"
        >
          {PLATE_ANALYSIS_TEMPLATES.map((template) => (
            <button
              key={template.op}
              type="button"
              className="rounded-md border border-border p-3 text-left transition-colors hover:border-primary/60"
              onClick={() => addFromTemplate(template)}
              data-testid={`plate-analysis-template-${template.op}`}
            >
              <div className="text-sm font-medium">{template.label}</div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {template.description}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPickerOpen(true)}
          disabled={!chartsAllowed && !statsAllowed}
          data-testid="plate-analysis-add"
        >
          <Plus className="mr-1 size-4" /> Add analysis
        </Button>
      )}
    </div>
  );
}

function PresentationPicker({
  row,
  template,
  chartsAllowed,
  statsAllowed,
  onChange,
}: {
  row: AnalysisRowState;
  template: PlateAnalysisTemplate | undefined;
  chartsAllowed: boolean;
  statsAllowed: boolean;
  onChange: (presentation: AnalysisRowState["presentation"]) => void;
}) {
  const chartTypes = template?.chartTypes ?? ["bar"];
  const value =
    row.presentation.directive === "chart"
      ? `chart:${row.presentation.chartType ?? chartTypes[0]}`
      : "stats";
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === "stats") onChange({ directive: "stats" });
        else {
          onChange({
            directive: "chart",
            chartType: next.slice("chart:".length),
          });
        }
      }}
    >
      <SelectTrigger
        className="h-8 w-64"
        data-testid="plate-analysis-presentation"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {statsAllowed ? (
          <SelectItem value="stats">Stat tiles</SelectItem>
        ) : null}
        {chartsAllowed
          ? chartTypes.map((type) => (
              <SelectItem key={type} value={`chart:${type}`}>
                {`Chart — ${type}`}
              </SelectItem>
            ))
          : null}
      </SelectContent>
    </Select>
  );
}
