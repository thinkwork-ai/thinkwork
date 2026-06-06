// Full-page create/edit form for scheduled jobs (automations). Replaces the
// former modal — the edit/create experience is now a full-page view styled
// like the other settings edit screens (SettingsSection cards + label/value
// rows). The prompt renders as a truncated preview that opens a dedicated
// editor Sheet, so long prompts stay readable without a giant inline textarea.

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import {
  Button,
  Input,
  Textarea,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@thinkwork/ui";
import {
  SchedulePicker,
  type SchedulePickerValue,
} from "@/components/schedule-picker/SchedulePicker";
import {
  SettingsPane,
  SettingsPageTitle,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

export interface ScheduledJobFormData {
  name: string;
  trigger_type: string;
  agent_id?: string | null;
  computer_id?: string | null;
  prompt?: string;
  schedule_type: string;
  schedule_expression: string;
  timezone: string;
}

interface ScheduledJobFormProps {
  mode: "create" | "edit";
  /** Legacy Computer association; null for tenant-agent-owned jobs. */
  computerId?: string;
  /** The agent that fires the job (the tenant platform agent). */
  agentId: string;
  initial?: Partial<ScheduledJobFormData>;
  onSubmit: (data: ScheduledJobFormData) => Promise<void>;
  onCancel: () => void;
}

export function ScheduledJobForm({
  mode,
  computerId,
  agentId,
  initial,
  onSubmit,
  onCancel,
}: ScheduledJobFormProps) {
  const [name, setName] = useState(initial?.name || "");
  const [prompt, setPrompt] = useState(initial?.prompt || "");
  const [scheduleValue, setScheduleValue] = useState<SchedulePickerValue>({
    scheduleType: initial?.schedule_type || "rate",
    scheduleExpression: initial?.schedule_expression || "rate(5 minutes)",
    timezone: initial?.timezone || "UTC",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);

  // Re-seed when a different job loads (initial identity changes).
  useEffect(() => {
    setName(initial?.name || "");
    setPrompt(initial?.prompt || "");
    setScheduleValue({
      scheduleType: initial?.schedule_type || "rate",
      scheduleExpression: initial?.schedule_expression || "rate(5 minutes)",
      timezone: initial?.timezone || "UTC",
    });
    setError(null);
  }, [initial]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const triggerType =
      scheduleValue.scheduleType === "at"
        ? "agent_reminder"
        : "agent_scheduled";
    try {
      await onSubmit({
        name: name.trim(),
        trigger_type: triggerType,
        agent_id: agentId,
        computer_id: computerId ?? null,
        prompt: prompt.trim() || undefined,
        schedule_type: scheduleValue.scheduleType,
        schedule_expression: scheduleValue.scheduleExpression,
        timezone: scheduleValue.timezone,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsPane>
      <SettingsPageTitle
        title={mode === "edit" ? "Edit automation" : "New automation"}
        description={
          mode === "edit"
            ? "Update the job name, prompt, and schedule."
            : "Name the job, give it a prompt, and set a schedule."
        }
      />

      <SettingsSection label="Job">
        <SettingsRow
          label="Name"
          description="Display name for this automation."
        >
          <Input
            className="w-72"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Check Austin headlines"
          />
        </SettingsRow>
        <SettingsRow
          label="Prompt"
          description="Instruction the agent runs on each trigger."
        >
          <div className="w-72">
            <PromptPreview
              value={prompt}
              onEdit={() => setPromptEditorOpen(true)}
            />
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection label="Schedule">
        <div className="p-4">
          <SchedulePicker value={scheduleValue} onChange={setScheduleValue} />
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-3.5">
          {error ? (
            <span className="text-sm text-destructive">{error}</span>
          ) : null}
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim()}
          >
            {saving ? "Saving…" : mode === "edit" ? "Save job" : "Create job"}
          </Button>
        </div>
      </SettingsSection>

      <PromptEditorSheet
        open={promptEditorOpen}
        onOpenChange={setPromptEditorOpen}
        value={prompt}
        onSave={(next) => {
          setPrompt(next);
          setPromptEditorOpen(false);
        }}
      />
    </SettingsPane>
  );
}

/** Truncated, read-only preview of the prompt; click to open the editor. */
function PromptPreview({
  value,
  onEdit,
}: {
  value: string;
  onEdit: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="group flex w-full items-start justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5 text-left outline-none transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {value.trim() ? (
        <span className="line-clamp-3 whitespace-pre-wrap text-sm text-foreground">
          {value}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">
          Add a prompt for the agent to run on each trigger…
        </span>
      )}
      <Pencil className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
    </button>
  );
}

/** Full-height editor for the prompt, opened from the preview. */
function PromptEditorSheet({
  open,
  onOpenChange,
  value,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  // Re-seed the draft each time the editor opens so it reflects the latest
  // committed value (and discards an abandoned edit from a prior open).
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // The base SheetContent caps right sheets at `sm:max-w-sm` via a
        // variant-prefixed class that out-specifies a plain `sm:max-w-*`, so
        // force a wider cap with `!` to give long prompts room.
        className="flex w-full flex-col gap-4 p-6 sm:!max-w-3xl"
      >
        <SheetHeader className="p-0">
          <SheetTitle>Edit prompt</SheetTitle>
          <SheetDescription>
            The instruction the agent runs on each trigger.
          </SheetDescription>
        </SheetHeader>
        <Textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. Look at the headlines for Austin and summarize any important news"
          className="min-h-0 flex-1 resize-none font-mono text-sm"
        />
        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => onSave(draft)}>
            Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
