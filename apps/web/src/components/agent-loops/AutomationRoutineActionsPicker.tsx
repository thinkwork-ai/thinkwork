/**
 * "Run routine" action picker (deterministic routines v1, plan
 * 2026-07-03-004 U5, R7). Attaches git_python routines to an Automation
 * as token-free actions that execute before the agent turn — or instead
 * of it ("run routines only"). Only enabled routines with a validated SHA
 * are selectable; ineligible routines render disabled with a one-line
 * reason instead of failing at save.
 */

import type { Dispatch, SetStateAction } from "react";
import { useMemo } from "react";
import { useQuery } from "urql";
import { Checkbox, Switch } from "@thinkwork/ui";
import { SettingsGitRoutinesQuery } from "@/lib/graphql-queries";
import type { AgentLoopDraft } from "./agent-loop-types";

interface GitRoutineRow {
  id: string;
  name: string;
  description?: string | null;
  engine: string;
  status: string;
  validatedSha?: string | null;
  fixturePaths?: string | null;
  disabledReason?: string | null;
}

function ineligibleReason(routine: GitRoutineRow): string | null {
  if (routine.status !== "active") {
    return routine.disabledReason
      ? `disabled: ${routine.disabledReason}`
      : `routine is ${routine.status}`;
  }
  const hasFixtures = (() => {
    try {
      const parsed = routine.fixturePaths
        ? JSON.parse(routine.fixturePaths)
        : null;
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  })();
  if (!routine.validatedSha && !hasFixtures) {
    return "no validated version yet — run its fixtures first";
  }
  return null;
}

export function AutomationRoutineActionsPicker({
  tenantId,
  draft,
  setDraft,
}: {
  tenantId: string;
  draft: AgentLoopDraft;
  setDraft: Dispatch<SetStateAction<AgentLoopDraft>>;
}) {
  const [result] = useQuery({
    query: SettingsGitRoutinesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const gitRoutines = useMemo(
    () =>
      (
        (result.data as { routines?: GitRoutineRow[] } | undefined)?.routines ??
        []
      ).filter((routine) => routine.engine === "git_python"),
    [result.data],
  );
  const selected = new Set(draft.routineActionRoutineIds);

  function toggle(routineId: string, checked: boolean) {
    setDraft((current) => {
      const ids = new Set(current.routineActionRoutineIds);
      if (checked) ids.add(routineId);
      else ids.delete(routineId);
      return { ...current, routineActionRoutineIds: [...ids] };
    });
  }

  if (gitRoutines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No routines yet — ask the agent to author one.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      <ul className="grid gap-2">
        {gitRoutines.map((routine) => {
          const reason = ineligibleReason(routine);
          const checked = selected.has(routine.id);
          return (
            <li key={routine.id} className="flex items-start gap-2 text-sm">
              <Checkbox
                id={`routine-action-${routine.id}`}
                checked={checked}
                disabled={Boolean(reason) && !checked}
                onCheckedChange={(value) => toggle(routine.id, value === true)}
                aria-label={`Run routine ${routine.name}`}
              />
              <label
                htmlFor={`routine-action-${routine.id}`}
                className={
                  reason && !checked
                    ? "cursor-not-allowed text-muted-foreground"
                    : "cursor-pointer"
                }
              >
                <span className="font-medium">{routine.name}</span>
                {routine.description ? (
                  <span className="text-muted-foreground">
                    {" "}
                    — {routine.description}
                  </span>
                ) : null}
                {reason ? (
                  <span className="block text-xs text-muted-foreground">
                    {reason}
                  </span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>
      {draft.routineActionRoutineIds.length > 0 ? (
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={!draft.routineAgentTurn}
            onCheckedChange={(checked) =>
              setDraft((current) => ({
                ...current,
                routineAgentTurn: !checked,
              }))
            }
            aria-label="Run routines only"
          />
          Run routines only — complete without an agent turn (zero tokens)
        </label>
      ) : null}
    </div>
  );
}
