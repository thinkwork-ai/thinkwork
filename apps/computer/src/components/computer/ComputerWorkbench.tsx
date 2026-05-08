import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { ComputerComposer } from "@/components/computer/ComputerComposer";
import { StarterCardGrid } from "@/components/computer/StarterCardGrid";
import { useTenant } from "@/context/TenantContext";
import { CreateThreadMutation, MyComputerQuery } from "@/lib/graphql-queries";

interface MyComputerResult {
  myComputer: { id: string; name?: string | null } | null;
}

interface CreateThreadResult {
  createThread: { id: string };
}

interface CreateThreadVars {
  input: {
    tenantId: string;
    computerId: string;
    title: string;
    channel: "CHAT";
  };
}

export function ComputerWorkbench() {
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [{ data: computerData }] = useQuery<MyComputerResult>({
    query: MyComputerQuery,
  });
  const [{ fetching }, createThread] = useMutation<
    CreateThreadResult,
    CreateThreadVars
  >(CreateThreadMutation);

  const computerId = computerData?.myComputer?.id ?? null;

  async function handleSubmit() {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    if (!tenantId || !computerId) {
      setError("Your Computer is not ready yet. Try again in a moment.");
      return;
    }

    setError(null);
    const result = await createThread({
      input: {
        tenantId,
        computerId,
        title: titleFromPrompt(trimmed),
        channel: "CHAT",
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

    navigate({ to: "/tasks/$id", params: { id: threadId } });
  }

  return (
    <section className="flex min-h-full w-full flex-1 bg-muted/30 text-foreground dark:bg-card">
      <div className="mx-auto flex w-full max-w-[750px] flex-1 flex-col justify-center gap-5 px-4 py-8 sm:px-6">
        <header className="text-center">
          <h1 className="text-balance text-3xl font-semibold leading-tight tracking-normal sm:text-4xl">
            ThinkWork Computer
          </h1>
        </header>

        <ComputerComposer
          value={prompt}
          onChange={setPrompt}
          onSubmit={handleSubmit}
          isSubmitting={fetching}
          error={error}
        />

        <StarterCardGrid onSelect={setPrompt} />
      </div>
    </section>
  );
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\n/)[0]?.trim() || "New Computer task";
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}
