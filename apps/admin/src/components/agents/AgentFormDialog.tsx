import { useEffect, useState } from "react";
import { useMutation, useQuery } from "urql";
import { useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTenant } from "@/context/TenantContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogBody,
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
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Loader2, Trash2 } from "lucide-react";
import {
  CreateAgentMutation,
  UpdateAgentMutation,
  UpdateAgentRuntimeMutation,
  AgentTemplatesListQuery,
} from "@/lib/graphql-queries";
import { AgentRuntime, AgentType } from "@/gql/graphql";

const agentSchema = z.object({
  name: z.string().min(1, "Agent name is required").trim(),
  templateId: z.string().min(1, "Agent template is required"),
  runtime: z.nativeEnum(AgentRuntime),
  budgetDollars: z.string().optional(),
});

type AgentFormValues = z.infer<typeof agentSchema>;

const DEFAULT_VALUES: AgentFormValues = {
  name: "",
  templateId: "",
  runtime: AgentRuntime.Strands,
  budgetDollars: "",
};

interface AgentFormDialogProps {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<AgentFormValues> & { id?: string; agentName?: string };
  hasRecentActivity?: boolean;
  onSaved?: () => void;
  onDelete?: () => Promise<void>;
}

export function AgentFormDialog({
  mode,
  open,
  onOpenChange,
  initial,
  hasRecentActivity = false,
  onSaved,
  onDelete,
}: AgentFormDialogProps) {
  const { tenantId } = useTenant();
  const navigate = useNavigate();

  const [{ fetching: creating }, createAgent] =
    useMutation(CreateAgentMutation);
  const [{ fetching: updating }, updateAgent] =
    useMutation(UpdateAgentMutation);
  const [{ fetching: updatingRuntime }, updateAgentRuntime] = useMutation(
    UpdateAgentRuntimeMutation,
  );
  const fetching = mode === "create" ? creating : updating || updatingRuntime;

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Fetch agent templates for the dropdown
  const [templatesResult] = useQuery({
    query: AgentTemplatesListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId || !open,
  });
  const agentTemplates = (templatesResult.data?.agentTemplates ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
    model?: string | null;
    runtime?: AgentRuntime | null;
  }>;

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentSchema),
    defaultValues: DEFAULT_VALUES,
  });

  useEffect(() => {
    if (open) {
      form.reset({
        ...DEFAULT_VALUES,
        ...initial,
      });
      setConfirmDelete(false);
    }
  }, [open, initial, form]);

  const onSubmit = async (values: AgentFormValues) => {
    if (!tenantId) return;

    if (mode === "create") {
      const result = await createAgent({
        input: {
          tenantId,
          name: values.name.trim(),
          type: AgentType.Agent,
          templateId: values.templateId,
          runtime: values.runtime,
        },
      });

      if (!result.error && result.data?.createAgent) {
        onOpenChange(false);
        navigate({
          to: "/agents/$agentId",
          params: { agentId: result.data.createAgent.id },
        });
      }
    } else {
      const result = await updateAgent({
        id: initial?.id!,
        input: {
          name: values.name.trim(),
          templateId: values.templateId || undefined,
        },
      });

      if (!result.error) {
        const runtimeResult = await updateAgentRuntime({
          id: initial?.id!,
          runtime: values.runtime,
        });
        if (runtimeResult.error) {
          form.setError("runtime", { message: runtimeResult.error.message });
          return;
        }
        onOpenChange(false);
        onSaved?.();
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New Agent" : "Edit Agent"}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogBody className="space-y-4 py-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">
                      Name
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Agent name"
                        autoFocus
                        className="text-sm"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="templateId"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className="text-xs text-muted-foreground">
                        Agent Template
                      </FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(value) => {
                          field.onChange(value);
                          if (mode === "create") {
                            const template = agentTemplates.find(
                              (candidate) => candidate.id === value,
                            );
                            if (template?.runtime) {
                              form.setValue("runtime", template.runtime, {
                                shouldDirty: true,
                              });
                            }
                          }
                        }}
                      >
                        <FormControl>
                          <SelectTrigger className="text-sm">
                            <SelectValue placeholder="Select template..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {agentTemplates.map((c) => (
                            <SelectItem
                              key={c.id}
                              value={c.id}
                              className="text-sm"
                            >
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="runtime"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <FormLabel className="text-xs text-muted-foreground">
                          Harness
                        </FormLabel>
                        {hasRecentActivity && (
                          <Badge variant="outline" className="text-[10px]">
                            New chats only
                          </Badge>
                        )}
                      </div>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger className="text-sm">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem
                            value={AgentRuntime.Strands}
                            className="text-sm"
                          >
                            Strands
                          </SelectItem>
                          <SelectItem
                            value={AgentRuntime.Pi}
                            className="text-sm"
                          >
                            Pi
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {hasRecentActivity && (
                        <p className="text-[11px] leading-snug text-muted-foreground">
                          In-flight chat will complete on the previous harness.
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="budgetDollars"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className="text-xs text-muted-foreground">
                        Budget
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="$/mo"
                          className="text-sm"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </DialogBody>

            <DialogFooter className="mt-4">
              {mode === "edit" && onDelete && (
                <div className="mr-auto">
                  {!confirmDelete ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Agent
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={deleting}
                      onClick={async () => {
                        setDeleting(true);
                        await onDelete();
                        setDeleting(false);
                      }}
                    >
                      {deleting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-2 h-4 w-4" />
                      )}
                      Confirm Delete
                    </Button>
                  )}
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={fetching}>
                {fetching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {mode === "create" ? "Creating..." : "Saving..."}
                  </>
                ) : mode === "create" ? (
                  "Create Agent"
                ) : (
                  "Save Changes"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
