import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import {
  ComputerComposer,
  type ComputerComposerMention,
} from "@/components/computer/ComputerComposer";
import { StarterCardGrid } from "@/components/computer/StarterCardGrid";
import type { MentionTarget } from "@/components/spaces/MentionMenu";
import { useTenant } from "@/context/TenantContext";
import {
  CreateThreadMutation,
  NewThreadMentionTargetsQuery,
  SendMessageMutation,
} from "@/lib/graphql-queries";
import { uploadThreadAttachments } from "@/lib/upload-thread-attachments";
import { getIdToken } from "@/lib/auth";
import { useAssignedComputerSelection } from "@/lib/use-assigned-computer-selection";

interface CreateThreadResult {
  createThread: { id: string };
}

interface CreateThreadVars {
  input: {
    tenantId: string;
    computerId: string;
    spaceId?: string;
    title: string;
    channel: "CHAT";
    firstMessage?: string;
  };
}

interface SendMessageResult {
  sendMessage: { id: string };
}

interface SendMessageVars {
  input: {
    threadId: string;
    role: "USER";
    content: string;
    metadata?: string;
    mentions?: ComputerComposerMention[];
  };
}

interface NewThreadMentionTargetsData {
  tenantMembers?: Array<{
    id: string;
    principalType: string;
    principalId: string;
    role: string;
    status: string;
    user?: {
      id: string;
      name?: string | null;
      email: string;
      image?: string | null;
    } | null;
  }>;
  allTenantAgents?: Array<{
    id: string;
    name: string;
    avatarUrl?: string | null;
    role?: string | null;
    status: string;
  }>;
}

interface ComputerWorkbenchProps {
  spaceId?: string;
}

