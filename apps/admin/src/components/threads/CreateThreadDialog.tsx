import { useState, useEffect, useMemo } from "react";
import { graphql } from "@/gql";
import { useQuery, useMutation } from "urql";
import { useTenant } from "@/context/TenantContext";
import { useDialog } from "@/context/DialogContext";
import { cn } from "@/lib/utils";
import { StatusIcon } from "./StatusIcon";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ChevronDown,
  Calendar,
  Loader2,
  User,
} from "lucide-react";
import { AgentsListQuery, UpdateThreadMutation } from "@/lib/graphql-queries";

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

const CreateThreadMutation = graphql(`
  mutation CreateThread($input: CreateThreadInput!) {
    createThread(input: $input) {
      id
      number
      title
      status
      createdAt
    }
  }
`);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked"] as const;

const DRAFT_KEY = "thinkwork:thread-draft";
const DEBOUNCE_MS = 800;

function statusLabel(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Zod Schema
// ---------------------------------------------------------------------------

const threadSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string(),
  status: z.string(),
  agentId: z.string(),
  dueAt: z.string(),
});

type ThreadFormValues = z.infer<typeof threadSchema>;

// ---------------------------------------------------------------------------
// Draft persistence
// ---------------------------------------------------------------------------

const INITIAL_FORM: ThreadFormValues = {
  title: "",
  description: "",
  status: "backlog",
  agentId: "",
  dueAt: "",
};

function loadDraft(): ThreadFormValues | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ThreadFormValues;
  } catch {
    return null;
  }
}

function saveDraft(draft: ThreadFormValues) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

// ---------------------------------------------------------------------------
// Shared ThreadFormDialog (create + edit modes)
// ---------------------------------------------------------------------------

interface ThreadFormDialogProps {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<ThreadFormValues> & { id?: string };
  onSaved?: () => void;
}

