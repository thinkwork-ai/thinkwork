import { useState, useEffect } from "react";
import { Beaker, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "urql";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SchedulePicker,
  type SchedulePickerValue,
} from "@/components/schedule-picker/SchedulePicker";
import { apiFetch } from "@/lib/api-fetch";
import { allEvalCategoryIds, EVAL_CATEGORIES } from "@/lib/evaluation-options";
import { cn } from "@/lib/utils";

type AgentOption = { id: string; name: string };
const DEFAULT_EVAL_MODEL_ID = "moonshotai.kimi-k2.5";

export const EVAL_SCHEDULE_TRIGGER_TYPE = "eval_scheduled";

export interface EvalScheduleConfig {
  agentId?: string;
  agentTemplateId?: string;
  computerId?: string;
  targetTemplateKind?: "agent" | "computer";
  model?: string;
  categories?: string[];
}

export interface ScheduledJobFormData {
  name: string;
  trigger_type: string;
  agent_id?: string;
  prompt?: string;
  config?: EvalScheduleConfig;
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
  defaultTriggerType?: string;
  onSubmit: (data: ScheduledJobFormData) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Zod schema (agent-only, schedule state lives in SchedulePicker)
// ---------------------------------------------------------------------------

const triggerFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  agentId: z.string().optional(),
  agentTemplateId: z.string().optional(),
  computerId: z.string().optional(),
  model: z.string().optional(),
  categories: z.array(z.string()).optional(),
  prompt: z.string().optional(),
});

type TriggerFormValues = z.infer<typeof triggerFormSchema>;

export function isEvalScheduledTrigger(triggerType?: string | null): boolean {
  return triggerType === EVAL_SCHEDULE_TRIGGER_TYPE;
}

export function resolveInitialTriggerType(
  initial?: Partial<ScheduledJobFormData>,
  defaultTriggerType?: string,
): string {
  return initial?.trigger_type || defaultTriggerType || "agent_scheduled";
}

function evalConfigFromInitial(
  initial?: Partial<ScheduledJobFormData>,
): EvalScheduleConfig {
  return initial?.config ?? {};
}

export function validateScheduledJobForm(
  values: TriggerFormValues,
  triggerType: string,
): Array<{ field: keyof TriggerFormValues; message: string }> {
  if (isEvalScheduledTrigger(triggerType)) {
    const errors: Array<{ field: keyof TriggerFormValues; message: string }> =
      [];
    if ((values.categories ?? []).length === 0) {
      errors.push({
        field: "categories",
        message: "Select at least one category",
      });
    }
    return errors;
  }

  if (!values.agentId) {
    return [{ field: "agentId", message: "Select an agent" }];
  }
  return [];
}

