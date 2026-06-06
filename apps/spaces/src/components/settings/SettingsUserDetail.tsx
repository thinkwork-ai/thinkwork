import { useEffect, useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { CheckIcon, CopyIcon } from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsDeleteBudgetPolicyMutation,
  SettingsUserBudgetStatusQuery,
  SettingsTenantMembersQuery,
  SettingsUpsertBudgetPolicyMutation,
  SettingsUpdateTenantMemberMutation,
  SettingsUpdateUserMutation,
  SettingsUpdateUserProfileMutation,
} from "@/lib/settings-queries";
import {
  SettingsPageTitle,
  SettingsPane,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

export function SettingsUserDetail() {
  const { userId: memberId } = useParams({
    from: "/_authed/settings/users/$userId",
  });
  const { tenantId, userId: callerUserId, role: callerRole } = useTenant();

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
  const user = member?.user ?? null;

  // Title + back navigation live in the settings header bar as nested
  // breadcrumbs (Users > <name>). Must be called unconditionally before any
  // early return.
  const displayName = user
    ? (user.name ?? user.email)
    : result.fetching
      ? "User"
      : "User not found";
  usePageHeaderActions({
    title: displayName,
    breadcrumbs: [
      { label: "Users", href: "/settings/users" },
      { label: displayName },
    ],
    subtitle: user ? (user.email ?? undefined) : undefined,
  });

  if (result.fetching && !result.data) {
    return (
      <SettingsPane>
        <div className="flex items-center justify-center py-24">
          <LoadingShimmer />
        </div>
      </SettingsPane>
    );
  }

  if (!member || !user) {
    return (
      <SettingsPane>
        <p className="text-sm text-muted-foreground">
          This member could not be loaded — they may have been removed.
        </p>
      </SettingsPane>
    );
  }

  const isSelf = !!callerUserId && callerUserId === user.id;
  const callerIsOwner = callerRole === "owner";

  return (
    <SettingsPane>
      <SettingsPageTitle
        title={displayName}
        badge={<Badge variant="secondary">{titleCase(member.status)}</Badge>}
      />
      <ProfileSection
        userId={user.id}
        name={user.name ?? ""}
        profile={user.profile ?? null}
        memberId={member.id}
        currentRole={member.role}
        tenantId={tenantId ?? ""}
        isSelf={isSelf}
        callerIsOwner={callerIsOwner}
        onSaved={() => refetch({ requestPolicy: "network-only" })}
      />
    </SettingsPane>
  );
}

const ROLE_OPTIONS = ["member", "admin", "owner"];

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
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
  memberId,
  currentRole,
  tenantId,
  isSelf,
  callerIsOwner,
  onSaved,
}: {
  userId: string;
  name: string;
  profile: Profile;
  memberId: string;
  currentRole: string;
  tenantId: string;
  isSelf: boolean;
  callerIsOwner: boolean;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name,
    title: profile?.title ?? "",
    timezone: profile?.timezone ?? "",
    notes: profile?.notes ?? "",
  });
  const [budgetForm, setBudgetForm] = useState({
    unlimited: true,
    amount: "",
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [budgetResult, refetchBudget] = useQuery({
    query: SettingsUserBudgetStatusQuery,
    variables: { tenantId, userId },
    pause: !tenantId || !userId,
  });
  const budgetStatus = budgetResult.data?.userBudgetStatus ?? null;
  const [{ fetching: savingUser }, updateUser] = useMutation(
    SettingsUpdateUserMutation,
  );
  const [{ fetching: savingProfile }, updateProfile] = useMutation(
    SettingsUpdateUserProfileMutation,
  );
  const [{ fetching: savingBudget }, upsertBudget] = useMutation(
    SettingsUpsertBudgetPolicyMutation,
  );
  const [{ fetching: deletingBudget }, deleteBudget] = useMutation(
    SettingsDeleteBudgetPolicyMutation,
  );

  // Role change auto-saves on its own mutation state, independent of the
  // profile Save button. Non-owners can't grant owner.
  const [roleState, updateMember] = useMutation(
    SettingsUpdateTenantMemberMutation,
  );
  const [roleErrorMsg, setRoleErrorMsg] = useState<string | null>(null);
  const roleOptions = ROLE_OPTIONS.filter(
    (r) => r !== "owner" || callerIsOwner || r === currentRole,
  );

  async function onRoleChange(role: string) {
    if (role === currentRole) return;
    setRoleErrorMsg(null);
    const result = await updateMember({ id: memberId, input: { role } });
    if (result.error) setRoleErrorMsg(result.error.message);
    else onSaved();
  }

  // Re-sync when the underlying record changes (e.g. after refetch).
  useEffect(() => {
    setForm({
      name,
      title: profile?.title ?? "",
      timezone: profile?.timezone ?? "",
      notes: profile?.notes ?? "",
    });
  }, [name, profile]);

  useEffect(() => {
    setBudgetForm({
      unlimited: !budgetStatus,
      amount: budgetStatus ? String(budgetStatus.policy.limitUsd) : "",
    });
  }, [budgetStatus]);

  const set = (k: keyof typeof form) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));
  const saving = savingUser || savingProfile || savingBudget || deletingBudget;

  function parseBudgetLimit(): number | null {
    const trimmed = budgetForm.amount.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }

  async function onSave() {
    setErrorMsg(null);
    setSaved(false);
    const budgetLimit = budgetForm.unlimited ? null : parseBudgetLimit();
    if (!budgetForm.unlimited && budgetLimit == null) {
      setErrorMsg("Budget must be a positive number.");
      return;
    }

    const mutations: Array<Promise<{ error?: { message?: string } }>> = [
      updateUser({ id: userId, input: { name: form.name } }),
      updateProfile({
        userId,
        input: {
          title: form.title,
          timezone: form.timezone,
          notes: form.notes,
        },
      }),
    ];
    if (budgetForm.unlimited) {
      const policyId = budgetStatus?.policy.id;
      if (policyId) mutations.push(deleteBudget({ id: policyId }));
    } else {
      const limitUsd = budgetLimit;
      if (limitUsd == null) return;
      mutations.push(
        upsertBudget({
          tenantId,
          input: {
            scope: "user",
            userId,
            agentId: null,
            limitUsd,
            period: "monthly",
            actionOnExceed: "PAUSE",
          },
        }),
      );
    }

    const results = await Promise.all(mutations);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      setErrorMsg(failed.error.message ?? "Save failed");
      return;
    }

    setSaved(true);
    refetchBudget({ requestPolicy: "network-only" });
    onSaved();
  }

  return (
    <SettingsSection label="Profile">
      <SettingsRow
        label="User ID"
        description="Unique identifier for this member."
      >
        <div className="w-72">
          <CopyableId value={userId} />
        </div>
      </SettingsRow>
      <SettingsRow
        label="Name"
        description="Display name shown across the workspace."
      >
        <Input
          className="w-72"
          value={form.name}
          onChange={(e) => set("name")(e.target.value)}
        />
      </SettingsRow>
      <SettingsRow
        label="Role"
        description="Permission level within this tenant."
      >
        {roleState.fetching ? (
          <span className="text-sm text-muted-foreground">Saving…</span>
        ) : roleErrorMsg ? (
          <span className="text-sm text-destructive">{roleErrorMsg}</span>
        ) : null}
        <Select
          value={currentRole}
          onValueChange={onRoleChange}
          disabled={isSelf || roleState.fetching}
        >
          <SelectTrigger className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roleOptions.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow
        label="Monthly budget"
        description="Monthly spend limit. Off is unlimited."
      >
        <div className="flex w-72 items-center gap-3">
          <Switch
            checked={!budgetForm.unlimited}
            onCheckedChange={(checked) =>
              setBudgetForm((f) => ({
                unlimited: !checked,
                amount: checked ? f.amount : "",
              }))
            }
            aria-label="Enable user budget"
          />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <Input
              value={budgetForm.amount}
              disabled={budgetForm.unlimited}
              inputMode="decimal"
              placeholder={budgetForm.unlimited ? "Unlimited" : "0.00"}
              aria-invalid={
                !budgetForm.unlimited && parseBudgetLimit() == null
                  ? true
                  : undefined
              }
              onChange={(e) =>
                setBudgetForm((f) => ({ ...f, amount: e.target.value }))
              }
            />
          </div>
        </div>
      </SettingsRow>
      <SettingsRow
        label="Title"
        description="Job title or role at the company."
      >
        <Input
          className="w-72"
          value={form.title}
          onChange={(e) => set("title")(e.target.value)}
        />
      </SettingsRow>
      <SettingsRow
        label="Timezone"
        description="Used to localize dates and times for this user."
      >
        <Input
          className="w-72"
          value={form.timezone}
          onChange={(e) => set("timezone")(e.target.value)}
        />
      </SettingsRow>
      <SettingsRow
        label="Notes"
        description="Freeform notes about this member, visible to operators."
      >
        <Textarea
          className="w-72"
          rows={3}
          value={form.notes}
          onChange={(e) => set("notes")(e.target.value)}
        />
      </SettingsRow>
      <div className="flex items-center justify-end gap-3 px-4 py-3.5">
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
    </SettingsSection>
  );
}

/** Read-only identifier field; click anywhere to copy the value. */
function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    if (!navigator?.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denied — leave the value visible to select manually.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      title="Click to copy"
      aria-label={`Copy user ID ${value}`}
      className="flex w-full items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-left font-mono text-xs text-muted-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <CheckIcon className="size-4 shrink-0 text-foreground" />
      ) : (
        <CopyIcon className="size-4 shrink-0 opacity-60" />
      )}
    </button>
  );
}
