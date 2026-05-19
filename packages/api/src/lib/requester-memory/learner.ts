import { createHash } from "node:crypto";
import { getDb, type Database } from "@thinkwork/database-pg";
import {
  messages,
  threadAttachments,
  threads,
} from "@thinkwork/database-pg/schema";
import { and, asc, eq } from "drizzle-orm";
import {
  appendMarkdownSection,
  renderCandidateAppendSection,
  renderDurableMemoryAppendSection,
  renderIdleLearningReport,
  renderThreadJournalAppendSection,
  upsertCandidateSection,
  upsertThreadJournalSection,
} from "./markdown.js";
import {
  syncRequesterMemoryToHindsight,
  type RequesterMemoryHindsightSyncResult,
  type SyncRequesterMemoryToHindsightInput,
} from "./hindsight-sync.js";
import {
  classifyMemoryCandidateSafety,
  type MemoryCandidateRejectReason,
} from "./safety.js";
import {
  readRequesterMemoryFile,
  writeIdleLearningReport,
  writeRequesterMemoryFileWithSnapshot,
  type ChangedRequesterMemoryFile,
} from "./storage.js";

const MAX_MESSAGES = 120;
const MAX_CANDIDATES = 20;
const MAX_CANDIDATE_TEXT_CHARS = 500;

export type LearningCandidateCategory =
  | "preference"
  | "correction"
  | "person"
  | "project"
  | "workflow"
  | "decision"
  | "negative_signal";

export type LearningCandidate = {
  category: LearningCandidateCategory;
  text: string;
  score: number;
  hash: string;
  evidenceMessageIds: string[];
};

export type RejectedLearningCandidate = {
  reason: MemoryCandidateRejectReason;
  text: string;
  evidenceMessageId: string;
};

export type LearningCandidateSummary = {
  extracted: number;
  accepted: number;
  rejected: number;
  promoted: number;
  staged: number;
  categories: Partial<Record<LearningCandidateCategory, number>>;
  durablePromotionEnabled: boolean;
};

export type ThreadIdleMemoryLearningWorkerInput = {
  runId: string;
  tenantId: string;
  threadId: string;
  computerId: string;
  requesterUserId: string;
  scheduledJobId: string;
  activitySequence: number;
  scheduledFor: string;
  lastActivityAt: string;
};

