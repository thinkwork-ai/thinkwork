import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useSubscription } from "urql";
import { toast } from "sonner";
import {
  ThreadConversation,
  type ThreadConversationMessage,
} from "./ThreadConversation";
import { ThreadComposer, type ComposerMention } from "./ThreadComposer";
import {
  ThreadParticipantsBar,
  type ThreadParticipantSummary,
} from "./ThreadParticipantsBar";
import type { MentionTarget } from "./MentionMenu";
import {
  NewMessageSubscription,
  SendMessageMutation,
  SpaceThreadCollaborationQuery,
  ThreadMentionTargetsQuery,
} from "@/lib/graphql-queries";
import { getIdToken } from "@/lib/auth";
import { uploadThreadAttachments } from "@/lib/upload-thread-attachments";

interface SpaceThreadRoomProps {
  threadId: string;
  expectedSpaceId: string;
}

interface SpaceThreadCollaborationResult {
  thread?: {
    id: string;
    spaceId?: string | null;
    title?: string | null;
    participants?: ThreadParticipantSummary[] | null;
    messages?: {
      edges?: Array<{ node: ThreadConversationMessage }>;
    } | null;
  } | null;
}

interface MentionTargetsResult {
  threadMentionTargets?: MentionTarget[] | null;
}

export function SpaceThreadRoom({
  threadId,
  expectedSpaceId,
}: SpaceThreadRoomProps) {
  const [{ data, fetching, error }, reexecuteThread] =
    useQuery<SpaceThreadCollaborationResult>({
      query: SpaceThreadCollaborationQuery,
      variables: { id: threadId, messageLimit: 150 },
      requestPolicy: "cache-and-network",
    });
  const [{ data: targetData }, reexecuteTargets] =
    useQuery<MentionTargetsResult>({
      query: ThreadMentionTargetsQuery,
      variables: { threadId },
      requestPolicy: "cache-and-network",
    });
  const [{ fetching: sending }, sendMessage] = useMutation(SendMessageMutation);
  const [{ data: messageUpdate }] = useSubscription<{
    onNewMessage?: {
      threadId?: string | null;
      messageId?: string | null;
    } | null;
  }>({
    query: NewMessageSubscription,
    variables: { threadId },
    pause: !threadId,
  });

  useEffect(() => {
    if (messageUpdate?.onNewMessage?.threadId === threadId) {
      reexecuteThread({ requestPolicy: "network-only" });
      reexecuteTargets({ requestPolicy: "network-only" });
    }
  }, [
    messageUpdate?.onNewMessage?.messageId,
    messageUpdate?.onNewMessage?.threadId,
    reexecuteTargets,
    reexecuteThread,
    threadId,
  ]);

  const thread = data?.thread ?? null;
  const messages = useMemo(
    () => (thread?.messages?.edges ?? []).map((edge) => edge.node),
    [thread?.messages?.edges],
  );
  const mentionTargets = targetData?.threadMentionTargets ?? [];

  if (thread?.spaceId && thread.spaceId !== expectedSpaceId) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
        Thread not found in this Space.
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <ThreadParticipantsBar participants={thread?.participants ?? []} />
      <ThreadConversation
        messages={messages}
        isLoading={fetching && !data}
        error={error?.message ?? null}
      />
      <ThreadComposer
        mentionTargets={mentionTargets}
        isSending={sending}
        onSend={async (content, files, mentions) => {
          const attachmentRefs = await uploadFiles(threadId, files);
          const input: Record<string, unknown> = {
            threadId,
            role: "USER",
            content,
            mentions: mentions.map(toSendMention),
          };
          if (attachmentRefs.length) {
            input.metadata = JSON.stringify({ attachments: attachmentRefs });
          }
          const result = await sendMessage({ input });
          if (result.error) {
            toast.error(`Could not send message: ${result.error.message}`);
            throw result.error;
          }
          reexecuteThread({ requestPolicy: "network-only" });
        }}
      />
    </section>
  );
}

async function uploadFiles(threadId: string, files: File[]) {
  const apiUrl = import.meta.env.VITE_API_URL || "";
  if (files.length === 0 || !apiUrl) return [];
  const token = await getIdToken();
  if (!token) throw new Error("Sign-in required to upload attachments");
  const result = await uploadThreadAttachments({
    endpoints: { apiUrl, token },
    threadId,
    files,
  });
  if (result.failures.length > 0) {
    toast.warning("Some attachments could not be uploaded.");
  }
  return result.uploaded.map((file) => ({ attachmentId: file.attachmentId }));
}

function toSendMention(mention: ComposerMention) {
  return {
    targetType: mention.targetType,
    targetId: mention.targetId,
    displayName: mention.displayName,
    rawText: mention.rawText,
  };
}
