import { formatBytes } from "@thinkwork/shared-utils";
import { Bot, Clock, Download, FileText, UserRound } from "lucide-react";
import { renderTypedParts } from "@/components/workbench/render-typed-part";
import { normalizePersistedParts } from "@/components/workbench/TaskThreadView";
import type { UserQuestionRecord } from "@/lib/ui-message-types";
import {
  resolveUserQuestionRecord,
  type UserQuestionNameTarget,
} from "@/lib/user-question-record";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  resolveMessageAttachments,
  type MessageAttachmentDisplay,
  type ThreadAttachmentSummary,
} from "@/lib/thread-message-attachments";

export interface ThreadConversationMessage {
  id: string;
  role: string;
  content?: string | null;
  parts?: unknown;
  metadata?: unknown;
  createdAt?: string | null;
  sender?: {
    type?: string | null;
    id?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
  } | null;
  mentions?: Array<{
    id: string;
    targetType?: string | null;
    targetId?: string | null;
    displayName?: string | null;
  }> | null;
  /** Answer-state record for ask_user_question messages (Message.userQuestion). */
  userQuestion?: UserQuestionRecord | null;
}

interface ThreadConversationProps {
  messages: ThreadConversationMessage[];
  attachments?: ThreadAttachmentSummary[];
  /**
   * Name sources for resolving `userQuestion.answeredBy` (a users.id) to a
   * display name — without them the answered card falls back to "Answered".
   */
  mentionTargets?: UserQuestionNameTarget[];
  onDownloadAttachment?: (attachmentId: string) => void | Promise<void>;
  isLoading?: boolean;
  error?: string | null;
}

export function ThreadConversation({
  messages,
  attachments = [],
  mentionTargets,
  onDownloadAttachment,
  isLoading = false,
  error,
}: ThreadConversationProps) {
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoadingShimmer />
      </div>
    );
  }
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
        No messages yet
      </div>
    );
  }

  const groups = groupMessages(messages);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        {groups.map((group) =>
          group.kind === "milestone" ? (
            <MilestoneRow key={group.message.id} message={group.message} />
          ) : (
            <MessageGroup
              key={group.id}
              group={group}
              attachments={attachments}
              mentionTargets={mentionTargets}
              onDownloadAttachment={onDownloadAttachment}
            />
          ),
        )}
      </div>
    </div>
  );
}

type MessageGroup =
  | {
      kind: "message";
      id: string;
      senderKey: string;
      senderName: string;
      senderType: string;
      messages: ThreadConversationMessage[];
    }
  | { kind: "milestone"; message: ThreadConversationMessage };

function groupMessages(messages: ThreadConversationMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const message of messages) {
    if (isMilestone(message)) {
      groups.push({ kind: "milestone", message });
      continue;
    }
    const sender = senderFor(message);
    const previous = groups[groups.length - 1];
    if (
      previous?.kind === "message" &&
      previous.senderKey === sender.senderKey
    ) {
      previous.messages.push(message);
      continue;
    }
    groups.push({
      kind: "message",
      id: message.id,
      senderKey: sender.senderKey,
      senderName: sender.senderName,
      senderType: sender.senderType,
      messages: [message],
    });
  }
  return groups;
}

