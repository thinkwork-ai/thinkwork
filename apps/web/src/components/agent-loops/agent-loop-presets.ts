import type { AgentLoopDraft, AgentLoopWorkerOption } from "./agent-loop-types";
import { defaultAgentLoopDraft } from "./agent-loop-utils";

export interface AgentLoopPreset {
  id: string;
  name: string;
  description: string;
  buildDraft: (workerOptions: AgentLoopWorkerOption[]) => AgentLoopDraft;
}

export const AGENT_LOOP_PRESETS: AgentLoopPreset[] = [
  {
    id: "weekly-agent-check-in",
    name: "Weekly Agent Check-In",
    description: "A scheduled self-check loop for recurring status review.",
    buildDraft: (workerOptions) => ({
      ...defaultAgentLoopDraft(workerOptions),
      name: "Weekly Agent Check-In",
      description:
        "Review open work, summarize blockers, and recommend next actions.",
      triggerFamily: "schedule",
      scheduleType: "rate",
      scheduleExpression: "rate(7 days)",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      objective:
        "Review current work for this tenant and produce a concise weekly check-in.",
      completionCriteriaText:
        "Summarizes notable progress.\nCalls out blockers or uncertainty.\nRecommends the next action for the operator.",
      judgeMode: "self_check",
      maxIterations: "1",
      maxRuntimeMinutes: "30",
      maxTokens: "100000",
      retryBackoffMinutes: "5",
      failBehavior: "return_blocker",
      escalateOnFailure: false,
      redactionState: "summary_only",
      retainRawEvidence: false,
      retentionDays: "30",
      suitabilityGoalStable: true,
      suitabilityEvidenceAvailable: true,
      suitabilityBudgeted: true,
    }),
  },
];
