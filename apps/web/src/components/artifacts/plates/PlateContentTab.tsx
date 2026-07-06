/**
 * Plate content-contract editor (THINK-188 U5) — the Content tab inside
 * PlateEditDialog.
 *
 * Sections render as ordered structured rows (EvalTestCaseForm pattern).
 * Platform floor rows (source: "platform") are governance-locked: title and
 * remove are disabled (with aria-described explanations), tier can only be
 * raised, guidance is freely editable, and any field diverging from the
 * platform baseline shows a "platform updates paused" marker with a per-field
 * revert (R13). Tenant additions are fully editable and reorderable among
 * themselves; floor order is platform-owned.
 */

import { useId } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@thinkwork/ui";
import {
  duplicateSectionRowKeys,
  nextRowKey,
  PLATE_SECTION_TIER_LABELS,
  PLATE_SECTION_TIERS,
  sectionRowId,
  tiersAtOrAbove,
  type AnalysisRowState,
  type PlateSectionTier,
  type SectionRowState,
} from "./plate-support";
import { PlateAnalysisPicker } from "./PlateAnalysisPicker";

const FLOOR_LOCK_EXPLANATION =
  "Platform floor section: it cannot be removed or retitled, and its tier can only be raised. Guidance and suggested widgets are yours to adapt.";

export interface PlateContentTabProps {
  sections: SectionRowState[];
  analyses: AnalysisRowState[];
  /** Platform plate = floor governance; tenant plate = full ownership. */
  isPlatform: boolean;
  /** null = all directive kinds allowed. */
  allowedDirectives: string[] | null;
  onSectionsChange: (rows: SectionRowState[]) => void;
  onAnalysesChange: (rows: AnalysisRowState[]) => void;
}

