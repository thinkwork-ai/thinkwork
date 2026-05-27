import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import {
  WorkspaceFileEditor,
  type WorkspaceFilesClient,
} from "@thinkwork/workspace-editor";
import {
  Bot,
  Pause,
  Play,
  Plus,
  Repeat,
  Trash2,
  Webhook as WebhookIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { ScheduledJobFormDialog } from "@/components/scheduled-jobs/ScheduledJobFormDialog";
import { Badge } from "@/components/ui/badge";
import { CopyLinkButton } from "@/components/ui/CopyLinkButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Mail } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { WebhookFormDialog } from "@/components/webhooks/WebhookFormDialog";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import {
  SpaceEmailTriggerStatus,
  type SpaceAdminDetailQuery as SpaceAdminDetailQueryResult,
} from "@/gql/graphql";
import { apiFetch as authedApiFetch } from "@/lib/api-fetch";
import {
  KnowledgeBasesListQuery,
  SpaceMemoryQuery,
  SetSpaceKnowledgeBasesMutation,
  SpaceAdminDetailQuery,
  UpdateSpaceEmailTriggerMutation,
  UpdateSpaceMutation,
} from "@/lib/graphql-queries";
import {
  deleteWorkspaceFile,
  getWorkspaceFile,
  listWorkspaceFiles,
  moveWorkspaceFile,
  putWorkspaceFile,
  renameWorkspacePath,
  type Target,
} from "@/lib/workspace-files-api";
import { relativeTime } from "@/lib/utils";

type SpaceDetailTab = "workspace" | "kbs" | "triggers" | "settings" | "members";
type Space = NonNullable<SpaceAdminDetailQueryResult["space"]>;
type SpaceAccessMode = "PUBLIC" | "PRIVATE";
type SpaceDraft = {
  name: string;
  description: string;
  accessMode: SpaceAccessMode;
};

const spaceWorkspaceFilesClient: WorkspaceFilesClient<Target> = {
  listFiles: listWorkspaceFiles,
  getFile: getWorkspaceFile,
  putFile: putWorkspaceFile,
  deleteFile: deleteWorkspaceFile,
  movePath: moveWorkspaceFile,
  renamePath: renameWorkspacePath,
};

interface SpaceDetailChromeContext {
  space: Space;
  draft: SpaceDraft;
  setDraft: Dispatch<SetStateAction<SpaceDraft>>;
  refreshSpace: () => void;
}

interface SpaceDetailChromeProps {
  spaceId: string;
  activeTab: SpaceDetailTab;
  headerActions?: (context: SpaceDetailChromeContext) => ReactNode;
  children: (context: SpaceDetailChromeContext) => ReactNode;
}

