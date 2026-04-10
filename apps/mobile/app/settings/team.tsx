import { useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator, Modal, RefreshControl } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useColorScheme } from "nativewind";
import { Plus, X, Eye, EyeOff, Trash2, Mail, Clock, XCircle, Check } from "lucide-react-native";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Text, Muted } from "@/components/ui/typography";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, Column } from "@/components/ui/data-table";
import { MobileRow } from "@/components/ui/mobile-row";
import { useIsLargeScreen } from "@/lib/hooks/use-media-query";
import { COLORS } from "@/lib/theme";
import { useMe } from "@/lib/hooks/use-users";
import { useTenantMembers } from "@/lib/hooks/use-tenants";
import { useAuth } from "@/lib/auth-context";

type UserRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role?: string;
  createdAt: number;
};

// TODO: listUsers — replace with GraphQL query for tenant users
// TODO: invitations.list — replace with GraphQL query for invitations
// TODO: sendInvite — replace with GraphQL mutation
// TODO: revokeInvitation — replace with GraphQL mutation
// TODO: adminUpdateUser — replace with GraphQL mutation
// TODO: adminDeleteUser — replace with GraphQL mutation

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  if (email) {
    const local = email.split("@")[0] ?? "";
    return local.slice(0, 2).toUpperCase() || "??";
  }
  return "??";
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Mobile row component
function TeamMemberRow({
  user,
  onPress,
  isLast
}: {
  user: UserRow;
  onPress: () => void;
  isLast?: boolean;
}) {
  return (
    <MobileRow
      onPress={onPress}
      isLast={isLast}
      line1Left={
        <View className="flex-row items-center flex-1">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-orange-100 dark:bg-orange-900">
              <Text className="text-sm font-semibold text-orange-600 dark:text-orange-300">
                {getInitials(user.name, user.email)}
              </Text>
            </AvatarFallback>
          </Avatar>
          <View className="flex-1 ml-3">
            <Text className="font-medium text-neutral-900 dark:text-neutral-100">
              {user.name?.trim() || "No name"}
            </Text>
            <Muted className="text-sm">{user.email ?? "—"}</Muted>
          </View>
        </View>
      }
      line1Right={<Muted className="text-xs">{formatDate(user.createdAt)}</Muted>}
    />
  );
}

function InvitationStatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    pending: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400",
    accepted: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
    expired: "bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400",
    revoked: "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400",
  };
  const cls = colorMap[status] ?? colorMap.expired;
  return (
    <View className={`px-2 py-0.5 rounded-full ${cls.split(" ").filter(c => c.startsWith("bg-") || c.startsWith("dark:bg-")).join(" ")}`}>
      <Text className={`text-xs font-medium capitalize ${cls.split(" ").filter(c => !c.startsWith("bg-") && !c.startsWith("dark:bg-")).join(" ")}`}>
        {status}
      </Text>
    </View>
  );
}

