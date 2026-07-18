import { GraphQLError } from "graphql";
import { isEmailSendApprovalInboxItem } from "../../../lib/email-channel/first-send-approval.js";

export interface EmailApprovalRecipientInput {
  type?: string | null;
  config?: unknown;
  recipient_id?: string | null;
}

/** Assigned email approvals are decidable and readable only by that user. */
export function assertEmailApprovalRecipient(
  inboxItem: EmailApprovalRecipientInput,
  callerUserId: string | null,
): void {
  if (
    isEmailSendApprovalInboxItem(inboxItem) &&
    inboxItem.recipient_id &&
    inboxItem.recipient_id !== callerUserId
  ) {
    throw new GraphQLError(
      "This email approval is assigned to a different user.",
      { extensions: { code: "FORBIDDEN" } },
    );
  }
}

export function canReadEmailApproval(
  inboxItem: EmailApprovalRecipientInput,
  callerUserId: string | null,
): boolean {
  return (
    !isEmailSendApprovalInboxItem(inboxItem) ||
    !inboxItem.recipient_id ||
    inboxItem.recipient_id === callerUserId
  );
}
