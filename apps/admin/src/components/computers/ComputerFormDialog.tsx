import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery } from "urql";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { useTenant } from "@/context/TenantContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  ComputerTemplatesListQuery,
  CreateComputerMutation,
  SetComputerAssignmentsMutation,
  TenantMembersListQuery,
} from "@/lib/graphql-queries";
import { buildComputerAssignmentTargets } from "@/lib/computer-assignment-utils";
import { ComputerScope } from "@/gql/graphql";

const PLATFORM_DEFAULT_COMPUTER_TEMPLATE_SLUG = "thinkwork-computer-default";

const computerSchema = z.object({
  name: z.string().min(1, "Name is required").trim(),
  templateId: z.string().min(1, "Template is required"),
  budgetDollars: z.string().optional(),
});

type ComputerFormValues = z.infer<typeof computerSchema>;

const DEFAULT_VALUES: ComputerFormValues = {
  name: "",
  templateId: "",
  budgetDollars: "",
};

export interface ComputerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<ComputerFormValues>;
  initialAccess?: {
    userIds?: string[];
  };
  /** Called after a successful create with the new Computer's id. */
  onCreated?: (computerId: string) => void;
}

export function ComputerFormDialog({
  open,
  onOpenChange,
  initial,
  initialAccess,
  onCreated,
}: ComputerFormDialogProps) {
  const { tenantId } = useTenant();
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const [{ fetching: creating }, createComputer] = useMutation(
    CreateComputerMutation,
  );
  const [{ fetching: assigning }, setAssignments] = useMutation(
    SetComputerAssignmentsMutation,
  );

  const [membersResult] = useQuery({
    query: TenantMembersListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId || !open,
  });
  const [templatesResult] = useQuery({
    query: ComputerTemplatesListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId || !open,
  });

  const queriesFetching = membersResult.fetching || templatesResult.fetching;
  const queriesReady =
    !queriesFetching &&
    membersResult.data != null &&
    templatesResult.data != null;

  const users = useMemo(
    () =>
      (membersResult.data?.tenantMembers ?? [])
        .filter((member) => member.principalType.toUpperCase() === "USER")
        .filter((member) => member.user)
        .map((member) => ({
          id: member.user!.id,
          name: member.user!.name ?? member.user!.email ?? member.user!.id,
          email: member.user!.email ?? "",
        })),
    [membersResult.data],
  );
  const computerTemplates = templatesResult.data?.computerTemplates ?? [];

  const form = useForm<ComputerFormValues>({
    resolver: zodResolver(computerSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      form.reset({
        ...DEFAULT_VALUES,
        ...initial,
      });
      setSelectedUserIds(initialAccess?.userIds ?? []);
    }
    wasOpenRef.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (computerTemplates.length === 0) return;
    if (form.getValues("templateId")) return;
    const platformDefault = computerTemplates.find(
      (template) => template.slug === PLATFORM_DEFAULT_COMPUTER_TEMPLATE_SLUG,
    );
    const presetTemplate =
      platformDefault?.id ?? computerTemplates[0]?.id ?? "";
    if (presetTemplate) {
      form.setValue("templateId", presetTemplate, { shouldDirty: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, computerTemplates]);

  const submittingRef = useRef(false);

  const onSubmit = async (values: ComputerFormValues) => {
    if (!tenantId) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      const budgetCents = parseBudgetDollarsToCents(values.budgetDollars);
      const result = await createComputer({
        input: {
          tenantId,
          templateId: values.templateId,
          name: values.name.trim(),
          scope: ComputerScope.Shared,
          ...(budgetCents != null ? { budgetMonthlyCents: budgetCents } : {}),
        },
      });

      if (result.error) {
        form.setError("root", { message: result.error.message });
        return;
      }

      const created = result.data?.createComputer;
      if (!created) return;

      const assignments = buildComputerAssignmentTargets(selectedUserIds, []);
      if (assignments.length > 0) {
        const assignmentResult = await setAssignments({
          input: {
            computerId: created.id,
            assignments,
          },
        });
        if (assignmentResult.error) {
          toast.error(
            "Computer created, but access assignment failed. Update access from Config.",
          );
          onOpenChange(false);
          onCreated?.(created.id);
          return;
        }
      }

      onOpenChange(false);
      onCreated?.(created.id);
    } finally {
      submittingRef.current = false;
    }
  };

  const rootError = form.formState.errors.root?.message;
  const saving = creating || assigning;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Computer</DialogTitle>
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
                        placeholder="e.g. Finance Computer"
                        autoFocus
                        className="text-sm"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="templateId"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className="text-xs text-muted-foreground">
                        Template
                      </FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={
                          !queriesReady || computerTemplates.length === 0
                        }
                      >
                        <FormControl>
                          <SelectTrigger className="text-sm">
                            {queriesFetching ? (
                              <span className="flex items-center gap-2 text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Loading templates...
                              </span>
                            ) : computerTemplates.length === 0 ? (
                              <span className="text-muted-foreground">
                                No Computer templates available
                              </span>
                            ) : (
                              <SelectValue placeholder="Select template..." />
                            )}
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {computerTemplates.map((template) => (
                            <SelectItem
                              key={template.id}
                              value={template.id}
                              className="text-sm"
                            >
                              {template.name}
                              {template.slug ===
                                PLATFORM_DEFAULT_COMPUTER_TEMPLATE_SLUG && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  default
                                </span>
                              )}
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
                  name="budgetDollars"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className="text-xs text-muted-foreground">
                        Budget (optional)
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

              <div className="rounded-md border p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Users className="h-4 w-4 text-cyan-600" />
                    Initial Access
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {selectedUserIds.length} users
                  </span>
                </div>
                <AssignmentChecklist
                  emptyLabel="No users"
                  items={users}
                  selectedIds={selectedUserIds}
                  onToggle={(id, checked) =>
                    toggleSelection(setSelectedUserIds, id, checked)
                  }
                />
              </div>

              {rootError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {rootError}
                </div>
              )}
            </DialogBody>

            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !queriesReady}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Computer"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function AssignmentChecklist({
  emptyLabel,
  items,
  selectedIds,
  onToggle,
}: {
  emptyLabel: string;
  items: { id: string; name: string; email?: string }[];
  selectedIds: string[];
  onToggle: (id: string, checked: boolean) => void;
}) {
  return (
    <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-2">
      {items.length === 0 ? (
        <div className="px-2 py-3 text-xs text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        items.map((item) => (
          <label
            key={item.id}
            className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
          >
            <Checkbox
              checked={selectedIds.includes(item.id)}
              onCheckedChange={(checked) => onToggle(item.id, checked === true)}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block truncate">{item.name}</span>
              {item.email && item.email !== item.name ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {item.email}
                </span>
              ) : null}
            </span>
          </label>
        ))
      )}
    </div>
  );
}

function toggleSelection(
  setSelected: Dispatch<SetStateAction<string[]>>,
  id: string,
  checked: boolean,
) {
  setSelected((current) => {
    if (checked) return current.includes(id) ? current : [...current, id];
    return current.filter((value) => value !== id);
  });
}

export function parseBudgetDollarsToCents(input?: string): number | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}
