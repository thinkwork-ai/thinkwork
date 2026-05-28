import { useEffect, useMemo, useState } from "react";
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
  SpacesComposer,
  type SpacesComposerMention,
} from "@/components/workbench/SpacesComposer";
import type { AgentRuntimePreference } from "@/components/workbench/AgentRuntimeIndicator";
import { StarterCardGrid } from "@/components/workbench/StarterCardGrid";
import type { SpaceSummary } from "@/components/spaces/space-types";
import type { MentionTarget } from "@/components/spaces/MentionMenu";
import { useTenant } from "@/context/TenantContext";
import {
  CreateThreadMutation,
  NewThreadMentionTargetsQuery,
  SendMessageMutation,
  SpacesQuery,
} from "@/lib/graphql-queries";
import { uploadThreadAttachments } from "@/lib/upload-thread-attachments";
import { getIdToken } from "@/lib/auth";
import { useAssignedComputerSelection } from "@/lib/use-assigned-computer-selection";
import {
  getDesktopBridge,
  shouldUseDesktopLocalPiDispatchNow,
} from "@/lib/desktop-runtime";

interface CreateThreadResult {
  createThread: { id: string; agentId?: string | null };
}

interface CreateThreadVars {
  input: {
    tenantId: string;
    computerId?: string;
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
    mentions?: SpacesComposerMention[];
    agentRequested?: boolean;
    dispatchMode?: "MANAGED_DEFAULT" | "DESKTOP_LOCAL";
  };
}

interface NewThreadMentionTargetsData {
  tenantMentionTargets?: Array<{
    id: string;
    targetType: "USER" | "AGENT";
    targetId: string;
    displayName: string;
    aliases?: string[] | null;
    isDefaultAgent?: boolean | null;
    avatarUrl?: string | null;
    role?: string | null;
  }>;
}

interface SpacesResult {
  spaces?: SpaceSummary[] | null;
}

interface SpacesWorkbenchProps {
  spaceId?: string;
}