export function buildScheduledJobPayload(
  values: TriggerFormValues,
  schedule: SchedulePickerValue,
  triggerType: string,
): ScheduledJobFormData {
  if (isEvalScheduledTrigger(triggerType)) {
    const config: EvalScheduleConfig = {
      model: values.model || DEFAULT_EVAL_MODEL_ID,
      categories: values.categories ?? [],
    };

    return {
      name: values.name.trim(),
      trigger_type: EVAL_SCHEDULE_TRIGGER_TYPE,
      config,
      schedule_type: schedule.scheduleType,
      schedule_expression: schedule.scheduleExpression,
      timezone: schedule.timezone,
    };
  }

  const agentTriggerType =
    schedule.scheduleType === "at" ? "agent_reminder" : "agent_scheduled";
  return {
    name: values.name.trim(),
    trigger_type: agentTriggerType,
    agent_id: values.agentId,
    prompt: values.prompt?.trim() || undefined,
    schedule_type: schedule.scheduleType,
    schedule_expression: schedule.scheduleExpression,
    timezone: schedule.timezone,
  };
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function ScheduledJobFormDialog({
  open,
  onOpenChange,
  mode,
  tenantId,
  initial,
  defaultTriggerType,
  onSubmit,
}: ScheduledJobFormDialogProps) {
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const initialTriggerType = resolveInitialTriggerType(
    initial,
    defaultTriggerType,
  );
  const isEvalSchedule = isEvalScheduledTrigger(initialTriggerType);
  const evalConfig = evalConfigFromInitial(initial);

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
      agentTemplateId: evalConfig.agentTemplateId || "",
      computerId: evalConfig.computerId || "",
      model: evalConfig.model || DEFAULT_EVAL_MODEL_ID,
      categories: evalConfig.categories?.length
        ? evalConfig.categories
        : isEvalSchedule
          ? allEvalCategoryIds()
          : [],
      prompt: initial?.prompt || "",
    },
  });

  const selectedCategories = form.watch("categories") ?? [];

  // Reset form when dialog opens
  useEffect(() => {
    if (!open) return;
    const nextTriggerType = resolveInitialTriggerType(
      initial,
      defaultTriggerType,
    );
    const nextEvalConfig = evalConfigFromInitial(initial);
    const nextIsEvalSchedule = isEvalScheduledTrigger(nextTriggerType);
    form.reset({
      name: initial?.name || "",
      agentId: initial?.agent_id || "",
      agentTemplateId: nextEvalConfig.agentTemplateId || "",
      computerId: nextEvalConfig.computerId || "",
      model: nextEvalConfig.model || DEFAULT_EVAL_MODEL_ID,
      categories: nextEvalConfig.categories?.length
        ? nextEvalConfig.categories
        : nextIsEvalSchedule
          ? allEvalCategoryIds()
          : [],
      prompt: initial?.prompt || "",
    });
    setScheduleValue({
      scheduleType: initial?.schedule_type || "rate",
      scheduleExpression: initial?.schedule_expression || "rate(5 minutes)",
      timezone: initial?.timezone || "UTC",
    });
    setDialogError(null);
  }, [open, initial, defaultTriggerType, form]);

  // Load agents
  useEffect(() => {
    if (!open || isEvalSchedule) return;
    apiFetch<AgentOption[]>("/api/agents", {
      extraHeaders: { "x-tenant-id": tenantId },
    })
      .then((data) => setAgents(Array.isArray(data) ? data : []))
      .catch(() => setAgents([]));
  }, [open, tenantId, isEvalSchedule]);

  function toggleCategory(id: string) {
    const current = form.getValues("categories") ?? [];
    const next = current.includes(id)
      ? current.filter((categoryId) => categoryId !== id)
      : [...current, id];
    form.setValue("categories", next, { shouldDirty: true });
    form.clearErrors("categories");
  }

  async function handleFormSubmit(values: TriggerFormValues) {
    setDialogError(null);
    const triggerType = isEvalSchedule
      ? EVAL_SCHEDULE_TRIGGER_TYPE
      : scheduleValue.scheduleType === "at"
        ? "agent_reminder"
        : "agent_scheduled";
    const validationErrors = validateScheduledJobForm(values, triggerType);
    if (validationErrors.length > 0) {
      for (const error of validationErrors) {
        form.setError(error.field, { message: error.message });
      }
      return;
    }

    try {
      setSaving(true);
      await onSubmit(
        buildScheduledJobPayload(values, scheduleValue, triggerType),
      );
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
              {/* Name + owner on one row */}
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-semibold">
                        Job Name
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="e.g. Check Austin headlines"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {isEvalSchedule ? (
                  <div className="w-[220px] rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                    Default Agent template
                  </div>
                ) : (
                  <FormField
                    control={form.control}
                    name="agentId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-semibold">
                          Agent
                        </FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select agent..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {agents.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              {isEvalSchedule ? (
                <div className="rounded-md border bg-muted/20 p-3">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                    <Beaker className="h-4 w-4" />
                    Evaluation Run
                  </div>
                  <div className="mb-4">
                    <FormLabel className="text-sm font-semibold">
                      Model
                    </FormLabel>
                    <div className="mt-2 rounded-md border bg-background px-3 py-2 text-sm">
                      Kimi K2.5
                    </div>
                  </div>
                  <FormField
                    control={form.control}
                    name="categories"
                    render={() => (
                      <FormItem>
                        <div className="flex items-center justify-between gap-3">
                          <FormLabel className="text-sm font-semibold">
                            Categories
                          </FormLabel>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() =>
                              form.setValue(
                                "categories",
                                allEvalCategoryIds(),
                                {
                                  shouldDirty: true,
                                },
                              )
                            }
                          >
                            Select All
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {EVAL_CATEGORIES.map((category) => {
                            const selected = selectedCategories.includes(
                              category.id,
                            );
                            return (
                              <button
                                key={category.id}
                                type="button"
                                onClick={() => toggleCategory(category.id)}
                                className={cn(
                                  "rounded-full border px-3 py-1 text-xs transition-colors",
                                  selected
                                    ? "border-foreground bg-foreground text-background"
                                    : "border-border bg-transparent text-foreground hover:bg-accent",
                                )}
                              >
                                {category.label}
                              </button>
                            );
                          })}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ) : (
                <FormField
                  control={form.control}
                  name="prompt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-semibold">
                        Prompt
                      </FormLabel>
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
              )}

              {/* Schedule Picker */}
              <SchedulePicker
                value={scheduleValue}
                onChange={setScheduleValue}
              />

              {dialogError && (
                <p className="text-sm text-destructive">{dialogError}</p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
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
