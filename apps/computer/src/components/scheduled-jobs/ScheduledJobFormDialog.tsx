// Copy of apps/admin/src/components/scheduled-jobs/ScheduledJobFormDialog.tsx
// adapted for apps/computer:
//   - imports normalized to @thinkwork/ui
//   - agent picker removed (agentId injected via prop, no /api/agents fetch)
//   - Zod schema reduced to { name, prompt }
//   - agent_id + computer_id merged into the submit payload by the form,
//     not by the parent route
//
// Keep in sync with the admin copy until a shared package extraction lands
// (see Deferred to Follow-Up Work in the scheduled-jobs-and-automations plan).

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import {
  Button,
  Input,
  Textarea,
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@thinkwork/ui";
import {
  SchedulePicker,
  type SchedulePickerValue,
} from "@/components/schedule-picker/SchedulePicker";

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

interface ScheduledJobFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  /** The Computer that owns this job. Required — apps/computer only edits its own Computer's jobs. */
  computerId: string;
  /**
   * The agent that fires the job. Resolved upstream from
   * `myComputer.sourceAgent.id`. The list/detail routes disable the
   * "Add Job" / "Edit" affordance when this is null, so the dialog itself
   * can rely on a non-null value.
   */
  agentId: string;
  initial?: Partial<ScheduledJobFormData>;
  onSubmit: (data: ScheduledJobFormData) => Promise<void>;
}

const triggerFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  prompt: z.string().optional(),
});

type TriggerFormValues = z.infer<typeof triggerFormSchema>;

export function ScheduledJobFormDialog({
  open, onOpenChange, mode, computerId, agentId, initial, onSubmit,
}: ScheduledJobFormDialogProps) {
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const [scheduleValue, setScheduleValue] = useState<SchedulePickerValue>({
    scheduleType: initial?.schedule_type || "rate",
    scheduleExpression: initial?.schedule_expression || "rate(5 minutes)",
    timezone: initial?.timezone || "UTC",
  });

  const form = useForm<TriggerFormValues>({
    resolver: zodResolver(triggerFormSchema as never) as Resolver<TriggerFormValues>,
    defaultValues: {
      name: initial?.name || "",
      prompt: initial?.prompt || "",
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      name: initial?.name || "",
      prompt: initial?.prompt || "",
    });
    setScheduleValue({
      scheduleType: initial?.schedule_type || "rate",
      scheduleExpression: initial?.schedule_expression || "rate(5 minutes)",
      timezone: initial?.timezone || "UTC",
    });
    setDialogError(null);
  }, [open, initial, form]);

  async function handleFormSubmit(values: TriggerFormValues) {
    setSaving(true);
    setDialogError(null);

    const triggerType =
      scheduleValue.scheduleType === "at" ? "agent_reminder" : "agent_scheduled";

    try {
      await onSubmit({
        name: values.name.trim(),
        trigger_type: triggerType,
        agent_id: agentId,
        computer_id: computerId,
        prompt: values.prompt?.trim() || undefined,
        schedule_type: scheduleValue.scheduleType,
        schedule_expression: scheduleValue.scheduleExpression,
        timezone: scheduleValue.timezone,
      });
      onOpenChange(false);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Edit Scheduled Job" : "New Scheduled Job"}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleFormSubmit)}
            className="flex-1 flex flex-col overflow-hidden"
          >
            <div className="flex-1 overflow-y-auto space-y-5 py-2 pr-1">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-semibold">Job Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. Check Austin headlines" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="prompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-semibold">Prompt</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="e.g. Look at the headlines for Austin and summarize any important news"
                        rows={3}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <SchedulePicker value={scheduleValue} onChange={setScheduleValue} />

              {dialogError && <p className="text-sm text-destructive">{dialogError}</p>}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                {mode === "edit" ? "Save Job" : "Create Job"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