function MessageGroup({
  group,
  attachments,
  mentionTargets,
  onDownloadAttachment,
}: {
  group: Extract<MessageGroup, { kind: "message" }>;
  attachments: ThreadAttachmentSummary[];
  mentionTargets?: UserQuestionNameTarget[];
  onDownloadAttachment?: (attachmentId: string) => void | Promise<void>;
}) {
  const Icon = group.senderType === "agent" ? Bot : UserRound;
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-sm font-semibold">{group.senderName}</span>
          <span className="text-xs text-muted-foreground">
            {formatTime(group.messages[0]?.createdAt)}
          </span>
        </div>
        <div className="space-y-2">
          {group.messages.map((message) => (
            <MessageBody
              key={message.id}
              message={message}
              attachments={attachments}
              mentionTargets={mentionTargets}
              onDownloadAttachment={onDownloadAttachment}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageBody({
  message,
  attachments,
  mentionTargets,
  onDownloadAttachment,
}: {
  message: ThreadConversationMessage;
  attachments: ThreadAttachmentSummary[];
  mentionTargets?: UserQuestionNameTarget[];
  onDownloadAttachment?: (attachmentId: string) => void | Promise<void>;
}) {
  const typedParts = normalizePersistedParts(message.parts);
  const renderedParts = typedParts.length
    ? renderTypedParts(typedParts, {
        keyPrefix: message.id,
        userQuestion: resolveUserQuestionRecord(message.userQuestion, {
          mentionTargets,
        }),
      }).filter(Boolean)
    : null;
  const messageAttachments = resolveMessageAttachments({
    metadata: message.metadata,
    threadAttachments: attachments,
  });
  const hasRenderedParts = Boolean(renderedParts?.length);
  return (
    <div
      className={`grid min-w-0 gap-2 rounded-md bg-muted/45 px-3 py-2 text-sm leading-6 ${hasRenderedParts ? "mt-2" : ""}`}
    >
      {hasRenderedParts ? (
        <div className="space-y-2">{renderedParts}</div>
      ) : message.content ? (
        <p className="whitespace-pre-wrap break-words">
          {highlightMentions(message.content ?? "", message.mentions ?? [])}
        </p>
      ) : messageAttachments.length === 0 ? (
        <p className="text-muted-foreground">(No message content)</p>
      ) : null}
      {messageAttachments.length > 0 ? (
        <ConversationAttachmentChips
          attachments={messageAttachments}
          onDownloadAttachment={onDownloadAttachment}
        />
      ) : null}
    </div>
  );
}

function ConversationAttachmentChips({
  attachments,
  onDownloadAttachment,
}: {
  attachments: MessageAttachmentDisplay[];
  onDownloadAttachment?: (attachmentId: string) => void | Promise<void>;
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      {attachments.map((attachment) => (
        <button
          key={attachment.id}
          type="button"
          aria-label={`Download ${attachment.label}`}
          disabled={!onDownloadAttachment}
          className="inline-flex min-h-9 max-w-full min-w-0 items-center gap-2 rounded-full border bg-background/70 px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => void onDownloadAttachment?.(attachment.id)}
        >
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{attachment.label}</span>
          {attachment.sizeBytes ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatFileSize(attachment.sizeBytes)}
            </span>
          ) : null}
          <Download className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}

function MilestoneRow({ message }: { message: ThreadConversationMessage }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      <div className="flex max-w-[80%] items-center gap-2 rounded-full border bg-background px-3 py-1">
        <Clock className="size-3" />
        <span className="truncate">{message.content || "Thread event"}</span>
      </div>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function highlightMentions(
  content: string,
  mentions: NonNullable<ThreadConversationMessage["mentions"]>,
) {
  if (!mentions.length) return content;
  const names = new Set(
    mentions
      .map((mention) => mention.displayName)
      .filter((name): name is string => Boolean(name)),
  );
  if (names.size === 0) return content;
  const pattern = new RegExp(
    `(@(?:${[...names].map(escapeRegExp).join("|")}))`,
    "g",
  );
  const parts = content.split(pattern);
  return parts.map((part, index) => {
    const name = part.startsWith("@") ? part.slice(1).trim() : "";
    return names.has(name) ? (
      <span
        key={`${part}:${index}`}
        className="rounded bg-primary/10 px-1 font-medium text-primary"
      >
        {part}
      </span>
    ) : (
      part
    );
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function senderFor(message: ThreadConversationMessage) {
  const senderType =
    message.sender?.type?.toLowerCase() ??
    (message.role.toLowerCase() === "assistant" ? "agent" : "user");
  const senderName =
    message.sender?.displayName ?? (senderType === "agent" ? "Agent" : "User");
  const senderKey = `${senderType}:${message.sender?.id ?? senderName}`;
  return { senderType, senderName, senderKey };
}

function isMilestone(message: ThreadConversationMessage) {
  const role = message.role.toLowerCase();
  return role === "system" || role === "tool";
}

function formatTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const formatFileSize = formatBytes;
