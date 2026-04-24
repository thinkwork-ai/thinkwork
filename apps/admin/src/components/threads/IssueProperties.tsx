import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { graphql } from "@/gql";
import { useMutation, useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { StatusIcon } from "./StatusIcon";
import { Identity } from "@/components/Identity";
import { cn, formatDateTime, relativeTime } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { User, ArrowUpRight, Tag, Plus, Trash2, Calendar } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ThreadLabel {
  id: string;
  name: string;
  color: string | null;
}

interface ThreadLabelAssignment {
  id: string;
  labelId: string;
  label: ThreadLabel | null;
}

interface Agent {
  id: string;
  name: string;
  status: string;
  avatarUrl: string | null;
}

interface Thread {
  id: string;
  tenantId: string;
  status: string;
  assigneeType: string | null;
  assigneeId: string | null;
  agentId: string | null;
  agent: Agent | null;
  parentId: string | null;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdByType: string | null;
  createdById: string | null;
  reporter: { id: string; name: string | null; email: string } | null;
  createdAt: string;
  updatedAt: string;
  labelAssignments?: ThreadLabelAssignment[];
}

// ---------------------------------------------------------------------------
// Queries & Mutations
// ---------------------------------------------------------------------------

const AgentsForPickerQuery = graphql(`
  query AgentsForPicker($tenantId: ID!) {
    agents: allTenantAgents(tenantId: $tenantId) {
      id
      name
      status
      avatarUrl
    }
  }
`);

const TenantLabelsQuery = graphql(`
  query TenantLabelsForProperties($tenantId: ID!) {
    threadLabels(tenantId: $tenantId) {
      id
      name
      color
    }
  }
`);

const CreateThreadLabelMutation = graphql(`
  mutation CreateThreadLabelFromProperties($input: CreateThreadLabelInput!) {
    createThreadLabel(input: $input) {
      id
      name
      color
    }
  }
`);

const DeleteThreadLabelMutation = graphql(`
  mutation DeleteThreadLabelFromProperties($id: ID!) {
    deleteThreadLabel(id: $id)
  }
`);

const AssignThreadLabelMutation = graphql(`
  mutation AssignThreadLabelFromProperties($threadId: ID!, $labelId: ID!) {
    assignThreadLabel(threadId: $threadId, labelId: $labelId) {
      id
      labelId
    }
  }
`);

const RemoveThreadLabelMutation = graphql(`
  mutation RemoveThreadLabelFromProperties($threadId: ID!, $labelId: ID!) {
    removeThreadLabel(threadId: $threadId, labelId: $labelId)
  }
`);

const UpdateThreadMutation = graphql(`
  mutation UpdateThreadFromProperties($id: ID!, $input: UpdateThreadInput!) {
    updateThread(id: $id, input: $input) {
      id
      status
      assigneeType
      assigneeId
      dueAt
      updatedAt
    }
  }
`);

// ---------------------------------------------------------------------------
// Recent-assignee helpers (local-storage based)
// ---------------------------------------------------------------------------

const RECENT_KEY = "thinkwork:recent-assignees";
const MAX_RECENT = 5;

function getRecentAssigneeIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function trackRecentAssignee(id: string) {
  const ids = getRecentAssigneeIds().filter((x) => x !== id);
  ids.unshift(id);
  localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)));
}

