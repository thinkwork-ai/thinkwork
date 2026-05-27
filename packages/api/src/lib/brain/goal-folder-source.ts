import { randomUUID } from "node:crypto";

import type { BrainEnrichmentCandidate } from "./enrichment-service.js";

export interface CompletedGoalFolderRecord {
  id: string;
  tenantId: string;
  threadId: string;
  templateKey?: string | null;
  outcome: string;
  status: string;
  reviewPolicy?: unknown;
  metadata?: unknown;
  completedAt?: Date | string | null;
}

export interface CompletedGoalFolderFiles {
  goal?: string | null;
  progress?: string | null;
  decisions?: string | null;
  handoffs?: string | null;
  artifacts?: string | null;
}

export interface CompletedGoalFolderEligibility {
  eligible: boolean;
  reasons: string[];
}

export function evaluateCompletedGoalFolderEligibility(args: {
  goal: CompletedGoalFolderRecord;
  files: CompletedGoalFolderFiles;
}): CompletedGoalFolderEligibility {
  const reasons: string[] = [];
  if (args.goal.status !== "completed") reasons.push("goal_not_completed");
  if (!completionWasReviewedOrReviewOptional(args.goal)) {
    reasons.push("completion_not_reviewed_or_declared_no_review");
  }
  if (!args.files.goal?.trim()) reasons.push("missing_goal_md");
  if (!args.files.progress?.trim()) reasons.push("missing_progress_md");
  if (
    meaningfulBullets(args.files.decisions).length === 0 &&
    meaningfulBullets(args.files.handoffs).length === 0 &&
    meaningfulBullets(args.files.artifacts).length === 0
  ) {
    reasons.push("no_decisions_handoffs_or_artifacts");
  }
  return { eligible: reasons.length === 0, reasons };
}

export function completedGoalFolderToBrainCandidate(args: {
  goal: CompletedGoalFolderRecord;
  files: CompletedGoalFolderFiles;
}): {
  candidate: BrainEnrichmentCandidate | null;
  eligibility: CompletedGoalFolderEligibility;
} {
  const eligibility = evaluateCompletedGoalFolderEligibility(args);
  if (!eligibility.eligible) return { candidate: null, eligibility };

  const decisions = meaningfulBullets(args.files.decisions);
  const handoffs = meaningfulBullets(args.files.handoffs);
  const artifacts = meaningfulBullets(args.files.artifacts);
  const progress = completionLine(args.files.progress);
  const summaryParts = [
    args.goal.outcome.trim(),
    progress,
    summarizeGroup("Decisions", decisions),
    summarizeGroup("Handoffs", handoffs),
    summarizeGroup("Artifacts", artifacts),
  ].filter(Boolean);

  return {
    eligibility,
    candidate: {
      id: `candidate:${randomUUID()}`,
      title: args.goal.outcome.trim(),
      summary: summaryParts.join("\n"),
      sourceFamily: "BRAIN",
      providerId: "goal-folder",
      score: null,
      citation: {
        label: "Completed Goal folder",
        uri: null,
        sourceId: args.goal.id,
        metadata: {
          sourceType: "completed_goal_folder",
          tenantId: args.goal.tenantId,
          threadId: args.goal.threadId,
          templateKey: args.goal.templateKey ?? null,
          completedAt: dateString(args.goal.completedAt),
          eligibilityReasons: eligibility.reasons,
        },
      },
    },
  };
}

function completionWasReviewedOrReviewOptional(
  goal: CompletedGoalFolderRecord,
): boolean {
  const metadata = objectValue(goal.metadata);
  const review = objectValue(metadata?.review);
  if (review?.action === "CONFIRM_COMPLETION") return true;

  const policy = objectValue(goal.reviewPolicy);
  return policy?.required === false;
}

function meaningfulBullets(content?: string | null): string[] {
  return (content ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(
      (line) =>
        line && !/^none\b/i.test(line) && !/^none captured yet\.?$/i.test(line),
    );
}

function completionLine(content?: string | null): string | null {
  if (!content) return null;
  const required = content.match(/Required complete:\s*([^\n]+)/i)?.[1]?.trim();
  return required ? `Progress: required complete ${required}.` : null;
}

function summarizeGroup(label: string, items: string[]): string | null {
  if (items.length === 0) return null;
  const visible = items.slice(0, 3).join("; ");
  const suffix = items.length > 3 ? `; +${items.length - 3} more` : "";
  return `${label}: ${visible}${suffix}`;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function dateString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}
