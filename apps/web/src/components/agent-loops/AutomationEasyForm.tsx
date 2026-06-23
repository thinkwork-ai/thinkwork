import type { Dispatch, SetStateAction } from "react";
import { CheckCircle2, Timer } from "lucide-react";
import {
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@thinkwork/ui";
import {
  SchedulePicker,
  type SchedulePickerValue,
} from "@/components/schedule-picker/SchedulePicker";
import { SettingsRow, SettingsSection } from "@/components/settings/SettingsContent";
import type { AgentLoopDraft } from "./agent-loop-types";

export function AutomationEasyForm({
  draft,
  setDraft,
}: {
  draft: AgentLoopDraft;
  setDraft: Dispatch<SetStateAction<AgentLoopDraft>>;
}) {
  const scheduleValue: SchedulePickerValue = {
    scheduleType: draft.scheduleType,
    scheduleExpression: draft.scheduleExpression,
    timezone: draft.timezone,
  };

  return (
    <>
      <SettingsSection label="Automation">
        <SettingsRow
          label={
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="size-4" />
              Prompt
            </span>
          }
          layout="stacked"
        >
          <Textarea
            aria-label="Automation prompt"
            className="min-h-40 w-full"
            value={draft.objective}
            onChange={(event) =>
              setDraft((current) => {
                const objective = event.target.value;
                return {
                  ...current,
                  objective,
                  name: current.name || titleFromPrompt(objective),
                };
              })
            }
            placeholder="Watch Linear for issues ready for implementation and create a short routing summary."
          />
        </SettingsRow>
        <SettingsRow label="Active">
          <Switch
            aria-label="Automation active"
            checked={draft.lifecycleStatus === "active" && draft.enabled}
            onCheckedChange={(checked) =>
              setDraft((current) => ({
                ...current,
                lifecycleStatus: checked ? "active" : "paused",
                enabled: checked,
              }))
            }
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection label="Trigger">
        <SettingsRow
          label={
            <span className="inline-flex items-center gap-2">
              <Timer className="size-4" />
              Trigger
            </span>
          }
        >
          <Select
            value={draft.triggerFamily}
            onValueChange={(value) =>
              setDraft((current) => ({
                ...current,
                triggerFamily: value === "schedule" ? "schedule" : "manual",
              }))
            }
          >
            <SelectTrigger className="w-64" aria-label="Trigger family">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="schedule">Schedule</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        {draft.triggerFamily === "schedule" ? (
          <>
            <div className="border-b border-border p-4">
              <SchedulePicker
                value={scheduleValue}
                onChange={(next) =>
                  setDraft((current) => ({
                    ...current,
                    scheduleType: next.scheduleType,
                    scheduleExpression: next.scheduleExpression,
                    timezone: next.timezone,
                  }))
                }
              />
            </div>
            <SettingsRow label="Suitability" layout="stacked">
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <ChecklistItem
                  label="Goal is stable"
                  checked={draft.suitabilityGoalStable}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      suitabilityGoalStable: checked,
                    }))
                  }
                />
                <ChecklistItem
                  label="Evidence is available"
                  checked={draft.suitabilityEvidenceAvailable}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      suitabilityEvidenceAvailable: checked,
                    }))
                  }
                />
                <ChecklistItem
                  label="Budget is bounded"
                  checked={draft.suitabilityBudgeted}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      suitabilityBudgeted: checked,
                    }))
                  }
                />
              </div>
            </SettingsRow>
          </>
        ) : null}
      </SettingsSection>
    </>
  );
}

function ChecklistItem({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <span>{label}</span>
    </label>
  );
}

function titleFromPrompt(prompt: string): string {
  return (
    prompt
      .split(/\r?\n/)[0]
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 8)
      .join(" ")
      .replace(/[.?!,:;]+$/g, "") ?? ""
  );
}