function sortAgentsByRecency(agents: Agent[], recentIds: string[]): Agent[] {
  const order = new Map(recentIds.map((id, i) => [id, i]));
  return [...agents].sort((a, b) => {
    const oa = order.get(a.id) ?? Infinity;
    const ob = order.get(b.id) ?? Infinity;
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-xs text-muted-foreground shrink-0 w-20">
        {label}
      </span>
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {children}
      </div>
    </div>
  );
}

function PropertyPicker({
  inline,
  label,
  open,
  onOpenChange,
  triggerContent,
  triggerClassName,
  popoverClassName,
  popoverAlign = "end",
  extra,
  children,
}: {
  inline?: boolean;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerContent: React.ReactNode;
  triggerClassName?: string;
  popoverClassName?: string;
  popoverAlign?: "start" | "center" | "end";
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const btnCn = cn(
    "inline-flex items-center gap-1.5 cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1 py-0.5 transition-colors",
    triggerClassName,
  );

  if (inline) {
    return (
      <div>
        <PropertyRow label={label}>
          <button className={btnCn} onClick={() => onOpenChange(!open)}>
            {triggerContent}
          </button>
          {extra}
        </PropertyRow>
        {open && (
          <div
            className={cn(
              "rounded-md border border-border bg-popover p-1 mb-2",
              popoverClassName,
            )}
          >
            {children}
          </div>
        )}
      </div>
    );
  }

  return (
    <PropertyRow label={label}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button className={btnCn}>{triggerContent}</button>
        </PopoverTrigger>
        <PopoverContent
          className={cn("p-1", popoverClassName)}
          align={popoverAlign}
          collisionPadding={16}
        >
          {children}
        </PopoverContent>
      </Popover>
      {extra}
    </PropertyRow>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface IssuePropertiesProps {
  thread: Thread;
  /** Called after any mutation succeeds so the parent can reexecute its query. */
  onUpdate?: () => void;
  /** When true, pickers render inline instead of in popovers (mobile). */
  inline?: boolean;
}

export function IssueProperties({
  thread,
  onUpdate,
  inline,
}: IssuePropertiesProps) {
  const { tenantId } = useTenant();
  const effectiveTenantId = thread.tenantId ?? tenantId;

  // -- State -----------------------------------------------------------------
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [labelSearch, setLabelSearch] = useState("");
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#6366f1");
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [dueDateValue, setDueDateValue] = useState(
    thread.dueAt ? thread.dueAt.slice(0, 10) : "",
  );

  // -- Queries ---------------------------------------------------------------
  const [agentsResult] = useQuery({
    query: AgentsForPickerQuery,
    variables: { tenantId: effectiveTenantId! },
    pause: !effectiveTenantId,
  });
  const agents: Agent[] = (agentsResult.data?.agents ?? []) as Agent[];

  const [labelsResult, reexecuteLabels] = useQuery({
    query: TenantLabelsQuery,
    variables: { tenantId: effectiveTenantId! },
    pause: !effectiveTenantId,
  });
  const tenantLabels: ThreadLabel[] = (labelsResult.data?.threadLabels ??
    []) as ThreadLabel[];

  // -- Mutations -------------------------------------------------------------
  const [, updateThread] = useMutation(UpdateThreadMutation);
  const [, createLabelMut] = useMutation(CreateThreadLabelMutation);
  const [, deleteLabelMut] = useMutation(DeleteThreadLabelMutation);
  const [, assignLabelMut] = useMutation(AssignThreadLabelMutation);
  const [, removeLabelMut] = useMutation(RemoveThreadLabelMutation);

  // -- Helpers ---------------------------------------------------------------
  const doUpdate = async (input: Record<string, unknown>) => {
    await updateThread({
      id: thread.id,
      input: input as any,
    });
    onUpdate?.();
  };

  const handleStatusChange = (status: string) => {
    doUpdate({ status: status.toUpperCase() });
  };

  const currentLabelIds = new Set(
    (thread.labelAssignments ?? []).map((la) => la.labelId),
  );
  const currentLabels = (thread.labelAssignments ?? [])
    .map((la) => la.label)
    .filter(Boolean) as ThreadLabel[];

  const toggleLabel = async (labelId: string) => {
    if (currentLabelIds.has(labelId)) {
      await removeLabelMut({ threadId: thread.id, labelId });
    } else {
      await assignLabelMut({ threadId: thread.id, labelId });
    }
    onUpdate?.();
  };

  const handleCreateLabel = async () => {
    const name = newLabelName.trim();
    if (!name || !effectiveTenantId) return;
    const result = await createLabelMut({
      input: { tenantId: effectiveTenantId, name, color: newLabelColor },
    });
    if (result.data?.createThreadLabel) {
      await assignLabelMut({
        threadId: thread.id,
        labelId: result.data.createThreadLabel.id,
      });
      reexecuteLabels({ requestPolicy: "network-only" });
      onUpdate?.();
    }
    setNewLabelName("");
  };

  const handleDeleteLabel = async (labelId: string) => {
    await deleteLabelMut({ id: labelId });
    reexecuteLabels({ requestPolicy: "network-only" });
    onUpdate?.();
  };

  const handleDueDateSave = () => {
    doUpdate({ dueAt: dueDateValue || null });
    setDueDateOpen(false);
  };

  // -- Agent helpers ---------------------------------------------------------
  const recentAssigneeIds = useMemo(
    () => getRecentAssigneeIds(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assigneeOpen],
  );
  const sortedAgents = useMemo(
    () =>
      sortAgentsByRecency(
        agents.filter((a) => a.status !== "terminated"),
        recentAssigneeIds,
      ),
    [agents, recentAssigneeIds],
  );

  const assignedAgent = thread.assigneeType === "AGENT" && thread.assigneeId
    ? agents.find((a) => a.id === thread.assigneeId) ?? thread.agent
    : thread.agent;

  // -- Normalized status for display -----------------------------------------
  const statusLower = thread.status.toLowerCase();

  // -- Trigger renderers -----------------------------------------------------

  const labelsTrigger =
    currentLabels.length > 0 ? (
      <div className="flex items-center gap-1 flex-wrap">
        {currentLabels.slice(0, 3).map((label) => (
          <span
            key={label.id}
            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border"
            style={{
              borderColor: label.color ?? "#6366f1",
              backgroundColor: `${label.color ?? "#6366f1"}22`,
              color: label.color ?? "#6366f1",
            }}
          >
            {label.name}
          </span>
        ))}
        {currentLabels.length > 3 && (
          <span className="text-xs text-muted-foreground">
            +{currentLabels.length - 3}
          </span>
        )}
      </div>
    ) : (
      <>
        <Tag className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">No labels</span>
      </>
    );

  const labelsContent = (
    <>
      <input
        className="w-full px-2 py-1.5 text-xs bg-transparent outline-none border-b border-border mb-1 placeholder:text-muted-foreground/50"
        placeholder="Search labels..."
        value={labelSearch}
        onChange={(e) => setLabelSearch(e.target.value)}
        autoFocus={!inline}
      />
      <div className="max-h-44 overflow-y-auto overscroll-contain space-y-0.5">
        {tenantLabels
          .filter((label) => {
            if (!labelSearch.trim()) return true;
            return label.name
              .toLowerCase()
              .includes(labelSearch.toLowerCase());
          })
          .map((label) => {
            const selected = currentLabelIds.has(label.id);
            return (
              <div key={label.id} className="flex items-center gap-1">
                <button
                  className={cn(
                    "flex items-center gap-2 flex-1 px-2 py-1.5 text-xs rounded hover:bg-accent/50 text-left",
                    selected && "bg-accent",
                  )}
                  onClick={() => toggleLabel(label.id)}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: label.color ?? "#6366f1",
                    }}
                  />
                  <span className="truncate">{label.name}</span>
                </button>
                <button
                  type="button"
                  className="p-1 text-muted-foreground hover:text-destructive rounded"
                  onClick={() => handleDeleteLabel(label.id)}
                  title={`Delete ${label.name}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
      </div>
      <div className="mt-2 border-t border-border pt-2 space-y-1">
        <div className="flex items-center gap-1">
          <input
            className="h-7 w-7 p-0 rounded bg-transparent"
            type="color"
            value={newLabelColor}
            onChange={(e) => setNewLabelColor(e.target.value)}
          />
          <input
            className="flex-1 px-2 py-1.5 text-xs bg-transparent outline-none rounded placeholder:text-muted-foreground/50"
            placeholder="New label"
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
          />
        </div>
        <button
          className="flex items-center justify-center gap-1.5 w-full px-2 py-1.5 text-xs rounded border border-border hover:bg-accent/50 disabled:opacity-50"
          disabled={!newLabelName.trim()}
          onClick={handleCreateLabel}
        >
          <Plus className="h-3 w-3" />
          Create label
        </button>
      </div>
    </>
  );

  const assigneeTrigger = assignedAgent ? (
    <Identity name={assignedAgent.name} size="sm" />
  ) : (
    <>
      <User className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-sm text-muted-foreground">Unassigned</span>
    </>
  );

  const assigneeContent = (
    <>
      <input
        className="w-full px-2 py-1.5 text-xs bg-transparent outline-none border-b border-border mb-1 placeholder:text-muted-foreground/50"
        placeholder="Search agents..."
        value={assigneeSearch}
        onChange={(e) => setAssigneeSearch(e.target.value)}
        autoFocus={!inline}
      />
      <div className="max-h-48 overflow-y-auto overscroll-contain">
        <button
          className={cn(
            "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
            !thread.assigneeId && "bg-accent",
          )}
          onClick={() => {
            doUpdate({ assigneeType: null, assigneeId: null });
            setAssigneeOpen(false);
          }}
        >
          No assignee
        </button>
        {sortedAgents
          .filter((a) => {
            if (!assigneeSearch.trim()) return true;
            return a.name
              .toLowerCase()
              .includes(assigneeSearch.toLowerCase());
          })
          .map((a) => (
            <button
              key={a.id}
              className={cn(
                "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
                a.id === thread.assigneeId && "bg-accent",
              )}
              onClick={() => {
                trackRecentAssignee(a.id);
                doUpdate({
                  assigneeType: "AGENT",
                  assigneeId: a.id,
                });
                setAssigneeOpen(false);
              }}
            >
              <Identity name={a.name} size="sm" />
            </button>
          ))}
      </div>
    </>
  );

  const dueDateTrigger = thread.dueAt ? (
    <>
      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-sm">{formatDateTime(thread.dueAt)}</span>
    </>
  ) : (
    <>
      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-sm text-muted-foreground">No due date</span>
    </>
  );

  const dueDateContent = (
    <div className="p-2 space-y-2">
      <input
        type="date"
        className="w-full px-2 py-1.5 text-xs bg-transparent outline-none border border-border rounded"
        value={dueDateValue}
        onChange={(e) => setDueDateValue(e.target.value)}
        autoFocus
      />
      <div className="flex items-center gap-1">
        <button
          className="flex-1 px-2 py-1.5 text-xs rounded border border-border hover:bg-accent/50"
          onClick={handleDueDateSave}
        >
          Save
        </button>
        {thread.dueAt && (
          <button
            className="px-2 py-1.5 text-xs rounded border border-border hover:bg-accent/50 text-muted-foreground"
            onClick={() => {
              setDueDateValue("");
              doUpdate({ dueAt: null });
              setDueDateOpen(false);
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );

  // -- Render ----------------------------------------------------------------

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        {/* Status */}
        <PropertyRow label="Status">
          <StatusIcon
            status={statusLower}
            onChange={handleStatusChange}
            showLabel
          />
        </PropertyRow>

        {/* Labels */}
        <PropertyPicker
          inline={inline}
          label="Labels"
          open={labelsOpen}
          onOpenChange={(open) => {
            setLabelsOpen(open);
            if (!open) setLabelSearch("");
          }}
          triggerContent={labelsTrigger}
          triggerClassName="min-w-0 max-w-full"
          popoverClassName="w-64"
        >
          {labelsContent}
        </PropertyPicker>

        {/* Assignee */}
        <PropertyPicker
          inline={inline}
          label="Assignee"
          open={assigneeOpen}
          onOpenChange={(open) => {
            setAssigneeOpen(open);
            if (!open) setAssigneeSearch("");
          }}
          triggerContent={assigneeTrigger}
          popoverClassName="w-52"
          extra={
            assignedAgent ? (
              <Link
                to="/agents/$agentId"
                params={{ agentId: assignedAgent.id }}
                className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            ) : undefined
          }
        >
          {assigneeContent}
        </PropertyPicker>

        {/* Due date */}
        <PropertyPicker
          inline={inline}
          label="Due date"
          open={dueDateOpen}
          onOpenChange={setDueDateOpen}
          triggerContent={dueDateTrigger}
          popoverClassName="w-56"
        >
          {dueDateContent}
        </PropertyPicker>

      </div>

      <Separator />

      {/* Timestamps & meta */}
      <div className="space-y-1">
        {thread.reporter && (
          <PropertyRow label="Reporter">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm">
              {thread.reporter.name ?? thread.reporter.email}
            </span>
          </PropertyRow>
        )}
        {thread.createdByType === "AGENT" && thread.agent && (
          <PropertyRow label="Created by">
            <Link
              to="/agents/$agentId"
              params={{ agentId: thread.agent.id }}
              className="hover:underline"
            >
              <Identity name={thread.agent.name} size="sm" />
            </Link>
          </PropertyRow>
        )}
        {thread.startedAt && (
          <PropertyRow label="Started">
            <span className="text-sm">{formatDateTime(thread.startedAt)}</span>
          </PropertyRow>
        )}
        {thread.completedAt && (
          <PropertyRow label="Completed">
            <span className="text-sm">
              {formatDateTime(thread.completedAt)}
            </span>
          </PropertyRow>
        )}
        {thread.cancelledAt && (
          <PropertyRow label="Cancelled">
            <span className="text-sm">
              {formatDateTime(thread.cancelledAt)}
            </span>
          </PropertyRow>
        )}
        <PropertyRow label="Created">
          <span className="text-sm">{formatDateTime(thread.createdAt)}</span>
        </PropertyRow>
        <PropertyRow label="Updated">
          <span className="text-sm">{relativeTime(thread.updatedAt)}</span>
        </PropertyRow>
      </div>
    </div>
  );
}