export function SpaceDetailChrome({
  spaceId,
  activeTab,
  headerActions,
  children,
}: SpaceDetailChromeProps) {
  const { tenantId } = useTenant();
  const [draft, setDraft] = useState<SpaceDraft>({
    name: "",
    description: "",
    accessMode: "PUBLIC",
  });
  const [updateResult, updateSpace] = useMutation(UpdateSpaceMutation);

  const [spaceResult, reexecuteSpaceQuery] = useQuery({
    query: SpaceAdminDetailQuery,
    variables: { id: spaceId },
    pause: !spaceId,
    requestPolicy: "cache-and-network",
  });

  const space = spaceResult.data?.space ?? null;

  useEffect(() => {
    if (!space) return;
    setDraft({
      name: space.name,
      description: space.description ?? "",
      accessMode: space.accessMode as SpaceAccessMode,
    });
  }, [space?.id, space?.name, space?.description, space?.accessMode]);

  useBreadcrumbs([
    { label: "Spaces", href: "/spaces" },
    { label: space?.name ?? "Space" },
  ]);

  const dirty = Boolean(
    space &&
    (draft.name.trim() !== space.name ||
      (draft.description.trim() || null) !== (space.description ?? null) ||
      draft.accessMode !== space.accessMode),
  );
  const canSave =
    dirty && draft.name.trim().length > 0 && !updateResult.fetching;

  async function handleSaveSpace() {
    if (!space || !tenantId || !canSave) return;
    const response = await updateSpace({
      input: {
        tenantId,
        spaceId: space.id,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        accessMode: draft.accessMode,
      },
    });

    if (response.error) {
      toast.error(`Could not save Space: ${response.error.message}`);
      return;
    }

    const updated = response.data?.updateSpace;
    if (updated) {
      setDraft({
        name: updated.name,
        description: updated.description ?? "",
        accessMode: updated.accessMode as SpaceAccessMode,
      });
    }
    toast.success("Space saved.");
    reexecuteSpaceQuery({ requestPolicy: "network-only" });
  }

  if (!tenantId || (spaceResult.fetching && !spaceResult.data)) {
    return <PageSkeleton />;
  }

  if (!space) {
    return (
      <PageLayout
        header={
          <PageHeader
            title="Space not found"
            description={spaceResult.error?.message}
          />
        }
      >
        <div className="text-sm text-muted-foreground">
          The Space could not be loaded or is not available to this tenant.
        </div>
      </PageLayout>
    );
  }

  const chromeContext: SpaceDetailChromeContext = {
    space,
    draft,
    setDraft,
    refreshSpace: () => reexecuteSpaceQuery({ requestPolicy: "network-only" }),
  };

  return (
    <PageLayout
      header={
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <h1 className="min-w-0 truncate text-2xl font-bold leading-tight tracking-tight text-foreground">
            {space.name}
          </h1>
          <div className="flex justify-center">
            <Tabs value={activeTab}>
              <TabsList>
                <TabsTrigger value="workspace" asChild className="px-4">
                  <Link to="/spaces/$spaceId/workspace" params={{ spaceId }}>
                    Workspace
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="kbs" asChild className="px-4">
                  <Link to="/spaces/$spaceId/kbs" params={{ spaceId }}>
                    KBs
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="triggers" asChild className="px-4">
                  <Link to="/spaces/$spaceId/triggers" params={{ spaceId }}>
                    Triggers
                  </Link>
                </TabsTrigger>
                <TabsTrigger value="settings" asChild className="px-4">
                  <Link to="/spaces/$spaceId/settings" params={{ spaceId }}>
                    Settings
                  </Link>
                </TabsTrigger>
                {space.accessMode === "PRIVATE" ? (
                  <TabsTrigger value="members" asChild className="px-4">
                    <Link to="/spaces/$spaceId/members" params={{ spaceId }}>
                      Members
                    </Link>
                  </TabsTrigger>
                ) : null}
              </TabsList>
            </Tabs>
          </div>
          <div className="flex min-w-0 justify-end">
            {headerActions ? (
              headerActions(chromeContext)
            ) : dirty ? (
              <Button size="sm" onClick={handleSaveSpace} disabled={!canSave}>
                {updateResult.fetching ? "Saving..." : "Save"}
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      {children(chromeContext)}
    </PageLayout>
  );
}

export function SpaceSettingsPanel({
  draft,
  setDraft,
}: {
  space: Space;
  draft: SpaceDraft;
  setDraft: Dispatch<SetStateAction<SpaceDraft>>;
  refreshSpace: () => void;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-md border p-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="space-name">Name</Label>
            <Input
              id="space-name"
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="space-access">Access</Label>
            <Select
              value={draft.accessMode}
              onValueChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  accessMode: value as SpaceAccessMode,
                }))
              }
            >
              <SelectTrigger id="space-access">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PUBLIC">Public</SelectItem>
                <SelectItem value="PRIVATE">Private</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="space-description">Description</Label>
            <Textarea
              id="space-description"
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </div>
        </div>
      </section>
    </div>
  );
}

export function SpaceWorkspacePanel({ spaceId }: { spaceId: string }) {
  return (
    <WorkspaceFileEditor
      target={{ spaceId }}
      targetKey={`space:${spaceId}`}
      client={spaceWorkspaceFilesClient}
      defaultOpenFile="CONTEXT.md"
      className="min-h-[620px]"
    />
  );
}

