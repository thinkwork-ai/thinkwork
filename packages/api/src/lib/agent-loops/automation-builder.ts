import { RUNTIME_INFERRED_COMPLETION_CRITERION } from "./automation-draft.js";
import {
  renderQuestionMarkdown,
  type UserQuestionInput,
} from "../user-questions/question-message.js";

export const AUTOMATION_LOOP_DESIGNER_SKILL_SLUG = "automation-loop-designer";

export const AUTOMATION_LOOP_DESIGNER_SOURCE =
  "https://github.com/ksimback/looper";

export interface AutomationBuilderDraftInput {
  builderThreadId: string;
  prompt?: string | null;
  title?: string | null;
}

export interface AutomationBuilderDraft {
  creationMode: "chat";
  name: string;
  description: string;
  lifecycleStatus: "active";
  enabled: true;
  triggerFamily: "manual";
  scheduleType: "rate";
  scheduleExpression: "rate(7 days)";
  timezone: "UTC";
  objective: string;
  completionCriteriaText: string;
  workerId: string;
  judgeMode: "self_check";
  judgeCriteriaText: string;
  maxIterations: string;
  maxRuntimeMinutes: string;
  maxTokens: string;
  costBudgetUsd: string;
  retryBackoffMinutes: string;
  failBehavior: "return_blocker";
  escalateOnFailure: false;
  redactionState: "summary_only";
  retainRawEvidence: false;
  retentionDays: string;
  suitabilityGoalStable: false;
  suitabilityEvidenceAvailable: false;
  suitabilityBudgeted: false;
  builderThreadId: string;
  sourceMetadata: Record<string, unknown>;
}

export function buildAutomationBuilderDraft(
  input: AutomationBuilderDraftInput,
): AutomationBuilderDraft {
  const prompt = stringValue(input.prompt);
  const name =
    stringValue(input.title) || titleFromPrompt(prompt) || "Draft Automation";

  return {
    creationMode: "chat",
    name,
    description: "Created from an Automation Builder chat.",
    lifecycleStatus: "active",
    enabled: true,
    triggerFamily: "manual",
    scheduleType: "rate",
    scheduleExpression: "rate(7 days)",
    timezone: "UTC",
    objective: prompt,
    completionCriteriaText: "",
    workerId: "",
    judgeMode: "self_check",
    judgeCriteriaText: "",
    maxIterations: "1",
    maxRuntimeMinutes: "30",
    maxTokens: "100000",
    costBudgetUsd: "",
    retryBackoffMinutes: "5",
    failBehavior: "return_blocker",
    escalateOnFailure: false,
    redactionState: "summary_only",
    retainRawEvidence: false,
    retentionDays: "30",
    suitabilityGoalStable: false,
    suitabilityEvidenceAvailable: false,
    suitabilityBudgeted: false,
    builderThreadId: input.builderThreadId,
    sourceMetadata: {
      createdFrom: "settings.automations.chat",
      creationMode: "chat",
      builderThreadId: input.builderThreadId,
      prompt,
      goalInference: "runtime_inferred",
      defaultCompletionCriterion: RUNTIME_INFERRED_COMPLETION_CRITERION,
      designerSkill: AUTOMATION_LOOP_DESIGNER_SKILL_SLUG,
      designerSource: AUTOMATION_LOOP_DESIGNER_SOURCE,
      designerSourceLicense: "MIT",
      designerSourceAuthor: "Kevin Simback",
    },
  };
}

export function buildAutomationBuilderOpeningMessage(input: {
  prompt?: string | null;
}): string {
  const intro = buildAutomationBuilderIntroMessage(input);
  const questionMarkdown = renderQuestionMarkdown(
    buildAutomationBuilderQuestions(),
  );
  return `${intro}\n\n${questionMarkdown}`;
}

export function buildAutomationBuilderIntroMessage(input: {
  prompt?: string | null;
}): string {
  const prompt = stringValue(input.prompt);
  const promptLine = prompt
    ? `\n\nStarting prompt:\n${prompt}`
    : "\n\nStart by telling me what you want this Automation to do.";

  return [
    "I will help turn this into a ThinkWork Automation.",
    "",
    "I will tighten the goal, identify the Space where it should run, choose a trigger, define what counts as done, and decide whether the judge can self-check or should escalate.",
    "",
    "I will use the Automation Loop Designer skill, adapted from Looper's design-coaching pattern, to keep the loop reviewable before it runs.",
    promptLine,
  ].join("\n");
}

export function buildAutomationBuilderQuestions(): UserQuestionInput[] {
  return [
    {
      header: "Goal",
      question: "What should the Automation accomplish each time it runs?",
      options: [
        {
          label: "Use my prompt",
          description: "Treat the prompt as the initial goal.",
        },
        {
          label: "I'll explain",
          description: "Answer with more detail in the composer.",
        },
      ],
    },
    {
      header: "Space",
      question: "Which Space should it run in?",
      options: [
        {
          label: "Default Space",
          description: "Use the Agent settings default Space.",
        },
        {
          label: "I'll choose",
          description: "Name the Space in my reply.",
        },
      ],
    },
    {
      header: "Trigger",
      question: "Should it run manually or on a schedule?",
      options: [
        {
          label: "Manual",
          description: "Run only when I start it.",
        },
        {
          label: "Schedule",
          description: "Run on a recurring cadence.",
        },
      ],
    },
    {
      header: "Done",
      question:
        "What evidence or final response would convince you it is done?",
      options: [
        {
          label: "Summary",
          description: "A concise status summary is enough.",
        },
        {
          label: "I'll define",
          description: "Answer with explicit completion criteria.",
        },
      ],
    },
  ];
}

function titleFromPrompt(prompt: string): string {
  if (!prompt) return "";
  const firstLine = prompt.split(/\r?\n/)[0]?.trim() ?? "";
  const words = firstLine.split(/\s+/).filter(Boolean).slice(0, 8);
  if (words.length === 0) return "";
  return words.join(" ").replace(/[.?!,:;]+$/g, "");
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
