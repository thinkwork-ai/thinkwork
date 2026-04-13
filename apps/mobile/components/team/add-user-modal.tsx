import { useState } from "react";
import { View, Modal, Pressable, ActivityIndicator, ScrollView, TextInput } from "react-native";
import { useColorScheme } from "nativewind";
import { X, Users, Mail, Check } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { COLORS } from "@/lib/theme";
import { useTenantMembers } from "@/lib/hooks/use-tenants";
import { useTeam, useAddTeamUser } from "@/lib/hooks/use-teams";
import { useMe } from "@/lib/hooks/use-users";

// TODO: Replace sendInvite with GraphQL mutation
// Previously: useAction(api.invitations_actions.sendInvite)

interface AddUserModalProps {
  visible: boolean;
  teamId: string;
  onClose: () => void;
}

export function AddUserModal({ visible, teamId, onClose }: AddUserModalProps) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [meResult] = useMe();
  const currentUser = meResult.data?.me ?? undefined;
  const [tenantMembersResult] = useTenantMembers(currentUser?.tenantId);
  const tenantUsers = tenantMembersResult.data?.tenantMembers ?? undefined;
  const [teamResult] = useTeam(teamId);
  const teamMembers = teamResult.data?.team?.users ?? [];
  const [, executeAddTeamUser] = useAddTeamUser();

  // TODO: implement sendInvite via GraphQL mutation
  const sendInvite = async (_args: { email: string }) => {
    throw new Error("TODO: implement sendInvite via GraphQL");
  };

  const [selectedRole, setSelectedRole] = useState<Record<string, "admin" | "member">>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addedUsers, setAddedUsers] = useState<Set<string>>(new Set());

  // Invite by email state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  const resetForm = () => {
    setSelectedRole({});
    setError(null);
    setAddedUsers(new Set());
    setShowInvite(false);
    setInviteEmail("");
    setInviteSuccess(false);
  };

  // Filter out users already in the team
  const existingUserIds = new Set((teamMembers ?? []).map((m: any) => m.userId));
  const availableUsers = (tenantUsers ?? []).filter(
    (u: any) => !existingUserIds.has(u.principalId) && !addedUsers.has(u.principalId)
  );

  const handleAddUser = async (userId: string, userName: string) => {
    const role = selectedRole[userId] || "member";
    setError(null);
    setSubmitting(userId);
    try {
      await executeAddTeamUser({
        teamId,
        input: {
          userId,
          role,
        },
      });
      setAddedUsers((prev) => new Set(prev).add(userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(null);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setError(null);
    setInviting(true);
    try {
      await sendInvite({ email: inviteEmail.trim() });
      setInviteSuccess(true);
      setInviteEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setInviting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => { resetForm(); onClose(); }}
    >
      <View className="flex-1 justify-center items-center bg-black/60 px-6">
        <View
          className="w-full max-w-sm rounded-xl p-6 border"
          style={{ backgroundColor: colors.card, borderColor: colors.border, maxHeight: "80%" }}
        >
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-row items-center gap-2">
              <Users size={20} color={colors.foreground} />
              <Text className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
                Add User to Team
              </Text>
            </View>
            <Pressable onPress={() => { resetForm(); onClose(); }} className="p-2">
              <X size={20} color={colors.foreground} />
            </Pressable>
          </View>

          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {/* Debug info */}
            <View className="mb-2 px-2 py-1 bg-neutral-100 dark:bg-neutral-900 rounded">
              <Text className="text-xs text-neutral-500">
                Tenant users: {tenantUsers === undefined ? "loading" : tenantUsers?.length ?? "null"} |
                Team members: {teamMembers === undefined ? "loading" : teamMembers?.length ?? "null"} |
                Available: {availableUsers.length}
              </Text>
            </View>

            {tenantUsers === undefined ? (
              <View className="py-8 items-center">
                <ActivityIndicator size="small" color={colors.primary} />
                <Muted className="mt-2">Loading users...</Muted>
              </View>
            ) : availableUsers.length === 0 && !showInvite ? (
              <View className="py-6 items-center">
                <Muted className="text-center mb-4">
                  All tenant users are already in this team.
                </Muted>
              </View>
            ) : (
              <View className="gap-2">
                {availableUsers.map((user: any) => {
                  const usrId = user.principalId;
                  const role = selectedRole[usrId] || "member";
                  const isSubmitting = submitting === usrId;
                  return (
                    <View
                      key={usrId}
                      className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3"
                    >
                      <View className="flex-row items-center justify-between mb-2">
                        <View className="flex-1 mr-2">
                          <Text className="text-base font-medium text-neutral-900 dark:text-neutral-100">
                            {user.name || "Unnamed"}
                          </Text>
                          <Muted className="text-xs" numberOfLines={1}>
                            {user.email || "No email"}
                          </Muted>
                        </View>
                        <Pressable
                          onPress={() => handleAddUser(usrId, user.name || "Unknown")}
                          disabled={isSubmitting}
                          className="rounded-lg bg-sky-500 px-3 py-1.5"
                          style={{ opacity: isSubmitting ? 0.5 : 1 }}
                        >
                          {isSubmitting ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text className="text-white text-sm font-semibold">Add</Text>
                          )}
                        </Pressable>
                      </View>
                      <View className="flex-row gap-2">
                        {(["admin", "member"] as const).map((r) => (
                          <Pressable
                            key={r}
                            onPress={() => setSelectedRole((prev) => ({ ...prev, [usrId]: r }))}
                            className={`flex-1 items-center py-1.5 rounded-md border ${
                              role === r
                                ? "border-sky-500 bg-sky-50 dark:bg-sky-900/20"
                                : "border-neutral-200 dark:border-neutral-800"
                            }`}
                          >
                            <Text
                              className={`text-xs font-medium capitalize ${
                                role === r
                                  ? "text-sky-600 dark:text-sky-400"
                                  : "text-neutral-600 dark:text-neutral-400"
                              }`}
                            >
                              {r}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Invite by Email Section */}
            <View className="mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-800">
              {!showInvite ? (
                <Pressable
                  onPress={() => setShowInvite(true)}
                  className="flex-row items-center gap-2 py-2"
                >
                  <Mail size={16} color={colors.primary} />
                  <Text style={{ color: colors.primary }} className="text-sm font-medium">
                    Invite by Email
                  </Text>
                </Pressable>
              ) : (
                <View className="gap-3">
                  <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    Invite by Email
                  </Text>
                  <Input
                    value={inviteEmail}
                    onChangeText={setInviteEmail}
                    placeholder="user@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoFocus
                  />
                  {inviteSuccess && (
                    <View className="flex-row items-center gap-1">
                      <Check size={14} color="#22c55e" />
                      <Text className="text-sm text-green-600 dark:text-green-400">
                        Invitation sent!
                      </Text>
                    </View>
                  )}
                  <Pressable
                    onPress={handleInvite}
                    disabled={inviting || !inviteEmail.trim()}
                    className="items-center py-2.5 rounded-lg bg-sky-500"
                    style={{ opacity: inviting || !inviteEmail.trim() ? 0.5 : 1 }}
                  >
                    {inviting ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text className="text-white font-semibold text-sm">Send Invite</Text>
                    )}
                  </Pressable>
                </View>
              )}
            </View>
          </ScrollView>

          {error && (
            <View className="mt-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2">
              <Text className="text-xs text-red-600 dark:text-red-400">{error}</Text>
            </View>
          )}

          <Pressable
            onPress={() => { resetForm(); onClose(); }}
            className="mt-3 items-center py-3"
          >
            <Text className="font-medium text-neutral-500 dark:text-neutral-400">Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
