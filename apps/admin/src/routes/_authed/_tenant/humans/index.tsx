import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { Users, Search, Plus } from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { TenantMembersListQuery } from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";
import { InviteMemberDialog } from "@/components/humans/InviteMemberDialog";

export const Route = createFileRoute("/_authed/_tenant/humans/")({
  component: HumansPage,
});

type HumanRow = {
  id: string;
  name: string;
  email: string;
  initials: string;
  role: string;
  status: string;
  createdAt: string;
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const columns: ColumnDef<HumanRow>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <Avatar size="xs">
          <AvatarFallback>{row.original.initials}</AvatarFallback>
        </Avatar>
        <span className="font-medium">{row.original.name}</span>
      </div>
    ),
  },
  {
    accessorKey: "email",
    header: "Email",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">{row.original.email}</span>
    ),
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) => (
      <Badge
        variant={row.original.role === "owner" ? "default" : "secondary"}
        className="text-xs"
      >
        {row.original.role}
      </Badge>
    ),
    size: 100,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant="outline" className="text-xs">
        {row.original.status}
      </Badge>
    ),
    size: 100,
  },
  {
    accessorKey: "createdAt",
    header: "Joined",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {relativeTime(row.original.createdAt)}
      </span>
    ),
    size: 120,
  },
];

function HumansPage() {
  const { tenantId } = useTenant();
  const [search, setSearch] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  useBreadcrumbs([{ label: "Humans" }]);

  const [result, reexecute] = useQuery({
    query: TenantMembersListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const handleInvited = useCallback(() => {
    reexecute({ requestPolicy: "network-only" });
  }, [reexecute]);

  const allMembers = result.data?.tenantMembers ?? [];

  const rows: HumanRow[] = useMemo(() => {
    const humans = allMembers.filter(
      (m) => m.principalType.toUpperCase() === "USER",
    );
    return humans.map((m) => {
      const name = m.user?.name ?? "Unknown";
      return {
        id: m.id,
        name,
        email: m.user?.email ?? m.principalId,
        initials: getInitials(name),
        role: m.role,
        status: m.status,
        createdAt: m.createdAt,
      };
    });
  }, [allMembers]);

  if (!tenantId) return <PageSkeleton />;
  const isLoading = result.fetching && !result.data;

  return (
    <PageLayout
      header={
        <>
          <PageHeader title="Humans" />

          <div className="flex items-center gap-2 mt-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="pl-7 text-sm"
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Invite Member
            </Button>
          </div>
        </>
      }
    >
      {rows.length === 0 && !isLoading ? (
        <EmptyState
          icon={Users}
          title="No team members yet"
          description="Invite team members to collaborate with your agents."
          action={{ label: "Invite Member", onClick: () => setInviteOpen(true) }}
        />
      ) : (
        <DataTable columns={columns} data={rows} filterValue={search} />
      )}

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        tenantId={tenantId}
        onInvited={handleInvited}
      />
    </PageLayout>
  );
}