export function SpaceKbsPanel({ space }: { space: Space }) {
  const { tenantId } = useTenant();
  const [spaceMemoryResult, reexecuteSpaceMemoryQuery] = useQuery({
    query: SpaceMemoryQuery,
    variables: { id: space.id },
    pause: !space.id,
    requestPolicy: "cache-and-network",
  });
  const spaceKnowledgeBases =
    (spaceMemoryResult.data as any)?.space?.knowledgeBases ?? [];
  const selectedKnowledgeBaseIds = spaceKnowledgeBases
    .filter((assignment) => assignment.enabled)
    .map((assignment) => assignment.knowledgeBaseId);
  const [selectedIds, setSelectedIds] = useState(selectedKnowledgeBaseIds);
  const [, setSpaceKnowledgeBases] = useMutation(
    SetSpaceKnowledgeBasesMutation,
  );
  const [knowledgeBasesResult] = useQuery({
    query: KnowledgeBasesListQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  useEffect(() => {
    setSelectedIds(selectedKnowledgeBaseIds);
  }, [selectedKnowledgeBaseIds.join("|")]);

  const knowledgeBases =
    (knowledgeBasesResult.data as any)?.knowledgeBases ?? [];
  const assignedKnowledgeBases = new Map(
    spaceKnowledgeBases
      .map((assignment) => assignment.knowledgeBase)
      .filter(Boolean)
      .map((knowledgeBase) => [knowledgeBase.id, knowledgeBase]),
  );
  const knowledgeBaseOptions = knowledgeBases.map(
    (knowledgeBase: { id: string; name: string; status: string }) => ({
      label: knowledgeBase.name,
      value: knowledgeBase.id,
      disabled:
        !selectedIds.includes(knowledgeBase.id) &&
        knowledgeBase.status !== "active",
    }),
  );
  const selectedKnowledgeBases = selectedIds
    .map(
      (id) =>
        knowledgeBases.find(
          (knowledgeBase: { id: string }) => knowledgeBase.id === id,
        ) ?? assignedKnowledgeBases.get(id),
    )
    .filter(Boolean) as Array<{ id: string; name: string; status: string }>;

  async function handleKnowledgeBasesChange(nextIds: string[]) {
    if (!tenantId) return;
    setSelectedIds(nextIds);
    const response = await setSpaceKnowledgeBases({
      input: {
        tenantId,
        spaceId: space.id,
        knowledgeBases: nextIds.map((knowledgeBaseId) => ({
          knowledgeBaseId,
          enabled: true,
        })),
      },
    });

    if (response.error) {
      setSelectedIds(selectedKnowledgeBaseIds);
      toast.error(`Could not save knowledge bases: ${response.error.message}`);
      return;
    }

    toast.success("Knowledge bases saved.");
    reexecuteSpaceMemoryQuery({ requestPolicy: "network-only" });
  }

  return (
    <section className="space-y-4 rounded-md border p-4">
      <div className="space-y-1.5">
        <Label>Knowledge Bases</Label>
        <MultiSelect
          options={knowledgeBaseOptions}
          defaultValue={selectedIds}
          onValueChange={handleKnowledgeBasesChange}
          placeholder={
            knowledgeBasesResult.fetching
              ? "Loading knowledge bases..."
              : "Choose knowledge bases"
          }
          emptyIndicator={
            <span className="text-sm text-muted-foreground">
              No knowledge bases found.
            </span>
          }
          maxCount={4}
          disabled={
            knowledgeBasesResult.fetching && knowledgeBases.length === 0
          }
          className="w-full justify-between"
          popoverClassName="w-[var(--radix-popover-trigger-width)]"
          hideSelectAll
          deduplicateOptions
        />
      </div>
      {selectedKnowledgeBases.length > 0 ? (
        <div className="divide-y rounded-md border">
          {selectedKnowledgeBases.map((knowledgeBase) => (
            <div
              key={knowledgeBase.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate font-medium">
                {knowledgeBase.name}
              </span>
              <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                {knowledgeBase.status}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border p-3 text-sm text-muted-foreground">
          No knowledge bases selected.
        </div>
      )}
    </section>
  );
}

type ScheduledJobRow = {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  enabled: boolean;
  schedule_type: string | null;
  schedule_expression: string | null;
  timezone: string;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
};

type WebhookRow = {
  id: string;
  name: string;
  description: string | null;
  target_type: string;
  enabled: boolean;
  token: string;
  last_invoked_at: string | null;
  invocation_count: number;
  created_at: string;
};

type SpaceTriggerRow = {
  id: string;
  kind: "schedule" | "webhook" | "email";
  name: string;
  typeLabel: string;
  descriptionValue: string;
  descriptionCopyable: boolean;
  descriptionCopyLabel?: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunOrDeliveryAt: string | null;
  createdAt: string;
};

const SPACE_AUTOMATION_TYPE_LABELS: Record<string, string> = {
  agent_heartbeat: "Heartbeat",
  agent_reminder: "Reminder",
  agent_scheduled: "Scheduled",
  eval_scheduled: "Evaluation",
  routine_schedule: "Routine",
  routine_one_time: "One-time",
};

async function spaceApiFetch<T>(
  path: string,
  tenantId: string,
  options: RequestInit = {},
): Promise<T> {
  const { headers, ...rest } = options;
  return authedApiFetch<T>(path, {
    ...rest,
    extraHeaders: {
      "x-tenant-id": tenantId,
      ...(headers as Record<string, string> | undefined),
    },
  });
}

function formatAutomationSchedule(expr: string | null): string {
  if (!expr) return "—";
  if (expr.startsWith("rate(")) return expr.slice(5, -1);
  if (expr.startsWith("at(")) {
    const value = expr.slice(3, -1);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }
  return expr;
}

function estimateNextAutomationRun(
  scheduleExpr: string | null,
  lastRunAt: string | null,
): string | null {
  if (!scheduleExpr) return null;
  if (scheduleExpr.startsWith("at(")) {
    const date = new Date(scheduleExpr.slice(3, -1));
    return date.getTime() > Date.now() ? date.toISOString() : null;
  }
  if (!scheduleExpr.startsWith("rate(")) return null;
  const match = scheduleExpr
    .slice(5, -1)
    .trim()
    .match(/^(\d+)\s+(minute|hour|day|second)s?$/i);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const unitMs =
    unit === "second"
      ? 1000
      : unit === "minute"
        ? 60000
        : unit === "hour"
          ? 3600000
          : 86400000;
  const intervalMs = value * unitMs;
  const base = lastRunAt ? new Date(lastRunAt).getTime() : Date.now();
  if (!Number.isFinite(base) || intervalMs <= 0) return null;
  const elapsed = Date.now() - base;
  const periods = elapsed > 0 ? Math.ceil(elapsed / intervalMs) : 1;
  return new Date(base + periods * intervalMs).toISOString();
}

function triggerColumns(): ColumnDef<SpaceTriggerRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <span className="font-medium whitespace-nowrap">
          {row.original.name}
        </span>
      ),
    },
    {
      accessorKey: "typeLabel",
      header: "Type",
      cell: ({ row }) => {
        const Icon =
          row.original.kind === "email"
            ? Mail
            : row.original.kind === "webhook"
              ? WebhookIcon
              : row.original.typeLabel === "Routine" ||
                  row.original.typeLabel === "One-time"
                ? Repeat
                : Bot;
        return (
          <Badge variant="secondary" className="gap-1 text-xs">
            <Icon className="h-3.5 w-3.5" />
            {row.original.typeLabel}
          </Badge>
        );
      },
    },
    {
      accessorKey: "descriptionValue",
      header: "Description",
      meta: { flex: true },
      cell: ({ row }) =>
        row.original.descriptionCopyable ? (
          <div className="flex items-center gap-1.5 min-w-0 w-full">
            <code className="flex-1 truncate text-xs text-muted-foreground min-w-0">
              {row.original.descriptionValue}
            </code>
            <CopyLinkButton
              text={row.original.descriptionValue}
              ariaLabel={row.original.descriptionCopyLabel ?? "Copy"}
            />
          </div>
        ) : (
          <div className="text-muted-foreground text-sm truncate min-w-0 w-full">
            {row.original.descriptionValue || "—"}
          </div>
        ),
    },
    {
      accessorKey: "enabled",
      header: "Status",
      cell: ({ row }) =>
        row.original.enabled ? (
          <Badge
            variant="secondary"
            className="gap-1 bg-green-500/15 text-xs text-green-600 dark:text-green-400"
          >
            <Play className="h-3 w-3 fill-current" />
            Enabled
          </Badge>
        ) : (
          <Badge
            variant="secondary"
            className="gap-1 bg-muted text-xs text-muted-foreground"
          >
            <Pause className="h-3 w-3" />
            Disabled
          </Badge>
        ),
    },
    {
      accessorKey: "lastRunAt",
      header: "Last Run",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {row.original.lastRunAt ? relativeTime(row.original.lastRunAt) : "—"}
        </span>
      ),
    },
  ];
}

function deriveSpaceEmailAddress(
  tenantSlug: string,
  spaceSlug: string,
): string {
  return `${spaceSlug}@${tenantSlug}.thinkwork.ai`;
}

function deriveWebhookUrl(token: string): string {
  const base =
    (import.meta.env.VITE_API_URL as string | undefined) ||
    (typeof process !== "undefined"
      ? (process.env?.VITE_API_URL as string | undefined)
      : undefined) ||
    "";
  return `${base}/webhooks/${token}`;
}

interface SpaceTriggersHandle {
  // Data
  scheduledJobs: ScheduledJobRow[];
  webhooks: WebhookRow[];
  loading: boolean;
  errorMessage: string | null;
  // Dialog state
  scheduleDialogOpen: boolean;
  setScheduleDialogOpen: (open: boolean) => void;
  webhookDialogOpen: boolean;
  setWebhookDialogOpen: (open: boolean) => void;
  emailDialogOpen: boolean;
  setEmailDialogOpen: (open: boolean) => void;
  // Email mutation
  emailMutationFetching: boolean;
  enableEmail: () => Promise<void>;
  updateEmailTrigger: (input: {
    status: Space["emailTriggerStatus"];
    emailPrefix?: string | null;
  }) => Promise<boolean>;
  // Plumbing
  fetchAutomations: () => Promise<void>;
}

const SpaceTriggersContext = createContext<SpaceTriggersHandle | null>(null);

function useSpaceTriggersRequired(): SpaceTriggersHandle {
  const handle = useContext(SpaceTriggersContext);
  if (!handle) {
    throw new Error(
      "SpaceTriggers components must be rendered inside <SpaceTriggersProvider>",
    );
  }
  return handle;
}

export function SpaceTriggersProvider({
  spaceId,
  children,
}: {
  spaceId: string;
  children: ReactNode;
}) {
  const { tenantId } = useTenant();
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledJobRow[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [webhookDialogOpen, setWebhookDialogOpen] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emailMutationResult, updateSpaceEmailTrigger] = useMutation(
    UpdateSpaceEmailTriggerMutation,
  );

  const fetchAutomations = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ spaceId }).toString();
      const [jobs, hooks] = await Promise.all([
        spaceApiFetch<ScheduledJobRow[]>(
          `/api/scheduled-jobs?${query}`,
          tenantId,
        ),
        spaceApiFetch<WebhookRow[]>(`/api/webhooks?${query}`, tenantId),
      ]);
      setScheduledJobs(jobs);
      setWebhooks(hooks);
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [spaceId, tenantId]);

  useEffect(() => {
    void fetchAutomations();
  }, [fetchAutomations]);

  const updateEmailTrigger = useCallback(
    async (input: {
      status: Space["emailTriggerStatus"];
      emailPrefix?: string | null;
    }) => {
      const response = await updateSpaceEmailTrigger({
        input: {
          spaceId,
          status: input.status,
          emailPrefix: input.emailPrefix,
        },
      });
      if (response.error) {
        toast.error(
          `Could not update email trigger: ${response.error.message}`,
        );
        return false;
      }
      return true;
    },
    [spaceId, updateSpaceEmailTrigger],
  );

  const enableEmail = useCallback(async () => {
    const ok = await updateEmailTrigger({
      status: SpaceEmailTriggerStatus.Enabled,
    });
    if (!ok) return;
    toast.success("Email trigger enabled.");
    await fetchAutomations();
  }, [updateEmailTrigger, fetchAutomations]);

  const handle = useMemo<SpaceTriggersHandle>(
    () => ({
      scheduledJobs,
      webhooks,
      loading,
      errorMessage,
      scheduleDialogOpen,
      setScheduleDialogOpen,
      webhookDialogOpen,
      setWebhookDialogOpen,
      emailDialogOpen,
      setEmailDialogOpen,
      emailMutationFetching: emailMutationResult.fetching,
      enableEmail,
      updateEmailTrigger,
      fetchAutomations,
    }),
    [
      scheduledJobs,
      webhooks,
      loading,
      errorMessage,
      scheduleDialogOpen,
      webhookDialogOpen,
      emailDialogOpen,
      emailMutationResult.fetching,
      enableEmail,
      updateEmailTrigger,
      fetchAutomations,
    ],
  );

  return (
    <SpaceTriggersContext.Provider value={handle}>
      {children}
    </SpaceTriggersContext.Provider>
  );
}

