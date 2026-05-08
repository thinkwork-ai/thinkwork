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

    navigate({ to: "/threads/$id", params: { id: threadId } });
  }

  return (
    <main className="mx-auto flex w-full max-w-[750px] flex-1 flex-col justify-center gap-8 px-4 py-8 sm:px-6">
      <section className="grid gap-3 text-center">
        <p className="text-sm font-medium text-muted-foreground">
          ThinkWork Computer
        </p>
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          What should your Computer work on?
        </h1>
        <p className="mx-auto max-w-2xl text-sm leading-6 text-muted-foreground">
          Start with a business question. Your Computer can turn connected data
          and research into threads, dashboards, and reviewable work.
        </p>
      </section>

      <ComputerComposer
        value={prompt}
        onChange={setPrompt}
        onSubmit={handleSubmit}
        isSubmitting={fetching}
        error={error}
      />

      <StarterCardGrid onSelect={setPrompt} />
    </main>
  );
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\n/)[0]?.trim() || "New Computer task";
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}
