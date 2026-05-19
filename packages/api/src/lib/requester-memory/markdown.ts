import { createHash } from "node:crypto";
import type {
  LearningCandidate,
  LearningCandidateSummary,
  RejectedLearningCandidate,
} from "./learner.js";
import type { RequesterMemoryHindsightSyncResult } from "./hindsight-sync.js";
import type { RequesterThreadDigestRetainResult } from "./hindsight-primary.js";

export function renderCandidateAppendSection(input: {
  runId: string;
  threadId: string;
  scheduledFor: string;
  candidates: LearningCandidate[];
}): string {
  const lines = [
    `## Candidate thread ${input.threadId}`,
    "",
    `- Thread: ${input.threadId}`,
    `- Scheduled for: ${input.scheduledFor}`,
    "",
  ];

  for (const candidate of input.candidates) {
    lines.push(
      `- [${candidate.category}] score=${candidate.score.toFixed(2)} message=${candidate.evidenceMessageIds.join(", ")} hash=${candidate.hash}`,
      `  ${candidate.text}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

export function upsertCandidateSection(input: {
  existing: string | null;
  section: string;
  threadId: string;
}): string {
  return upsertSecondLevelSection(input, (sectionLines) => {
    const heading = sectionLines[0]?.trimEnd();
    return (
      heading === `## Candidate thread ${input.threadId}` ||
      sectionLines.some(
        (line) => line.trimEnd() === `- Thread: ${input.threadId}`,
      )
    );
  });
}

export function appendMarkdownSection(
  existing: string | null,
  section: string,
): string {
  const base = existing?.trimEnd();
  if (!base) return `${section.trimEnd()}\n`;
  return `${base}\n\n${section.trimEnd()}\n`;
}

export function upsertThreadJournalSection(input: {
  existing: string | null;
  section: string;
  threadId: string;
}): string {
  return upsertSecondLevelSection(input, (sectionLines) => {
    const heading = sectionLines[0]?.trimEnd();
    return heading === `## Thread ${input.threadId}`;
  });
}

function upsertSecondLevelSection(
  input: {
    existing: string | null;
    section: string;
  },
  shouldRemoveSection: (sectionLines: string[]) => boolean,
): string {
  const base = input.existing?.trimEnd();
  if (!base) return `${input.section.trimEnd()}\n`;

  const lines = base.split("\n");
  const nextLines: string[] = [];

  for (let index = 0; index < lines.length; ) {
    if (!/^##\s+/.test(lines[index]?.trimEnd() ?? "")) {
      nextLines.push(lines[index] ?? "");
      index += 1;
      continue;
    }

    const sectionStart = index;
    index += 1;
    while (
      index < lines.length &&
      !/^##\s+/.test(lines[index]?.trimEnd() ?? "")
    ) {
      index += 1;
    }
    const sectionLines = lines.slice(sectionStart, index);
    if (!shouldRemoveSection(sectionLines)) {
      nextLines.push(...sectionLines);
    }
  }

  const compacted = nextLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return appendMarkdownSection(compacted || null, input.section);
}