export type ThreadIdleMemoryLearningWorkerResult = {
  ok: boolean;
  status: "changed" | "no_change" | "failed";
  changedFiles: ChangedRequesterMemoryFile[];
  candidateSummary?: LearningCandidateSummary;
  reportS3Key?: string | null;
  error?: string;
  budget?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type LearnerDeps = {
  db?: Database;
  syncHindsight?: (
    input: SyncRequesterMemoryToHindsightInput,
  ) => Promise<RequesterMemoryHindsightSyncResult>;
};

type TranscriptMessage = {
  id: string;
  role: string;
  content: string | null;
  senderType: string | null;
  senderId: string | null;
  metadata: unknown;
  createdAt: Date;
};

type ThreadMetadata = {
  id: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  channel: string;
  metadata: unknown;
};

type AttachmentMetadata = {
  id: string;
  name: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: Date;
};

export async function runRequesterIdleMemoryLearning(
  input: ThreadIdleMemoryLearningWorkerInput,
  deps: LearnerDeps = {},
): Promise<ThreadIdleMemoryLearningWorkerResult> {
  const db = deps.db ?? getDb();
  const [thread, transcript, attachments, currentMemory] = await Promise.all([
    loadThreadMetadata(db, input),
    loadTranscript(db, input),
    loadAttachmentMetadata(db, input),
    readRequesterMemoryFile({
      tenantId: input.tenantId,
      userId: input.requesterUserId,
      path: "memory/MEMORY.md",
    }),
  ]);

  const { accepted, rejected, extractedCount } =
    extractLearningCandidates(transcript);
  const promotable = rehydratePromotableCandidates(accepted, transcript);
  const promoted = promotable.filter(
    (candidate) => !currentMemory?.includes(candidate.text),
  );
  const staged = accepted.filter(
    (candidate) =>
      !promotable.some(
        (promotedCandidate) => promotedCandidate.hash === candidate.hash,
      ),
  );
  const candidateSummary = summarizeCandidates({
    accepted,
    rejected,
    extractedCount,
    promoted,
    staged,
  });
  const changedFiles: ChangedRequesterMemoryFile[] = [];
  const workingPath = workingFilePath(input.scheduledFor);
  const existingWorkingMemory = await readRequesterMemoryFile({
    tenantId: input.tenantId,
    userId: input.requesterUserId,
    path: workingPath,
  });
  const journalSection = renderThreadJournalAppendSection({
    runId: input.runId,
    threadId: input.threadId,
    scheduledFor: input.scheduledFor,
    thread,
    messages: transcript,
    attachmentCount: attachments.length,
  });
  const nextWorkingMemory = upsertThreadJournalSection({
    existing: existingWorkingMemory,
    section: journalSection,
    threadId: input.threadId,
  });
  if (nextWorkingMemory !== existingWorkingMemory) {
    const workingWriteResult = await writeRequesterMemoryFileWithSnapshot({
      tenantId: input.tenantId,
      userId: input.requesterUserId,
      runId: input.runId,
      path: workingPath,
      content: nextWorkingMemory,
    });
    changedFiles.push({
      ...stripPreviousContent(workingWriteResult),
      evidenceMessageIds: transcript.map((message) => message.id),
    });
  }

  if (staged.length > 0) {
    const candidatePath = candidateFilePath(input.scheduledFor);
    const existingCandidates = await readRequesterMemoryFile({
      tenantId: input.tenantId,
      userId: input.requesterUserId,
      path: candidatePath,
    });
    const section = renderCandidateAppendSection({
      runId: input.runId,
      threadId: input.threadId,
      scheduledFor: input.scheduledFor,
      candidates: staged,
    });
    const nextCandidates = upsertCandidateSection({
      existing: existingCandidates,
      section,
      threadId: input.threadId,
    });
    if (nextCandidates !== existingCandidates) {
      const writeResult = await writeRequesterMemoryFileWithSnapshot({
        tenantId: input.tenantId,
        userId: input.requesterUserId,
        runId: input.runId,
        path: candidatePath,
        content: nextCandidates,
      });
      changedFiles.push({
        ...stripPreviousContent(writeResult),
        evidenceMessageIds: uniqueMessageIds(staged),
      });
    }
  }

  if (promoted.length > 0) {
    const section = renderDurableMemoryAppendSection({
      runId: input.runId,
      threadId: input.threadId,
      scheduledFor: input.scheduledFor,
      candidates: promoted,
    });
    const writeResult = await writeRequesterMemoryFileWithSnapshot({
      tenantId: input.tenantId,
      userId: input.requesterUserId,
      runId: input.runId,
      path: "memory/MEMORY.md",
      content: appendMarkdownSection(currentMemory, section),
    });
    changedFiles.push({
      ...stripPreviousContent(writeResult),
      evidenceMessageIds: uniqueMessageIds(promoted),
    });
  }

  const hindsightSync = await (
    deps.syncHindsight ?? syncRequesterMemoryToHindsight
  )({
    tenantId: input.tenantId,
    userId: input.requesterUserId,
    runId: input.runId,
    threadId: input.threadId,
    changedFiles,
  });
  annotateChangedFilesWithHindsight(changedFiles, hindsightSync);

  const reportMarkdown = renderIdleLearningReport({
    runId: input.runId,
    tenantId: input.tenantId,
    userId: input.requesterUserId,
    threadId: input.threadId,
    computerId: input.computerId,
    scheduledJobId: input.scheduledJobId,
    scheduledFor: input.scheduledFor,
    lastActivityAt: input.lastActivityAt,
    candidateSummary,
    candidates: accepted,
    rejectedCandidates: rejected,
    changedPaths: changedFiles.map((file) => file.path),
    transcriptMessageCount: transcript.length,
    attachmentCount: attachments.length,
    hindsightSync,
  });
  const report = await writeIdleLearningReport({
    tenantId: input.tenantId,
    userId: input.requesterUserId,
    runId: input.runId,
    markdown: reportMarkdown,
  });

  return {
    ok: true,
    status: changedFiles.length > 0 ? "changed" : "no_change",
    changedFiles,
    candidateSummary,
    reportS3Key: report.key,
    budget: {
      mode: "deterministic_slice_c",
      llmCalls: 0,
      memoryWrites: changedFiles.length,
      reportWrites: 1,
      hindsightStatus: hindsightSync.status,
    },
    metadata: {
      runId: input.runId,
      scheduledJobId: input.scheduledJobId,
      activitySequence: input.activitySequence,
      durablePromotionEnabled: true,
      hindsightSync,
      currentMemoryBytes: currentMemory
        ? Buffer.byteLength(currentMemory, "utf8")
        : 0,
      thread: thread
        ? {
            title: thread.title,
            status: thread.status,
            priority: thread.priority,
            type: thread.type,
            channel: thread.channel,
          }
        : null,
    },
  };
}

export function extractLearningCandidates(transcript: TranscriptMessage[]): {
  accepted: LearningCandidate[];
  rejected: RejectedLearningCandidate[];
  extractedCount: number;
} {
  const accepted: LearningCandidate[] = [];
  const rejected: RejectedLearningCandidate[] = [];
  const seen = new Set<string>();
  let extractedCount = 0;

  for (const message of transcript) {
    if (!isRequesterMessage(message)) continue;
    for (const statement of splitCandidateStatements(message.content ?? "")) {
      const safety = classifyMemoryCandidateSafety(statement);
      if (!safety.safe) {
        extractedCount += 1;
        rejected.push({
          reason: safety.reason,
          text: statement,
          evidenceMessageId: message.id,
        });
        continue;
      }
      const category = classifyStatement(statement);
      if (!category) continue;
      extractedCount += 1;
      const text = truncateCandidateText(statement);
      const hash = shortCandidateHash(category, text);
      if (seen.has(hash)) continue;
      seen.add(hash);
      accepted.push({
        category,
        text,
        score: scoreStatement(statement, category),
        hash,
        evidenceMessageIds: [message.id],
      });
      if (accepted.length >= MAX_CANDIDATES) {
        return { accepted, rejected, extractedCount };
      }
    }
  }

  return { accepted, rejected, extractedCount };
}

async function loadThreadMetadata(
  db: Database,
  input: ThreadIdleMemoryLearningWorkerInput,
): Promise<ThreadMetadata | null> {
  const rows = await db
    .select({
      id: threads.id,
      title: threads.title,
      status: threads.status,
      priority: threads.priority,
      type: threads.type,
      channel: threads.channel,
      metadata: threads.metadata,
    })
    .from(threads)
    .where(
      and(
        eq(threads.tenant_id, input.tenantId),
        eq(threads.id, input.threadId),
      ),
    )
    .limit(1);
  return (rows[0] as ThreadMetadata | undefined) ?? null;
}

async function loadTranscript(
  db: Database,
  input: ThreadIdleMemoryLearningWorkerInput,
): Promise<TranscriptMessage[]> {
  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      senderType: messages.sender_type,
      senderId: messages.sender_id,
      metadata: messages.metadata,
      createdAt: messages.created_at,
    })
    .from(messages)
    .where(
      and(
        eq(messages.tenant_id, input.tenantId),
        eq(messages.thread_id, input.threadId),
      ),
    )
    .orderBy(asc(messages.created_at))
    .limit(MAX_MESSAGES);
  return rows as TranscriptMessage[];
}

