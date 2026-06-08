import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
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
import { TenantSkillCatalogQuery } from "@/lib/skill-catalog-queries";
import type { SkillOption } from "@/components/spaces/SkillMenu";
import type { SpaceSummary } from "@/components/spaces/space-types";
import { isDefaultSpace } from "@/components/spaces/space-utils";
import type { MentionTarget } from "@/components/spaces/MentionMenu";
import { useTenant } from "@/context/TenantContext";
import {
  CreateThreadMutation,
  MyApprovedModelCatalogQuery,
  NewThreadMentionTargetsQuery,
  SendMessageMutation,
  SpacesQuery,
} from "@/lib/graphql-queries";
import { SettingsTenantAgentQuery } from "@/lib/settings-queries";
import { uploadThreadAttachments } from "@/lib/upload-thread-attachments";
import { getIdToken } from "@/lib/auth";
import { useAssignedComputerSelection } from "@/lib/use-assigned-computer-selection";
import { setPendingThreadStart } from "@/lib/pending-thread-starts";
import {
  chooseApprovedModelId,
  writeStoredModelId,
  type ApprovedModelOption,
} from "@/lib/approved-model-selection";

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
    modelId?: string;
  };
}

interface ApprovedModelsResult {
  myApprovedModelCatalog?: ApprovedModelOption[] | null;
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
    email?: string | null;
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
  // A NEW thread always starts at the tenant Agent's configured default model
  // (resolved below), NOT a previously remembered pick. Seeding from
  // localStorage here let a stale stored model (e.g. GPT OSS 120B chosen once)
  // permanently shadow the Agent default in chooseApprovedModelId. Start null
  // so the auto-pick effect resolves to the Agent default; an explicit change
  // in this composer still applies for the rest of the session.
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
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
  const [{ data: approvedModelData, error: approvedModelError }] =
    useQuery<ApprovedModelsResult>({
      query: MyApprovedModelCatalogQuery,
      pause: !tenantId,
      requestPolicy: "cache-and-network",
    });
  // Tenant's configured default model (Settings > Agents > Default model). New
  // threads fall back to this instead of the first approved model in the list.
  // This reads the parent Agent's `model` (what the Agents page writes via
  // updateTenantAgent), NOT tenant.settings.defaultModel — nothing populates
  // that field, so reading it made the composer silently fall through to the
  // first catalog model (e.g. GPT OSS 120B) instead of the configured default.
  const [{ data: tenantAgentData, fetching: tenantAgentFetching }] = useQuery({
    query: SettingsTenantAgentQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const tenantDefaultModelId = tenantAgentData?.agent?.model ?? null;
  // Tenant skill catalog for the `/skill` force-pin popup. No agent context yet
  // on the new-thread surface, so `installed` is unannotated and the picker
  // shows the full catalog; the blocklist guardrail is enforced at dispatch.
  const [{ data: skillCatalogData }] = useQuery({
    query: TenantSkillCatalogQuery,
    variables: { agentId: null },
    pause: !tenantId,
  });
  const skillCatalog = useMemo<SkillOption[]>(
    () => skillCatalogData?.tenantSkillCatalog ?? [],
    [skillCatalogData],
  );
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
  useEffect(() => {
    if (approvedModelError) {
      console.warn(
        "[SpacesWorkbench] failed to load approved models:",
        approvedModelError,
      );
    }
  }, [approvedModelError]);
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
      // The resolved Default Space pinned to the top; the rest sorted
      // alphabetically. Pin by id (not isDefaultSpace, which also matches
      // "General") so only the one true default floats up.
      [...spaces]
        .sort((a, b) => {
          const aDefault = a.id === defaultSpaceId;
          const bDefault = b.id === defaultSpaceId;
          if (aDefault !== bDefault) return aDefault ? -1 : 1;
          return (a.name || a.slug || "Space").localeCompare(
            b.name || b.slug || "Space",
          );
        })
        .map((space) => ({
          id: space.id,
          name: space.name || space.slug || "Space",
        })),
    [spaces, defaultSpaceId],
  );
  const mentionTargets = useMemo(
    () => buildNewThreadMentionTargets(mentionTargetData),
    [mentionTargetData],
  );
  const approvedModels = approvedModelData?.myApprovedModelCatalog;
  useEffect(() => {
    if (!approvedModels) return;
    // Wait for the tenant default to resolve before auto-picking, so a fast
    // approved-models response can't lock in the first model before the
    // configured default arrives.
    if (tenantAgentFetching) return;
    // `||` (not `??`) so an empty-string selection — which the Select control
    // can briefly emit on mount — still falls through to the tenant default.
    const nextModelId = chooseApprovedModelId(
      approvedModels,
      selectedModelId || tenantDefaultModelId,
    );
    // Only set state here; don't persist. Storage holds explicit user choices
    // (handleSelectedModelChange), so a fresh session always reflects the
    // tenant's configured default rather than a previously auto-picked model.
    if (nextModelId !== selectedModelId) {
      setSelectedModelId(nextModelId);
    }
  }, [
    approvedModels,
    selectedModelId,
    tenantDefaultModelId,
    tenantAgentFetching,
  ]);

  function handleSelectedModelChange(modelId: string) {
    // The Select control can emit an empty value during mount/teardown; ignore
    // it so it can't wipe a valid selection (and reset to the first model).
    if (!modelId) return;
    setSelectedModelId(modelId);
    writeStoredModelId(modelId);
  }

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
    pinnedSkills: string[] = [],
    requestedModelId?: string,
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
    let routed = false;
    const surfaceError = (message: string) => {
      if (routed) {
        toast.error(message);
        return;
      }
      setError(message);
    };
    try {
      // Create the thread first, route immediately, then finish message send
      // and runtime dispatch in the background. The detail route receives an
      // optimistic user-message scaffold so a new thread feels instant while
      // the server persists the first message and starts the agent turn.
      const title = titleFromPromptWithAttachments(trimmed, files);
      const created = await createThread({
        input: {
          tenantId,
          ...(computerId ? { computerId } : {}),
          spaceId: targetSpaceId,
          title,
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
      if (trimmed) {
        setPendingThreadStart({
          threadId,
          title,
          content: trimmed,
          expectAssistantResponse: agentRequested !== false,
          startedAt: new Date().toISOString(),
          attachments:
            files.length > 0
              ? files.map((file) => ({
                  name: file.name,
                  sizeBytes: file.size,
                  mimeType: file.type,
                }))
              : undefined,
        });
      }
      navigateToCreatedThread(
        navigate,
        threadId,
        targetSpaceId,
        defaultSpaceId,
      );
      routed = true;

      let attachmentRefs: { attachmentId: string }[] = [];
      if (files.length > 0) {
        const apiUrl = import.meta.env.VITE_API_URL || "";
        const token = await getIdToken();
        if (!apiUrl || !token) {
          surfaceError("Sign-in required to upload attachments");
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
          surfaceError(`Upload failed (${first.stage}): ${first.message}`);
          return;
        }
        if (uploadResult.failures.length > 0) {
          toast.warning(
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
      const metadata: Record<string, unknown> = {};
      if (attachmentRefs.length > 0) metadata.attachments = attachmentRefs;
      if (pinnedSkills.length > 0) {
        metadata.skills = pinnedSkills.map((slug) => ({ slug }));
      }
      const turnModelId = requestedModelId ?? selectedModelId;
      if (turnModelId) {
        sendInput.modelId = turnModelId;
        metadata.requestedModelId = turnModelId;
      }
      if (Object.keys(metadata).length > 0) {
        sendInput.metadata = JSON.stringify(metadata);
      }
      if (agentRequested === false) {
        sendInput.agentRequested = false;
      }
      const sent = await sendMessage({
        input: sendInput,
      });
      if (sent.error) {
        surfaceError(
          attachmentRefs.length > 0
            ? "Files uploaded, but the first message did not send. Try sending the message again."
            : (sent.error.message ?? "Failed to send the first message"),
        );
        return;
      }
    } catch (err) {
      surfaceError(err instanceof Error ? err.message : "Failed to start work");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex min-h-full w-full flex-1 bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[750px] flex-1 flex-col justify-center gap-4 px-4 pb-[12vh] pt-8 sm:px-6">
        <header className="text-center">
          <h1 className="text-balance text-2xl font-normal leading-tight tracking-normal sm:text-3xl">
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
          skillCatalog={skillCatalog}
          spaces={composerSpaces}
          selectedSpaceId={selectedSpace?.id ?? defaultSpaceId ?? null}
          selectedSpaceIsDefault={selectedSpaceIsDefault}
          onSelectedSpaceChange={setSelectedSpaceId}
          approvedModels={approvedModels ?? undefined}
          selectedModelId={selectedModelId}
          onSelectedModelChange={handleSelectedModelChange}
          isSubmitting={fetching || busy || computersFetching || spacesFetching}
          error={error}
        />
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
  navigate({
    to: "/threads/$id",
    params: { id: threadId },
  });
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
    email: target.email,
  }));

  return targets.sort((a, b) => {
    const typeOrder =
      a.targetType === b.targetType ? 0 : a.targetType === "USER" ? -1 : 1;
    if (typeOrder !== 0) return typeOrder;
    return a.displayName.localeCompare(b.displayName);
  });
}