export function ThreadFormDialog({
  mode,
  open,
  onOpenChange,
  initial,
  onSaved,
}: ThreadFormDialogProps) {
  const { tenantId } = useTenant();

  const [{ fetching: creating }, createThread] = useMutation(CreateThreadMutation);
  const [{ fetching: updatingThread }, updateThread] = useMutation(UpdateThreadMutation);
  const fetching = mode === "create" ? creating : updatingThread;

  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [hasDraft, setHasDraft] = useState(false);

  const form = useForm<ThreadFormValues>({
    resolver: zodResolver(threadSchema),
    defaultValues: INITIAL_FORM,
  });

  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId || !open,
  });

  const agents = agentsResult.data?.agents ?? [];

  useEffect(() => {
    if (open) {
      if (mode === "create") {
        const draft = loadDraft();
        if (draft && draft.title) {
          form.reset(draft);
          setHasDraft(true);
        } else {
          form.reset({
            ...INITIAL_FORM,
            ...initial,
          });
          setHasDraft(false);
        }
      } else {
        form.reset({
          ...INITIAL_FORM,
          ...initial,
        });
        setHasDraft(false);
      }
    }
  }, [open, initial, form, mode]);

  // Auto-save draft (create mode only)
  const watchedValues = form.watch();
  useEffect(() => {
    if (!open || mode !== "create") return;
    const t = window.setTimeout(() => {
      if (watchedValues.title.trim()) saveDraft(watchedValues);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [watchedValues, open, mode]);

  const agentId = form.watch("agentId");

  const selectedAgent = useMemo(
    () => agents.find((a: any) => a.id === agentId),
    [agents, agentId],
  );

  const filteredAgents = useMemo(
    () =>
      agents.filter((a: any) =>
        !assigneeSearch.trim() || a.name.toLowerCase().includes(assigneeSearch.toLowerCase()),
      ),
    [agents, assigneeSearch],
  );

  const onSubmit = async (values: ThreadFormValues) => {
    if (!tenantId) return;

    if (mode === "create") {
      const result = await createThread({
        input: {
          tenantId,
          title: values.title.trim(),
          description: values.description.trim() || undefined,
          agentId: values.agentId || undefined,
          assigneeType: values.agentId ? "AGENT" : undefined,
          assigneeId: values.agentId || undefined,
          dueAt: values.dueAt || undefined,
        },
      });

      if (!result.error) {
        clearDraft();
        onOpenChange(false);
      }
    } else {
      const result = await updateThread({
        id: initial?.id!,
        input: {
          title: values.title.trim(),
          description: values.description.trim() || undefined,
          status: values.status.toUpperCase().replace(/ /g, "_") as any,
          assigneeType: values.agentId ? "AGENT" : undefined,
          assigneeId: values.agentId || undefined,
          dueAt: values.dueAt || undefined,
        },
      });

      if (!result.error) {
        onOpenChange(false);
        onSaved?.();
      }
    }
  };

  const handleDiscard = () => {
    clearDraft();
    form.reset({
      ...INITIAL_FORM,
      ...initial,
    });
    setHasDraft(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Create Thread" : "Edit Thread"}</DialogTitle>
        </DialogHeader>

        {mode === "create" && hasDraft && (
          <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <span>Draft restored</span>
            <button type="button" className="text-xs underline" onClick={handleDiscard}>
              Discard
            </button>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogBody className="space-y-4 py-2">
              {/* Title */}
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        placeholder="Thread title"
                        autoFocus
                        className="text-sm"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Description */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        placeholder="Add description..."
                        rows={4}
                        className="text-sm resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Inline property row */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Status */}
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-accent/50 transition-colors">
                            <StatusIcon status={field.value} />
                            <span>{statusLabel(field.value)}</span>
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-40 p-1" align="start">
                          {STATUSES.map((s) => (
                            <button
                              type="button"
                              key={s}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent/50",
                                field.value === s && "bg-accent",
                              )}
                              onClick={() => field.onChange(s)}
                            >
                              <StatusIcon status={s} />
                              {statusLabel(s)}
                            </button>
                          ))}
                        </PopoverContent>
                      </Popover>
                    </FormItem>
                  )}
                />

                {/* Assignee (agent) */}
                <FormField
                  control={form.control}
                  name="agentId"
                  render={({ field }) => (
                    <FormItem>
                      <Popover open={assigneeOpen} onOpenChange={(o) => { setAssigneeOpen(o); if (!o) setAssigneeSearch(""); }}>
                        <PopoverTrigger asChild>
                          <button type="button" className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-accent/50 transition-colors">
                            <User className="h-3 w-3 text-muted-foreground" />
                            <span>{selectedAgent ? (selectedAgent as any).name : "Assignee"}</span>
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-1" align="start">
                          <input
                            className="mb-1 w-full border-b border-border bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground/50"
                            placeholder="Search agents..."
                            value={assigneeSearch}
                            onChange={(e) => setAssigneeSearch(e.target.value)}
                            autoFocus
                          />
                          <div className="max-h-48 overflow-y-auto overscroll-contain">
                            <button
                              type="button"
                              className={cn(
                                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent/50",
                                !field.value && "bg-accent",
                              )}
                              onClick={() => { field.onChange(""); setAssigneeOpen(false); }}
                            >
                              No assignee
                            </button>
                            {filteredAgents.map((agent: any) => (
                              <button
                                type="button"
                                key={agent.id}
                                className={cn(
                                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent/50",
                                  field.value === agent.id && "bg-accent",
                                )}
                                onClick={() => { field.onChange(agent.id); setAssigneeOpen(false); }}
                              >
                                {agent.name}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </FormItem>
                  )}
                />

                {/* Due date */}
                <FormField
                  control={form.control}
                  name="dueAt"
                  render={({ field }) => (
                    <FormItem>
                      <div className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        <FormControl>
                          <Input
                            type="date"
                            className="h-7 w-auto border px-2 text-xs"
                            {...field}
                          />
                        </FormControl>
                      </div>
                    </FormItem>
                  )}
                />
              </div>

            </DialogBody>

            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={fetching}>
                {fetching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {mode === "create" ? "Creating..." : "Saving..."}
                  </>
                ) : (
                  mode === "create" ? "Create Thread" : "Save Changes"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Wrapper for global create dialog (backwards compat with DialogContext)
// ---------------------------------------------------------------------------

export function CreateThreadDialog() {
  const { dialogs, closeDialog } = useDialog();
  const { open, defaults } = dialogs.newThread;

  return (
    <ThreadFormDialog
      mode="create"
      open={open}
      onOpenChange={() => closeDialog("newThread")}
      initial={defaults ? {
        title: defaults.title,
        status: defaults.status,
        agentId: defaults.agentId,
      } : undefined}
    />
  );
}