export function SpaceTriggersAdd({
  space,
  refreshSpace,
}: {
  space: Space;
  refreshSpace: () => void;
}) {
  const handle = useSpaceTriggersRequired();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => handle.setScheduleDialogOpen(true)}>
          <Repeat className="h-4 w-4" />
          Schedule
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handle.setWebhookDialogOpen(true)}>
          <WebhookIcon className="h-4 w-4" />
          Webhook
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={
            space.emailTriggerStatus !== SpaceEmailTriggerStatus.None ||
            handle.emailMutationFetching
          }
          onSelect={() => {
            void (async () => {
              await handle.enableEmail();
              refreshSpace();
            })();
          }}
        >
          <Mail className="h-4 w-4" />
          Email
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SpaceTriggersPanel({
  space,
  refreshSpace,
}: {
  space: Space;
  refreshSpace: () => void;
}) {
  const handle = useSpaceTriggersRequired();
  const { tenantId, tenant } = useTenant();
  const tenantSlug = tenant?.slug ?? "";
  const navigate = useNavigate();
  const {
    scheduledJobs,
    webhooks,
    loading,
    errorMessage,
    scheduleDialogOpen,
    setScheduleDialogOpen,
    webhookDialogOpen,
    setWebhookDialogOpen,
    emailDialogOpen,
    setEmailDialogOpen,
    emailMutationFetching,
    updateEmailTrigger,
    fetchAutomations,
  } = handle;

  const emailAddress = deriveSpaceEmailAddress(tenantSlug, space.slug);

  const rows = useMemo<SpaceTriggerRow[]>(() => {
    const scheduleRows: SpaceTriggerRow[] = scheduledJobs.map((job) => ({
      id: `schedule:${job.id}`,
      kind: "schedule",
      name: job.name,
      typeLabel:
        SPACE_AUTOMATION_TYPE_LABELS[job.trigger_type] ?? job.trigger_type,
      descriptionValue: formatAutomationSchedule(job.schedule_expression),
      descriptionCopyable: false,
      enabled: job.enabled,
      lastRunAt: job.last_run_at,
      nextRunOrDeliveryAt:
        job.next_run_at ??
        estimateNextAutomationRun(job.schedule_expression, job.last_run_at),
      createdAt: job.created_at,
    }));

    const webhookRows: SpaceTriggerRow[] = webhooks.map((webhook) => ({
      id: `webhook:${webhook.id}`,
      kind: "webhook",
      name: webhook.name,
      typeLabel: "Webhook",
      descriptionValue: deriveWebhookUrl(webhook.token),
      descriptionCopyable: true,
      descriptionCopyLabel: "Copy webhook URL",
      enabled: webhook.enabled,
      lastRunAt: null,
      nextRunOrDeliveryAt: webhook.last_invoked_at,
      createdAt: webhook.created_at,
    }));

    const emailRows: SpaceTriggerRow[] =
      space.emailTriggerStatus !== SpaceEmailTriggerStatus.None
        ? [
            {
              id: `email:${space.id}`,
              kind: "email",
              name: "Email trigger",
              typeLabel: "Email",
              descriptionValue: emailAddress,
              descriptionCopyable: true,
              descriptionCopyLabel: "Copy Space email address",
              enabled:
                space.emailTriggerStatus === SpaceEmailTriggerStatus.Enabled,
              lastRunAt: null,
              nextRunOrDeliveryAt: null,
              createdAt: new Date(0).toISOString(),
            },
          ]
        : [];

    return [...emailRows, ...scheduleRows, ...webhookRows].sort((a, b) => {
      // Email row always sorts first for prominence; otherwise newest first.
      if (a.kind === "email") return -1;
      if (b.kind === "email") return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [
    scheduledJobs,
    webhooks,
    space.emailTriggerStatus,
    space.id,
    emailAddress,
  ]);

  if (loading) return <PageSkeleton />;

  if (errorMessage) {
    return (
      <section className="rounded-md border border-destructive/40 p-4 text-sm text-destructive">
        {errorMessage}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <DataTable
        columns={triggerColumns()}
        data={rows}
        pageSize={20}
        onRowClick={(row) => {
          if (row.kind === "email") {
            setEmailDialogOpen(true);
            return;
          }
          const rawId = row.id.split(":").slice(1).join(":");
          if (row.kind === "schedule") {
            navigate({
              to: "/automations/schedules/$scheduledJobId",
              params: { scheduledJobId: rawId },
            });
          } else {
            navigate({
              to: "/automations/webhooks/$webhookId",
              params: { webhookId: rawId },
            });
          }
        }}
      />
      {tenantId ? (
        <>
          <ScheduledJobFormDialog
            open={scheduleDialogOpen}
            onOpenChange={setScheduleDialogOpen}
            mode="create"
            tenantId={tenantId}
            onSubmit={async (data) => {
              await spaceApiFetch("/api/scheduled-jobs", tenantId, {
                method: "POST",
                body: JSON.stringify({ ...data, spaceId: space.id }),
              });
              toast.success("Schedule added");
              await fetchAutomations();
            }}
          />
          <WebhookFormDialog
            open={webhookDialogOpen}
            onOpenChange={setWebhookDialogOpen}
            mode="create"
            tenantId={tenantId}
            onSubmit={async (data) => {
              await spaceApiFetch("/api/webhooks", tenantId, {
                method: "POST",
                body: JSON.stringify({ ...data, spaceId: space.id }),
              });
              toast.success("Webhook added");
              await fetchAutomations();
            }}
          />
        </>
      ) : null}
      <SpaceEmailTriggerDialog
        space={space}
        tenantSlug={tenantSlug}
        open={emailDialogOpen}
        onOpenChange={(open) => {
          if (!emailMutationFetching) setEmailDialogOpen(open);
        }}
        fetching={emailMutationFetching}
        updateEmailTrigger={updateEmailTrigger}
        refreshSpace={async () => {
          refreshSpace();
          await fetchAutomations();
        }}
      />
    </section>
  );
}

function SpaceEmailTriggerDialog({
  space,
  tenantSlug,
  open,
  onOpenChange,
  fetching,
  updateEmailTrigger,
  refreshSpace,
}: {
  space: Space;
  tenantSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fetching: boolean;
  updateEmailTrigger: (input: {
    status: Space["emailTriggerStatus"];
    emailPrefix?: string | null;
  }) => Promise<boolean>;
  refreshSpace: () => Promise<void>;
}) {
  const [prefixDraft, setPrefixDraft] = useState(space.slug);
  const [confirmAction, setConfirmAction] = useState<
    "disable" | "delete" | null
  >(null);
  const emailAddress = deriveSpaceEmailAddress(tenantSlug, space.slug);
  const normalizedPrefix = normalizeSpaceEmailPrefix(prefixDraft);
  const previewAddress = deriveSpaceEmailAddress(
    tenantSlug,
    normalizedPrefix || space.slug,
  );
  const prefixChanged =
    normalizedPrefix !== "" && normalizedPrefix !== space.slug;
  const canSavePrefix = prefixChanged && !fetching;
  const isEnabled =
    space.emailTriggerStatus === SpaceEmailTriggerStatus.Enabled;
  const nextStatus = isEnabled
    ? SpaceEmailTriggerStatus.Disabled
    : SpaceEmailTriggerStatus.Enabled;

  useEffect(() => {
    if (!open) return;
    setPrefixDraft(space.slug);
    setConfirmAction(null);
  }, [open, space.slug]);

  async function savePrefix() {
    if (!canSavePrefix) return;
    const ok = await updateEmailTrigger({
      status: space.emailTriggerStatus,
      emailPrefix: prefixDraft,
    });
    if (!ok) return;
    toast.success("Email address updated.");
    onOpenChange(false);
    await refreshSpace();
  }

  async function toggleStatus() {
    if (isEnabled) {
      setConfirmAction("disable");
      return;
    }
    const ok = await updateEmailTrigger({ status: nextStatus });
    if (!ok) return;
    toast.success("Email trigger enabled.");
    onOpenChange(false);
    await refreshSpace();
  }

  async function disableTrigger() {
    const ok = await updateEmailTrigger({
      status: SpaceEmailTriggerStatus.Disabled,
    });
    if (!ok) return;
    toast.success("Email trigger disabled.");
    onOpenChange(false);
    await refreshSpace();
  }

  async function deleteTrigger() {
    const ok = await updateEmailTrigger({
      status: SpaceEmailTriggerStatus.None,
    });
    if (!ok) return;
    toast.success("Email trigger deleted.");
    onOpenChange(false);
    await refreshSpace();
  }

  if (confirmAction) {
    const deleting = confirmAction === "delete";
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {deleting ? "Delete email trigger?" : "Disable email trigger?"}
            </DialogTitle>
            <DialogDescription>
              {deleting ? (
                <>
                  The Email row will be removed from this Space and{" "}
                  <code className="text-xs">{emailAddress}</code> will stop
                  accepting cold-contact email. The Space, source files,
                  threads, and token-bearing replies are unaffected.
                </>
              ) : (
                <>
                  The address <code className="text-xs">{emailAddress}</code>{" "}
                  will stop accepting cold-contact email. The Email row stays
                  visible and can be re-enabled later. Token-bearing replies are
                  unaffected.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmAction(null)}
              disabled={fetching}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={deleting ? "destructive" : "default"}
              onClick={() => {
                void (deleting ? deleteTrigger() : disableTrigger());
              }}
              disabled={fetching}
            >
              {fetching ? "Working..." : deleting ? "Delete" : "Disable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Email trigger</DialogTitle>
          <DialogDescription>
            <code className="text-xs">{emailAddress}</code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Status</div>
              <div className="text-sm text-muted-foreground">
                {isEnabled ? "Accepting cold-contact email" : "Paused"}
              </div>
            </div>
            <Badge
              variant="secondary"
              className={
                isEnabled
                  ? "gap-1 bg-green-500/15 text-xs text-green-600 dark:text-green-400"
                  : "gap-1 bg-muted text-xs text-muted-foreground"
              }
            >
              {isEnabled ? (
                <Play className="h-3 w-3 fill-current" />
              ) : (
                <Pause className="h-3 w-3" />
              )}
              {isEnabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="space-email-prefix">Address</Label>
            <div className="flex min-w-0 items-center gap-2">
              <Input
                id="space-email-prefix"
                value={prefixDraft}
                onChange={(event) => setPrefixDraft(event.target.value)}
                disabled={fetching}
              />
              <span className="whitespace-nowrap text-sm text-muted-foreground">
                @{tenantSlug}.thinkwork.ai
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
              <code className="min-w-0 truncate text-xs">{previewAddress}</code>
              <CopyLinkButton
                text={previewAddress}
                ariaLabel="Copy Space email address"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="justify-between sm:justify-between">
          <Button
            type="button"
            variant="destructive"
            onClick={() => setConfirmAction("delete")}
            disabled={fetching}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={toggleStatus}
              disabled={fetching}
            >
              {isEnabled ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {isEnabled ? "Disable" : "Enable"}
            </Button>
            <Button
              type="button"
              onClick={savePrefix}
              disabled={!canSavePrefix}
            >
              {fetching ? "Saving..." : "Save address"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function normalizeSpaceEmailPrefix(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
