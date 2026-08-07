/**
 * Self profile — mobile port of the web SelfProfilePage: identity header
 * (name + role badge + email), Account Usage (stat tiles, daily-activity
 * heatmap, model breakdown), and the Profile form with role-based editing
 * (operators can edit the monthly budget; role is read-only on the self page,
 * matching the web's disabled self-role select).
 */
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  View,
} from "react-native";
import { useColorScheme } from "nativewind";
import { useMutation, useQuery } from "urql";
import * as Clipboard from "expo-clipboard";
import { Copy, Check } from "lucide-react-native";
import { useMe, useUpdateUser, useUpdateUserProfile } from "@/lib/hooks/use-users";
import {
  DeleteBudgetPolicyMutation,
  UpsertBudgetPolicyMutation,
  UserBudgetStatusQuery,
} from "@/lib/graphql-queries";
import { useAuth } from "@/lib/auth-context";
import { getPlatformConfig } from "@/lib/platform-config";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";
import { AccountUsageSection } from "@/components/profile/AccountUsageSection";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Muted, Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

function titleCase(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

export default function ProfileScreen() {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [{ data: meData }, refetchMe] = useMe();
  const me = meData?.me ?? null;
  const profile = (me as any)?.profile ?? null;
  const userId = me?.id ?? null;
  const tenantId = me?.tenantId ?? null;
  const { getToken } = useAuth();

  // Caller role from /api/auth/me — same source the web TenantContext uses.
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const baseUrl = getPlatformConfig().apiUrl.replace(/\/+$/, "");
        const res = await fetch(`${baseUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const body = (await res.json()) as { role?: string | null };
        if (!cancelled) setRole(body.role ?? null);
      } catch {
        /* role chip just falls back to Member */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);
  const resolvedRole = role ?? "member";
  const canManageSelf = resolvedRole === "owner" || resolvedRole === "admin";

  // ── Profile form state ────────────────────────────────────────────────────
  const [form, setForm] = useState({
    name: "",
    title: "",
    timezone: "",
    notes: "",
  });
  useEffect(() => {
    setForm({
      name: me?.name ?? "",
      title: profile?.title ?? "",
      timezone: profile?.timezone ?? "",
      notes: profile?.notes ?? "",
    });
  }, [me?.name, profile]);

  // ── Budget state ──────────────────────────────────────────────────────────
  const [{ data: budgetData }, refetchBudget] = useQuery({
    query: UserBudgetStatusQuery,
    variables: { tenantId: tenantId!, userId: userId! },
    pause: !tenantId || !userId,
  });
  const budgetStatus = budgetData?.userBudgetStatus ?? null;
  const [budgetForm, setBudgetForm] = useState({ unlimited: true, amount: "" });
  useEffect(() => {
    setBudgetForm({
      unlimited: !budgetStatus,
      amount: budgetStatus ? String(budgetStatus.policy.limitUsd) : "",
    });
  }, [budgetStatus]);

  const [, updateUser] = useUpdateUser();
  const [, updateProfile] = useUpdateUserProfile();
  const [, upsertBudget] = useMutation(UpsertBudgetPolicyMutation);
  const [, deleteBudget] = useMutation(DeleteBudgetPolicyMutation);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyUserId = async () => {
    if (!userId) return;
    await Clipboard.setStringAsync(userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSave = async () => {
    if (!userId) return;
    setError(null);
    setSaved(false);

    let budgetLimit: number | null = null;
    if (canManageSelf && !budgetForm.unlimited) {
      const parsed = Number(budgetForm.amount.trim());
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError("Budget must be a positive number.");
        return;
      }
      budgetLimit = parsed;
    }

    setSaving(true);
    try {
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
      if (canManageSelf && tenantId) {
        if (budgetForm.unlimited) {
          const policyId = budgetStatus?.policy.id;
          if (policyId) mutations.push(deleteBudget({ id: policyId }));
        } else if (budgetLimit != null) {
          mutations.push(
            upsertBudget({
              tenantId,
              input: {
                scope: "user",
                userId,
                agentId: null,
                limitUsd: budgetLimit,
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
        setError(failed.error.message ?? "Save failed");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      refetchMe({ requestPolicy: "network-only" });
      if (canManageSelf) refetchBudget({ requestPolicy: "network-only" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DetailLayout title="Profile">
      <ScrollView
        className="flex-1 bg-white dark:bg-neutral-950"
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <WebContent>
          <View className="mt-4 px-4 gap-8">
            {/* Identity header */}
            <View className="gap-1">
              <View className="flex-row items-center gap-2.5">
                <Text className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                  {me?.name || me?.email || "Profile"}
                </Text>
                <Badge variant="secondary">{titleCase(resolvedRole)}</Badge>
              </View>
              {me?.email ? <Muted>{me.email}</Muted> : null}
            </View>

            {/* Usage tiles + heatmap + model breakdown */}
            <AccountUsageSection tenantId={tenantId} userId={userId} />

            {/* Profile form */}
            <View className="gap-4">
              <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                Profile
              </Text>
              <View className="gap-5">
                <FormRow
                  label="User ID"
                  description="Unique identifier for this member."
                >
                  <Pressable
                    onPress={handleCopyUserId}
                    className="flex-row items-center gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2.5"
                  >
                    <Text
                      className="flex-1 text-sm text-neutral-500 dark:text-neutral-400"
                      numberOfLines={1}
                    >
                      {userId ?? "—"}
                    </Text>
                    {copied ? (
                      <Check size={16} color="#22c55e" />
                    ) : (
                      <Copy size={16} color={colors.muted} />
                    )}
                  </Pressable>
                </FormRow>

                <FormRow
                  label="Name"
                  description="Display name shown across the workspace."
                >
                  <Input
                    value={form.name}
                    compact
                    onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                    autoCapitalize="words"
                  />
                </FormRow>

                <FormRow
                  label="Role"
                  description="Permission level within this tenant."
                >
                  <View className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2.5 opacity-60">
                    <Text className="text-sm text-neutral-900 dark:text-neutral-100">
                      {titleCase(resolvedRole)}
                    </Text>
                  </View>
                </FormRow>

                <FormRow
                  label="Monthly budget"
                  description="Monthly spend limit. Off is unlimited."
                >
                  {canManageSelf ? (
                    <View className="flex-row items-center gap-3">
                      <Switch
                        value={!budgetForm.unlimited}
                        onValueChange={(on) =>
                          setBudgetForm((f) => ({ ...f, unlimited: !on }))
                        }
                        trackColor={{ true: colors.primary }}
                      />
                      {!budgetForm.unlimited && (
                        <>
                          <Muted>$</Muted>
                          <View className="flex-1">
                            <Input
                              compact
                              value={budgetForm.amount}
                              onChangeText={(v) =>
                                setBudgetForm((f) => ({ ...f, amount: v }))
                              }
                              keyboardType="decimal-pad"
                              placeholder="150"
                            />
                          </View>
                        </>
                      )}
                    </View>
                  ) : (
                    <View className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2.5 opacity-60">
                      <Text className="text-sm text-neutral-900 dark:text-neutral-100">
                        {budgetStatus
                          ? `$${budgetStatus.policy.limitUsd} / month`
                          : "Unlimited"}
                      </Text>
                    </View>
                  )}
                </FormRow>

                <FormRow
                  label="Title"
                  description="Job title or role at the company."
                >
                  <Input
                    value={form.title}
                    compact
                    onChangeText={(v) => setForm((f) => ({ ...f, title: v }))}
                    autoCapitalize="words"
                  />
                </FormRow>

                <FormRow
                  label="Timezone"
                  description="Used to localize dates and times for this user."
                >
                  <Input
                    value={form.timezone}
                    compact
                    onChangeText={(v) =>
                      setForm((f) => ({ ...f, timezone: v }))
                    }
                    placeholder="e.g. America/Chicago"
                    autoCapitalize="none"
                  />
                </FormRow>

                <FormRow
                  label="Notes"
                  description="Freeform notes about this member, visible to operators."
                >
                  <Input
                    compact
                    value={form.notes}
                    onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))}
                    multiline
                    numberOfLines={3}
                    style={{ minHeight: 64, textAlignVertical: "top" }}
                  />
                </FormRow>

                {error && (
                  <View className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3">
                    <Text className="text-sm text-red-600 dark:text-red-400">
                      {error}
                    </Text>
                  </View>
                )}

                <View className="flex-row justify-end">
                  <Pressable
                    onPress={handleSave}
                    disabled={saving || !userId}
                    className="flex-row items-center justify-center rounded-lg bg-neutral-900 dark:bg-neutral-100 px-6"
                    style={{ opacity: saving ? 0.5 : 1, height: 40 }}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color={colors.background} />
                    ) : (
                      <Text className="font-semibold text-sm text-white dark:text-neutral-900">
                        {saved ? "Saved" : "Save"}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        </WebContent>
      </ScrollView>
    </DetailLayout>
  );
}

function FormRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-2">
      <View className="gap-0.5">
        <Text className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {label}
        </Text>
        <Muted className="text-xs leading-4">{description}</Muted>
      </View>
      {children}
    </View>
  );
}
