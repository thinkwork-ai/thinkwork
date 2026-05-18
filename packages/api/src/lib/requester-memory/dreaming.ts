import { createHash } from "node:crypto";
import { getDb, type Database } from "@thinkwork/database-pg";
import {
  messages,
  tenantMembers,
  threads,
} from "@thinkwork/database-pg/schema";
import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  appendMarkdownSection,
  renderDurableMemoryAppendSection,
} from "./markdown.js";
import {
  extractLearningCandidates,
  type LearningCandidate,
} from "./learner.js";
import {
  syncRequesterMemoryToHindsight,
  type RequesterMemoryHindsightSyncResult,
  type SyncRequesterMemoryToHindsightInput,
} from "./hindsight-sync.js";
import { invokeClaude } from "../wiki/bedrock.js";
import {
  dreamingReportPath,
  dreamingStatePath,
  listRequesterMemoryFiles,
  readRequesterMemoryFile,
  readRequesterMemorySourceFile,
  writeRequesterMemoryFileWithSnapshot,
  writeRequesterMemoryInternalFile,
  type ChangedRequesterMemoryFile,
  type RequesterMemoryFileSummary,
} from "./storage.js";

const DEFAULT_LOOKBACK_DAYS = 14;
const MAX_MESSAGES = 240;
const MAX_SOURCE_FILES = 80;
const INACTIVITY_MINUTES = 15;

type DreamingPhase = "light" | "rem" | "deep";

export type RequesterMemoryDreamingInput = {
  runId?: string;
  tenantId?: string;
  userId?: string;
  now?: string;
  force?: boolean;
  dryRun?: boolean;
  lookbackDays?: number;
};

export type RequesterMemoryDreamingUserResult = {
  tenantId: string;
  userId: string;
  status: "changed" | "no_change" | "skipped" | "failed";
  reason?: string;
  changedFiles: ChangedRequesterMemoryFile[];
  phaseSummary?: Record<DreamingPhase, unknown>;
  hindsightSync?: RequesterMemoryHindsightSyncResult;
  error?: string;
};

export type RequesterMemoryDreamingResult = {
  ok: boolean;
  runId: string;
  status: "changed" | "no_change" | "failed";
  users: RequesterMemoryDreamingUserResult[];
  budget: {
    usersConsidered: number;
    usersProcessed: number;
    llmCalls: number;
    memoryWrites: number;
    dryRun: boolean;
  };
};

type DreamingTarget = {
  tenantId: string;
  userId: string;
};

type DreamingMessage = {
  id: string;
  threadId: string | null;
  role: string;
  content: string | null;
  senderType: string | null;
  senderId: string | null;
  metadata: unknown;
  createdAt: Date;
};

type SourceDocument = {
  path: string;
  content: string;
};

type ScoredCandidate = LearningCandidate & {
  recallCount: number;
  uniqueEvidenceCount: number;
  dreamScore: number;
};

type DreamingDeps = {
  db?: Database;
  loadTargets?: (
    input: RequesterMemoryDreamingInput,
  ) => Promise<DreamingTarget[]>;
  loadRecentMessages?: (
    target: DreamingTarget,
    input: RequesterMemoryDreamingInput,
  ) => Promise<DreamingMessage[]>;
  listFiles?: (target: DreamingTarget) => Promise<RequesterMemoryFileSummary[]>;
  readSourceFile?: (
    target: DreamingTarget,
    path: string,
  ) => Promise<string | null>;
  readPublicFile?: (
    target: DreamingTarget,
    path: string,
  ) => Promise<string | null>;
  writePublicFile?: (input: {
    tenantId: string;
    userId: string;
    runId: string;
    path: string;
    content: string;
  }) => Promise<ChangedRequesterMemoryFile>;
  writeInternalFile?: (input: {
    tenantId: string;
    userId: string;
    path: string;
    content: string;
  }) => Promise<unknown>;
  reflect?: (input: ReflectionInput) => Promise<string>;
  syncHindsight?: (
    input: SyncRequesterMemoryToHindsightInput,
  ) => Promise<RequesterMemoryHindsightSyncResult>;
};

