import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from "@/components/ui/form";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SchedulePicker, type SchedulePickerValue } from "@/components/schedule-picker/SchedulePicker";

const API_URL = import.meta.env.VITE_API_URL || "";
const API_AUTH_SECRET = import.meta.env.VITE_API_AUTH_SECRET || "";

type AgentOption = { id: string; name: string };

export interface ScheduledJobFormData {
  name: string;
  trigger_type: string;
  agent_id?: string;
  prompt?: string;
  schedule_type: string;
  schedule_expression: string;
  timezone: string;
}

interface ScheduledJobFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  tenantId: string;
  initial?: Partial<ScheduledJobFormData>;
  onSubmit: (data: ScheduledJobFormData) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Zod schema (agent-only, schedule state lives in SchedulePicker)
// ---------------------------------------------------------------------------

const triggerFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  agentId: z.string().min(1, "Select an agent"),
  prompt: z.string().optional(),
});

type TriggerFormValues = z.infer<typeof triggerFormSchema>;

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function ScheduledJobFormDialog({
  open, onOpenChange, mode, tenantId, initial, onSubmit,
}: ScheduledJobFormDialogProps) {
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const [scheduleValue, setScheduleValue] = useState<SchedulePickerValue>({
    scheduleType: initial?.schedule_type || "rate",
    scheduleExpression: initial?.schedule_expression || "rate(5 minutes)",
    timezone: initial?.timezone || "UTC",
  });

  const form = useForm<TriggerFormValues>({
    resolver: zodResolver(triggerFormSchema),
    defaultValues: {
      name: initial?.name || "",
      agentId: initial?.agent_id || "",
      prompt: initial?.prompt || "",
    },
  });

  // Reset form when dialog opens
  useEffect(() => {
    if (!open) return;
    form.reset({
      name: initial?.name || "",
      agentId: initial?.agent_id || "",
      prompt: initial?.prompt || "",
    });
    setScheduleValue({
      scheduleType: initial?.schedule_type || "rate",
      scheduleExpression: initial?.schedule_expression || "rate(5 minutes)",
      timezone: initial?.timezone || "UTC",
    });
    setDialogError(null);
  }, [open, initial]);

  // Load agents
  useEffect(() => {
    if (!open) return;
    fetch(`${API_URL}/api/agents`, {
      headers: {
        "Content-Type": "application/json",
        ...(API_AUTH_SECRET ? { Authorization: `Bearer ${API_AUTH_SECRET}` } : {}),
        "x-tenant-id": tenantId,
      },
    })
      .then((r) => r.json())
      .then((data) => setAgents(Array.isArray(data) ? data : []))
      .catch(() => setAgents([]));
  }, [open, tenantId]);

  async function handleFormSubmit(values: TriggerFormValues) {
    setSaving(true);
    setDialogError(null);

    const triggerType = scheduleValue.scheduleType === "at" ? "agent_reminder" : "agent_scheduled";

    try {
      await onSubmit({
        name: values.name.trim(),
        trigger_type: triggerType,
        agent_id: values.agentId,
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
          <DialogTitle>{mode === "edit" ? "Edit Scheduled Job" : "New Scheduled Job"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleFormSubmit)} className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto space-y-5 py-2 pr-1">
              {/* Name + Agent on one row */}
              <div className="grid grid-cols-[1fr_auto] gap-3">
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
                  name="agentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-semibold">Agent</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Select agent..." /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {agents.map((a) => (
                            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Prompt */}
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

              {/* Schedule Picker */}
              <SchedulePicker value={scheduleValue} onChange={setScheduleValue} />

              {dialogError && <p className="text-sm text-destructive">{dialogError}</p>}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
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
