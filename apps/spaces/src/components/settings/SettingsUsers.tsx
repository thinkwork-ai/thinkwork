import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQuery } from "urql";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsInviteMemberMutation,
  SettingsTenantMembersQuery,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsTablePane,
  settingsLinkActionClassName,
} from "@/components/settings/SettingsContent";

type UserRow = {
  id: string;
  name: string;
  email: string;
  initials: string;
  role: string;
  status: string;
  createdAt?: unknown;
};

function getInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?"
  );
}

function relativeTime(value: unknown): string {
  if (!value) return "—";
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function SettingsUsers() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);

  const [result, refetch] = useQuery({
    query: SettingsTenantMembersQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const rows = useMemo<UserRow[]>(() => {
    const members = result.data?.tenantMembers ?? [];
    return members
      .filter((m) => m.principalType.toUpperCase() === "USER")
      .map((m) => {
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
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [result.data]);

  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
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
          <span className="text-muted-foreground">{row.original.email}</span>
        ),
      },
      {
        accessorKey: "role",
        header: "Role",
        size: 110,
        cell: ({ row }) => (
          <Badge
            variant={row.original.role === "owner" ? "default" : "secondary"}
          >
            {row.original.role}
          </Badge>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        size: 110,
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.status}</Badge>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Joined",
        size: 130,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {relativeTime(row.original.createdAt)}
          </span>
        ),
      },
    ],
    [],
  );

  if (result.error) {
    return (
      <SettingsPane className="max-w-none">
        <SettingsHeader
          title="Users"
          description="Invite teammates and manage their roles and access."
        />
        <div className="flex items-center justify-between rounded-xl border border-border p-6">
          <span className="text-sm text-muted-foreground">
            Couldn’t load members.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch({ requestPolicy: "network-only" })}
          >
            Retry
          </Button>
        </div>
      </SettingsPane>
    );
  }

  return (
    <SettingsTablePane
      title="Users"
      description="Invite teammates and manage their roles and access."
      loading={result.fetching && !result.data}
      actions={
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className={settingsLinkActionClassName}
        >
          + Invite member
        </button>
      }
      toolbar={
        <Input
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      }
    >
      <DataTable
        columns={columns}
        data={rows}
        filterValue={search}
        scrollable
        allowHorizontalScroll={false}
        pageSize={25}
        tableClassName="table-fixed"
        onRowClick={(row) =>
          navigate({
            to: "/settings/users/$userId",
            params: { userId: row.id },
          })
        }
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            No team members yet. Invite someone to collaborate.
          </div>
        }
      />
      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        tenantId={tenantId ?? ""}
        onInvited={() => {
          refetch({ requestPolicy: "network-only" });
          setInviteOpen(false);
        }}
      />
    </SettingsTablePane>
  );
}

function InviteMemberDialog({
  open,
  onOpenChange,
  tenantId,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("member");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [state, invite] = useMutation(SettingsInviteMemberMutation);

  async function onSubmit() {
    setErrorMsg(null);
    const result = await invite({
      tenantId,
      input: { email: email.trim(), name: name.trim() || null, role },
    });
    if (result.error) {
      setErrorMsg(result.error.message);
      return;
    }
    setEmail("");
    setName("");
    setRole("member");
    onInvited();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name (optional)</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Role</label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {errorMsg ? (
            <p className="text-sm text-destructive">{errorMsg}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={state.fetching || !email.trim()}>
            {state.fetching ? "Inviting…" : "Invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