type ReflectionInput = {
  target: DreamingTarget;
  runId: string;
  now: Date;
  candidates: ScoredCandidate[];
  sourceDocuments: SourceDocument[];
};

export async function runRequesterMemoryDreaming(
  input: RequesterMemoryDreamingInput = {},
  deps: DreamingDeps = {},
): Promise<RequesterMemoryDreamingResult> {
  const runId =
    input.runId ??
    `dream-${new Date().toISOString().replace(/\W/g, "").slice(0, 14)}`;
  const targets = deps.loadTargets
    ? await deps.loadTargets(input)
    : await defaultLoadTargets(input, deps.db ?? getDb());
  const users: RequesterMemoryDreamingUserResult[] = [];
  let llmCalls = 0;

  for (const target of targets) {
    try {
      const result = await runRequesterMemoryDreamForUser(
        { ...input, runId },
        target,
        deps,
      );
      if (result.phaseSummary?.rem) llmCalls += 1;
      users.push(result);
    } catch (err) {
      users.push({
        ...target,
        status: "failed",
        changedFiles: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const failures = users.filter((user) => user.status === "failed");
  const changed = users.filter((user) => user.status === "changed");
  return {
    ok: failures.length === 0,
    runId,
    status:
      failures.length > 0
        ? "failed"
        : changed.length > 0
          ? "changed"
          : "no_change",
    users,
    budget: {
      usersConsidered: targets.length,
      usersProcessed: users.filter((user) => user.status !== "skipped").length,
      llmCalls,
      memoryWrites: users.reduce(
        (sum, user) => sum + user.changedFiles.length,
        0,
      ),
      dryRun: Boolean(input.dryRun),
    },
  };
}

export async function runRequesterMemoryDreamForUser(
  input: RequesterMemoryDreamingInput,
  target: DreamingTarget,
  deps: DreamingDeps = {},
): Promise<RequesterMemoryDreamingUserResult> {
  const runId = input.runId ?? "manual-dream";
  const now = input.now ? new Date(input.now) : new Date();
  const date = now.toISOString().slice(0, 10);
  const messagesForUser = await (
    deps.loadRecentMessages ?? defaultLoadRecentMessages
  )(target, input, deps.db ?? getDb());
  const lastUserMessageAt = latestUserMessageAt(messagesForUser, target.userId);

  if (
    !input.force &&
    lastUserMessageAt &&
    minutesBetween(now, lastUserMessageAt) < INACTIVITY_MINUTES
  ) {
    return {
      ...target,
      status: "skipped",
      reason: "user_active_within_15_minutes",
      changedFiles: [],
    };
  }

  const sourceDocuments = await loadSourceDocuments(target, deps);
  const light = runLightPhase(messagesForUser, sourceDocuments);
  if (light.candidates.length === 0) {
    return {
      ...target,
      status: "no_change",
      changedFiles: [],
      phaseSummary: {
        light: {
          candidates: 0,
          rejected: light.rejected,
          sources: sourceDocuments.length,
        },
        rem: { reflected: false, fallback: false },
        deep: { promoted: 0, compacted: false },
      },
      hindsightSync: { status: "skipped", files: [] },
    };
  }
  const reflection = await runRemPhase(
    {
      target,
      runId,
      now,
      candidates: light.candidates,
      sourceDocuments,
    },
    deps,
  );
  const deep = runDeepPhase({
    candidates: light.candidates,
    currentMemory: await readPublicMemory(target, "memory/MEMORY.md", deps),
    now,
  });
  const changedFiles: ChangedRequesterMemoryFile[] = [];

  if (!input.dryRun) {
    await writeInternal(target, deps, {
      path: dreamingStatePath(`${date}.json`),
      content: JSON.stringify(
        {
          runId,
          generatedAt: now.toISOString(),
          candidateCount: light.candidates.length,
          promotedCount: deep.promoted.length,
          sourcePaths: sourceDocuments.map((document) => document.path),
          lastUserMessageAt: lastUserMessageAt?.toISOString() ?? null,
        },
        null,
        2,
      ),
    });

    changedFiles.push(
      await writePublic(target, deps, {
        runId,
        path: dreamingReportPath("light", date),
        content: renderLightReport({ runId, now, light, sourceDocuments }),
      }),
    );
    changedFiles.push(
      await writePublic(target, deps, {
        runId,
        path: dreamingReportPath("rem", date),
        content: renderRemReport({ runId, now, reflection }),
      }),
    );
    changedFiles.push(
      await writePublic(target, deps, {
        runId,
        path: "memory/DREAMS.md",
        content: appendMarkdownSection(
          await readPublicMemory(target, "memory/DREAMS.md", deps),
          renderDreamDiarySection({ runId, now, reflection }),
        ),
      }),
    );

    if (deep.contentChanged) {
      changedFiles.push(
        await writePublic(target, deps, {
          runId,
          path: "memory/MEMORY.md",
          content: deep.nextMemory,
        }),
      );
    }
    changedFiles.push(
      await writePublic(target, deps, {
        runId,
        path: dreamingReportPath("deep", date),
        content: renderDeepReport({ runId, now, deep }),
      }),
    );
  }

  const hindsightSync = input.dryRun
    ? { status: "skipped" as const, files: [] }
    : await (deps.syncHindsight ?? syncRequesterMemoryToHindsight)({
        tenantId: target.tenantId,
        userId: target.userId,
        runId,
        threadId: "requester-memory-dreaming",
        changedFiles,
      });

  annotateChangedFilesWithHindsight(changedFiles, hindsightSync);

  return {
    ...target,
    status: changedFiles.length > 0 ? "changed" : "no_change",
    changedFiles,
    phaseSummary: {
      light: {
        candidates: light.candidates.length,
        rejected: light.rejected,
        sources: sourceDocuments.length,
      },
      rem: {
        reflected: Boolean(reflection.trim()),
        fallback: reflection.startsWith("Deterministic reflection:"),
      },
      deep: {
        promoted: deep.promoted.length,
        compacted: deep.compacted,
      },
    },
    hindsightSync,
  };
}

async function defaultLoadTargets(
  input: RequesterMemoryDreamingInput,
  db: Database,
): Promise<DreamingTarget[]> {
  if (input.tenantId && input.userId) {
    return [{ tenantId: input.tenantId, userId: input.userId }];
  }
  const conditions = [
    eq(tenantMembers.principal_type, "user"),
    eq(tenantMembers.status, "active"),
  ];
  if (input.tenantId)
    conditions.push(eq(tenantMembers.tenant_id, input.tenantId));
  const rows = await db
    .select({
      tenantId: tenantMembers.tenant_id,
      userId: tenantMembers.principal_id,
    })
    .from(tenantMembers)
    .where(and(...conditions))
    .limit(1000);
  return rows as DreamingTarget[];
}

async function defaultLoadRecentMessages(
  target: DreamingTarget,
  input: RequesterMemoryDreamingInput,
  db: Database,
): Promise<DreamingMessage[]> {
  const lookbackDays = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const rows = await db
    .select({
      id: messages.id,
      threadId: messages.thread_id,
      role: messages.role,
      content: messages.content,
      senderType: messages.sender_type,
      senderId: messages.sender_id,
      metadata: messages.metadata,
      createdAt: messages.created_at,
    })
    .from(messages)
    .leftJoin(threads, eq(messages.thread_id, threads.id))
    .where(
      and(
        eq(messages.tenant_id, target.tenantId),
        sql`${messages.created_at} >= now() - (${lookbackDays} || ' days')::interval`,
        or(
          eq(messages.sender_id, target.userId),
          eq(threads.user_id, target.userId),
          eq(threads.reporter_id, target.userId),
        ),
      ),
    )
    .orderBy(desc(messages.created_at))
    .limit(MAX_MESSAGES);
  return (rows as DreamingMessage[]).reverse();
}

async function loadSourceDocuments(
  target: DreamingTarget,
  deps: DreamingDeps,
): Promise<SourceDocument[]> {
  const files = await (deps.listFiles ?? defaultListFiles)(target);
  const sourceFiles = files
    .filter((file) => isMemorySourceForDreaming(file.path))
    .slice(0, MAX_SOURCE_FILES);
  const documents: SourceDocument[] = [];
  for (const file of sourceFiles) {
    const content = await (deps.readSourceFile ?? defaultReadSourceFile)(
      target,
      file.path,
    );
    if (content?.trim()) documents.push({ path: file.path, content });
  }
  return documents;
}

function runLightPhase(
  messagesForUser: DreamingMessage[],
  sourceDocuments: SourceDocument[],
): { candidates: ScoredCandidate[]; rejected: number } {
  const extracted = extractLearningCandidates(messagesForUser);
  const fromMemoryFiles = extractCandidatesFromSourceDocuments(sourceDocuments);
  const grouped = new Map<string, ScoredCandidate>();
  for (const candidate of [...extracted.accepted, ...fromMemoryFiles]) {
    const key = normalizedCandidateKey(candidate);
    const existing = grouped.get(key);
    if (existing) {
      existing.recallCount += 1;
      existing.uniqueEvidenceCount = new Set([
        ...existing.evidenceMessageIds,
        ...candidate.evidenceMessageIds,
      ]).size;
      existing.evidenceMessageIds = [
        ...new Set([
          ...existing.evidenceMessageIds,
          ...candidate.evidenceMessageIds,
        ]),
      ];
      existing.score = Math.max(existing.score, candidate.score);
      existing.dreamScore = scoreDreamCandidate(existing);
    } else {
      grouped.set(key, {
        ...candidate,
        recallCount: 1,
        uniqueEvidenceCount: candidate.evidenceMessageIds.length,
        dreamScore: scoreDreamCandidate({
          ...candidate,
          recallCount: 1,
          uniqueEvidenceCount: candidate.evidenceMessageIds.length,
        }),
      });
    }
  }
  return {
    candidates: [...grouped.values()].sort(
      (a, b) => b.dreamScore - a.dreamScore,
    ),
    rejected: extracted.rejected.length,
  };
}

async function runRemPhase(
  input: ReflectionInput,
  deps: DreamingDeps,
): Promise<string> {
  if (deps.reflect) return deps.reflect(input);
  try {
    const prompt = [
      "Reflect on requester memory candidates. Identify stable patterns, contradictions, and what should not be promoted. Do not invent facts.",
      "",
      "Candidates:",
      ...input.candidates
        .slice(0, 30)
        .map(
          (candidate) =>
            `- ${candidate.category} score=${candidate.dreamScore.toFixed(2)} recall=${candidate.recallCount}: ${candidate.text}`,
        ),
      "",
      "Memory source files:",
      ...input.sourceDocuments
        .slice(0, 20)
        .map(
          (document) => `- ${document.path} (${document.content.length} chars)`,
        ),
    ].join("\n");
    const response = await invokeClaude({
      system: "You are a cautious memory consolidation engine.",
      user: prompt,
      maxTokens: 1200,
      temperature: 0.2,
      modelId: process.env.REQUESTER_MEMORY_DREAMING_MODEL_ID,
    });
    return response.text.trim() || deterministicReflection(input.candidates);
  } catch (err) {
    return `${deterministicReflection(input.candidates)}\n\nLLM reflection failed: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}

function runDeepPhase(input: {
  candidates: ScoredCandidate[];
  currentMemory: string | null;
  now: Date;
}): {
  promoted: ScoredCandidate[];
  nextMemory: string;
  contentChanged: boolean;
  compacted: boolean;
} {
  const existing = input.currentMemory ?? "";
  const compacted = compactMemoryMarkdown(existing);
  const promoted = input.candidates.filter(
    (candidate) =>
      candidate.dreamScore >= 0.78 &&
      candidate.uniqueEvidenceCount >= 1 &&
      !compacted.includes(candidate.text),
  );
  const nextMemory =
    promoted.length === 0
      ? compacted
      : appendMarkdownSection(
          compacted,
          renderDurableMemoryAppendSection({
            runId: "dreaming",
            threadId: "requester-memory-dreaming",
            scheduledFor: input.now.toISOString(),
            candidates: promoted,
          }),
        );
  return {
    promoted,
    nextMemory,
    contentChanged: nextMemory !== existing,
    compacted: compacted !== existing,
  };
}

export function compactMemoryMarkdown(content: string | null): string {
  if (!content?.trim()) return "";
  const seenBullets = new Set<string>();
  const lines: string[] = [];
  for (const line of content.trimEnd().split("\n")) {
    const normalized = line.trim().replace(/\s+/g, " ").toLowerCase();
    if (line.trim().startsWith("- [")) {
      if (seenBullets.has(normalized)) continue;
      seenBullets.add(normalized);
    }
    lines.push(line);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function extractCandidatesFromSourceDocuments(
  documents: SourceDocument[],
): LearningCandidate[] {
  const candidates: LearningCandidate[] = [];
  for (const document of documents) {
    for (const line of document.content.split("\n")) {
      const match = line.match(/^- \[([a-z_]+)\]\s+(.*)$/i);
      if (!match) continue;
      const text = match[2]?.replace(/\s+Evidence:.*$/i, "").trim();
      if (!text || text.length < 8) continue;
      const category = match[1] as LearningCandidate["category"];
      if (!isLearningCandidateCategory(category)) continue;
      candidates.push({
        category,
        text,
        score: 0.62,
        hash: hashCandidate(category, text),
        evidenceMessageIds: [`source:${document.path}`],
      });
    }
  }
  return candidates;
}

function isLearningCandidateCategory(
  category: string,
): category is LearningCandidate["category"] {
  return [
    "preference",
    "correction",
    "person",
    "project",
    "workflow",
    "decision",
    "negative_signal",
  ].includes(category);
}

function renderLightReport(input: {
  runId: string;
  now: Date;
  light: { candidates: ScoredCandidate[]; rejected: number };
  sourceDocuments: SourceDocument[];
}): string {
  return [
    "# Requester Memory Dreaming: Light",
    "",
    `- Run: ${input.runId}`,
    `- Generated at: ${input.now.toISOString()}`,
    `- Source files: ${input.sourceDocuments.length}`,
    `- Rejected candidates: ${input.light.rejected}`,
    "",
    ...input.light.candidates
      .slice(0, 80)
      .map(
        (candidate) =>
          `- [${candidate.category}] dream=${candidate.dreamScore.toFixed(2)} recall=${candidate.recallCount} hash=${candidate.hash}: ${candidate.text}`,
      ),
    "",
  ].join("\n");
}

function renderRemReport(input: {
  runId: string;
  now: Date;
  reflection: string;
}): string {
  return [
    "# Requester Memory Dreaming: REM",
    "",
    `- Run: ${input.runId}`,
    `- Generated at: ${input.now.toISOString()}`,
    "",
    input.reflection.trim() || "No reflection generated.",
    "",
  ].join("\n");
}

function renderDreamDiarySection(input: {
  runId: string;
  now: Date;
  reflection: string;
}): string {
  return [
    `## Dream ${input.runId}`,
    "",
    `- Generated at: ${input.now.toISOString()}`,
    "",
    input.reflection.trim() || "No reflection generated.",
    "",
  ].join("\n");
}

function renderDeepReport(input: {
  runId: string;
  now: Date;
  deep: { promoted: ScoredCandidate[]; compacted: boolean };
}): string {
  return [
    "# Requester Memory Dreaming: Deep",
    "",
    `- Run: ${input.runId}`,
    `- Generated at: ${input.now.toISOString()}`,
    `- Promoted: ${input.deep.promoted.length}`,
    `- Compacted: ${input.deep.compacted}`,
    "",
    ...input.deep.promoted.map(
      (candidate) =>
        `- [${candidate.category}] dream=${candidate.dreamScore.toFixed(2)} hash=${candidate.hash}: ${candidate.text}`,
    ),
    "",
  ].join("\n");
}

function isMemorySourceForDreaming(path: string): boolean {
  if (!path.startsWith("memory/") || !path.endsWith(".md")) return false;
  if (path === "memory/DREAMS.md") return false;
  if (path.startsWith("memory/dreaming/")) return false;
  if (path.startsWith("memory/reports/")) return false;
  if (path.includes("/.")) return false;
  return true;
}

function scoreDreamCandidate(candidate: {
  score: number;
  recallCount: number;
  uniqueEvidenceCount: number;
}): number {
  return Math.min(
    0.98,
    candidate.score +
      Math.min(candidate.recallCount - 1, 3) * 0.08 +
      Math.min(candidate.uniqueEvidenceCount - 1, 3) * 0.04,
  );
}

function normalizedCandidateKey(candidate: LearningCandidate): string {
  return `${candidate.category}:${candidate.text.toLowerCase().replace(/\W+/g, " ").trim()}`;
}

function hashCandidate(category: string, text: string): string {
  return createHash("sha256")
    .update(`${category}\n${text.toLowerCase()}`)
    .digest("hex")
    .slice(0, 12);
}

function deterministicReflection(candidates: ScoredCandidate[]): string {
  const top = candidates.slice(0, 5);
  if (top.length === 0)
    return "Deterministic reflection: no stable memory candidates found.";
  return [
    "Deterministic reflection: strongest requester memory signals:",
    ...top.map(
      (candidate) =>
        `- ${candidate.category}: ${candidate.text} (dream=${candidate.dreamScore.toFixed(2)}, recall=${candidate.recallCount})`,
    ),
  ].join("\n");
}

function latestUserMessageAt(
  messagesForUser: DreamingMessage[],
  userId: string,
): Date | null {
  const userMessages = messagesForUser.filter(
    (message) =>
      message.role === "user" ||
      message.senderType === "user" ||
      message.senderId === userId,
  );
  return userMessages.reduce<Date | null>((latest, message) => {
    if (!latest || message.createdAt > latest) return message.createdAt;
    return latest;
  }, null);
}

function minutesBetween(now: Date, then: Date): number {
  return (now.getTime() - then.getTime()) / 60_000;
}

async function defaultListFiles(
  target: DreamingTarget,
): Promise<RequesterMemoryFileSummary[]> {
  return listRequesterMemoryFiles(target);
}

async function defaultReadSourceFile(
  target: DreamingTarget,
  path: string,
): Promise<string | null> {
  return readRequesterMemorySourceFile({ ...target, path });
}

async function readPublicMemory(
  target: DreamingTarget,
  path: string,
  deps: DreamingDeps,
): Promise<string | null> {
  return (deps.readPublicFile ?? defaultReadPublicFile)(target, path);
}

async function defaultReadPublicFile(
  target: DreamingTarget,
  path: string,
): Promise<string | null> {
  return readRequesterMemoryFile({ ...target, path });
}

async function writePublic(
  target: DreamingTarget,
  deps: DreamingDeps,
  input: { runId: string; path: string; content: string },
): Promise<ChangedRequesterMemoryFile> {
  return (deps.writePublicFile ?? writeRequesterMemoryFileWithSnapshot)({
    tenantId: target.tenantId,
    userId: target.userId,
    ...input,
  });
}

async function writeInternal(
  target: DreamingTarget,
  deps: DreamingDeps,
  input: { path: string; content: string },
): Promise<unknown> {
  return (deps.writeInternalFile ?? writeRequesterMemoryInternalFile)({
    tenantId: target.tenantId,
    userId: target.userId,
    ...input,
  });
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