export default function TeamMembersScreen() {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const isLargeScreen = useIsLargeScreen();

  const [meResult] = useMe();
  const currentUser = meResult.data?.me ?? undefined;
  const [membersResult] = useTenantMembers(currentUser?.tenantId);

  // TODO: These need proper GraphQL queries/mutations
  const users: UserRow[] | undefined = undefined; // TODO: implement listUsers via GraphQL
  const invitations: any[] | undefined = undefined; // TODO: implement invitations.list via GraphQL
  const sendInvite = async (_args: { email: string }) => {
    throw new Error("TODO: implement sendInvite via GraphQL");
  };
  const revokeInvitation = async (_args: { invitationId: string }) => {
    throw new Error("TODO: implement revokeInvitation via GraphQL");
  };
  const adminUpdateUser = async (_args: { userId: string; name?: string; phone?: string }) => {
    throw new Error("TODO: implement adminUpdateUser via GraphQL");
  };
  const adminDeleteUser = async (_args: { userId: string }) => {
    throw new Error("TODO: implement adminDeleteUser via GraphQL");
  };

  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalMode, setModalMode] = useState<"invite" | "edit">("invite");
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const currentUserId = currentUser?.id ?? null;

  const resetForm = () => {
    setName("");
    setEmail("");
    setPhone("");
    setError(null);
    setSuccess(null);
    setDeleteConfirm(false);
  };

  const openInvite = () => {
    setModalMode("invite");
    setEditingUser(null);
    resetForm();
    setModalVisible(true);
  };

  const openEdit = (user: UserRow) => {
    setModalMode("edit");
    setEditingUser(user);
    setName(user.name ?? "");
    setEmail(user.email ?? "");
    setPhone(user.phone ?? "");
    setError(null);
    setSuccess(null);
    setDeleteConfirm(false);
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      if (modalMode === "invite") {
        if (!email.trim()) {
          setError("Email is required");
          setSubmitting(false);
          return;
        }
        await sendInvite({ email: email.trim() });
        setSuccess(`Invitation sent to ${email.trim()}`);
        setEmail("");
      } else if (editingUser) {
        await adminUpdateUser({
          userId: editingUser.id,
          name: name.trim() || undefined,
          phone: phone.trim() || undefined,
        });
        setModalVisible(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!editingUser || !deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await adminDeleteUser({ userId: editingUser.id });
      setModalVisible(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (invitationId: string) => {
    try {
      await revokeInvitation({ invitationId });
    } catch (err) {
      console.error("Failed to revoke invitation:", err);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  const canDelete = editingUser && editingUser.id !== currentUserId;

  // Table columns for large screens
  const columns: Column<UserRow>[] = [
    {
      key: "name",
      header: "Name",
      flex: 2,
      minWidth: 200,
      render: (item) => (
        <View className="flex-row items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-orange-100 dark:bg-orange-900">
              <Text className="text-xs font-semibold text-orange-600 dark:text-orange-300">
                {getInitials(item.name, item.email)}
              </Text>
            </AvatarFallback>
          </Avatar>
          <Text className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {item.name?.trim() || "No name"}
          </Text>
        </View>
      ),
    },
    {
      key: "email",
      header: "Email",
      flex: 2,
      minWidth: 200,
      render: (item) => (
        <Muted className="text-sm">{item.email ?? "—"}</Muted>
      ),
    },
    {
      key: "phone",
      header: "Phone",
      flex: 1,
      minWidth: 120,
      render: (item) => (
        <Muted className="text-sm">{item.phone ?? "—"}</Muted>
      ),
    },
    {
      key: "created",
      header: "Joined",
      flex: 1,
      minWidth: 100,
      render: (item) => (
        <Muted className="text-sm">{formatDate(item.createdAt)}</Muted>
      ),
    },
  ];

  // Pending invitations
  const pendingInvitations = (invitations ?? []).filter(
    (inv) => inv.status === "pending",
  );

  // Loading state
  if (users === undefined) {
    return (
      <DetailLayout
        title="Team Members"
        headerRight={
          <Pressable
            onPress={openInvite}
            className="flex-row items-center gap-1"
          >
            <Mail size={16} color={colors.primary} />
            <Text style={{ color: colors.primary }} className="font-semibold text-base">Invite</Text>
          </Pressable>
        }
      >
        <View className="flex-1 p-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md mb-2" />
          ))}
        </View>
      </DetailLayout>
    );
  }

  const userList = users as UserRow[];

  const renderMobileItem = ({ item, index }: { item: UserRow; index: number }) => (
    <TeamMemberRow
      user={item}
      onPress={() => openEdit(item)}
      isLast={index === userList.length - 1}
    />
  );

  return (
    <DetailLayout
      title="Team Members"
      headerRight={
        <Pressable
          onPress={openInvite}
          className="flex-row items-center gap-1"
        >
          <Mail size={16} color={colors.primary} />
          <Text style={{ color: colors.primary }} className="font-semibold text-base">Invite</Text>
        </Pressable>
      }
    >
      <View className="flex-1 bg-white dark:bg-neutral-950" style={{ maxWidth: 600 }}>
        {isLargeScreen ? (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            <DataTable
              data={userList}
              columns={columns}
              keyExtractor={(item) => item.id}
              onRowPress={openEdit}
              emptyMessage="No team members yet. Tap Invite to get started."
            />

            {/* Pending Invitations Section */}
            {pendingInvitations.length > 0 && (
              <View className="mt-6">
                <Text className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-3">
                  Pending Invitations
                </Text>
                {pendingInvitations.map((inv) => (
                  <View
                    key={inv.id}
                    className="flex-row items-center justify-between py-3 px-4 border-b border-neutral-100 dark:border-neutral-800"
                  >
                    <View className="flex-row items-center gap-3 flex-1">
                      <Clock size={16} color={colors.mutedForeground} />
                      <View>
                        <Text className="text-sm text-neutral-900 dark:text-neutral-100">
                          {inv.email}
                        </Text>
                        <Muted className="text-xs">
                          Sent {formatDate(inv.createdAt)} · Expires{" "}
                          {formatDate(inv.expiresAt)}
                        </Muted>
                      </View>
                    </View>
                    <Pressable
                      onPress={() => handleRevoke(inv.id)}
                      className="p-2"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <XCircle size={18} color="#ef4444" />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        ) : (
          <View className="flex-1">
            {userList.length === 0 && pendingInvitations.length === 0 ? (
              <View className="py-12 items-center px-4">
                <Muted className="text-center mb-4">
                  No team members yet.
                </Muted>
                <Button onPress={openInvite}>
                  <Mail size={18} color="#ffffff" />
                  <Text className="text-white font-medium ml-2">Invite Team Member</Text>
                </Button>
              </View>
            ) : (
              <ScrollView
                className="flex-1"
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              >
                <View className="pt-3">
                  {userList.map((user, index) => (
                    <TeamMemberRow
                      key={user.id}
                      user={user}
                      onPress={() => openEdit(user)}
                      isLast={index === userList.length - 1 && pendingInvitations.length === 0}
                    />
                  ))}
                </View>

                {/* Pending Invitations Section (Mobile) */}
                {pendingInvitations.length > 0 && (
                  <View className="mt-4 px-4">
                    <Text className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-3">
                      Pending Invitations
                    </Text>
                    {pendingInvitations.map((inv) => (
                      <View
                        key={inv.id}
                        className="flex-row items-center justify-between py-3 border-b border-neutral-100 dark:border-neutral-800"
                      >
                        <View className="flex-1">
                          <Text className="text-sm text-neutral-900 dark:text-neutral-100">
                            {inv.email}
                          </Text>
                          <Muted className="text-xs">
                            Sent {formatDate(inv.createdAt)}
                          </Muted>
                        </View>
                        <Pressable
                          onPress={() => handleRevoke(inv.id)}
                          className="p-2"
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <XCircle size={18} color="#ef4444" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        )}
      </View>

      {/* Invite / Edit Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalVisible(false)}
      >
        <View className="flex-1 bg-white dark:bg-neutral-950">
          {/* Modal Header */}
          <View className="flex-row items-center justify-between px-4 py-4 border-b border-neutral-200 dark:border-neutral-800">
            <Text className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {modalMode === "invite" ? "Invite Team Member" : "Edit Team Member"}
            </Text>
            <Pressable onPress={() => setModalVisible(false)} className="p-2">
              <X size={24} color={colors.foreground} />
            </Pressable>
          </View>

          {/* Modal Content */}
          <ScrollView
            className="flex-1 px-4 py-4"
            keyboardShouldPersistTaps="handled"
          >
            <View className="gap-4">
              {modalMode === "invite" ? (
                <>
                  <Text className="text-sm text-neutral-600 dark:text-neutral-400">
                    Enter the email address of the person you'd like to invite. They'll receive an email with a link to create their account.
                  </Text>
                  <Input
                    label="Email"
                    value={email}
                    onChangeText={(t) => { setEmail(t); setSuccess(null); setError(null); }}
                    placeholder="colleague@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoFocus
                  />
                </>
              ) : (
                <>
                  <Input
                    label="Name"
                    value={name}
                    onChangeText={setName}
                    placeholder="Full name"
                    autoCapitalize="words"
                  />
                  <Input
                    label="Email"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="email@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    editable={false}
                    containerClassName="opacity-60"
                  />
                  <Text className="text-xs text-neutral-500 dark:text-neutral-400 -mt-2">
                    Email cannot be changed.
                  </Text>
                  <Input
                    label="Phone"
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="+1 234 567 8900"
                    keyboardType="phone-pad"
                  />
                </>
              )}

              {/* Success Message */}
              {success && (
                <View className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-4 py-3 flex-row items-center gap-2">
                  <Check size={16} color="#16a34a" />
                  <Text className="text-sm text-green-600 dark:text-green-400 flex-1">{success}</Text>
                </View>
              )}

              {/* Error Message */}
              {error && (
                <View className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3">
                  <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text>
                </View>
              )}

              {/* Action Buttons */}
              <View className="gap-3 mt-4">
                <Button onPress={handleSubmit} disabled={submitting}>
                  {submitting ? (
                    <>
                      <ActivityIndicator size="small" color="#fff" />
                      <Text className="ml-2 text-white font-semibold">
                        {modalMode === "invite" ? "Sending..." : "Saving..."}
                      </Text>
                    </>
                  ) : modalMode === "invite" ? (
                    <>
                      <Mail size={18} color="#ffffff" />
                      <Text className="ml-2 text-white font-semibold">Send Invitation</Text>
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>

                {modalMode === "edit" && canDelete && (
                  <Button
                    variant="destructive"
                    onPress={handleDelete}
                    disabled={submitting}
                  >
                    <Trash2 size={18} color="#ef4444" />
                    <Text className="ml-2 text-red-600 dark:text-red-400 font-semibold">
                      {deleteConfirm ? "Tap again to confirm delete" : "Delete Team Member"}
                    </Text>
                  </Button>
                )}

                {modalMode === "edit" && !canDelete && editingUser?.id === currentUserId && (
                  <Text className="text-sm text-neutral-500 dark:text-neutral-400 text-center">
                    You cannot delete your own account.
                  </Text>
                )}
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </DetailLayout>
  );
}
