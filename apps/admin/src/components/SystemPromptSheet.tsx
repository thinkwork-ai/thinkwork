import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQuery } from "urql";

import { PageSkeleton } from "@/components/PageSkeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EvalTestCaseQuery } from "@/lib/graphql-queries";
import { cn } from "@/lib/utils";

const SYSTEM_PROMPT_SHEET_WIDTH_CLASS = "data-[side=right]:max-w-none";
const SYSTEM_PROMPT_SHEET_STYLE = {
  width: "min(750px, calc(100vw - 2rem))",
  maxWidth: "none",
};

export function SystemPromptSheet({
  titleSuffix,
  capturedSystemPrompt,
  evalTestCaseId,
  open,
  onOpenChange,
  capturedDescription = "The composed system prompt the runtime ran against this case — workspace files (PLATFORM/CAPABILITIES/GUARDRAILS/MEMORY_GUIDE/SOUL/IDENTITY/USER/AGENTS/CONTEXT/TOOLS) plus the runtime tool policy, captured from the agent at invoke time.",
  fallbackDescription = "Per-case system prompt override stored on this test case. The runtime did not capture a composed prompt for this result; this is the fallback override stored on the test case row.",
  emptyDescription = "No system prompt captured for this result. Pi runtime started capturing composed prompts on 2026-05-24; older results show empty.",
  emptyMessage = "No system prompt available for this result.",
}: {
  titleSuffix?: string | null;
  /** The system prompt the runtime actually used, captured from the runtime response. */
  capturedSystemPrompt: string | null | undefined;
  /** Optional eval fallback for legacy results that only have a test-case override. */
  evalTestCaseId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  capturedDescription?: string;
  fallbackDescription?: string;
  emptyDescription?: string;
  emptyMessage?: string;
}) {
  const captured = capturedSystemPrompt?.trim() || "";
  const [tc] = useQuery({
    query: EvalTestCaseQuery,
    variables: { id: evalTestCaseId ?? "" },
    pause: !open || !evalTestCaseId || captured.length > 0,
    requestPolicy: "cache-first",
  });
  const override = tc.data?.evalTestCase?.systemPrompt?.trim() || "";
  const displayed = captured || override;
  const source: "captured" | "override" | null = captured
    ? "captured"
    : override
      ? "override"
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={cn(SYSTEM_PROMPT_SHEET_WIDTH_CLASS, "overflow-y-auto")}
        style={SYSTEM_PROMPT_SHEET_STYLE}
      >
        <SheetHeader className="border-b border-border/70 px-6 py-4 pr-14">
          <SheetTitle className="text-base leading-snug">
            System prompt
            {titleSuffix ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {titleSuffix}
              </span>
            ) : null}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {source === "captured"
              ? capturedDescription
              : source === "override"
                ? fallbackDescription
                : emptyDescription}
          </SheetDescription>
        </SheetHeader>
        <div className="px-6 py-4">
          {!captured && evalTestCaseId && tc.fetching ? (
            <PageSkeleton />
          ) : !displayed ? (
            <p className="text-sm text-muted-foreground italic">
              {emptyMessage}
            </p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {displayed}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
