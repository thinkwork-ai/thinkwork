import { AlertTriangle, RotateCcw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Shared Permissions sub-panel for the template + agent Skills tabs
 * (Units 8 + 9 of docs/plans/2026-04-22-008-feat-agent-skill-permissions-ui-plan.md).
 *
 * - Template mode: flat checkbox list; value is the template's ceiling.
 * - Agent mode: tri-state per op (inherited / allowed / denied). Ops
 *   outside the template ceiling render disabled with a tooltip.
 *
 * Storage is a flat `string[]` at rest; the tri-state "inherited"
 * state is represented in memory as `value === null`. Save semantics
 * are decided by the caller (dirty-diff: if the edited array equals
 * the template ceiling and the agent was originally inheriting, save
 * as `null` to keep the agent inheriting — see $agentId_.skills.tsx).
 */

export type SkillOperation = {
  name: string;
  path: string;
  description?: string;
  default_enabled?: boolean;
};

type CommonProps = {
  ops: SkillOperation[];
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  disabled?: boolean;
};

export type PermissionsEditorProps =
  | ({ mode: "template" } & CommonProps)
  | ({ mode: "agent"; ceiling: string[] | null } & CommonProps);

export function PermissionsEditor(props: PermissionsEditorProps) {
  const { mode, ops, value, onChange, disabled } = props;
  const ceiling = mode === "agent" ? props.ceiling : null;

  // Effective checked set (what the UI renders as checked).
  //
  // Template mode: if value is null (first-time authoring), pre-check
  // default_enabled ops. Once the operator saves anything, value is an
  // explicit array.
  //
  // Agent mode: null = inheriting, render every ceiling op as checked
  // (visual style = "inherited"). Explicit array = render only its ops.
  const effectiveChecked = new Set<string>(
    value !== null
      ? value
      : mode === "template"
        ? ops.filter((o) => o.default_enabled === true).map((o) => o.name)
        : (ceiling ?? []),
  );
  const ceilingSet = mode === "agent" ? new Set(ceiling ?? []) : null;
  const isInheriting = mode === "agent" && value === null;

  const grouped = groupOpsByFile(ops);
  const effectiveCount = effectiveChecked.size;

  const handleToggle = (opName: string, checked: boolean) => {
    // Materialize on first explicit edit. For the template this means
    // value = [...], for the agent this means we switch out of the
    // inheriting null state into an explicit array.
    const current =
      value !== null
        ? new Set(value)
        : mode === "template"
          ? new Set(
              ops
                .filter((o) => o.default_enabled === true)
                .map((o) => o.name),
            )
          : new Set(ceiling ?? []);
    if (checked) current.add(opName);
    else current.delete(opName);
    onChange(Array.from(current));
  };

  const handleReset = () => onChange(null);

  return (
    <div className="space-y-3">
      {mode === "agent" && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="text-muted-foreground">
            {isInheriting ? (
              <span>
                Inheriting from template (
                {(ceiling?.length ?? 0)} op{(ceiling?.length ?? 0) === 1 ? "" : "s"})
              </span>
            ) : (
              <span>Explicit override</span>
            )}
          </div>
          {!isInheriting && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={handleReset}
              className="h-7 gap-1"
            >
              <RotateCcw className="h-3 w-3" />
              Reset to inherit
            </Button>
          )}
        </div>
      )}

      {effectiveCount === 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {mode === "template"
              ? "No operations enabled — agents inheriting from this template will have zero effective ops for this skill."
              : "No operations enabled — this agent cannot use this skill."}
          </span>
        </div>
      )}

      <TooltipProvider delayDuration={150}>
        <div className="space-y-3">
          {grouped.map(({ file, ops: fileOps }) => (
            <div
              key={file}
              className="rounded-md border bg-muted/30 p-2 space-y-1"
            >
              <div className="text-xs font-semibold text-muted-foreground px-1">
                {file}{" "}
                <span className="text-[10px] opacity-70">
                  ({fileOps.length})
                </span>
              </div>
              <div className="space-y-0.5">
                {fileOps.map((op) => {
                  const outOfCeiling =
                    mode === "agent" &&
                    ceilingSet !== null &&
                    !ceilingSet.has(op.name);
                  const checked = effectiveChecked.has(op.name);
                  const destructive = op.default_enabled === false;
                  const row = (
                    <label
                      key={op.name}
                      className={`flex items-start gap-2 rounded px-1.5 py-1 text-xs ${
                        outOfCeiling
                          ? "opacity-50 cursor-not-allowed"
                          : "cursor-pointer hover:bg-muted/60"
                      } ${isInheriting ? "text-muted-foreground" : ""}`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) =>
                          !outOfCeiling && handleToggle(op.name, Boolean(v))
                        }
                        disabled={disabled || outOfCeiling}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-[11px] text-foreground">
                            {op.name}
                          </code>
                          {destructive && (
                            <Badge
                              variant="destructive"
                              className="text-[9px] h-4 px-1"
                            >
                              opt-in
                            </Badge>
                          )}
                          {isInheriting && !outOfCeiling && (
                            <Badge
                              variant="outline"
                              className="text-[9px] h-4 px-1"
                            >
                              inherited
                            </Badge>
                          )}
                        </div>
                        {op.description && (
                          <div className="text-muted-foreground text-[11px] leading-tight mt-0.5">
                            {op.description}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                  return outOfCeiling ? (
                    <Tooltip key={op.name}>
                      <TooltipTrigger asChild>{row}</TooltipTrigger>
                      <TooltipContent side="right" className="text-xs">
                        Not authorized by template
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    row
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </TooltipProvider>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupOpsByFile(
  ops: SkillOperation[],
): Array<{ file: string; ops: SkillOperation[] }> {
  const map = new Map<string, SkillOperation[]>();
  for (const op of ops) {
    const file = extractFileLabel(op.path);
    let bucket = map.get(file);
    if (!bucket) {
      bucket = [];
      map.set(file, bucket);
    }
    bucket.push(op);
  }
  // Preserve manifest order but cluster each group together.
  return Array.from(map.entries()).map(([file, ops]) => ({ file, ops }));
}

function extractFileLabel(path: string | undefined): string {
  if (!path) return "other";
  const last = path.split("/").pop();
  return last || path;
}

/**
 * Helper for the agent-skills save path. Decides what to write to the
 * resolver based on the initial load-time state and the current edit
 * state (dirty-diff semantics — see plan Key Technical Decisions).
 *
 *  - If the current edit state equals the ceiling AND the agent was
 *    originally inheriting, save `null` — don't materialize a fresh
 *    override just because the operator opened the dialog.
 *  - If the current edit state is unchanged from the initial load,
 *    return `loaded` — no-op for the caller.
 *  - Otherwise return the explicit array as-is.
 */
export function resolveAgentSaveValue({
  loaded,
  current,
  ceiling,
}: {
  loaded: string[] | null;
  current: string[] | null;
  ceiling: string[] | null;
}): string[] | null {
  // No change — return the loaded state directly.
  if (shallowEqual(loaded, current)) return loaded;
  // User just clicked Reset (current=null). Always emit null.
  if (current === null) return null;
  // If the explicit current matches the ceiling AND the agent was
  // originally inheriting, collapse back to inheritance rather than
  // materializing an override that will block future template widenings.
  if (
    loaded === null &&
    ceiling !== null &&
    shallowEqualSets(current, ceiling)
  ) {
    return null;
  }
  return current;
}

function shallowEqual(a: string[] | null, b: string[] | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function shallowEqualSets(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const x of b) if (!setA.has(x)) return false;
  return true;
}