export function SpacesWorkbench({ spaceId }: SpacesWorkbenchProps = {}) {
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(
    spaceId ?? null,
  );
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
  const [{ data: mentionTargetData, error: mentionTargetError }] = useQuery<
    NewThreadMentionTargetsData,
    { tenantId: string }
  >({
    query: NewThreadMentionTargetsQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  // Surface a failed mention-targets fetch instead of silently rendering an
  // empty @-menu — a swallowed GraphQL error here previously hid a broken
  // query for the entire new-thread composer.
  useEffect(() => {
    if (mentionTargetError) {
      console.warn(
        "[SpacesWorkbench] failed to load mention targets:",
        mentionTargetError,
      );
    }
  }, [mentionTargetError]);
  const [{ data: spacesData, fetching: spacesFetching }] = useQuery<
    SpacesResult,
    { tenantId: string }
  >({
    query: SpacesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const computerId = selectedComputer?.id ?? null;
  const spaces = useMemo(
    () =>
      (spacesData?.spaces ?? []).filter((space) => space.status !== "archived"),
    [spacesData?.spaces],
  );
  const defaultSpace = useMemo(
    () =>
      spaces.find((space) => isPrimaryDefaultSpace(space)) ??
      spaces.find((space) => isDefaultSpace(space)) ??
      spaces[0] ??
      null,
    [spaces],
  );
  const defaultSpaceId = defaultSpace?.id;
  const selectedSpace = useMemo(
    () => spaces.find((space) => space.id === selectedSpaceId) ?? null,
    [selectedSpaceId, spaces],
  );
  const selectedSpaceIsDefault = selectedSpace
    ? isDefaultSpace(selectedSpace)
    : true;
  const composerSpaces = useMemo(
    () =>
      spaces.map((space) => ({
        id: space.id,
        name: space.name || space.slug || "Space",
      })),
    [spaces],
  );
  const mentionTargets = useMemo(
    () => buildNewThreadMentionTargets(mentionTargetData),
    [mentionTargetData],
  );
  const defaultAgentId = useMemo(
    () =>
      mentionTargets.find(
        (target) =>
          target.targetType === "AGENT" && target.isDefaultAgent === true,
      )?.targetId ?? null,
    [mentionTargets],
  );

  useEffect(() => {
    if (spaceId && spaces.some((space) => space.id === spaceId)) {
      setSelectedSpaceId(spaceId);
      return;
    }
    if (
      selectedSpaceId &&
      spaces.some((space) => space.id === selectedSpaceId)
    ) {
      return;
    }
    if (defaultSpaceId) {
      setSelectedSpaceId(defaultSpaceId);
    }
  }, [defaultSpaceId, selectedSpaceId, spaceId, spaces]);

  async function handleSubmit(
    files: File[],
    mentions: SpacesComposerMention[],
    agentRequested: boolean,
    runtimePreference: AgentRuntimePreference = "local",
  ) {
    const trimmed = prompt.trim();
    if (!trimmed && files.length === 0) return;
    const targetSpaceId = selectedSpace?.id ?? defaultSpaceId ?? undefined;
    if (!tenantId || (!computerId && !targetSpaceId)) {
      setError(
        noAssignedComputers && !targetSpaceId
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
      const shouldAttemptDesktopLocalPi =
        agentRequested !== false &&
        runtimePreference !== "managed" &&
        (await shouldUseDesktopLocalPiDispatchNow());

      if (
        files.length === 0 &&
        agentRequested !== false &&
        !shouldAttemptDesktopLocalPi
      ) {
        const result = await createThread({
          input: {
            tenantId,
            ...(computerId ? { computerId } : {}),
            spaceId: targetSpaceId,
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
        navigateToCreatedThread(
          navigate,
          threadId,
          targetSpaceId,
          defaultSpaceId,
        );
        return;
      }

      // Files present, or human-only text: create first, then send the first
      // message through sendMessage so agentRequested can be honored.
      const created = await createThread({
        input: {
          tenantId,
          ...(computerId ? { computerId } : {}),
          spaceId: targetSpaceId,
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
      const desktopLocalAgentId =
        created.data?.createThread?.agentId ?? defaultAgentId;
      if (shouldAttemptDesktopLocalPi && !desktopLocalAgentId) {
        setError("Local Pi could not start because the thread has no agent.");
        return;
      }

      let attachmentRefs: { attachmentId: string }[] = [];
      if (files.length > 0) {
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
          setError(
            `${uploadResult.failures.length} attachment${uploadResult.failures.length === 1 ? "" : "s"} could not be uploaded. Sending the files that finished.`,
          );
        }

        attachmentRefs = uploadResult.uploaded.map((a) => ({
          attachmentId: a.attachmentId,
        }));
      }
      const sendInput: SendMessageVars["input"] = {
        threadId,
        role: "USER",
        content: trimmed,
        mentions,
      };
      if (attachmentRefs.length > 0) {
        sendInput.metadata = JSON.stringify({ attachments: attachmentRefs });
      }
      if (agentRequested === false) {
        sendInput.agentRequested = false;
      } else if (shouldAttemptDesktopLocalPi && desktopLocalAgentId) {
        sendInput.dispatchMode = "DESKTOP_LOCAL";
      } else if (runtimePreference === "managed") {
        sendInput.dispatchMode = "MANAGED_DEFAULT";
      }
      const sent = await sendMessage({
        input: sendInput,
      });
      if (sent.error) {
        setError(
          attachmentRefs.length > 0
            ? "Files uploaded, but the first message did not send. Try sending the message again."
            : (sent.error.message ?? "Failed to send the first message"),
        );
        return;
      }

      if (sendInput.dispatchMode === "DESKTOP_LOCAL" && desktopLocalAgentId) {
        dispatchDesktopLocalPiEvent("running");
        try {
          await getDesktopBridge()?.pi?.startTurn({
            agentId: desktopLocalAgentId,
            threadId,
            messageId: sent.data?.sendMessage?.id,
            userMessage: trimmed,
          });
        } catch (err) {
          dispatchDesktopLocalPiEvent("fallback");
          setError(
            "Local Pi could not start. The message was saved; use cloud fallback for the next turn.",
          );
          console.warn("[desktop-local-pi] startTurn failed:", err);
          return;
        }
      }

      navigateToCreatedThread(
        navigate,
        threadId,
        targetSpaceId,
        defaultSpaceId,
      );
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
        ) : noAssignedComputers &&
          spaces.length === 0 &&
          !computersFetching &&
          !spacesFetching ? (
          <p className="mx-auto max-w-md text-center text-sm text-muted-foreground">
            You do not have access to a workspace yet. Ask your tenant operator
            to assign one before starting work.
          </p>
        ) : null}

        <SpacesComposer
          value={prompt}
          onChange={setPrompt}
          onSubmit={handleSubmit}
          mentionTargets={mentionTargets}
          spaces={composerSpaces}
          selectedSpaceId={selectedSpace?.id ?? defaultSpaceId ?? null}
          selectedSpaceIsDefault={selectedSpaceIsDefault}
          onSelectedSpaceChange={setSelectedSpaceId}
          isSubmitting={fetching || busy || computersFetching || spacesFetching}
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
  defaultSpaceId?: string,
) {
  if (spaceId && spaceId !== defaultSpaceId) {
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

function isDefaultSpace(space: SpaceSummary) {
  const slug = space.slug?.toLowerCase();
  const name = space.name?.toLowerCase();
  const templateKey = space.templateKey?.toLowerCase();
  return (
    slug === "default" ||
    slug === "general" ||
    name === "default" ||
    name === "general" ||
    templateKey === "default" ||
    templateKey === "general"
  );
}

function isPrimaryDefaultSpace(space: SpaceSummary) {
  const slug = space.slug?.toLowerCase();
  const name = space.name?.toLowerCase();
  const templateKey = space.templateKey?.toLowerCase();
  return slug === "default" || name === "default" || templateKey === "default";
}

function buildNewThreadMentionTargets(
  data: NewThreadMentionTargetsData | undefined,
): MentionTarget[] {
  const targets = (data?.tenantMentionTargets ?? []).map((target) => ({
    id: target.id,
    targetType: target.targetType,
    targetId: target.targetId,
    displayName: target.displayName,
    aliases: target.aliases ?? undefined,
    isDefaultAgent: target.isDefaultAgent ?? undefined,
    avatarUrl: target.avatarUrl,
    role: target.role,
  }));

  return targets.sort((a, b) => {
    const typeOrder =
      a.targetType === b.targetType ? 0 : a.targetType === "USER" ? -1 : 1;
    if (typeOrder !== 0) return typeOrder;
    return a.displayName.localeCompare(b.displayName);
  });
}

function dispatchDesktopLocalPiEvent(status: "running" | "idle" | "fallback") {
  window.dispatchEvent(
    new CustomEvent("thinkwork:desktop-local-pi-turn", {
      detail: { status },
    }),
  );
}