async function loadAttachmentMetadata(
  db: Database,
  input: ThreadIdleMemoryLearningWorkerInput,
): Promise<AttachmentMetadata[]> {
  const rows = await db
    .select({
      id: threadAttachments.id,
      name: threadAttachments.name,
      mimeType: threadAttachments.mime_type,
      sizeBytes: threadAttachments.size_bytes,
      createdAt: threadAttachments.created_at,
    })
    .from(threadAttachments)
    .where(
      and(
        eq(threadAttachments.tenant_id, input.tenantId),
        eq(threadAttachments.thread_id, input.threadId),
      ),
    )
    .orderBy(asc(threadAttachments.created_at))
    .limit(50);
  return rows as AttachmentMetadata[];
}

function isRequesterMessage(message: TranscriptMessage): boolean {
  return message.role === "user" || message.senderType === "user";
}

function splitCandidateStatements(content: string): string[] {
  return content
    .split(/(?:\n+|(?<=[.!?])\s+)/)
    .map((statement) => statement.trim().replace(/\s+/g, " "))
    .filter((statement) => statement.length >= 8);
}

function classifyStatement(
  statement: string,
): LearningCandidateCategory | null {
  if (
    /\b(?:actually|correction|that's wrong|that is wrong|instead)\b/i.test(
      statement,
    )
  ) {
    return "correction";
  }
  if (
    /\b(?:we decided|decision|decided to|the decision is)\b/i.test(statement)
  ) {
    return "decision";
  }
  if (
    /\b(?:workflow|process|when i|when we|i usually|we usually|default to)\b/i.test(
      statement,
    )
  ) {
    return "workflow";
  }
  if (
    /\b(?:project|repo|repository|customer|client|tenant)\b/i.test(statement)
  ) {
    return "project";
  }
  if (/\b(?:call me|my name is|i am|i'm|my role is)\b/i.test(statement)) {
    return "person";
  }
  if (
    /\b(?:remember|for future|keep in mind|i prefer|my preference|i like|i don't like|i do not like)\b/i.test(
      statement,
    )
  ) {
    return "preference";
  }
  if (/\b(?:avoid|don't|do not|never)\b/i.test(statement)) {
    return "negative_signal";
  }
  return null;
}

function scoreStatement(
  statement: string,
  category: LearningCandidateCategory,
): number {
  let score = 0.45;
  if (/\b(?:remember|for future|keep in mind)\b/i.test(statement))
    score += 0.25;
  if (
    /\b(?:i prefer|my preference|i like|call me|my name is)\b/i.test(statement)
  )
    score += 0.2;
  if (category === "correction" || category === "decision") score += 0.2;
  if (/\b(?:always|never|default|prefer|usually)\b/i.test(statement))
    score += 0.1;
  if (statement.length > 240) score -= 0.1;
  return Math.max(0.1, Math.min(0.95, score));
}

function summarizeCandidates(input: {
  accepted: LearningCandidate[];
  rejected: RejectedLearningCandidate[];
  extractedCount: number;
  promoted: LearningCandidate[];
  staged: LearningCandidate[];
}): LearningCandidateSummary {
  const categories: Partial<Record<LearningCandidateCategory, number>> = {};
  for (const candidate of input.accepted) {
    categories[candidate.category] = (categories[candidate.category] ?? 0) + 1;
  }
  return {
    extracted: input.extractedCount,
    accepted: input.accepted.length,
    rejected: input.rejected.length,
    promoted: input.promoted.length,
    staged: input.staged.length,
    categories,
    durablePromotionEnabled: true,
  };
}

function rehydratePromotableCandidates(
  candidates: LearningCandidate[],
  transcript: TranscriptMessage[],
): LearningCandidate[] {
  const messagesById = new Map(
    transcript.map((message) => [message.id, message]),
  );
  return candidates.filter((candidate) => {
    if (!shouldPromoteCandidate(candidate)) return false;
    return candidate.evidenceMessageIds.every((messageId) => {
      const source = messagesById.get(messageId)?.content ?? "";
      return source.includes(candidate.text);
    });
  });
}

function shouldPromoteCandidate(candidate: LearningCandidate): boolean {
  if (
    candidate.category === "negative_signal" ||
    candidate.category === "project"
  ) {
    return candidate.score >= 0.85;
  }
  if (
    candidate.category === "correction" ||
    candidate.category === "decision"
  ) {
    return candidate.score >= 0.6;
  }
  return candidate.score >= 0.7;
}

function candidateFilePath(scheduledFor: string): string {
  const date = Number.isNaN(Date.parse(scheduledFor))
    ? new Date().toISOString().slice(0, 10)
    : new Date(scheduledFor).toISOString().slice(0, 10);
  return `memory/candidates/${date}.md`;
}

function workingFilePath(scheduledFor: string): string {
  const date = Number.isNaN(Date.parse(scheduledFor))
    ? new Date().toISOString().slice(0, 10)
    : new Date(scheduledFor).toISOString().slice(0, 10);
  return `memory/working/${date}.md`;
}

function truncateCandidateText(text: string): string {
  if (text.length <= MAX_CANDIDATE_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_CANDIDATE_TEXT_CHARS - 1).trimEnd()}...`;
}

function shortCandidateHash(
  category: LearningCandidateCategory,
  text: string,
): string {
  return createHash("sha256")
    .update(`${category}\n${text.toLowerCase()}`)
    .digest("hex")
    .slice(0, 12);
}

function stripPreviousContent(
  result: ChangedRequesterMemoryFile & { previousContent?: string | null },
): ChangedRequesterMemoryFile {
  const { previousContent: _previousContent, ...rest } = result;
  return rest;
}

function uniqueMessageIds(candidates: LearningCandidate[]): string[] {
  return [
    ...new Set(candidates.flatMap((candidate) => candidate.evidenceMessageIds)),
  ];
}

function annotateChangedFilesWithHindsight(
  changedFiles: ChangedRequesterMemoryFile[],
  hindsightSync: RequesterMemoryHindsightSyncResult,
): void {
  for (const syncFile of hindsightSync.files) {
    const changedFile = changedFiles.find(
      (file) => file.path === syncFile.path,
    );
    if (!changedFile) continue;
    changedFile.hindsightDocumentId = syncFile.documentId;
    changedFile.hindsightStatus = syncFile.status;
  }
}
