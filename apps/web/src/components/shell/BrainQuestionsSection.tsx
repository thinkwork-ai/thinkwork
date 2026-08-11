/**
 * "The Brain has a question for you" sidebar section (THINK-787).
 *
 * Lists the Brain Consult loop's open questions routed to the signed-in
 * expert. Answering opens the Teach-the-Brain dialog in question mode;
 * the answer flows through `teachBrain` with `answersQuestionId`, the
 * Brain flips the question to answered server-side, and the re-pull
 * removes it from this list. Renders nothing when the caller has no
 * open questions (most users, most of the time).
 */

import { useMemo, useState } from "react";
import { useQuery } from "urql";
import { GraduationCap } from "lucide-react";
import { SidebarGroup, SidebarGroupLabel } from "@thinkwork/ui";
import { BrainExpertQuestionsQuery } from "@/lib/graphql-queries";
import {
  TeachBrainDialog,
  type TeachBrainQuestion,
} from "@/components/workbench/TeachBrainDialog";

interface BrainExpertQuestionRow {
  id: string;
  question: string;
  why: string | null;
  domain: string | null;
  taskId: string | null;
  createdAt: string | null;
}

function ageLabel(createdAt: string | null): string | null {
  if (!createdAt) return null;
  const ms = Date.now() - Date.parse(createdAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function BrainQuestionsSection() {
  const [{ data }, reexecuteQuery] = useQuery<{
    brainExpertQuestions: BrainExpertQuestionRow[];
  }>({
    query: BrainExpertQuestionsQuery,
    requestPolicy: "cache-and-network",
  });
  const questions = useMemo(
    () => data?.brainExpertQuestions ?? [],
    [data?.brainExpertQuestions],
  );
  const [answering, setAnswering] = useState<TeachBrainQuestion | null>(null);
  // Optimistically hide answered questions until the re-pull confirms.
  const [answeredIds, setAnsweredIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const openQuestions = questions.filter((q) => !answeredIds.has(q.id));
  if (openQuestions.length === 0) return null;

  return (
    <SidebarGroup
      className="px-3 group-data-[collapsible=icon]:hidden"
      data-testid="brain-questions-section"
    >
      <SidebarGroupLabel className="h-auto px-0 text-[0.78rem] font-semibold text-sidebar-foreground">
        The Brain has a question for you ({openQuestions.length})
      </SidebarGroupLabel>
      <div className="space-y-0.5">
        {openQuestions.map((q) => (
          <button
            key={q.id}
            type="button"
            data-testid={`brain-question-${q.id}`}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={() =>
              setAnswering({
                id: q.id,
                question: q.question,
                why: q.why,
                domain: q.domain,
              })
            }
          >
            <GraduationCap className="size-3.5 shrink-0 text-sidebar-foreground/60" />
            <span className="min-w-0 flex-1 truncate text-sm">
              {q.question}
            </span>
            {q.domain ? (
              <span className="shrink-0 rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-medium leading-none text-sidebar-foreground/70">
                {q.domain}
              </span>
            ) : null}
            {ageLabel(q.createdAt) ? (
              <span className="shrink-0 text-[10px] text-sidebar-foreground/50">
                {ageLabel(q.createdAt)}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <TeachBrainDialog
        open={answering !== null}
        onOpenChange={(open) => {
          if (!open) setAnswering(null);
        }}
        question={answering ?? undefined}
        onAccepted={() => {
          if (answering) {
            setAnsweredIds((prev) => new Set(prev).add(answering.id));
          }
          reexecuteQuery({ requestPolicy: "network-only" });
        }}
      />
    </SidebarGroup>
  );
}
