import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "urql";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import { ComputerComposer } from "@/components/computer/ComputerComposer";
import { StarterCardGrid } from "@/components/computer/StarterCardGrid";
import { useTenant } from "@/context/TenantContext";
import {
  CreateThreadMutation,
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
  };
}

export function ComputerWorkbench() {
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

  const computerId = selectedComputer?.id ?? null;

  async function handleSubmit(files: File[]) {
    const trimmed = prompt.trim();
    if (!trimmed && files.length === 0) return;
    if (!tenantId || !computerId) {
      setError(
        noAssignedComputers
          ? "You need access to a shared Computer before starting work."
          : "Your selected Computer is not ready yet. Try again in a moment.",
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
            title: titleFromPrompt(trimmed),
            channel: "CHAT",
            firstMessage: trimmed,
          },
        });
        if (result.error) {
          setError(result.error.message ?? "Failed to start Computer work");
          return;
        }
        const threadId = result.data?.createThread?.id;
        if (!threadId) {
          setError("Thread created but no id returned");
          return;
        }
        navigate({ to: "/threads/$id", params: { id: threadId } });
        return;
      }

      // Files present: 3-call sequence.
      const created = await createThread({
        input: {
          tenantId,
          computerId,
          title: titleFromPromptWithAttachments(trimmed, files),
          channel: "CHAT",
        },
      });
      if (created.error) {
        setError(created.error.message ?? "Failed to start Computer work");
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
        },
      });
      if (sent.error) {
        setError(sent.error.message ?? "Failed to send the first message");
        return;
      }

      navigate({ to: "/threads/$id", params: { id: threadId } });
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
            {selectedComputer?.name || "ThinkWork Computer"}
          </h1>
        </header>

        {computers.length > 1 ? (
          <div className="mx-auto w-full max-w-xs">
            <Select
              value={selectedComputerId ?? undefined}
              onValueChange={setSelectedComputerId}
            >
              <SelectTrigger aria-label="Select Computer">
                <SelectValue placeholder="Select a Computer" />
              </SelectTrigger>
              <SelectContent>
                {computers.map((computer) => (
                  <SelectItem key={computer.id} value={computer.id}>
                    {computer.name || computer.slug || "Computer"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : noAssignedComputers && !computersFetching ? (
          <p className="mx-auto max-w-md text-center text-sm text-muted-foreground">
            You do not have access to a shared Computer yet. Ask your tenant
            operator to assign one before starting work.
          </p>
        ) : null}

        <ComputerComposer
          value={prompt}
          onChange={setPrompt}
          onSubmit={handleSubmit}
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

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\n/)[0]?.trim() || "New Computer thread";
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