export function PlateContentTab({
  sections,
  analyses,
  isPlatform,
  allowedDirectives,
  onSectionsChange,
  onAnalysesChange,
}: PlateContentTabProps) {
  const duplicates = duplicateSectionRowKeys(sections);

  function updateRow(rowKey: string, patch: Partial<SectionRowState>) {
    onSectionsChange(
      sections.map((row) =>
        row.rowKey === rowKey ? { ...row, ...patch } : row,
      ),
    );
  }

  function removeRow(rowKey: string) {
    onSectionsChange(sections.filter((row) => row.rowKey !== rowKey));
  }

  function addRow() {
    onSectionsChange([
      ...sections,
      {
        rowKey: nextRowKey(),
        title: "",
        tier: "suggested",
        guidance: "",
        suggestedDirectives: [],
        source: "tenant",
      },
    ]);
  }

  /** Reorderable slice: additions only on platform plates, all rows on tenant plates. */
  function moveRow(rowKey: string, delta: -1 | 1) {
    const movable = sections.filter(
      (r) => !isPlatform || r.source === "tenant",
    );
    const fixed = sections.filter((r) => isPlatform && r.source === "platform");
    const idx = movable.findIndex((r) => r.rowKey === rowKey);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= movable.length) return;
    const next = [...movable];
    [next[idx], next[target]] = [next[target], next[idx]];
    onSectionsChange([...fixed, ...next]);
  }

  return (
    <div className="space-y-6" data-testid="plate-content-tab">
      <div className="space-y-2">
        <div className="text-sm font-medium">Sections</div>
        <p className="text-xs text-muted-foreground">
          {isPlatform
            ? "Platform floor sections are enforced on every document in this plate. Adapt their guidance, raise a tier, or add your own sections below."
            : "Documents in this plate must contain each required section (or explicitly waive it). Suggested sections guide without blocking."}
        </p>
        {sections.length === 0 ? (
          <p
            className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground"
            data-testid="plate-sections-empty"
          >
            No sections yet — documents compile with no content contract. Add a
            section to start shaping what belongs in this plate.
          </p>
        ) : null}
        <div className="space-y-3">
          {sections.map((row, index) => (
            <SectionRow
              key={row.rowKey}
              row={row}
              index={index}
              isPlatform={isPlatform}
              duplicate={duplicates.has(row.rowKey)}
              onChange={(patch) => updateRow(row.rowKey, patch)}
              onRemove={() => removeRow(row.rowKey)}
              onMove={(delta) => moveRow(row.rowKey, delta)}
            />
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          data-testid="plate-section-add"
        >
          <Plus className="mr-1 size-4" /> Add section
        </Button>
      </div>

      <PlateAnalysisPicker
        analyses={analyses}
        allowedDirectives={allowedDirectives}
        onChange={onAnalysesChange}
      />
    </div>
  );
}

function SectionRow({
  row,
  index,
  isPlatform,
  duplicate,
  onChange,
  onRemove,
  onMove,
}: {
  row: SectionRowState;
  index: number;
  isPlatform: boolean;
  duplicate: boolean;
  onChange: (patch: Partial<SectionRowState>) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const lockNoteId = useId();
  const isFloor = isPlatform && row.source === "platform";
  const id = sectionRowId(row);
  const tierOptions = isFloor
    ? tiersAtOrAbove(row.baseline!.tier)
    : [...PLATE_SECTION_TIERS];
  const guidanceDiverged =
    isFloor && row.baseline && row.guidance.trim() !== row.baseline.guidance;
  const tierDiverged =
    isFloor && row.baseline && row.tier !== row.baseline.tier;

  return (
    <div
      className="space-y-2 rounded-md border border-border p-3"
      data-testid={`plate-section-row-${id || index}`}
    >
      <div className="flex items-center gap-2">
        <Input
          value={row.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Section title (e.g. Pipeline Health)"
          disabled={isFloor}
          aria-describedby={isFloor ? lockNoteId : undefined}
          className="h-8"
          data-testid="plate-section-title"
        />
        {isFloor ? (
          <span
            className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
            data-testid="plate-section-floor-badge"
          >
            Platform floor
          </span>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => onMove(-1)}
              aria-label="Move section up"
              data-testid="plate-section-move-up"
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => onMove(1)}
              aria-label="Move section down"
              data-testid="plate-section-move-down"
            >
              <ArrowDown className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-destructive"
              onClick={onRemove}
              aria-label="Remove section"
              data-testid="plate-section-remove"
            >
              <Trash2 className="size-4" />
            </Button>
          </>
        )}
      </div>
      {isFloor ? (
        <p id={lockNoteId} className="text-[11px] text-muted-foreground">
          {FLOOR_LOCK_EXPLANATION}
        </p>
      ) : null}
      {duplicate ? (
        <p
          className="text-xs text-destructive"
          data-testid="plate-section-duplicate"
        >
          Another section already uses the id &ldquo;{id}&rdquo; — titles must
          be unique within a plate.
        </p>
      ) : null}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        <Label className="text-xs text-muted-foreground">Tier</Label>
        <div className="space-y-1">
          <Select
            value={row.tier}
            onValueChange={(tier) =>
              onChange({ tier: tier as PlateSectionTier })
            }
          >
            <SelectTrigger
              className="h-8 w-64"
              aria-describedby={isFloor ? lockNoteId : undefined}
              data-testid="plate-section-tier"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tierOptions.map((tier) => (
                <SelectItem key={tier} value={tier}>
                  {PLATE_SECTION_TIER_LABELS[tier]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tierDiverged ? (
            <DivergenceMarker
              field="tier"
              onRevert={() => onChange({ tier: row.baseline!.tier })}
            />
          ) : null}
        </div>
        <Label className="self-start pt-1.5 text-xs text-muted-foreground">
          Guidance
        </Label>
        <div className="space-y-1">
          <Textarea
            value={row.guidance}
            onChange={(e) => onChange({ guidance: e.target.value })}
            placeholder="What belongs in this section — the agent reads this when authoring."
            rows={2}
            className="text-xs"
            data-testid="plate-section-guidance"
          />
          {guidanceDiverged ? (
            <DivergenceMarker
              field="guidance"
              onRevert={() => onChange({ guidance: row.baseline!.guidance })}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** R13: overridden floor fields are visibly diverged and revertible. */
function DivergenceMarker({
  field,
  onRevert,
}: {
  field: string;
  onRevert: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground"
      data-testid={`plate-section-diverged-${field}`}
    >
      <span>Customized — platform updates paused for this field.</span>
      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-foreground underline underline-offset-2"
        onClick={onRevert}
        data-testid={`plate-section-revert-${field}`}
      >
        <RotateCcw className="size-3" /> Revert to platform
      </button>
    </div>
  );
}
