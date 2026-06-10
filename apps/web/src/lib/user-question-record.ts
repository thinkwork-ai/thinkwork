/**
 * Helpers for `Message.userQuestion` answer-state records (plan
 * 2026-06-09-005 U8): narrowing raw GraphQL status strings at the mapping
 * boundary and resolving `answeredBy` (a users.id UUID) into a display
 * name. Shared by the workbench transcript (TaskThreadView) and the Spaces
 * collaboration surface (ThreadConversation) so both render human names —
 * never a bare UUID.
 */

import type {
  UserQuestionRecord,
  UserQuestionStatus,
} from "@/lib/ui-message-types";

/**
 * Narrow a raw GraphQL status string to {@link UserQuestionStatus}.
 * Missing/empty values fall back to PENDING; an unrecognized non-empty
 * value (a future server enum member) passes through uppercased rather
 * than being coerced to PENDING — the card treats non-PENDING as resolved,
 * which is the safer rendering for a status we don't know.
 */
export function toUserQuestionStatus(
  value: string | null | undefined,
): UserQuestionStatus {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return "PENDING";
  return normalized as UserQuestionStatus;
}

/** Minimal identity shape for the signed-in user (id + display name). */
export interface UserQuestionAnswererIdentity {
  id?: string | null;
  name?: string | null;
}

/** Minimal mention-target shape used to look up an answerer's name. */
export interface UserQuestionNameTarget {
  targetType?: string | null;
  targetId?: string | null;
  displayName?: string | null;
}

/**
 * Attach a display name to the message's userQuestion record. answeredBy is
 * a users.id — resolve it through the current user and the thread's mention
 * targets so the answered card shows a human name. When no name source
 * matches, the record passes through unchanged and the card renders just
 * "Answered" (it never falls back to the raw UUID).
 */
export function resolveUserQuestionRecord(
  record: UserQuestionRecord | null | undefined,
  options: {
    currentUser?: UserQuestionAnswererIdentity | null;
    mentionTargets?: UserQuestionNameTarget[] | null;
  } = {},
): UserQuestionRecord | null {
  if (!record) return null;
  if (record.answeredByDisplayName || !record.answeredBy) return record;
  const { currentUser, mentionTargets } = options;
  let displayName: string | null = null;
  if (sameIdentity(record.answeredBy, currentUser?.id)) {
    displayName = currentUser?.name?.trim() || null;
  }
  if (!displayName) {
    displayName =
      mentionTargets?.find(
        (target) =>
          target.targetType === "USER" &&
          sameIdentity(target.targetId, record.answeredBy),
      )?.displayName ?? null;
  }
  return displayName
    ? { ...record, answeredByDisplayName: displayName }
    : record;
}

function sameIdentity(left?: string | null, right?: string | null) {
  return Boolean(left?.trim() && right?.trim() && left.trim() === right.trim());
}