export function ComputerWorkbench({ spaceId }: ComputerWorkbenchProps = {}) {
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const {
    computers,
    fetching: computersFetching,
    noAssignedComputers,
    selectedComputer,
    selectedComputerId,
    setSelectedComputerId,
  } = useAssignedComputerSelection();
  const [{ fetching }, createThread] = useMutation<
    CreateThreadResult,
    CreateThreadVars
  >(CreateThreadMutation);
  const [, sendMessage] = useMutation<SendMessageResult, SendMessageVars>(
    SendMessageMutation,
  );
  const [{ data: mentionTargetData }] = useQuery<
    NewThreadMentionTargetsData,
    { tenantId: string }
  >({
    query: NewThreadMentionTargetsQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const computerId = selectedComputer?.id ?? null;
  const mentionTargets = useMemo(
    () => buildNewThreadMentionTargets(mentionTargetData),
    [mentionTargetData],
  );

  async function handleSubmit(
    files: File[],
    mentions: ComputerComposerMention[],
  ) {
    const trimmed = prompt.trim();
    if (!trimmed && files.length === 0) return;
    if (!tenantId || !computerId) {
      setError(
        noAssignedComputers
          ? "You need access to a workspace before starting work."
          : "Your selected workspace is not ready yet. Try again in a moment.",
      );
      return;
    }

    setError(null);
    setBusy(true);
    try {
      // File-attached path: createThread WITHOUT firstMessage (so the
      // thread starts empty), upload each file via the U2 presign +
      // finalize flow against the new threadId, then send the first
      // user message with metadata.attachments referencing the uploaded
      // ids. Thread auto-titles from the first user message
      // (sendMessage.mutation.ts) — so the operator's prompt becomes
      // the visible title in the threads sidebar.
      //
      // Text-only path (no files): keep the existing atomic
      // createThread-with-firstMessage flow so we don't regress the
      // one-RT happy path.
      if (files.length === 0) {
        const result = await createThread({
          input: {
            tenantId,
            computerId,
            spaceId,
            title: titleFromPrompt(trimmed),
            channel: "CHAT",
            firstMessage: trimmed,
          },
        });
        if (result.error) {
          setError(result.error.message ?? "Failed to start work");
          return;
        }
        const threadId = result.data?.createThread?.id;
        if (!threadId) {
          setError("Thread created but no id returned");
          return;
        }
        navigateToCreatedThread(navigate, threadId, spaceId);
        return;
      }

      // Files present: 3-call sequence.
      const created = await createThread({
        input: {
          tenantId,
          computerId,
          spaceId,
          title: titleFromPromptWithAttachments(trimmed, files),
          channel: "CHAT",
        },
      });
      if (created.error) {
        setError(created.error.message ?? "Failed to start work");
        return;
      }
      const threadId = created.data?.createThread?.id;
      if (!threadId) {
        setError("Thread created but no id returned");
        return;
      }

      const apiUrl = import.meta.env.VITE_API_URL || "";
      const token = await getIdToken();
      if (!apiUrl || !token) {
        setError("Sign-in required to upload attachments");
        return;
      }
      const uploadResult = await uploadThreadAttachments({
        endpoints: { apiUrl, token },
        threadId,
        files,
      });
      if (
        uploadResult.uploaded.length === 0 &&
        uploadResult.failures.length > 0
      ) {
        const first = uploadResult.failures[0]!;
        setError(`Upload failed (${first.stage}): ${first.message}`);
        return;
      }
      if (uploadResult.failures.length > 0) {
        console.warn(
          "[ComputerWorkbench] partial upload failure:",
          uploadResult.failures,
        );
      }

      const attachmentRefs = uploadResult.uploaded.map((a) => ({
        attachmentId: a.attachmentId,
      }));
      const sent = await sendMessage({
        input: {
          threadId,
          role: "USER",
          content: trimmed,
          metadata: JSON.stringify({ attachments: attachmentRefs }),
          mentions,
        },
      });
      if (sent.error) {
        setError(sent.error.message ?? "Failed to send the first message");
        return;
      }

      navigateToCreatedThread(navigate, threadId, spaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start work");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex min-h-full w-full flex-1 bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[750px] flex-1 flex-col justify-center gap-5 px-4 py-8 sm:px-6">
        <header className="text-center">
          <h1 className="text-balance text-3xl font-normal leading-tight tracking-normal sm:text-4xl">
            {selectedComputer?.name || "ThinkWork"}
          </h1>
        </header>

        {computers.length > 1 ? (
          <div className="mx-auto w-full max-w-xs">
            <Select
              value={selectedComputerId ?? undefined}
              onValueChange={setSelectedComputerId}
            >
              <SelectTrigger aria-label="Select workspace">
                <SelectValue placeholder="Select a workspace" />
              </SelectTrigger>
              <SelectContent>
                {computers.map((computer) => (
                  <SelectItem key={computer.id} value={computer.id}>
                    {computer.name || computer.slug || "Workspace"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : noAssignedComputers && !computersFetching ? (
          <p className="mx-auto max-w-md text-center text-sm text-muted-foreground">
            You do not have access to a workspace yet. Ask your tenant operator
            to assign one before starting work.
          </p>
        ) : null}

        <ComputerComposer
          value={prompt}
          onChange={setPrompt}
          onSubmit={handleSubmit}
          mentionTargets={mentionTargets}
          isSubmitting={fetching || busy || computersFetching}
          error={error}
        />

        <div className="mt-6">
          <StarterCardGrid onSelect={setPrompt} />
        </div>
      </div>
    </section>
  );
}

function navigateToCreatedThread(
  navigate: ReturnType<typeof useNavigate>,
  threadId: string,
  spaceId?: string,
) {
  if (spaceId) {
    navigate({
      to: "/spaces/$spaceId/threads/$threadId",
      params: { spaceId, threadId },
    });
    return;
  }
  navigate({ to: "/threads/$id", params: { id: threadId } });
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\n/)[0]?.trim() || "New thread";
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}

function titleFromPromptWithAttachments(prompt: string, files: File[]): string {
  if (prompt.trim()) return titleFromPrompt(prompt);
  // File-only turn — title after the first attached file so the
  // sidebar entry reads sensibly without an explicit prompt.
  const first = files[0]?.name ?? "attachment";
  const suffix = files.length > 1 ? ` (+${files.length - 1})` : "";
  return `Analyze ${first}${suffix}`;
}

function buildNewThreadMentionTargets(
  data: NewThreadMentionTargetsData | undefined,
): MentionTarget[] {
  if (!data) return [];
  const byKey = new Map<string, MentionTarget>();

  for (const member of data.tenantMembers ?? []) {
    if (
      member.status.toLowerCase() !== "active" ||
      member.principalType.toLowerCase() !== "user" ||
      !member.user
    ) {
      continue;
    }
    const displayName = member.user.name || member.user.email || "User";
    byKey.set(`USER:${member.user.id}`, {
      id: `user:${member.user.id}`,
      targetType: "USER",
      targetId: member.user.id,
      displayName,
      avatarUrl: member.user.image,
      role: member.role,
    });
  }

  for (const agent of data.allTenantAgents ?? []) {
    if (agent.status.toLowerCase() === "archived") continue;
    byKey.set(`AGENT:${agent.id}`, {
      id: `agent:${agent.id}`,
      targetType: "AGENT",
      targetId: agent.id,
      displayName: agent.name,
      avatarUrl: agent.avatarUrl,
      role: agent.role,
    });
  }

  return [...byKey.values()].sort((a, b) => {
    const typeOrder =
      a.targetType === b.targetType ? 0 : a.targetType === "USER" ? -1 : 1;
    if (typeOrder !== 0) return typeOrder;
    return a.displayName.localeCompare(b.displayName);
  });
}
