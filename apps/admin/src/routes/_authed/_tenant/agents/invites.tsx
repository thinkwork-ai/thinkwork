import { createFileRoute } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { useState, useCallback, useEffect } from "react";
import {
  Link2,
  Plus,
  Copy,
  Check,
  Trash2,
  Loader2,
  UserPlus,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { DataTable } from "@/components/ui/data-table";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { useAuth } from "@/context/AuthContext";
import { relativeTime } from "@/lib/utils";

const API_URL = import.meta.env.VITE_API_URL || "";
const API_AUTH_SECRET = import.meta.env.VITE_API_AUTH_SECRET || "";

export const Route = createFileRoute("/_authed/_tenant/agents/invites")({
  component: InvitesPage,
});

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type InviteRow = {
  id: string;
  inviteType: string;
  agentName: string | null;
  usedCount: number;
  maxUses: number;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
};

type JoinRequestRow = {
  id: string;
  agentName: string;
  adapterType: string | null;
  status: string;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

async function apiFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(API_AUTH_SECRET ? { Authorization: `Bearer ${API_AUTH_SECRET}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function InvitesPage() {
  const { tenantId } = useTenant();
  const { user } = useAuth();
  useBreadcrumbs([
    { label: "Agents", href: "/agents" },
    { label: "BYOB Registration" },
  ]);

  const [invitesList, setInvitesList] = useState<InviteRow[]>([]);
  const [joinRequestsList, setJoinRequestsList] = useState<JoinRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<{
    token: string;
    agentName: string;
    onboardingUrl: string;
  } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [actioningRequestId, setActioningRequestId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!tenantId) return;
    try {
      const [invitesData, jrData] = await Promise.all([
        apiFetch(`/api/invites?tenantId=${tenantId}`),
        apiFetch(`/api/tenants/${tenantId}/join-requests`),
      ]);
      setInvitesList(
        (invitesData as any[]).map((i: any) => ({
          id: i.id,
          inviteType: i.inviteType,
          agentName: i.agentName ?? null,
          usedCount: i.usedCount,
          maxUses: i.maxUses,
          createdAt: i.createdAt,
          expiresAt: i.expiresAt,
          expired: i.expired ?? new Date(i.expiresAt) <= new Date(),
        })),
      );
      setJoinRequestsList(
        (jrData as any[]).map((r: any) => ({
          id: r.id,
          agentName: r.agentName ?? "Unknown Agent",
          adapterType: r.adapterType ?? null,
          status: r.status,
          createdAt: r.createdAt,
        })),
      );
    } catch (err) {
      console.error("Failed to fetch invites data:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!tenantId || loading) return <PageSkeleton />;

  const activeInvites = invitesList.filter(
    (i) => !i.expired,
  );
  const pendingRequests = joinRequestsList.filter(
    (r) => r.status === "pending_approval",
  );

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    try {
      await apiFetch(`/api/invites/${id}`, { method: "DELETE" });
      await fetchData();
    } finally {
      setRevokingId(null);
    }
  };

  const handleApprove = async (id: string) => {
    setActioningRequestId(id);
    try {
      await apiFetch(`/api/tenants/${tenantId}/join-requests/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ userId: user?.sub }),
      });
      await fetchData();
    } finally {
      setActioningRequestId(null);
    }
  };

  const handleReject = async (id: string) => {
    setActioningRequestId(id);
    try {
      await apiFetch(`/api/tenants/${tenantId}/join-requests/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ userId: user?.sub }),
      });
      await fetchData();
    } finally {
      setActioningRequestId(null);
    }
  };

  const inviteColumns: ColumnDef<InviteRow>[] = [
    {
      accessorKey: "agentName",
      header: "Agent",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium">
            {row.original.agentName ?? row.original.inviteType}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "usedCount",
      header: "Usage",
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">
          {row.original.usedCount}/{row.original.maxUses} used
        </Badge>
      ),
      size: 100,
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {relativeTime(row.original.createdAt)}
        </span>
      ),
      size: 120,
    },
    {
      accessorKey: "expiresAt",
      header: "Expires",
      cell: ({ row }) => (
        <span
          className={`text-xs ${row.original.expired ? "text-destructive" : "text-muted-foreground"}`}
        >
          {row.original.expired
            ? "expired"
            : relativeTime(row.original.expiresAt)}
        </span>
      ),
      size: 120,
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-destructive"
            disabled={revokingId === row.original.id}
            onClick={async (e) => {
              e.stopPropagation();
              handleRevoke(row.original.id);
            }}
          >
            {revokingId === row.original.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      ),
      size: 50,
    },
  ];

  const requestColumns: ColumnDef<JoinRequestRow>[] = [
    {
      accessorKey: "agentName",
      header: "Agent",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.agentName}</span>
      ),
    },
    {
      accessorKey: "adapterType",
      header: "Adapter",
      cell: ({ row }) =>
        row.original.adapterType ? (
          <Badge variant="outline" className="text-xs">
            {row.original.adapterType}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        ),
      size: 100,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status.toLowerCase().replace(/_/g, " ")}
          size="sm"
        />
      ),
      size: 140,
    },
    {
      accessorKey: "createdAt",
      header: "Requested",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {relativeTime(row.original.createdAt)}
        </span>
      ),
      size: 120,
    },
    {
      id: "actions",
      cell: ({ row }) => {
        if (row.original.status !== "pending_approval") return null;
        return (
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              disabled={actioningRequestId === row.original.id}
              onClick={async (e) => {
                e.stopPropagation();
                handleReject(row.original.id);
              }}
            >
              {actioningRequestId === row.original.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Reject"
              )}
            </Button>
            <Button
              size="sm"
              disabled={actioningRequestId === row.original.id}
              onClick={async (e) => {
                e.stopPropagation();
                handleApprove(row.original.id);
              }}
            >
              {actioningRequestId === row.original.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Approve"
              )}
            </Button>
          </div>
        );
      },
      size: 160,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="BYOB Registration"
        description="Invite external agents to join your workspace"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Invite Agent
          </Button>
        }
      />

      <Tabs defaultValue="invites">
        <TabsList>
          <TabsTrigger value="invites">
            Invites ({activeInvites.length})
          </TabsTrigger>
          <TabsTrigger value="requests">
            Join Requests{" "}
            {pendingRequests.length > 0 && (
              <Badge variant="default" className="ml-1.5 text-[10px] px-1.5">
                {pendingRequests.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invites" className="mt-4">
          {activeInvites.length === 0 ? (
            <EmptyState
              icon={Link2}
              title="No active invites"
              description="Create an invite link to allow external agents to register."
              action={{
                label: "Create Invite",
                onClick: () => setCreateOpen(true),
              }}
            />
          ) : (
            <DataTable
              columns={inviteColumns}
              data={activeInvites}
            />
          )}
        </TabsContent>

        <TabsContent value="requests" className="mt-4">
          {joinRequestsList.length === 0 ? (
            <EmptyState
              icon={UserPlus}
              title="No join requests"
              description="When external agents use your invite links, their requests will appear here."
            />
          ) : (
            <DataTable
              columns={requestColumns}
              data={joinRequestsList}
            />
          )}
        </TabsContent>
      </Tabs>

      <CreateInviteDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        tenantId={tenantId!}
        onCreated={(result) => {
          setCreatedInvite(result);
          fetchData();
        }}
      />

      {createdInvite && (
        <TokenRevealDialog
          token={createdInvite.token}
          agentName={createdInvite.agentName}
          onboardingUrl={createdInvite.onboardingUrl}
          onClose={() => setCreatedInvite(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Invite Dialog
// ---------------------------------------------------------------------------

const createInviteSchema = z.object({
  agentName: z.string().min(1, "Agent name is required"),
});

type CreateInviteValues = z.infer<typeof createInviteSchema>;

function CreateInviteDialog({
  open,
  onClose,
  tenantId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  onCreated: (result: {
    token: string;
    agentName: string;
    onboardingUrl: string;
  }) => void;
}) {
  const [creating, setCreating] = useState(false);

  const form = useForm<CreateInviteValues>({
    resolver: zodResolver(createInviteSchema),
    defaultValues: { agentName: "" },
  });

  const handleSubmit = useCallback(
    async (values: CreateInviteValues) => {
      setCreating(true);
      try {
        const result = await apiFetch(`/api/tenants/${tenantId}/invites`, {
          method: "POST",
          body: JSON.stringify({ agentName: values.agentName.trim() }),
        });
        onCreated({
          token: result.token,
          agentName: values.agentName.trim(),
          onboardingUrl: result.onboardingUrl,
        });
        onClose();
        form.reset();
      } catch (err) {
        console.error("Failed to create invite:", err);
      } finally {
        setCreating(false);
      }
    },
    [tenantId, onCreated, onClose, form],
  );

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite External Agent</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4 py-2"
          >
            <p className="text-sm text-muted-foreground">
              Create a short-lived invite token for an external agent. The token
              expires in 10 minutes.
            </p>
            <FormField
              control={form.control}
              name="agentName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-muted-foreground">
                    Agent Name
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. OpenClaw Production"
                      autoFocus
                      className="text-sm"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Create Invite"
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
// Token Reveal Dialog
// ---------------------------------------------------------------------------

function TokenRevealDialog({
  token,
  agentName,
  onboardingUrl,
  onClose,
}: {
  token: string;
  agentName: string;
  onboardingUrl: string;
  onClose: () => void;
}) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const inviteLink = `${window.location.origin}/invite/${token}`;

  const copyText = (text: string, setter: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite for {agentName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Share this link with the agent operator. Expires in{" "}
            <strong>10 minutes</strong>.
          </p>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Invite Link
            </Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-muted p-3 text-xs font-mono break-all">
                {inviteLink}
              </code>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => copyText(inviteLink, setCopiedLink)}
              >
                {copiedLink ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">
              Advanced: raw token & API onboarding URL
            </summary>
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted p-2 text-xs font-mono break-all">
                  {token}
                </code>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => copyText(token, setCopiedToken)}
                >
                  {copiedToken ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted p-2 text-xs font-mono break-all">
                  {onboardingUrl}
                </code>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => copyText(onboardingUrl, setCopiedUrl)}
                >
                  {copiedUrl ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          </details>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
