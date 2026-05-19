import { Bot, Clock, UserRound } from "lucide-react";
import { renderTypedParts } from "@/components/computer/render-typed-part";
import { normalizePersistedParts } from "@/components/computer/TaskThreadView";
import { LoadingShimmer } from "@/components/LoadingShimmer";

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
}

interface ThreadConversationProps {
  messages: ThreadConversationMessage[];
  isLoading?: boolean;
  error?: string | null;
}

export function ThreadConversation({
  messages,
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
            <MessageGroup key={group.id} group={group} />
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
}: {
  group: Extract<MessageGroup, { kind: "message" }>;
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
            <MessageBody key={message.id} message={message} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageBody({ message }: { message: ThreadConversationMessage }) {
  const typedParts = normalizePersistedParts(message.parts);
  const renderedParts = typedParts.length
    ? renderTypedParts(typedParts, { keyPrefix: message.id }).filter(Boolean)
    : null;
  return (
    <div className="rounded-md bg-muted/45 px-3 py-2 text-sm leading-6">
      {renderedParts?.length ? (
        <div className="space-y-2">{renderedParts}</div>
      ) : (
        <p className="whitespace-pre-wrap break-words">
          {highlightMentions(message.content ?? "", message.mentions ?? [])}
        </p>
      )}
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
