import { useState, useEffect } from "react";
import { View, ScrollView, Pressable, ActivityIndicator, Modal } from "react-native";
import { WebContent } from "@/components/layout/web-content";
import { useColorScheme } from "nativewind";
import { ChevronRight } from "lucide-react-native";
import { useAuth } from "@/lib/auth-context";
import { Eye, EyeOff, AlertTriangle, Lock } from "lucide-react-native";
import { HeaderContextMenu } from "@/components/ui/header-context-menu";
import { useMe, useUpdateUser } from "@/lib/hooks/use-users";
import { useTenant, useUpdateTenant } from "@/lib/hooks/use-tenants";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Input } from "@/components/ui/input";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useIsLargeScreen } from "@/lib/hooks/use-media-query";

export default function ManageAccountScreen() {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const isLargeScreen = useIsLargeScreen();
  const [meResult] = useMe();
  const user = meResult.data?.me ?? undefined;
  // TODO: getCurrent tenant — need tenantId from user or auth context
  const [tenantResult] = useTenant(user?.tenantId);
  const tenant = tenantResult.data?.tenant ?? undefined;
  const [, executeUpdateTenant] = useUpdateTenant();
  const [, executeUpdateUser] = useUpdateUser();
  const { signOut } = useAuth();

  // TODO: changePassword — implement via Cognito auth context
  const changePassword = async (_args: { currentPassword: string; newPassword: string }) => {
    throw new Error("TODO: implement changePassword via Cognito");
  };
  // TODO: cancelSubscription — implement via GraphQL mutation
  const cancelSubscription = async () => {
    throw new Error("TODO: implement cancelSubscription via GraphQL");
  };

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const handleCancelSubscription = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelSubscription();
      setShowCancelModal(false);
      signOut();
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCancelling(false);
    }
  };

  // Load user data
  useEffect(() => {
    if (user) {
      setName(user.name ?? "");
      setPhone(user.phone ?? "");
    }
  }, [user]);

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      if (user?.id) {
        await executeUpdateUser({
          id: user.id,
          input: {
            name: name.trim() || undefined,
            phone: phone.trim() || undefined,
          },
        });
      }
      setSuccess("Changes saved successfully");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordChange = async () => {
    setPasswordError(null);
    if (!currentPassword) {
      setPasswordError("Current password is required");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters");
      return;
    }
    setPasswordSubmitting(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswords(false);
      setShowPasswordModal(false);
      setSuccess("Password changed successfully");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const handleUpdatePlan = async (plan: string) => {
    if (tenant?.id) {
      await executeUpdateTenant({ id: tenant.id, input: { plan } });
    }
  };

  const accountMenu = (
    <HeaderContextMenu
      items={[
        {
          label: "Change Password",
          icon: Lock,
          onPress: () => {
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setShowPasswords(false);
            setPasswordError(null);
            setShowPasswordModal(true);
          },
        },
        {
          label: "Cancel Subscription",
          icon: AlertTriangle,
          destructive: true,
          onPress: () => {
            setDeleteConfirmText("");
            setCancelError(null);
            setShowCancelModal(true);
          },
        },
      ]}
    />
  );

  return (
    <DetailLayout title="Manage Account" headerRight={accountMenu}>
      <ScrollView
        className="flex-1 bg-white dark:bg-neutral-950"
        contentContainerStyle={{ paddingTop: 0, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <WebContent>
        <View className="mt-4 px-4">
          {/* Profile Fields */}
          <View className={`gap-4 ${isLargeScreen ? "rounded-lg border border-neutral-200 dark:border-neutral-800 p-4" : ""}`}>
            <View>
              <Input
                compact={isLargeScreen}
                label="Email"
                value={user?.email ?? ""}
                editable={false}
                placeholder="Email"
                keyboardType="email-address"
                containerClassName="opacity-60"
              />
              <Muted className="text-xs mt-1">
                Email is used to sign in and cannot be changed here.
              </Muted>
            </View>
            <View>
              <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-2">Plan</Text>
              <View className="flex-row gap-2">
                {(["pro", "business", "enterprise"] as const).map((plan) => {
                  const currentPlan = tenant?.plan || "pro";
                  const labels: Record<string, string> = { pro: "Pro", business: "Business", enterprise: "Enterprise" };
                  const isActive = currentPlan === plan;
                  return (
                    <Pressable
                      key={plan}
                      onPress={() => handleUpdatePlan(plan)}
                      className={`flex-1 items-center justify-center rounded-lg border ${
                        isActive
                          ? "bg-sky-500 border-sky-500"
                          : "bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700"
                      }`}
                      style={{ height: 48 }}
                    >
                      <Text className={`text-base font-medium ${isActive ? "text-white" : "text-neutral-900 dark:text-neutral-100"}`}>
                        {labels[plan]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <Input
              compact={isLargeScreen}
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              autoCapitalize="words"
            />
            <Input
              compact={isLargeScreen}
              label="Phone"
              value={phone}
              onChangeText={setPhone}
              placeholder="+1 234 567 8900"
              keyboardType="phone-pad"
            />
          </View>

          {/* Error/Success Messages */}
          {error && (
            <View className="mt-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3">
              <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text>
            </View>
          )}
          {success && (
            <View className="mt-4 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-4 py-3">
              <Text className="text-sm text-green-600 dark:text-green-400">{success}</Text>
            </View>
          )}

          {/* Actions */}
          <View className="mt-6">
            <Pressable
              onPress={handleSubmit}
              disabled={submitting}
              className="flex-row items-center justify-center px-5 rounded-lg bg-sky-500 border border-sky-500"
              style={{ opacity: submitting ? 0.5 : 1, height: 40 }}
            >
              {submitting ? (
                <>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text className="ml-2 text-white font-semibold text-sm">Saving...</Text>
                </>
              ) : (
                <Text className="text-white font-semibold text-sm">Save Changes</Text>
              )}
            </Pressable>
          </View>

        {/* Change Password Modal */}
        <Modal
          visible={showPasswordModal}
          transparent
          animationType="fade"
          onRequestClose={() => !passwordSubmitting && setShowPasswordModal(false)}
        >
          <View className="flex-1 justify-center items-center bg-black/60 px-6">
            <View
              className="w-full max-w-sm rounded-xl p-6 border"
              style={{ backgroundColor: colors.card, borderColor: colors.border }}
            >
              <Text className="text-lg font-bold text-neutral-900 dark:text-neutral-100 mb-4">
                Change Password
              </Text>
              <View className="gap-4">
                <Input
                  label="Current Password"
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="••••••••"
                  secureTextEntry={!showPasswords}
                  autoCapitalize="none"
                  autoFocus
                />
                <Input
                  label="New Password"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="At least 8 characters"
                  secureTextEntry={!showPasswords}
                  autoCapitalize="none"
                />
                <Input
                  label="Confirm New Password"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm new password"
                  secureTextEntry={!showPasswords}
                  autoCapitalize="none"
                />
                <Pressable
                  onPress={() => setShowPasswords(!showPasswords)}
                  className="flex-row items-center gap-2"
                >
                  {showPasswords ? (
                    <EyeOff size={18} color={colors.mutedForeground} />
                  ) : (
                    <Eye size={18} color={colors.mutedForeground} />
                  )}
                  <Text className="text-sm text-neutral-500 dark:text-neutral-400">
                    {showPasswords ? "Hide" : "Show"} passwords
                  </Text>
                </Pressable>
              </View>
              {passwordError && (
                <View className="mt-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2">
                  <Text className="text-xs text-red-600 dark:text-red-400">{passwordError}</Text>
                </View>
              )}
              <Pressable
                onPress={handlePasswordChange}
                disabled={passwordSubmitting}
                className="mt-4 items-center py-3 rounded-lg bg-sky-500"
                style={{ opacity: passwordSubmitting ? 0.5 : 1 }}
              >
                {passwordSubmitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text className="text-white font-semibold">Update Password</Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => setShowPasswordModal(false)}
                disabled={passwordSubmitting}
                className="mt-2 items-center py-3"
              >
                <Text className="font-medium text-neutral-500 dark:text-neutral-400">Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Cancel Subscription Confirmation Modal */}
        <Modal
          visible={showCancelModal}
          transparent
          animationType="fade"
          onRequestClose={() => !cancelling && setShowCancelModal(false)}
        >
          <View className="flex-1 justify-center items-center bg-black/60 px-6">
            <View
              className="w-full max-w-sm rounded-xl p-6 border"
              style={{
                backgroundColor: colors.card,
                borderColor: colors.border,
              }}
            >
              <View className="items-center mb-4">
                <AlertTriangle size={40} color="#ef4444" />
              </View>
              <Text className="text-lg font-bold text-center text-neutral-900 dark:text-neutral-100 mb-2">
                Cancel Subscription?
              </Text>
              <Text className="text-sm text-center text-neutral-600 dark:text-neutral-400 mb-4">
                This will permanently delete your account data and all associated resources. This action cannot be undone.
              </Text>
              <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                Type <Text className="font-bold text-red-600 dark:text-red-400">CANCEL</Text> to confirm:
              </Text>
              <Input
                value={deleteConfirmText}
                onChangeText={setDeleteConfirmText}
                placeholder="CANCEL"
                autoFocus
                autoCapitalize="characters"
              />
              {cancelError && (
                <View className="mt-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2">
                  <Text className="text-xs text-red-600 dark:text-red-400">{cancelError}</Text>
                </View>
              )}
              <Pressable
                onPress={handleCancelSubscription}
                disabled={deleteConfirmText !== "CANCEL" || cancelling}
                style={{
                  backgroundColor: deleteConfirmText === "CANCEL" && !cancelling ? "#dc2626" : "#d4d4d4",
                  paddingVertical: 14,
                  borderRadius: 10,
                  alignItems: "center",
                  marginTop: 16,
                  opacity: deleteConfirmText !== "CANCEL" || cancelling ? 0.5 : 1,
                }}
              >
                {cancelling ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
                    Cancel Account
                  </Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => setShowCancelModal(false)}
                disabled={cancelling}
                style={{
                  paddingVertical: 12,
                  alignItems: "center",
                  marginTop: 8,
                }}
              >
                <Text className="font-medium text-neutral-500 dark:text-neutral-400">
                  Cancel
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <View className="h-8" />
        </View>
        </WebContent>
      </ScrollView>
    </DetailLayout>
  );
}
