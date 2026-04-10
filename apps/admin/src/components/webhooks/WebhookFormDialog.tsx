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

const API_URL = import.meta.env.VITE_API_URL || "";
const API_AUTH_SECRET = import.meta.env.VITE_API_AUTH_SECRET || "";

type AgentOption = { id: string; name: string };
type RoutineOption = { id: string; name: string };

export interface WebhookFormData {
  name: string;
  description?: string;
  target_type: string;
  agent_id?: string;
  routine_id?: string;
  prompt?: string;
  rate_limit?: number;
}

interface WebhookFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  tenantId: string;
  initial?: Partial<WebhookFormData>;
  onSubmit: (data: WebhookFormData) => Promise<void>;
}

const webhookFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  targetType: z.enum(["agent", "routine"]),
  agentId: z.string().optional(),
  routineId: z.string().optional(),
  prompt: z.string().optional(),
  rateLimit: z.number().min(1).max(10000),
});

type FormValues = z.infer<typeof webhookFormSchema>;

export function WebhookFormDialog({
  open, onOpenChange, mode, tenantId, initial, onSubmit,
}: WebhookFormDialogProps) {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [routines, setRoutines] = useState<RoutineOption[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(webhookFormSchema),
    defaultValues: {
      name: initial?.name || "",
      description: initial?.description || "",
      targetType: (initial?.target_type as "agent" | "routine") || "agent",
      agentId: initial?.agent_id || "",
      routineId: initial?.routine_id || "",
      prompt: initial?.prompt || "",
      rateLimit: initial?.rate_limit || 60,
    },
  });

  const targetType = form.watch("targetType");

  useEffect(() => {
    if (!open || !tenantId) return;
    fetch(`${API_URL}/api/agents?tenant_id=${tenantId}`, {
      headers: {
        ...(API_AUTH_SECRET ? { Authorization: `Bearer ${API_AUTH_SECRET}` } : {}),
        "x-tenant-id": tenantId,
      },
    })
      .then((r) => r.json())
      .then((data) => setAgents(Array.isArray(data) ? data.map((a: any) => ({ id: a.id, name: a.name })) : []))
      .catch(() => setAgents([]));

    fetch(`${API_URL}/api/routines`, {
      headers: {
        ...(API_AUTH_SECRET ? { Authorization: `Bearer ${API_AUTH_SECRET}` } : {}),
        "x-tenant-id": tenantId,
      },
    })
      .then((r) => r.json())
      .then((data) => setRoutines(Array.isArray(data) ? data.map((r: any) => ({ id: r.id, name: r.name })) : []))
      .catch(() => setRoutines([]));
  }, [open, tenantId]);

  useEffect(() => {
    if (open) {
      form.reset({
        name: initial?.name || "",
        description: initial?.description || "",
        targetType: (initial?.target_type as "agent" | "routine") || "agent",
        agentId: initial?.agent_id || "",
        routineId: initial?.routine_id || "",
        prompt: initial?.prompt || "",
        rateLimit: initial?.rate_limit || 60,
      });
    }
  }, [open, initial]);

  async function handleSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      await onSubmit({
        name: values.name,
        description: values.description,
        target_type: values.targetType,
        agent_id: values.targetType === "agent" ? values.agentId : undefined,
        routine_id: values.targetType === "routine" ? values.routineId : undefined,
        prompt: values.prompt,
        rate_limit: values.rateLimit,
      });
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to save webhook:", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New Webhook" : "Edit Webhook"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl><Input {...field} placeholder="e.g. GitHub Push Handler" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Textarea {...field} placeholder="Optional description..." rows={2} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="targetType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="agent">Agent</SelectItem>
                      <SelectItem value="routine">Routine</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {targetType === "agent" && (
              <FormField
                control={form.control}
                name="agentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Agent</FormLabel>
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
            )}

            {targetType === "routine" && (
              <FormField
                control={form.control}
                name="routineId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Routine</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select routine..." /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {routines.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {targetType === "agent" && (
              <FormField
                control={form.control}
                name="prompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prompt</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Optional prompt to inject with webhook payload..." rows={3} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="rateLimit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rate Limit (per minute)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={10000}
                      value={field.value}
                      onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 60)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                {mode === "create" ? "Create" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
