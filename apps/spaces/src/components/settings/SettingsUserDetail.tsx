import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useMutation, useQuery } from "urql";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
} from "@thinkwork/ui";
import { WorkspaceFileEditor } from "@thinkwork/workspace-editor";
import { useTenant } from "@/context/TenantContext";
import { spacesWorkspaceFilesClient } from "@/lib/workspace-files-api";
import {
  SettingsTenantMembersQuery,
  SettingsUpdateTenantMemberMutation,
  SettingsUpdateUserMutation,
  SettingsUpdateUserProfileMutation,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

export function SettingsUserDetail() {
  const { userId: memberId } = useParams({
    from: "/_authed/settings/users/$userId",
  });
  const { tenantId, userId: callerUserId, role: callerRole } = useTenant();
  const [filesOpen, setFilesOpen] = useState(false);

  const [result, refetch] = useQuery({
    query: SettingsTenantMembersQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const member = useMemo(
    () =>
      result.data?.tenantMembers?.find(
        (m) => m.id === memberId && m.principalType.toUpperCase() === "USER",
      ),
    [result.data, memberId],
  );

  if (result.fetching && !result.data) {
    return (
      <SettingsPane>
        <SettingsHeader title="User" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </SettingsPane>
    );
  }

  if (!member || !member.user) {
    return (
      <SettingsPane>
        <BackToUsers />
        <SettingsHeader title="User not found" />
        <p className="text-sm text-muted-foreground">
          This member could not be loaded — they may have been removed.
        </p>
      </SettingsPane>
    );
  }

  const user = member.user;

  if (filesOpen) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">
            {user.name ?? user.email} · workspace
          </h1>
          <Button variant="ghost" size="sm" onClick={() => setFilesOpen(false)}>
            Done
          </Button>
        </div>
        <WorkspaceFileEditor
          target={{ userId: user.id }}
          targetKey={`user:${user.id}`}
          client={spacesWorkspaceFilesClient}
          defaultOpenFile="USER.md"
          className="min-h-0 flex-1"
        />
      </div>
    );
  }

  const isSelf = !!callerUserId && callerUserId === user.id;
  const callerIsOwner = callerRole === "owner";

  return (
    <SettingsPane>
      <BackToUsers />
      <SettingsHeader
        title={user.name ?? user.email}
        description={user.email}
      />

      <ProfileSection
        userId={user.id}
        name={user.name ?? ""}
        profile={user.profile ?? null}
        onSaved={() => refetch({ requestPolicy: "network-only" })}
        onOpenWorkspace={() => setFilesOpen(true)}
      />

      <RoleSection
        memberId={member.id}
        currentRole={member.role}
        status={member.status}
        isSelf={isSelf}
        callerIsOwner={callerIsOwner}
      />
    </SettingsPane>
  );
}

function BackToUsers() {
  return (
    <Link
      to="/settings/users"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
    >
      <ArrowLeft className="size-4" />
      Users
    </Link>
  );
}

const ROLE_OPTIONS = ["member", "admin", "owner"];

function RoleSection({
  memberId,
  currentRole,
  status,
  isSelf,
  callerIsOwner,
}: {
  memberId: string;
  currentRole: string;
  status: string;
  isSelf: boolean;
  callerIsOwner: boolean;
}) {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [state, updateMember] = useMutation(SettingsUpdateTenantMemberMutation);

  // Non-owners can't grant owner; you can't change your own role here.
  const options = ROLE_OPTIONS.filter(
    (r) => r !== "owner" || callerIsOwner || r === currentRole,
  );

  async function onRoleChange(role: string) {
    if (role === currentRole) return;
    setErrorMsg(null);
    const result = await updateMember({ id: memberId, input: { role } });
    if (result.error) setErrorMsg(result.error.message);
  }

  return (
    <SettingsSection
      label="Membership"
      action={
        state.fetching ? (
          <span className="text-sm text-muted-foreground">Saving…</span>
        ) : errorMsg ? (
          <span className="text-sm text-destructive">{errorMsg}</span>
        ) : undefined
      }
    >
      <SettingsRow
        label="Role"
        description={
          isSelf ? "You can’t change your own role here." : undefined
        }
      >
        <Select
          value={currentRole}
          onValueChange={onRoleChange}
          disabled={isSelf || state.fetching}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow label="Status">{status}</SettingsRow>
    </SettingsSection>
  );
}

type Profile = {
  title?: string | null;
  timezone?: string | null;
  notes?: string | null;
} | null;

function ProfileSection({
  userId,
  name,
  profile,
  onSaved,
  onOpenWorkspace,
}: {
  userId: string;
  name: string;
  profile: Profile;
  onSaved: () => void;
  onOpenWorkspace: () => void;
}) {
  const [form, setForm] = useState({
    name,
    title: profile?.title ?? "",
    timezone: profile?.timezone ?? "",
    notes: profile?.notes ?? "",
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [{ fetching: savingUser }, updateUser] = useMutation(
    SettingsUpdateUserMutation,
  );
  const [{ fetching: savingProfile }, updateProfile] = useMutation(
    SettingsUpdateUserProfileMutation,
  );

  // Re-sync when the underlying record changes (e.g. after refetch).
  useEffect(() => {
    setForm({
      name,
      title: profile?.title ?? "",
      timezone: profile?.timezone ?? "",
      notes: profile?.notes ?? "",
    });
  }, [name, profile]);

  const set = (k: keyof typeof form) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));
  const saving = savingUser || savingProfile;

  async function onSave() {
    setErrorMsg(null);
    setSaved(false);
    const [u, p] = await Promise.all([
      updateUser({ id: userId, input: { name: form.name } }),
      updateProfile({
        userId,
        input: {
          title: form.title,
          timezone: form.timezone,
          notes: form.notes,
        },
      }),
    ]);
    if (u.error || p.error) {
      setErrorMsg(u.error?.message ?? p.error?.message ?? "Save failed");
      return;
    }
    setSaved(true);
    onSaved();
  }

  return (
    <SettingsSection
      label="Profile"
      action={
        <button
          type="button"
          onClick={onOpenWorkspace}
          className="text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
        >
          Workspace
        </button>
      }
    >
      <div className="space-y-4 p-4">
        <Labeled label="Name">
          <Input
            value={form.name}
            onChange={(e) => set("name")(e.target.value)}
          />
        </Labeled>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Labeled label="Title">
            <Input
              value={form.title}
              onChange={(e) => set("title")(e.target.value)}
            />
          </Labeled>
          <Labeled label="Timezone">
            <Input
              value={form.timezone}
              onChange={(e) => set("timezone")(e.target.value)}
            />
          </Labeled>
        </div>
        <Labeled label="Notes">
          <Textarea
            rows={3}
            value={form.notes}
            onChange={(e) => set("notes")(e.target.value)}
          />
        </Labeled>
        <div className="flex items-center justify-end gap-3 pt-1">
          {saved ? (
            <span className="text-sm text-muted-foreground">Saved</span>
          ) : null}
          {errorMsg ? (
            <span className="text-sm text-destructive">{errorMsg}</span>
          ) : null}
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}
