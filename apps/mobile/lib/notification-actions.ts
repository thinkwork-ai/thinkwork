import * as Notifications from "expo-notifications";
import { print } from "graphql";

import * as auth from "@/lib/auth";
import {
  ApproveComputerApprovalMutation,
  RejectComputerApprovalMutation,
} from "@/lib/graphql-queries";
import { getPlatformConfig } from "@/lib/platform-config";
import { isAlreadyResolvedInboxError } from "@/lib/inbox-approvals";

export const APPROVE_NOTIFICATION_ACTION = "approve";
export const REJECT_NOTIFICATION_ACTION = "reject";
export const COMPUTER_APPROVAL_CATEGORY = "computer_approval_actions";

const handledNotificationRequestIds = new Set<string>();

export async function registerComputerApprovalActions() {
  await Notifications.setNotificationCategoryAsync(COMPUTER_APPROVAL_CATEGORY, [
    {
      identifier: APPROVE_NOTIFICATION_ACTION,
      buttonTitle: "Approve",
      options: {
        isAuthenticationRequired: true,
        opensAppToForeground: false,
      },
    },
    {
      identifier: REJECT_NOTIFICATION_ACTION,
      buttonTitle: "Reject",
      options: {
        isAuthenticationRequired: true,
        isDestructive: true,
        opensAppToForeground: false,
      },
    },
  ]);
}

export function isComputerApprovalAction(actionIdentifier: string): boolean {
  return (
    actionIdentifier === APPROVE_NOTIFICATION_ACTION ||
    actionIdentifier === REJECT_NOTIFICATION_ACTION
  );
}

export async function handleComputerApprovalActionResponse(
  response: Notifications.NotificationResponse,
  deps: {
    routeToApproval: (approvalId: string) => void;
    fetchImpl?: typeof fetch;
  },
) {
  const requestId = response.notification.request.identifier;
  if (handledNotificationRequestIds.has(requestId)) return;
  handledNotificationRequestIds.add(requestId);

  const approvalId = approvalIdFromResponse(response);
  if (!approvalId) return;

  const token = await auth.getIdToken();
  if (!token) {
    deps.routeToApproval(approvalId);
    return;
  }

  try {
    await sendApprovalDecision({
      approvalId,
      token,
      action:
        response.actionIdentifier === APPROVE_NOTIFICATION_ACTION
          ? "approve"
          : "reject",
      fetchImpl: deps.fetchImpl ?? fetch,
    });
  } catch (error) {
    if (isAlreadyResolvedInboxError(error)) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Approval already resolved",
          body: "This approval was handled before your action was applied.",
        },
        trigger: null,
      });
      return;
    }
    deps.routeToApproval(approvalId);
  }
}

async function sendApprovalDecision({
  approvalId,
  token,
  action,
  fetchImpl,
}: {
  approvalId: string;
  token: string;
  action: "approve" | "reject";
  fetchImpl: typeof fetch;
}) {
  const graphqlUrl = getPlatformConfig().graphqlUrl;
  if (!graphqlUrl) throw new Error("GraphQL URL not configured");
  const query =
    action === "approve"
      ? print(ApproveComputerApprovalMutation as any)
      : print(RejectComputerApprovalMutation as any);
  const response = await fetchImpl(graphqlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({
      query,
      variables: { id: approvalId, input: {} },
    }),
  });
  const payload = await response.json();
  if (payload.errors?.length) {
    const error = new Error(payload.errors[0]?.message ?? "Approval failed");
    (error as any).graphQLErrors = payload.errors;
    throw error;
  }
  if (!response.ok) {
    throw new Error(`Approval request failed: ${response.status}`);
  }
}

function approvalIdFromResponse(
  response: Notifications.NotificationResponse,
): string | null {
  const data = response.notification.request.content.data ?? {};
  const approvalId = (data as Record<string, unknown>).approvalId;
  return typeof approvalId === "string" && approvalId.trim()
    ? approvalId.trim()
    : null;
}

export function resetHandledNotificationActionsForTests() {
  handledNotificationRequestIds.clear();
}
