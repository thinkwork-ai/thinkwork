import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQuery } from "urql";
import { SendIcon, UserPlusIcon } from "lucide-react";
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
  SettingsAddManualUserMutation,
  SettingsInviteMemberMutation,
  SettingsTenantMembersQuery,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsTablePane,
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
  const { tenantId, role: callerRole } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const callerIsOwner = callerRole === "owner";

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
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setAddOpen(true)}
          >
            <UserPlusIcon className="size-3.5" />
            Add user
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setInviteOpen(true)}
          >
            <SendIcon className="size-3.5" />
            Send invite
          </Button>
        </div>
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
            No team members yet. Add a user or send an invite.
          </div>
        }
      />
      <SetupUserDialog
        mode="add"
        open={addOpen}
        onOpenChange={setAddOpen}
        tenantId={tenantId ?? ""}
        canCreateOwner={callerIsOwner}
        onCompleted={() => {
          refetch({ requestPolicy: "network-only" });
          setAddOpen(false);
        }}
      />
      <SetupUserDialog
        mode="invite"
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        tenantId={tenantId ?? ""}
        canCreateOwner={callerIsOwner}
        onCompleted={() => {
          refetch({ requestPolicy: "network-only" });
          setInviteOpen(false);
        }}
      />
    </SettingsTablePane>
  );
}

function SetupUserDialog({
  mode,
  open,
  onOpenChange,
  tenantId,
  canCreateOwner,
  onCompleted,
}: {
  mode: "add" | "invite";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  canCreateOwner: boolean;
  onCompleted: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("member");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [addState, addManualUser] = useMutation(SettingsAddManualUserMutation);
  const [inviteState, invite] = useMutation(SettingsInviteMemberMutation);
  const isAdd = mode === "add";
  const fetching = isAdd ? addState.fetching : inviteState.fetching;

  async function onSubmit() {
    setErrorMsg(null);
    const input = {
      email: email.trim(),
      name: name.trim() || null,
      role,
      idempotencyKey: createSetupAttemptId(mode, email),
    };
    const result = isAdd
      ? await addManualUser({
          tenantId,
          input,
        })
      : await invite({
          tenantId,
          input,
        });

    if (result.error) {
      setErrorMsg(result.error.message);
      return;
    }
    setEmail("");
    setName("");
    setRole("member");
    onCompleted();
  }

  const title = isAdd ? "Add user" : "Send invite";
  const submitLabel = isAdd ? "Add user" : "Send invite";
  const submittingLabel = isAdd ? "Adding..." : "Sending...";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            {isAdd
              ? "Create tenant access without sending an invitation email."
              : "Send a ThinkWork invitation email for this tenant."}
          </p>
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
                {canCreateOwner ? (
                  <SelectItem value="owner">Owner</SelectItem>
                ) : null}
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
          <Button onClick={onSubmit} disabled={fetching || !email.trim()}>
            {fetching ? submittingLabel : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function createSetupAttemptId(mode: "add" | "invite", email: string): string {
  const normalizedEmail = email.trim().toLowerCase();
  return `${mode}-user:${normalizedEmail}:${crypto.randomUUID()}`;
}