export function renderDurableMemoryAppendSection(input: {
  runId: string;
  threadId: string;
  scheduledFor: string;
  candidates: LearningCandidate[];
}): string {
  const lines = [
    `## Learned from thread ${input.threadId}`,
    "",
    `- Run: ${input.runId}`,
    `- Learned at: ${input.scheduledFor}`,
    "",
  ];

  for (const candidate of input.candidates) {
    lines.push(
      `- [${candidate.category}] ${candidate.text}`,
      `  Evidence: ${candidate.evidenceMessageIds.join(", ")}; score=${candidate.score.toFixed(2)}; hash=${candidate.hash}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

export function renderProcessedThreadMemoryDigestSection(input: {
  threadId: string;
  scheduledFor: string;
  thread: {
    title: string;
    status: string;
    priority: string;
    type: string;
    channel: string;
  } | null;
  messageCount: number;
  attachmentCount: number;
  candidateSummary: LearningCandidateSummary;
  promoted: LearningCandidate[];
  staged: LearningCandidate[];
  rejectedCandidates: RejectedLearningCandidate[];
}): string {
  const lines = [
    `## Thread ${input.threadId}`,
    "",
    `- Captured at: ${input.scheduledFor}`,
    `- Title: ${input.thread?.title?.trim() || "Untitled thread"}`,
    `- Type: ${input.thread?.type ?? "unknown"}`,
    `- Channel: ${input.thread?.channel ?? "unknown"}`,
    `- Status: ${input.thread?.status ?? "unknown"}`,
    `- Priority: ${input.thread?.priority ?? "unknown"}`,
    `- Messages reviewed: ${input.messageCount}`,
    `- Attachments reviewed: ${input.attachmentCount}`,
    `- Candidates extracted: ${input.candidateSummary.extracted}`,
    `- Candidates accepted: ${input.candidateSummary.accepted}`,
    `- Candidates promoted: ${input.candidateSummary.promoted}`,
    `- Candidates staged: ${input.candidateSummary.staged}`,
    `- Candidates rejected: ${input.candidateSummary.rejected}`,
    "",
    "### Promoted Memory",
    "",
    ...renderDigestCandidateLines(input.promoted),
    "",
    "### Staged Memory Candidates",
    "",
    ...renderDigestCandidateLines(input.staged),
    "",
    "### Rejected Signals",
    "",
    ...renderDigestRejectedLines(input.rejectedCandidates),
    "",
  ];

  return lines.join("\n");
}

export function renderIdleLearningReport(input: {
  runId: string;
  tenantId: string;
  userId: string;
  threadId: string;
  computerId: string;
  scheduledJobId: string;
  scheduledFor: string;
  lastActivityAt: string;
  candidateSummary: LearningCandidateSummary;
  candidates: LearningCandidate[];
  rejectedCandidates: RejectedLearningCandidate[];
  changedPaths: string[];
  transcriptMessageCount: number;
  attachmentCount: number;
  hindsightSync?: RequesterMemoryHindsightSyncResult;
  primaryHindsightRetain?: RequesterThreadDigestRetainResult;
}): string {
  const reportJson = {
    runId: input.runId,
    tenantId: input.tenantId,
    userId: input.userId,
    threadId: input.threadId,
    computerId: input.computerId,
    scheduledJobId: input.scheduledJobId,
    scheduledFor: input.scheduledFor,
    lastActivityAt: input.lastActivityAt,
    candidateSummary: input.candidateSummary,
    changedPaths: input.changedPaths,
    transcriptMessageCount: input.transcriptMessageCount,
    attachmentCount: input.attachmentCount,
    primaryHindsightRetain: input.primaryHindsightRetain ?? null,
    hindsightSync: input.hindsightSync ?? null,
  };

  return [
    "# Requester Idle-Learning Report",
    "",
    "Generated by requester idle memory learner.",
    "",
    "```json",
    JSON.stringify(reportJson, null, 2),
    "```",
    "",
    "## Candidates",
    "",
    ...renderCandidateLines(input.candidates),
    "",
    "## Rejected",
    "",
    ...renderRejectedLines(input.rejectedCandidates),
    "",
  ].join("\n");
}

function renderCandidateLines(candidates: LearningCandidate[]): string[] {
  if (candidates.length === 0) return ["- None"];
  return candidates.map(
    (candidate) =>
      `- [${candidate.category}] score=${candidate.score.toFixed(2)} hash=${candidate.hash}: ${candidate.text}`,
  );
}

function renderRejectedLines(rejected: RejectedLearningCandidate[]): string[] {
  if (rejected.length === 0) return ["- None"];
  return rejected.map(
    (candidate) =>
      `- [${candidate.reason}] message=${candidate.evidenceMessageId} hash=${shortHash(candidate.text)}`,
  );
}

function renderDigestCandidateLines(candidates: LearningCandidate[]): string[] {
  if (candidates.length === 0) return ["- None"];
  return candidates.map(
    (candidate) =>
      `- [${candidate.category}] ${candidate.text}\n  Evidence: ${candidate.evidenceMessageIds.join(", ")}; score=${candidate.score.toFixed(2)}; hash=${candidate.hash}`,
  );
}

function renderDigestRejectedLines(
  rejected: RejectedLearningCandidate[],
): string[] {
  if (rejected.length === 0) return ["- None"];
  return rejected.map(
    (candidate) =>
      `- [${candidate.reason}] evidence=${candidate.evidenceMessageId} hash=${shortHash(candidate.text)}`,
  );
}

function shortHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}
