import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import {
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  MailIcon,
  Trash2Icon,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { AccountUsageSection } from "@/components/profile/AccountUsageSection";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsDeleteBudgetPolicyMutation,
  SettingsRemoveTenantMemberMutation,
  SettingsResendMemberInviteMutation,
  SettingsSetTenantMemberPasswordMutation,
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
import { UserModelsSection } from "@/components/settings/UserModelsSection";
import { ScopedWorkspaceEditor } from "@/components/workspace-settings/ScopedWorkspaceEditor";

export function SettingsUserDetail() {
  const { userId: memberId } = useParams({
    from: "/_authed/settings/users/$userId",
  });
  const navigate = useNavigate();
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
  const canResendInvite =
    member.cognitoStatus != null &&
    RESENDABLE_INVITE_STATUSES.has(member.cognitoStatus);

  return (
    <SettingsPane>
      <SettingsPageTitle
        title={displayName}
        badge={<Badge variant="secondary">{titleCase(member.status)}</Badge>}
        actions={
          <div className="flex flex-wrap items-start justify-end gap-2">
            {canResendInvite ? (
              <ResendInviteButton
                tenantId={tenantId ?? ""}
                memberId={member.id}
              />
            ) : null}
          </div>
        }
      />
      <AccountUsageSection tenantId={tenantId ?? ""} userId={user.id} />
      <ProfileSection
        userId={user.id}
        name={user.name ?? ""}
        profile={user.profile ?? null}
        memberId={member.id}
        currentRole={member.role}
        tenantId={tenantId ?? ""}
        isSelf={isSelf}
        callerIsOwner={callerIsOwner}
        passwordAction={
          !isSelf ? (
            <SetPasswordButton
              tenantId={tenantId ?? ""}
              memberId={member.id}
              email={user.email ?? displayName}
            />
          ) : null
        }
        onSaved={() => refetch({ requestPolicy: "network-only" })}
      />
      <UserModelsSection userId={user.id} />
      <UserWorkspaceSection userId={user.id} />
      <DangerSection
        displayName={displayName}
        memberId={member.id}
        isSelf={isSelf}
        onDeleted={() => {
          void navigate({ to: "/settings/users" });
        }}
      />
    </SettingsPane>
  );
}

/**
 * Embedded file editor over this user's workspace source. The client targets
 * `{ userId }` directly, so edits land under the user's own source tree —
 * never the consolidated multi-source view. Replaces the User/ slice of the
 * retired Settings → Workspace page.
 */
function UserWorkspaceSection({ userId }: { userId: string }) {
  return (
    <SettingsSection label="Workspace files">
      <div className="h-[28rem]">
        <ScopedWorkspaceEditor
          target={{ userId }}
          targetKey={`user:${userId}`}
          defaultOpenFile="USER.md"
          bordered={false}
          className="h-full"
        />
      </div>
    </SettingsSection>
  );
}

const ROLE_OPTIONS = ["member", "admin", "owner"];
const RESENDABLE_INVITE_STATUSES = new Set([
  "FORCE_CHANGE_PASSWORD",
  "UNCONFIRMED",
]);

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function formatBudgetLimit(limitUsd: number | null | undefined): string {
  if (limitUsd == null || !Number.isFinite(limitUsd)) {
    return "Unlimited";
  }

  return `${new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    style: "currency",
  }).format(limitUsd)} / month`;
}

function SetPasswordButton({
  tenantId,
  memberId,
  email,
}: {
  tenantId: string;
  memberId: string;
  email: string;
}) {
  const [{ fetching }, setTenantMemberPassword] = useMutation(
    SettingsSetTenantMemberPasswordMutation,
  );
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [requireChange, setRequireChange] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPassword("");
      setConfirmPassword("");
      setRequireChange(false);
      setErrorMsg(null);
    }
  }, [open]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setMessage(null);
    setErrorMsg(null);

    if (password.length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await setTenantMemberPassword({
        tenantId,
        input: {
          memberId,
          password,
          permanent: !requireChange,
        },
      });
      if (result.error) {
        setErrorMsg(result.error.message);
        return;
      }

      setMessage(
        result.data?.setTenantMemberPassword.message ?? "Password set.",
      );
      setOpen(false);
    } catch (error) {
      setErrorMsg(
        error instanceof Error ? error.message : "Password update failed.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const disabled = fetching || isSubmitting || !tenantId || !memberId;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <KeyRoundIcon className="size-3.5" />
        Set password
      </Button>
      {message ? (
        <span className="text-xs text-muted-foreground">{message}</span>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={(event) => void onSubmit(event)}>
            <DialogHeader>
              <DialogTitle>Set password</DialogTitle>
              <DialogDescription>
                Manually set a password for {email}. No invite email is sent.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <label className="grid gap-2 text-sm font-medium">
                New password
                <Input
                  autoComplete="new-password"
                  minLength={8}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Confirm password
                <Input
                  autoComplete="new-password"
                  minLength={8}
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>
              <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    Require change on next sign-in
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Set a temporary password instead of a permanent one.
                  </p>
                </div>
                <Switch
                  checked={requireChange}
                  aria-label="Require change on next sign-in"
                  onCheckedChange={setRequireChange}
                />
              </div>
              {errorMsg ? (
                <p className="text-sm text-destructive">{errorMsg}</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={disabled}>
                {fetching || isSubmitting ? "Setting..." : "Set password"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResendInviteButton({
  tenantId,
  memberId,
}: {
  tenantId: string;
  memberId: string;
}) {
  const [{ fetching }, resendMemberInvite] = useMutation(
    SettingsResendMemberInviteMutation,
  );
  const inFlightRef = useRef(false);
  const [isResendInFlight, setIsResendInFlight] = useState(false);
  const [notPending, setNotPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    inFlightRef.current = false;
    setIsResendInFlight(false);
    setNotPending(false);
    setMessage(null);
    setErrorMsg(null);
  }, [memberId]);

  async function onResendInvite() {
    if (!tenantId || !memberId || inFlightRef.current || notPending) return;
    inFlightRef.current = true;
    setIsResendInFlight(true);
    setMessage(null);
    setErrorMsg(null);
    try {
      const result = await resendMemberInvite({
        tenantId,
        input: {
          memberId,
          idempotencyKey: createResendInviteIdempotencyKey(memberId),
        },
      });
      if (result.error) {
        setErrorMsg(result.error.message);
        return;
      }
      const resend = result.data?.resendMemberInvite;
      if (resend?.status === "RESENT") {
        setMessage("Invite resent");
        return;
      }
      if (resend?.status === "NOT_PENDING") {
        setNotPending(true);
      }
      setErrorMsg(resend?.message ?? "Invite resend did not complete.");
    } finally {
      inFlightRef.current = false;
      setIsResendInFlight(false);
    }
  }

  const disabled =
    fetching || isResendInFlight || notPending || !tenantId || !memberId;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={disabled}
        onClick={() => void onResendInvite()}
      >
        <MailIcon className="size-3.5" />
        {fetching || isResendInFlight ? "Sending..." : "Resend invite"}
      </Button>
      {message ? (
        <span className="text-xs text-muted-foreground">{message}</span>
      ) : errorMsg ? (
        <span className="max-w-72 text-right text-xs text-destructive">
          {errorMsg}
        </span>
      ) : null}
    </div>
  );
}

function createResendInviteIdempotencyKey(memberId: string): string {
  return `resend-member-invite:${memberId}:${crypto.randomUUID()}`;
}

export type Profile = {
  title?: string | null;
  timezone?: string | null;
  pronouns?: string | null;
  callBy?: string | null;
  notes?: string | null;
} | null;

export function ProfileSection({
  userId,
  name,
  profile,
  memberId,
  currentRole,
  tenantId,
  isSelf,
  callerIsOwner,
  passwordAction,
  roleReadOnly = false,
  budgetReadOnly = false,
  onSaved,
}: {
  userId: string;
  name: string;
  profile: Profile;
  memberId?: string;
  currentRole: string;
  tenantId: string;
  isSelf: boolean;
  callerIsOwner: boolean;
  passwordAction?: ReactNode;
  roleReadOnly?: boolean;
  budgetReadOnly?: boolean;
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
    if (roleReadOnly || !memberId || role === currentRole) return;
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
  const saving =
    savingUser ||
    savingProfile ||
    (!budgetReadOnly && (savingBudget || deletingBudget));

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
    if (!budgetReadOnly && !budgetForm.unlimited && budgetLimit == null) {
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
    if (!budgetReadOnly) {
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
    }

    const results = await Promise.all(mutations);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      setErrorMsg(failed.error.message ?? "Save failed");
      return;
    }

    setSaved(true);
    if (!budgetReadOnly) {
      refetchBudget({ requestPolicy: "network-only" });
    }
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
      {passwordAction ? (
        <SettingsRow
          label="Manually Set Password"
          description="Configure credentials without sending an invite email."
        >
          {passwordAction}
        </SettingsRow>
      ) : null}
      <SettingsRow
        label="Role"
        description="Permission level within this tenant."
      >
        {roleReadOnly ? (
          <span className="text-sm text-foreground">
            {titleCase(currentRole)}
          </span>
        ) : (
          <>
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
          </>
        )}
      </SettingsRow>
      <SettingsRow
        label="Monthly budget"
        description="Monthly spend limit. Off is unlimited."
      >
        {budgetReadOnly ? (
          <span className="text-sm text-foreground">
            {budgetResult.fetching && !budgetStatus
              ? "Loading..."
              : formatBudgetLimit(budgetStatus?.policy.limitUsd)}
          </span>
        ) : (
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
        )}
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

function DangerSection({
  displayName,
  memberId,
  isSelf,
  onDeleted,
}: {
  displayName: string;
  memberId: string;
  isSelf: boolean;
  onDeleted: () => void;
}) {
  const [{ fetching }, removeMember] = useMutation(
    SettingsRemoveTenantMemberMutation,
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onDelete() {
    setErrorMsg(null);
    const result = await removeMember({ id: memberId });
    if (result.error) {
      setErrorMsg(result.error.message);
      return;
    }
    onDeleted();
  }

  return (
    <SettingsSection label="Danger zone">
      <div className="flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Delete user</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Remove this user&apos;s access to the tenant.
          </p>
          {errorMsg ? (
            <p className="mt-2 text-sm text-destructive">{errorMsg}</p>
          ) : null}
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="destructive"
              disabled={isSelf || fetching}
            >
              <Trash2Icon className="size-3.5" />
              Delete user
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {displayName}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the user from this tenant. They will lose access to
                tenant workspaces immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={fetching}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={fetching}
                onClick={() => void onDelete()}
              >
                {fetching ? "Deleting..." : "Delete user"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
