import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useColorScheme } from "nativewind";
import { Check, Clock, RefreshCw, X } from "lucide-react-native";
import { useMutation, useQuery } from "urql";

import { DetailLayout } from "@/components/layout/detail-layout";
import { Button } from "@/components/ui/button";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useLiveStatus } from "@/components/providers/LiveStatusProvider";
import {
  ApproveComputerApprovalMutation,
  ComputerApprovalsQuery,
  RejectComputerApprovalMutation,
} from "@/lib/graphql-queries";
import {
  approvalQuestion,
  approvalReason,
  buildApprovalDecisionVariables,
  formatExpiry,
  isAlreadyResolvedInboxError,
  isApprovalExpired,
  visibleApprovalItems,
  type ApprovalItemLike,
} from "@/lib/inbox-approvals";

type ActionState =
  | { kind: "idle" }
  | { kind: "submitting"; itemId: string; action: "approve" | "reject" }
  | { kind: "already_resolved"; itemId: string }
  | { kind: "error"; itemId: string; message: string };

export default function FleetApprovalsScreen() {
  const { id, approvalId } = useLocalSearchParams<{
    id: string;
    approvalId?: string;
  }>();
  const tenantId = Array.isArray(id) ? id[0] : id;
  const focusedApprovalId = Array.isArray(approvalId)
    ? approvalId[0]
    : approvalId;
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [actionState, setActionState] = useState<ActionState>({
    kind: "idle",
  });

  const [{ data, fetching, error }, reexecuteApprovals] = useQuery({
    query: ComputerApprovalsQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  const [, executeApprove] = useMutation(ApproveComputerApprovalMutation);
  const [, executeReject] = useMutation(RejectComputerApprovalMutation);
  const { registerInboxRefetch } = useLiveStatus();

  const approvals = useMemo(
    () => visibleApprovalItems(data?.inboxItems ?? []),
    [data?.inboxItems],
  );

  const actOnApproval = useCallback(
    async (item: ApprovalItemLike, action: "approve" | "reject") => {
      if (isApprovalExpired(item)) {
        setActionState({ kind: "already_resolved", itemId: item.id });
        return;
      }
      setActionState({ kind: "submitting", itemId: item.id, action });
      const reviewNotes = notesById[item.id]?.trim() || undefined;
      const variables = buildApprovalDecisionVariables(item.id, reviewNotes);
      const result =
        action === "approve"
          ? await executeApprove(variables)
          : await executeReject(variables);
      if (result.error) {
        if (isAlreadyResolvedInboxError(result.error)) {
          setActionState({ kind: "already_resolved", itemId: item.id });
          reexecuteApprovals({ requestPolicy: "network-only" });
          return;
        }
        setActionState({
          kind: "error",
          itemId: item.id,
          message: result.error.message,
        });
        return;
      }
      setActionState({ kind: "idle" });
      setNotesById((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      reexecuteApprovals({ requestPolicy: "network-only" });
    },
    [executeApprove, executeReject, notesById, reexecuteApprovals],
  );

  useEffect(
    () =>
      registerInboxRefetch(() => {
        reexecuteApprovals({ requestPolicy: "network-only" });
      }),
    [registerInboxRefetch, reexecuteApprovals],
  );

  const refreshButton = (
    <Pressable
      onPress={() => reexecuteApprovals({ requestPolicy: "network-only" })}
      accessibilityRole="button"
      accessibilityLabel="Refresh approvals"
      className="p-2"
      hitSlop={8}
    >
      <RefreshCw size={20} color={colors.foreground} />
    </Pressable>
  );

  return (
    <DetailLayout title="Inbox" headerRight={refreshButton}>
      <ScrollView
        className="flex-1 bg-white dark:bg-neutral-950"
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
      >
        <View className="mb-1">
          <Text className="text-base font-semibold text-neutral-950 dark:text-neutral-50">
            Pending approvals
          </Text>
          <Muted className="text-sm">
            {approvals.length === 1
              ? "1 approval needs review"
              : `${approvals.length} approvals need review`}
          </Muted>
        </View>

        {fetching && approvals.length === 0 ? (
          <View className="items-center py-12">
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : error ? (
          <View className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
            <Text className="text-sm font-medium text-red-900 dark:text-red-100">
              Unable to load approvals.
            </Text>
            <Muted className="mt-1 text-xs">{error.message}</Muted>
          </View>
        ) : approvals.length === 0 ? (
          <View className="items-center rounded-lg border border-neutral-200 p-8 dark:border-neutral-800">
            <Muted>No pending approvals.</Muted>
          </View>
        ) : (
          approvals.map((item) => {
            const expired = isApprovalExpired(item);
            const expiry = formatExpiry(item.expiresAt);
            const isFocused = focusedApprovalId === item.id;
            const isSubmitting =
              actionState.kind === "submitting" &&
              actionState.itemId === item.id;
            const itemAlreadyResolved =
              actionState.kind === "already_resolved" &&
              actionState.itemId === item.id;
            const itemError =
              actionState.kind === "error" && actionState.itemId === item.id
                ? actionState.message
                : null;

            return (
              <View
                key={item.id}
                className={[
                  "rounded-lg border bg-white p-4 dark:bg-neutral-900",
                  isFocused
                    ? "border-primary"
                    : "border-neutral-200 dark:border-neutral-800",
                ].join(" ")}
              >
                <View className="flex-row items-center gap-2">
                  <Clock size={16} color={colors.mutedForeground} />
                  <Muted className="text-xs">
                    {expired
                      ? "This approval expired"
                      : (expiry ?? "Pending approval")}
                  </Muted>
                </View>

                <Text className="mt-3 text-base font-semibold text-neutral-950 dark:text-neutral-50">
                  {approvalQuestion(item)}
                </Text>
                {approvalReason(item) ? (
                  <Muted className="mt-2 text-sm">{approvalReason(item)}</Muted>
                ) : null}

                {itemAlreadyResolved ? (
                  <View className="mt-3 rounded-lg bg-neutral-100 p-3 dark:bg-neutral-800">
                    <Text className="text-sm font-medium">
                      Already resolved
                    </Text>
                    <Muted className="mt-1 text-xs">
                      This approval changed before your action was applied.
                    </Muted>
                  </View>
                ) : expired ? (
                  <View className="mt-3 rounded-lg bg-amber-50 p-3 dark:bg-amber-950">
                    <Text className="text-sm font-medium text-amber-950 dark:text-amber-100">
                      This approval expired
                    </Text>
                  </View>
                ) : (
                  <>
                    <TextInput
                      value={notesById[item.id] ?? ""}
                      onChangeText={(value) =>
                        setNotesById((current) => ({
                          ...current,
                          [item.id]: value,
                        }))
                      }
                      placeholder="Optional notes for reject or approve"
                      placeholderTextColor={colors.mutedForeground}
                      multiline
                      className="mt-3 min-h-[72px] rounded-lg border border-neutral-300 p-3 text-sm text-neutral-950 dark:border-neutral-700 dark:text-neutral-50"
                      style={{
                        backgroundColor:
                          colorScheme === "dark" ? "#171717" : "#ffffff",
                      }}
                    />
                    {itemError ? (
                      <Text className="mt-2 text-xs text-red-600 dark:text-red-300">
                        {itemError}
                      </Text>
                    ) : null}
                    <View className="mt-3 flex-row gap-2">
                      <Button
                        size="sm"
                        className="flex-1 bg-green-600"
                        disabled={isSubmitting}
                        loading={
                          isSubmitting && actionState.action === "approve"
                        }
                        onPress={() => actOnApproval(item, "approve")}
                      >
                        <Check size={14} color="#ffffff" />
                        <Text className="text-sm font-semibold text-white">
                          Approve
                        </Text>
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="flex-1 bg-red-600"
                        disabled={isSubmitting}
                        loading={
                          isSubmitting && actionState.action === "reject"
                        }
                        onPress={() => actOnApproval(item, "reject")}
                      >
                        <X size={14} color="#ffffff" />
                        <Text className="text-sm font-semibold text-white">
                          Reject
                        </Text>
                      </Button>
                    </View>
                  </>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </DetailLayout>
  );
}
