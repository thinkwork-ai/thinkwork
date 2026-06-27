/**
 * Plan §005 U9 — Trusted handler shell (the keystone unit).
 *
 * This is the production entry point for the agentcore-pi Lambda /
 * AgentCore runtime container. It binds U4-U8 into a single per-invocation
 * orchestrator:
 *
 *   - U4: AuroraSessionStore — Pi's session-blob persistence.
 *   - U5: run_skill ToolDef   — subprocess bridge to Python script-skills.
 *   - U6: Memory ToolDefs     — AgentCore Managed OR Hindsight, selected by
 *                                MEMORY_ENGINE env. Both modules are imported;
 *                                only the active one's tools reach the agent.
 *   - U7: HandleStore + buildMcpTools — handle-shaped Authorization, with the
 *                                       real `connectMcpServer` factory wired
 *                                       in here (no inert default).
 *   - U8: AgentCore Code Interpreter sandbox factory.
 *
 * Lifecycle invariants (FR-3a + FR-4a):
 *
 *   1. EVERY invocation gets a fresh HandleStore. The `try { … } finally {
 *      handleStore.clear() }` wrap below is load-bearing — without it, a warm
 *      Lambda container would carry handles across invocations and cross-
 *      tenant isolation would silently fail.
 *   2. Identity (tenantId, userId, agentId, threadId) is snapshotted at
 *      payload-parse time and never re-read from `process.env`.
 *   3. API_AUTH_SECRET / THINKWORK_API_URL come from the invocation payload
 *      (chat-agent-invoke fills them) and are snapshotted at the same time
 *      (see `feedback_completion_callback_snapshot_pattern`).
 *   4. MCP URLs are validated BEFORE handle minting so a malicious payload
 *      cannot exfiltrate handles by pointing them at file:// or IMDS.
 *   5. Connect failures + bearer-rejected configs surface through
 *      `onConnectError` → `logStructured` → CloudWatch. The agent loses one
 *      MCP server's tools but the turn proceeds.
 *
 * Worker isolation (U16): U9 ships the handler with an in-process Agent
 * loop — no `worker_thread.spawn(...)` yet. Per the plan, U16 wraps this
 * loop in a worker so handle resolution + response-body scrubbing happen
 * outside the trusted handler's address space. Until U16, the handle store
 * is functionally equivalent to a bearer (anyone with code execution in this
 * process can read it). The handle scheme is still load-bearing — it's the
 * wire format the worker thread will key off of.
 */

import http from "node:http";
import { mkdir, readlink, stat } from "node:fs/promises";
import path from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  createAnalyticsDisplayExtension,
  createAskUserQuestionExtension,
  createBrowserAutomationExtension,
  createContextEngineExtension,
  createDelegationExtension,
  createFetchWorkspaceSourceExtension,
  createKnowledgeGraphExtension,
  createSkillsExtension,
  createMemoryExtension,
  createOkfWikiNavigatorExtension,
  createSendEmailExtension,
  createSystemPromptExtension,
  createTaskStatusExtension,
  createWebExtractExtension,
  createWebSearchExtension,
  type AgentToolResult,
  formatWorkspaceSkills,
  toExtensionFactory,
  type ExtensionFactory,
  type FetchWorkspaceSourceHost,
  type ProviderBundle,
  type ThinkworkExtension,
} from "@thinkwork/pi-extensions";
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  BUILTIN_TOOL_NAMES,
  OKF_WIKI_NAVIGATOR_LIMITS,
  buildEmitJsonRenderUiTool,
  collectToolCosts,
  createActivityEmitter,
  type ActivityEmitEvent,
  type DelegationProvider,
  isFinalizeCallbackConfigured,
  normalizeHistory,
  normalizeApprovedModelIds,
  normalizeModelRoutingPolicy,
  postFinalizeCallback,
  readActivityCallbackConfig,
  runAgentLoop,
  type AgentProfileRunRecord,
  type ChildModelCaller,
  type InvocationResponse,
  type PiRetainStatus,
  type RunAgentLoopResult,
  type SessionStore,
  type ToolCostRecord,
  type ToolInvocationRecord,
  type WorkspaceBaseline,
} from "@thinkwork/pi-runtime-core";

import {
  InvocationValidationError,
  logAgentCorePhase,
  logStructured,
  snapshotIdentity,
  snapshotRuntimeEnv,
  snapshotSecrets,
  validateMcpUrl,
  type IdentitySnapshot,
  type LogFields,
  type RuntimeEnvSnapshot,
  type SecretsSnapshot,
} from "./handler-context.js";
import {
  HandleStore,
  buildMcpTools,
  type ConnectMcpServerFn,
  type McpRuntimeRecordLinkHints,
  type McpServerConfig,
} from "./mcp.js";
import { createConnectMcpServer } from "./mcp-connect.js";
import {
  McpToolRegistry,
  validateDirectTools,
  type DirectToolsMismatch,
} from "./mcp-registry.js";
import {
  AGENT_PROFILE_TOOL_NAME,
  buildAgentProfileDelegationTool,
  clarificationEscalationInstruction,
  normalizeAgentProfiles,
  runAgentProfileDelegationWithClarification,
  type PendingClarificationEscalation,
  type ProfileDelegationToolOptions,
} from "./agent-profile-delegation.js";
import type { AgentProfileConfig } from "./agent-profile-adapter.js";
import { buildMcpProxyTool } from "./mcp-proxy.js";
import {
  readMcpJson,
  McpJsonError,
  type McpJsonConfig,
} from "./runtime/mcp-json.js";
import {
  createPiGoalExtensionFactory,
  extractGoalRunEvidence,
  goalCommandForRuntimeMode,
  hasPiGoalMode,
  PI_GOAL_TOOL_NAMES,
} from "./runtime/pi-goal-adapter.js";
import { createScrubbingFetch } from "./scrubbing-fetch.js";
import { buildMemoryTools } from "./tools/memory.js";
import { createHindsightMemoryProvider } from "./runtime/providers/hindsight-memory-provider.js";
import { createApiKnowledgeGraphProvider } from "./runtime/providers/knowledge-graph-provider.js";
import { createOkfWikiProvider } from "./runtime/providers/okf-wiki-provider.js";
import {
  AuroraSessionStore,
  type AuroraSessionStoreOptions,
} from "./sessionstore-aurora.js";
import { resolveSandboxFactory } from "./runtime/sandbox-factory.js";
import { bootstrapWorkspace } from "./runtime/bootstrap-workspace.js";
import {
  appendFetchedFilesToWorkspaceBaseline,
  collectLocalWorkspaceChangedFiles,
  createLocalWorkspaceBaseline,
} from "./runtime/workspace-diff.js";
import { createS3SessionStore } from "./runtime/session-store.js";
import {
  buildFileReadTool,
  cleanupMessageAttachments,
  formatMessageAttachmentsPreamble,
  stageMessageAttachments,
} from "./runtime/message-attachments.js";
import {
  retainConversation,
  type RetainPayloadInput,
} from "./runtime/tools/memory-retain-client.js";
import { buildExecuteCodeTool } from "./runtime/tools/execute-code.js";
import { runAgentCoreBrowserAutomation } from "./runtime/browser-automation-runner.js";
import {
  discoverWorkspaceSkills,
  type WorkspaceSkill,
} from "./runtime/workspace-skills.js";
import {
  loadPinnedSkills,
  mergeWorkspaceSkills,
  parsePinnedSkillRefs,
} from "./runtime/pinned-skills.js";
import {
  SKILL_CREATOR_WORKSPACE_SKILL_SLUG,
  formatSkillCreatorCommandContext,
  parseSkillCreatorCommandPayload,
} from "./runtime/skill-drafts.js";
import {
  formatUserQuestionAnswerContext,
  parsePendingUserQuestions,
  resumeDelegationContextDetails,
} from "./user-question-context.js";
import {
  createIntakeQuestionPost,
  detectLeakedAskUserQuestion,
  rescueLeakedAskUserQuestion,
  turnAlreadyAskedUserQuestion,
} from "./ask-user-question-rescue.js";

const PORT = Number(process.env.PORT || 8080);

export {
  collectToolCosts,
  isFinalizeCallbackConfigured,
  normalizeHistory,
  postFinalizeCallback,
  runAgentLoop,
};
export type {
  InvocationResponse,
  PiRetainStatus,
  RunAgentLoopResult,
  ToolCostRecord,
  ToolInvocationRecord,
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function profileAliases(profile: AgentProfileConfig): string[] {
  return [profile.name, profile.slug].filter(Boolean);
}

function stripProfileMentions(
  message: string,
  profiles: readonly AgentProfileConfig[],
): string {
  let task = message.trim();
  for (const profile of profiles) {
    for (const alias of profileAliases(profile)) {
      const pattern = new RegExp(
        `(^|\\s)[#@]${escapeRegExp(alias)}(?=$|\\s|[.,!?;:])`,
        "giu",
      );
      task = task.replace(pattern, "$1").trim();
    }
  }
  return task || message.trim();
}

function explicitAgentProfileSlugsFromMessage(
  message: string,
  profiles: readonly AgentProfileConfig[],
): string[] {
  const matches: Array<{ index: number; slug: string }> = [];
  for (const profile of profiles) {
    for (const alias of profileAliases(profile)) {
      const pattern = new RegExp(
        `(^|\\s)[#@]${escapeRegExp(alias)}(?=$|\\s|[.,!?;:])`,
        "giu",
      );
      for (const match of message.matchAll(pattern)) {
        matches.push({
          index: match.index + (match[1]?.length ?? 0),
          slug: profile.slug,
        });
      }
    }
  }
  const seen = new Set<string>();
  return matches
    .sort((a, b) => a.index - b.index)
    .flatMap((match) => {
      if (seen.has(match.slug)) return [];
      seen.add(match.slug);
      return [match.slug];
    });
}

const EMAIL_ADDRESS_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;

function redactEmailAddresses(message: string): string {
  return message.replace(EMAIL_ADDRESS_PATTERN, " [redacted-address] ");
}

function containsEmailAddress(message: string): boolean {
  return new RegExp(EMAIL_ADDRESS_PATTERN).test(message);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const text = asString(item);
        return text ? [text] : [];
      })
    : [];
}

function trustedWorkspaceSkillIds(
  payload: Record<string, unknown>,
): Set<string> {
  const explicit = stringArray(payload.trusted_skill_ids);
  if (explicit.length > 0) return new Set(explicit);

  const skills = Array.isArray(payload.skills) ? payload.skills : [];
  return new Set(
    skills.flatMap((skill) => {
      if (!skill || typeof skill !== "object") return [];
      const skillId = asString((skill as { skillId?: unknown }).skillId);
      return skillId ? [skillId] : [];
    }),
  );
}

function requestedAgentProfileSlugs(input: {
  payload: Record<string, unknown>;
  message: string;
  profiles: readonly AgentProfileConfig[];
}): string[] {
  const explicit = explicitAgentProfileSlugsFromMessage(
    input.message,
    input.profiles,
  );
  if (explicit.length > 0) return explicit;

  const requested = [
    ...stringArray(input.payload.requested_agent_profile_slugs),
    asString(input.payload.requested_agent_profile_slug),
  ].flatMap((slug) => {
    const normalized = slug.toLowerCase();
    return normalized ? [normalized] : [];
  });
  const seen = new Set<string>();
  return requested.flatMap((slug) => {
    if (seen.has(slug)) return [];
    seen.add(slug);
    return [slug];
  });
}

function syntheticProfileToolInvocation(input: {
  evidence: AgentProfileRunRecord;
  profileSlug: string;
  task: string;
}): ToolInvocationRecord {
  return {
    id: input.evidence.profileRunId,
    name: AGENT_PROFILE_TOOL_NAME,
    tool_name: AGENT_PROFILE_TOOL_NAME,
    args: { profileSlug: input.profileSlug, task: input.task },
    result: { agent_profile_run: input.evidence },
    input_preview: JSON.stringify({
      profileSlug: input.profileSlug,
      task: input.task,
    }).slice(0, 600),
    output_preview: (input.evidence.handoffSummary ?? "").slice(0, 600),
    status: input.evidence.status,
    agent_profile_run: input.evidence,
    started_at: input.evidence.startedAt,
    finished_at: input.evidence.finishedAt,
    runtime: "pi",
  };
}

function profileChainTask(input: {
  baseTask: string;
  profile: AgentProfileConfig | undefined;
  previousRuns: readonly AgentProfileRunRecord[];
}): string {
  if (input.previousRuns.length === 0) return input.baseTask;
  const priorHandoffs = input.previousRuns
    .map((run, index) => {
      const handoff = run.handoffSummary?.trim() || "(no handoff summary)";
      return `${index + 1}. ${run.profileName}: ${handoff}`;
    })
    .join("\n\n");
  const profileName = input.profile?.name ?? "Agent Profile";
  return [
    `Original user request:\n${input.baseTask}`,
    `Prior agent profile handoffs:\n${priorHandoffs}`,
    `Your task as ${profileName}: complete only your assigned review or specialty step using the prior handoffs. Return a concise handoff summary to the parent Agent. Do not answer the user directly.`,
  ].join("\n\n");
}

function parentProfileChainMessage(input: {
  originalMessage: string;
  baseTask: string;
  runs: readonly AgentProfileRunRecord[];
}): string {
  const handoffs = input.runs
    .map((run, index) => {
      const handoff = run.handoffSummary?.trim() || "(no handoff summary)";
      return `${index + 1}. ${run.profileName} (${run.status}): ${handoff}`;
    })
    .join("\n\n");
  return [
    `Original user request:\n${input.baseTask}`,
    `The user explicitly requested these Agent Profile handoffs in this turn:\n${handoffs}`,
    "You are the parent Agent. Decide the next step from these handoffs and produce the final user-facing response. If a Reviewer handoff says the work passes, answer the user concisely using the verified result. If a Reviewer handoff identifies a blocking issue, do not present the unverified answer; either call the appropriate Agent Profile again with the feedback or explain the issue and next step.",
    `Raw user message for reference:\n${input.originalMessage}`,
  ].join("\n\n");
}

function isReviewerProfile(profile: AgentProfileConfig | undefined): boolean {
  if (!profile) return false;
  const builtInKey = profile.builtInKey?.toLowerCase() ?? "";
  const slug = profile.slug.toLowerCase();
  const name = profile.name.toLowerCase();
  return (
    builtInKey === "reviewer" || slug === "reviewer" || name === "reviewer"
  );
}

function maxReviewLoopsForProfile(
  profile: AgentProfileConfig | undefined,
): number {
  const loopPolicy = profile?.executionControls?.loopPolicy;
  const configured =
    loopPolicy?.maxReviewLoops ??
    profile?.executionControls?.maxReviewLoops ??
    1;
  return Math.max(0, Math.min(5, Math.trunc(configured)));
}

function retrySpecialistTask(input: {
  baseTask: string;
  specialist: AgentProfileConfig;
  reviewerRun: AgentProfileRunRecord;
}): string {
  const feedback =
    input.reviewerRun.handoff?.feedback?.trim() ||
    input.reviewerRun.handoff?.summary?.trim() ||
    input.reviewerRun.handoffSummary?.trim() ||
    "Reviewer requested revision without structured feedback.";
  return [
    `Original user request:\n${input.baseTask}`,
    `Reviewer feedback:\n${feedback}`,
    `Your task as ${input.specialist.name}: revise only the delegated work that the Reviewer identified. Return a new concise handoff to the parent Agent. Do not answer the user directly.`,
  ].join("\n\n");
}

function combineProfileChainRunResult(input: {
  parent: RunAgentLoopResult;
  profileRuns: readonly AgentProfileRunRecord[];
  profileToolInvocations: readonly ToolInvocationRecord[];
}): RunAgentLoopResult {
  return {
    ...input.parent,
    toolsCalled: [
      ...new Set([
        ...input.profileToolInvocations.map(
          (invocation) => invocation.tool_name,
        ),
        ...input.parent.toolsCalled,
      ]),
    ],
    toolInvocations: [
      ...input.profileToolInvocations,
      ...input.parent.toolInvocations,
    ],
    agentProfileRuns: [
      ...input.profileRuns,
      ...(input.parent.agentProfileRuns ?? []),
    ],
    toolCosts: input.parent.toolCosts,
  };
}

/** Parent message for a chain that unwound on needs_clarification (plan 005
 *  U6). Replaces the produce-the-final-response framing with the escalation
 *  instruction: answer from context and re-delegate, or ask_user_question. */
function parentClarificationChainMessage(input: {
  originalMessage: string;
  baseTask: string;
  runs: readonly AgentProfileRunRecord[];
  clarification: PendingClarificationEscalation;
}): string {
  const handoffs = input.runs
    .map((run, index) => {
      const handoff = run.handoffSummary?.trim() || "(no handoff summary)";
      return `${index + 1}. ${run.profileName} (${run.status}): ${handoff}`;
    })
    .join("\n\n");
  return [
    `Original user request:\n${input.baseTask}`,
    `Agent Profile handoffs so far in this turn:\n${handoffs}`,
    "You are the parent Agent. The delegation chain stopped because a specialist needs clarification; no further profiles ran.",
    clarificationEscalationInstruction(input.clarification),
    `Raw user message for reference:\n${input.originalMessage}`,
  ].join("\n\n");
}

export async function runParentOwnedProfileOrchestration(input: {
  originalMessage: string;
  baseTask: string;
  requestedProfiles: readonly AgentProfileConfig[];
  profileDelegationOptions: ProfileDelegationToolOptions;
  parentRunInput: Parameters<typeof runAgentLoop>[0];
  runLoop: typeof runAgentLoop;
  log: (entry: LogFields) => void;
  emitActivity: (event: ActivityEmitEvent) => void;
  /** Wraps the parent prompt (e.g. with the U4 answer-context block) right
   *  before the parent loop runs — the orchestration owns the chain message,
   *  so the caller cannot pre-compose it. */
  wrapParentMessage?: (message: string) => string;
}): Promise<RunAgentLoopResult> {
  const profileRuns: AgentProfileRunRecord[] = [];
  const profileToolInvocations: ToolInvocationRecord[] = [];
  // Set when a specialist hands off needs_clarification and the budget/eval
  // conversion did NOT apply: the chain unwinds (no further profiles run)
  // and the parent gets the escalation instruction (plan 005 U6).
  let pendingClarification: PendingClarificationEscalation | undefined;

  const executeProfile = async (
    profile: AgentProfileConfig,
    task: string,
  ): Promise<AgentProfileRunRecord> => {
    const outcome = await runAgentProfileDelegationWithClarification({
      options: input.profileDelegationOptions,
      profileSlug: profile.slug,
      task,
      // Record the unwrapped base task in the surfaced delegation context so
      // the R20 budget can re-match it on the resume turn.
      delegationTaskForContext: input.baseTask,
    });
    for (const run of outcome.runs) {
      profileRuns.push(run);
      profileToolInvocations.push(
        syntheticProfileToolInvocation({
          evidence: run,
          profileSlug: profile.slug,
          task,
        }),
      );
    }
    if (outcome.clarification) {
      pendingClarification = outcome.clarification;
    }
    return outcome.evidence;
  };

  chain: for (const profile of input.requestedProfiles) {
    const evidence = await executeProfile(
      profile,
      profileChainTask({
        baseTask: input.baseTask,
        profile,
        previousRuns: profileRuns,
      }),
    );
    if (pendingClarification) break;
    if (!isReviewerProfile(profile) || evidence.handoff?.verdict !== "revise") {
      continue;
    }

    const specialist = [...input.requestedProfiles]
      .slice(0, input.requestedProfiles.indexOf(profile))
      .reverse()
      .find((candidate) => !isReviewerProfile(candidate));
    if (!specialist) continue;

    const maxReviewLoops = Math.min(
      maxReviewLoopsForProfile(specialist),
      maxReviewLoopsForProfile(profile),
    );
    // reviewLoops counts ONLY revise cycles; clarification cycles are
    // handled inside runAgentProfileDelegationWithClarification (conversion
    // re-invoke) or unwind the chain — they never consume this budget (R20).
    let reviewLoops = 0;
    let reviewerEvidence = evidence;
    while (
      reviewerEvidence.handoff?.verdict === "revise" &&
      reviewLoops < maxReviewLoops
    ) {
      await executeProfile(
        specialist,
        retrySpecialistTask({
          baseTask: input.baseTask,
          specialist,
          reviewerRun: reviewerEvidence,
        }),
      );
      if (pendingClarification) break chain;
      reviewLoops += 1;
      reviewerEvidence = await executeProfile(
        profile,
        profileChainTask({
          baseTask: input.baseTask,
          profile,
          previousRuns: profileRuns,
        }),
      );
      if (pendingClarification) break chain;
    }
  }

  const wrap = input.wrapParentMessage ?? ((message: string) => message);
  const parentMessage = pendingClarification
    ? parentClarificationChainMessage({
        originalMessage: input.originalMessage,
        baseTask: input.baseTask,
        runs: profileRuns,
        clarification: pendingClarification,
      })
    : parentProfileChainMessage({
        originalMessage: input.originalMessage,
        baseTask: input.baseTask,
        runs: profileRuns,
      });
  const parentResult = await input.runLoop(
    {
      ...input.parentRunInput,
      message: wrap(parentMessage),
    },
    {
      log: input.log,
      emitActivity: input.emitActivity,
    },
  );
  return combineProfileChainRunResult({
    parent: parentResult,
    profileRuns,
    profileToolInvocations,
  });
}

function inferAutomaticAgentProfileSlug(
  message: string,
  profiles: AgentProfileConfig[],
): string {
  const hasEmailAddress = containsEmailAddress(message);
  const normalized = redactEmailAddresses(message).toLowerCase();
  const strongResearchIntent =
    /\b(research|cite|citation|web search|search the web|find current)\b/i.test(
      normalized,
    );
  const genericResearchIntent =
    /\b(source|sources|latest|current|today)\b/i.test(normalized);
  const emailDeliveryCommand =
    /\b(send|email|mail|forward|share|draft|reply)\b/i.test(normalized);
  const researchIntent =
    strongResearchIntent ||
    (genericResearchIntent && !(hasEmailAddress && emailDeliveryCommand));
  if (!researchIntent) return "";

  const researchProfile = profiles.find((profile) => {
    const builtInKey = profile.builtInKey?.toLowerCase() ?? "";
    const slug = profile.slug.toLowerCase();
    const name = profile.name.toLowerCase();
    return (
      builtInKey === "research" || slug === "research" || name === "research"
    );
  });
  return researchProfile?.slug ?? "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberFromRecord(
  record: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function extractConverseText(response: unknown): string {
  const output = asRecord(asRecord(response)?.output);
  const message = asRecord(output?.message);
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .map((part) => asString(asRecord(part)?.text))
    .filter(Boolean)
    .join("\n");
}

export function createBedrockChildModelCaller(
  client: BedrockRuntimeClient,
): ChildModelCaller {
  return async (input) => {
    const response = await client.send(
      new ConverseCommand({
        modelId: input.modelId,
        system: [{ text: input.systemPrompt }],
        messages: [
          {
            role: "user",
            content: [{ text: input.prompt }],
          },
        ],
        inferenceConfig: {
          maxTokens: 2048,
          temperature: 0,
        },
      }),
    );
    const usage = asRecord(response.usage);
    const cachedReadTokens =
      numberFromRecord(usage, "cacheReadInputTokens") ??
      numberFromRecord(usage, "cacheReadTokens");
    const cachedWriteTokens =
      numberFromRecord(usage, "cacheWriteInputTokens") ??
      numberFromRecord(usage, "cacheWriteTokens");
    return {
      text: extractConverseText(response),
      stopReason: asString(response.stopReason) || undefined,
      usage: {
        inputTokens: numberFromRecord(usage, "inputTokens"),
        outputTokens: numberFromRecord(usage, "outputTokens"),
        totalTokens: numberFromRecord(usage, "totalTokens"),
        cachedReadTokens,
        cachedWriteTokens,
      },
    };
  };
}

interface RuntimePhaseDiagnostic {
  phase: string;
  status: "started" | "completed" | "failed" | "skipped";
  duration_ms?: number;
  detail?: string;
  count?: number;
}

interface RuntimeDiagnostics {
  agentcore_phases: RuntimePhaseDiagnostic[];
  agentcore_timings_ms: Record<string, number>;
  workspace_diagnostics?: Record<string, unknown>;
}

function mergeRuntimeDiagnostics(
  runResult: RunAgentLoopResult,
  diagnostics: RuntimeDiagnostics,
): RunAgentLoopResult {
  const existingDiagnostics = runResult.diagnostics ?? {};
  const existingWorkspaceDiagnostics =
    existingDiagnostics.workspace_diagnostics &&
    typeof existingDiagnostics.workspace_diagnostics === "object" &&
    !Array.isArray(existingDiagnostics.workspace_diagnostics)
      ? (existingDiagnostics.workspace_diagnostics as Record<string, unknown>)
      : {};
  return {
    ...runResult,
    diagnostics: {
      ...existingDiagnostics,
      agentcore_phases: diagnostics.agentcore_phases,
      agentcore_timings_ms: diagnostics.agentcore_timings_ms,
      ...(diagnostics.workspace_diagnostics
        ? {
            workspace_diagnostics: {
              ...existingWorkspaceDiagnostics,
              ...diagnostics.workspace_diagnostics,
            },
          }
        : {}),
    },
  };
}

async function ensureWorkspaceDir(workspaceDir: string): Promise<void> {
  try {
    await mkdir(workspaceDir, { recursive: true });
    return;
  } catch (err) {
    if (
      !(
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === "ENOENT"
      )
    ) {
      throw err;
    }
  }

  const target = await readlink(workspaceDir);
  const absoluteTarget = path.resolve(path.dirname(workspaceDir), target);
  await mkdir(absoluteTarget, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
}

function parseMcpConfigs(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const url = asString(record.url);
    const serverName =
      asString(record.name) || asString(record.serverName) || url;
    const auth =
      record.auth && typeof record.auth === "object"
        ? (record.auth as Record<string, unknown>)
        : undefined;
    const bearer = asString(auth?.token) || asString(record.bearer);
    const authHeaders =
      auth?.headers && typeof auth.headers === "object"
        ? stringRecord(auth.headers as Record<string, unknown>)
        : {};
    const extraHeaders = {
      ...stringRecord(record.extraHeaders),
      ...authHeaders,
    };
    const trustedInternal = record.trustedInternal === true;
    if (
      !url ||
      !serverName ||
      (!bearer && Object.keys(extraHeaders).length === 0 && !trustedInternal)
    ) {
      return [];
    }
    return [
      {
        serverName,
        url,
        ...(bearer ? { bearer } : {}),
        ...(Object.keys(extraHeaders).length > 0 ? { extraHeaders } : {}),
        ...(trustedInternal ? { trustedInternal } : {}),
        transport: record.transport === "sse" ? "sse" : "streamable-http",
        toolWhitelist: Array.isArray(record.tools)
          ? (record.tools.filter(
              (tool): tool is string => typeof tool === "string",
            ) as string[])
          : undefined,
        recordLinkHints: parseMcpRecordLinkHints(record.recordLinkHints),
      } as McpServerConfig,
    ];
  });
}

const RECORD_LINK_FIELD_RE =
  /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*){0,4}$/;
const RECORD_LINK_OBJECT_TYPE_RE = /^[a-z][a-z0-9-]{1,63}$/;
const RECORD_LINK_TEMPLATE_SEGMENT_RE = /^[A-Za-z0-9._~-]+$|^\{id\}$/;
const RECORD_LINK_FORBIDDEN_FIELD_PARTS = [
  "auth_config",
  "authorization",
  "cookie",
  "token",
  "secret",
  "password",
  "credential",
  "header",
];

function parseMcpRecordLinkHints(
  value: unknown,
): McpRuntimeRecordLinkHints | undefined {
  const hints = recordOrNull(value);
  if (!hints) return undefined;
  if (hints.schemaVersion !== 1 || hints.source !== "plugin-manifest") {
    return undefined;
  }
  const browserBaseUrl =
    typeof hints.browserBaseUrl === "string" ? hints.browserBaseUrl : "";
  if (!isSafeRecordLinkBrowserBaseUrl(browserBaseUrl)) return undefined;
  if (!Array.isArray(hints.routes) || hints.routes.length === 0) {
    return undefined;
  }

  const routes: McpRuntimeRecordLinkHints["routes"] = [];
  const seenObjectTypes = new Set<string>();
  for (const route of hints.routes) {
    const normalizedRoute = parseMcpRecordLinkRoute(route);
    if (!normalizedRoute) return undefined;
    if (seenObjectTypes.has(normalizedRoute.objectType)) return undefined;
    seenObjectTypes.add(normalizedRoute.objectType);
    routes.push(normalizedRoute);
  }

  const workspace = recordOrNull(hints.workspace);
  const normalizedWorkspace =
    workspace === undefined
      ? undefined
      : parseMcpRecordLinkWorkspace(workspace);
  if (workspace !== undefined && !normalizedWorkspace) return undefined;

  return {
    schemaVersion: 1,
    source: "plugin-manifest",
    browserBaseUrl,
    routes,
    ...(normalizedWorkspace ? { workspace: normalizedWorkspace } : {}),
  };
}

function parseMcpRecordLinkRoute(
  value: unknown,
): McpRuntimeRecordLinkHints["routes"][number] | undefined {
  const route = recordOrNull(value);
  if (!route) return undefined;
  const objectType =
    typeof route.objectType === "string" ? route.objectType : "";
  const routeTemplate =
    typeof route.routeTemplate === "string" ? route.routeTemplate : "";
  if (!RECORD_LINK_OBJECT_TYPE_RE.test(objectType)) return undefined;
  if (!isSafeRecordLinkRouteTemplate(routeTemplate)) return undefined;
  const idFields = parseMcpRecordLinkFieldList(route.idFields);
  const labelFields = parseMcpRecordLinkFieldList(route.labelFields);
  if (route.idFields !== undefined && !idFields) return undefined;
  if (route.labelFields !== undefined && !labelFields) return undefined;
  return {
    objectType,
    routeTemplate,
    ...(idFields ? { idFields } : {}),
    ...(labelFields ? { labelFields } : {}),
  };
}

function parseMcpRecordLinkWorkspace(
  value: Record<string, unknown>,
): { hashField: string } | undefined {
  const hashField = typeof value.hashField === "string" ? value.hashField : "";
  if (!isSafeRecordLinkField(hashField)) return undefined;
  return { hashField };
}

function parseMcpRecordLinkFieldList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const fields: string[] = [];
  const seen = new Set<string>();
  for (const field of value) {
    if (!isSafeRecordLinkField(field)) return undefined;
    if (seen.has(field)) return undefined;
    seen.add(field);
    fields.push(field);
  }
  return fields;
}

function isSafeRecordLinkField(value: unknown): value is string {
  if (typeof value !== "string" || !RECORD_LINK_FIELD_RE.test(value)) {
    return false;
  }
  const normalized = value.toLowerCase();
  const parts = normalized.split(/[_.-]+/);
  return (
    !parts.includes("auth") &&
    !RECORD_LINK_FORBIDDEN_FIELD_PARTS.some((part) => normalized.includes(part))
  );
}

function isSafeRecordLinkRouteTemplate(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (/[?#\\%\s<>\[\]()"']/.test(value)) return false;
  if (/[\u0000-\u001F\u007F]/.test(value)) return false;
  const placeholders = value.match(/\{[^}]*\}/g) ?? [];
  if (placeholders.length !== 1 || placeholders[0] !== "{id}") return false;
  const segments = value.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0)) return false;
  let idSegmentCount = 0;
  for (const segment of segments) {
    if (segment === "." || segment === "..") return false;
    if (!RECORD_LINK_TEMPLATE_SEGMENT_RE.test(segment)) return false;
    if (segment === "{id}") idSegmentCount += 1;
  }
  return idSegmentCount === 1;
}

function isSafeRecordLinkBrowserBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.href === url.origin + "/" &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && isLocalRecordLinkOrigin(url)))
    );
  } catch {
    return false;
  }
}

function isLocalRecordLinkOrigin(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("127.") ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function recordOrNull(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === "string" && typeof entry[1] === "string",
    ),
  );
}

function instrumentSessionStore(
  store: SessionStore,
  context: {
    tenantId: string;
    agentId: string;
    agentSlug: string;
    threadId: string;
    threadTurnId?: string;
    traceId?: string;
  },
): SessionStore {
  return {
    async read(key) {
      const start = Date.now();
      const result = await store.read(key);
      const durationMs = Date.now() - start;
      logStructured({
        level: "info",
        event: "session_store_read",
        tenantId: context.tenantId,
        agentId: context.agentId,
        agentSlug: context.agentSlug,
        threadId: context.threadId,
        key,
        status: result ? "hit" : "miss",
        durationMs,
      });
      logAgentCorePhase({
        phase: "runtime.session_resume",
        status: result ? "completed" : "skipped",
        tenantId: context.tenantId,
        agentId: context.agentId,
        agentSlug: context.agentSlug,
        threadId: context.threadId,
        threadTurnId: context.threadTurnId,
        traceId: context.traceId,
        runtimeType: "pi",
        durationMs,
        detail: result ? "hit" : "miss",
      });
      return result;
    },

    async write(key, body, expectedVersion) {
      const start = Date.now();
      const version = await store.write(key, body, expectedVersion);
      logStructured({
        level: "info",
        event: "session_store_write",
        tenantId: context.tenantId,
        agentId: context.agentId,
        agentSlug: context.agentSlug,
        threadId: context.threadId,
        key,
        mode: expectedVersion === null ? "create" : "update",
        durationMs: Date.now() - start,
      });
      return version;
    },
  };
}

// ---------------------------------------------------------------------------
// Construction helpers — broken out so tests can swap factories.
// ---------------------------------------------------------------------------

export interface HandlerDependencies {
  /** AgentCore client factory — overridden in tests with aws-sdk-client-mock. */
  agentCoreClientFactory: () => BedrockAgentCoreClient;
  /** S3 client factory — overridden in tests. */
  s3ClientFactory: (region: string) => S3Client;
  /**
   * Lambda client factory — used by end-of-turn auto-retain to invoke the
   * `memory-retain` Lambda. Overridden in tests with a stubbed client.
   */
  lambdaClientFactory: (region: string) => LambdaClient;
  /** Bedrock Runtime client factory for model-routed child executions. */
  bedrockRuntimeClientFactory: (region: string) => BedrockRuntimeClient;
  /** Optional override for model-routed child execution (test-only). */
  childModelCaller?: ChildModelCaller;
  /** Optional override for the MCP connect factory (tests inject fakes). */
  connectMcpServerFactory?: ConnectMcpServerFn;
  /**
   * Optional override for the SessionStore constructor (tests inject fakes).
   * Production callers omit this and the default `AuroraSessionStore` runs.
   */
  sessionStoreFactory?: (opts: AuroraSessionStoreOptions) => AuroraSessionStore;
  /**
   * Optional override for the completion-callback HTTP fetch (tests inject
   * fakes). Production uses native `fetch` at invocation time.
   */
  fetchImpl?: typeof fetch;
  /** Optional override for the agent loop (test-only). */
  runAgentLoop?: typeof runAgentLoop;
  /** Optional override for the workspace S3 sync (test-only). */
  bootstrapWorkspaceImpl?: typeof bootstrapWorkspace;
  /** Optional override for per-turn attachment staging (test-only). */
  stageMessageAttachmentsImpl?: typeof stageMessageAttachments;
  /**
   * Optional override for workspace-skills discovery (test-only). The default
   * walks the local workspace tree.
   */
  discoverWorkspaceSkillsImpl?: typeof discoverWorkspaceSkills;
  /**
   * Test seam — invoked after the per-invocation `try { … } finally { … }`
   * block exits, with the assembled tool bundle. Tests use this to verify
   * the HandleStore was cleared regardless of how the agent loop completed.
   * Production callers omit this; the runtime never observes the bundle
   * after cleanup.
   */
  onHandlerComplete?: (bundle: InvocationResourceBundle) => void;
}

const defaultDependencies: HandlerDependencies = {
  agentCoreClientFactory: () => new BedrockAgentCoreClient({}),
  s3ClientFactory: (region: string) => new S3Client({ region }),
  lambdaClientFactory: (region: string) => new LambdaClient({ region }),
  bedrockRuntimeClientFactory: (region: string) =>
    new BedrockRuntimeClient({ region }),
};

// ---------------------------------------------------------------------------
// Tool assembly — pure given the snapshots + payload + factories.
// ---------------------------------------------------------------------------

export interface InvocationResourceBundle {
  tools: AgentTool<any>[];
  /**
   * Plan §004 U5 — Pi extension factories loaded into the session's resource
   * loader alongside `tools`. Each is a capability from
   * `@thinkwork/pi-extensions` bound to its U3 provider bundle. Memory is the
   * first (the tracer bullet); U7 ports the rest. The agent loop forwards these
   * to `DefaultResourceLoader.extensionFactories`.
   */
  extensionFactories: ExtensionFactory[];
  /**
   * Tool names registered by the loaded extensions (e.g. memory's
   * `recall`/`reflect`). The agent loop folds these into the
   * `createAgentSession` allowlist — without them the SDK gates extension tools
   * out (they register but never reach the model). U6.
   */
  extensionToolNames: string[];
  cleanup: Array<() => Promise<void>>;
  workspaceSkills: WorkspaceSkill[];
  handleStore: HandleStore;
  /**
   * Plan §006 U4 — true when the inert `mcp` proxy AgentTool was added to
   * `tools` for this invocation. Surfaced onto the response payload as
   * `mcp_proxy_registered` so the post-deploy smoke can pin the
   * registration substrate. False when no MCP configs were present after
   * URL validation (no proxy needed when there's nothing to gateway to —
   * avoids polluting the agent's tool list when MCP is unused).
   */
  mcpProxyRegistered: boolean;
}

export interface BuildInvocationResourcesArgs {
  payload: Record<string, unknown>;
  identity: IdentitySnapshot;
  env: RuntimeEnvSnapshot;
  agentCoreClient: BedrockAgentCoreClient;
  workspaceSkills: WorkspaceSkill[];
  connectMcpServer: ConnectMcpServerFn;
  sessionStoreFactory: (opts: AuroraSessionStoreOptions) => AuroraSessionStore;
  /**
   * Per-invocation cleanup queue, allocated by the caller and shared with the
   * MCP connect factory. Tool builders push teardown closures here; the
   * trusted handler drains it in `finally`. Required so MCP transport
   * teardown lands in the SAME array the handler drains — not a private
   * array owned by the factory.
   */
  cleanup: Array<() => Promise<void>>;
  /**
   * U16 — Per-invocation `HandleStore` allocated by the caller. The
   * scrubbing fetch passed into `createConnectMcpServer` resolves
   * handles against THIS store; if the resource builder created its own
   * private one, the fetch would hold a stale reference and resolve
   * would always fail. Must be the same instance across the
   * trusted-handler / MCP-connect / buildMcpTools triangle.
   */
  handleStore: HandleStore;
  /**
   * Plan §006 U4 — parsed mcp.json workspace config (directTools allowlist
   * plus any future per-server fields). The trusted handler reads the
   * file post-bootstrap; this argument is the parsed result. An empty
   * `directTools` array means no boot-time allowlist validation runs
   * and every MCP tool is reachable only through the proxy.
   */
  mcpJsonConfig: McpJsonConfig;
  /**
   * Plan §006 U4 — per-invocation registry the MCP build path populates
   * with each (server, tool) pair. The proxy AgentTool reads from this
   * registry for list/search/call. Always allocated by the caller —
   * never module-level — so per-invocation isolation is preserved
   * alongside the HandleStore.
   */
  mcpRegistry: McpToolRegistry;
  /** Optional host seam for managed delegation. Cloud currently omits this;
   * desktop wires its provider when it adopts shared extensions in U9. */
  delegationProvider?: DelegationProvider;
  /** Optional host seam for TOOLS.md model-routed child execution. */
  childModelCaller?: ChildModelCaller;
  /**
   * Plan 2026-06-12-002 U5 — host seam for `fetch_workspace_source`:
   * workspace root + S3 download closure + diff-baseline append. Built by
   * `handleInvocation` AFTER the workspace bootstrap/baseline exist, so the
   * extension can mount fetched folders without polluting the turn diff.
   * Absent (e.g. no workspace bucket) → the tool is not registered.
   */
  fetchWorkspaceSourceHost?: FetchWorkspaceSourceHost;
}

/**
 * Plan §006 U4 — thrown by the invocation resource builder when an `mcp.json` directTools
 * entry references a (server, tool) the live MCP registry did not surface
 * after connect. The trusted handler catches this in its outer try/catch
 * and surfaces a structured 500 response so the operator sees the
 * mismatch in the agent's first turn instead of silent demotion.
 */
export class DirectToolsValidationError extends Error {
  constructor(public readonly missing: DirectToolsMismatch[]) {
    const summary = missing
      .map((m) =>
        m.reason === "server_not_configured"
          ? `${m.server}/${m.tool} (server not configured)`
          : `${m.server}/${m.tool} (server lists: [${m.availableTools.join(", ")}])`,
      )
      .join("; ");
    super(`directTools_validation_failed: ${summary}`);
    this.name = "DirectToolsValidationError";
  }
}

/**
 * The ACTIVE space's runtime folder segment, derived from the dispatch
 * payload's `turn_context.spaceSlug` exactly like the renderer's
 * `runtimeFolderSegment` (slashes collapse to dashes). The fetch tool uses it
 * to refuse remounting the already-hydrated active Space folder read-only.
 */
function activeSpaceFolderSegment(turnContext: unknown): string {
  const record =
    turnContext &&
    typeof turnContext === "object" &&
    !Array.isArray(turnContext)
      ? (turnContext as Record<string, unknown>)
      : {};
  const slug = asString(record.spaceSlug);
  if (!slug) return "";
  return slug.replace(/^\/+|\/+$/g, "").replaceAll("/", "-");
}

async function isAccessibleDirectory(directory: string): Promise<boolean> {
  const stats = await stat(directory).catch(() => null);
  return stats?.isDirectory() === true;
}

/**
 * Build the per-invocation resource surface. The capability tools and prompt
 * policy now come from shared extensions; this helper only binds the host
 * providers and the remaining Pi-specific built-ins/custom tools.
 */
export async function buildInvocationResources(
  args: BuildInvocationResourcesArgs,
): Promise<InvocationResourceBundle> {
  const tools: AgentTool<any>[] = [];
  const cleanup = args.cleanup;
  // U16 — caller allocates the HandleStore so the scrubbing fetch
  // closure (built alongside `connectMcpServer` in handleInvocation)
  // resolves handles against the same store this build mints into.
  const handleStore = args.handleStore;
  const extensionFactories: ExtensionFactory[] = [];
  const extensionToolNames: string[] = [];
  const addExtension = (
    extension: ThinkworkExtension,
    providers: ProviderBundle = {},
  ) => {
    if ((extension.toolNames?.length ?? 0) === 0) return;
    extensionFactories.push(toExtensionFactory(extension, providers));
    extensionToolNames.push(...(extension.toolNames ?? []));
  };

  const sandboxInterpreterId = asString(args.payload.sandbox_interpreter_id);
  if (sandboxInterpreterId) {
    const sandboxFactory = resolveSandboxFactory(
      args.payload as { sandbox_interpreter_id: string },
      {
        client: args.agentCoreClient,
      },
    );
    tools.push(buildExecuteCodeTool({ sandboxFactory, cleanup }));
  } else if (args.payload.sandbox_status === "ready") {
    throw new Error(
      "Pi sandbox status is ready but `sandbox_interpreter_id` is missing.",
    );
  }

  if (args.payload.browser_automation_enabled === true) {
    addExtension(
      createBrowserAutomationExtension({
        enabled: true,
        run: (request) =>
          runAgentCoreBrowserAutomation(
            {
              client: args.agentCoreClient,
              traceId: asString(args.payload.trace_id) || undefined,
            },
            request,
          ) as Promise<AgentToolResult<unknown>>,
      }),
    );
  }

  if (args.payload.thread_json_render_ui_enabled === true) {
    tools.push(buildEmitJsonRenderUiTool());
  }

  addExtension(createAnalyticsDisplayExtension());

  if (hasPiGoalMode(args.payload)) {
    extensionFactories.push(
      createPiGoalExtensionFactory({ agentDir: args.env.piAgentDir }),
    );
    extensionToolNames.push(...PI_GOAL_TOOL_NAMES);
    logStructured({
      level: "info",
      event: "pi_goal_extension_loaded",
      tenantId: args.identity.tenantId,
      threadId: args.identity.threadId,
    });
  }

  // Outbound side-effect kill list (Evaluations Trust Core U8, layer 2
  // of 2): send_email / web_search / web_extract never register under
  // eval_mode — replaying a recorded thread must not send real email or
  // hit external web APIs. The eval payload builder already strips
  // these configs (layer 1); this gate mirrors the task-status /
  // context-engine eval_mode pattern so a payload regression stays
  // inert.
  if (
    args.payload.eval_mode !== true &&
    typeof args.payload.send_email_config === "object" &&
    args.payload.send_email_config
  ) {
    addExtension(
      createSendEmailExtension({
        sendEmailConfig: args.payload.send_email_config as Record<
          string,
          unknown
        >,
        payload: args.payload,
      }),
    );
  }

  if (
    args.payload.eval_mode !== true &&
    args.identity.tenantId &&
    args.identity.agentId &&
    args.identity.threadId &&
    asString(args.payload.thinkwork_api_url) &&
    asString(args.payload.thinkwork_api_secret)
  ) {
    addExtension(
      createTaskStatusExtension({
        taskStatusConfig: {
          apiUrl: asString(args.payload.thinkwork_api_url),
          apiSecret: asString(args.payload.thinkwork_api_secret),
          tenantId: args.identity.tenantId,
          agentId: args.identity.agentId,
          threadId: args.identity.threadId,
          threadTurnId: asString(args.payload.thread_turn_id),
        },
      }),
    );
  }

  // ask_user_question — structured HITL clarification (plan 2026-06-09-005
  // U5). Gated exactly like task-status (eval_mode + identity + API wiring):
  // in eval mode the extension MUST NOT register (R21 — evals never park).
  // The intake endpoint additionally requires the active thread_turn_id for
  // its ownership join, so the gate includes it. Parent-only by construction:
  // `childToolSurface()` in agent-profile-delegation filters extension tool
  // names against the compiled profile tool list, which never auto-includes
  // ask_user_question (runtime `defaultTools` is hardcoded empty and no
  // built-in profile seed lists it).
  if (
    args.payload.eval_mode !== true &&
    args.identity.tenantId &&
    args.identity.agentId &&
    args.identity.threadId &&
    asString(args.payload.thinkwork_api_url) &&
    asString(args.payload.thinkwork_api_secret) &&
    asString(args.payload.thread_turn_id)
  ) {
    addExtension(
      createAskUserQuestionExtension({
        askUserQuestionConfig: {
          apiUrl: asString(args.payload.thinkwork_api_url),
          apiSecret: asString(args.payload.thinkwork_api_secret),
          threadId: args.identity.threadId,
          threadTurnId: asString(args.payload.thread_turn_id),
        },
      }),
    );
  }

  // fetch_workspace_source — mid-turn read-only workspace navigation (plan
  // 2026-06-12-002 U5). Gated on the dispatch payload flag (U1 parity lib
  // emits it on all three builders) AND the task-status-style wiring gate
  // (never in eval mode; requires the API url/secret + active turn id) AND
  // the host seam built by handleInvocation once a workspace bucket +
  // baseline exist. `addExtension` folds the tool name into the allowlist —
  // omit that and the tool registers but is silently gated from the model.
  if (
    args.payload.fetch_workspace_source_enabled === true &&
    args.payload.eval_mode !== true &&
    args.identity.tenantId &&
    args.identity.threadId &&
    asString(args.payload.thinkwork_api_url) &&
    asString(args.payload.thinkwork_api_secret) &&
    asString(args.payload.thread_turn_id) &&
    args.fetchWorkspaceSourceHost
  ) {
    addExtension(
      createFetchWorkspaceSourceExtension({
        fetchSourceConfig: {
          apiUrl: asString(args.payload.thinkwork_api_url),
          apiSecret: asString(args.payload.thinkwork_api_secret),
          tenantId: args.identity.tenantId,
          threadId: args.identity.threadId,
          threadTurnId: asString(args.payload.thread_turn_id),
          activeSpaceFolder: activeSpaceFolderSegment(
            args.payload.turn_context,
          ),
        },
        host: args.fetchWorkspaceSourceHost,
      }),
    );
  }

  // Web Search (Exa/SerpApi) — tenant/template-configured, arrives as
  // `web_search_config`. Never in eval mode (U8 side-effect kill list).
  if (
    args.payload.eval_mode !== true &&
    typeof args.payload.web_search_config === "object" &&
    args.payload.web_search_config
  ) {
    addExtension(
      createWebSearchExtension({
        webSearchConfig: args.payload.web_search_config as Record<
          string,
          unknown
        >,
      }),
    );
  }

  // Web Extraction (Firecrawl) — tenant/template-configured, arrives as
  // `web_extract_config`. Never in eval mode (U8 side-effect kill list).
  if (
    args.payload.eval_mode !== true &&
    typeof args.payload.web_extract_config === "object" &&
    args.payload.web_extract_config
  ) {
    addExtension(
      createWebExtractExtension({
        webExtractConfig: args.payload.web_extract_config as Record<
          string,
          unknown
        >,
      }),
    );
  }

  // Company Brain / Context Engine — query_context + query_memory_context +
  // query_brain_context + query_wiki_context over the API's
  // `/mcp/context-engine` JSON-RPC facade.
  // Gated on `context_engine_enabled`; skipped in eval mode (user-less).
  if (
    args.payload.eval_mode !== true &&
    args.payload.context_engine_enabled === true
  ) {
    addExtension(
      createContextEngineExtension({
        enabled: true,
        apiUrl: asString(args.payload.thinkwork_api_url),
        apiSecret: asString(args.payload.thinkwork_api_secret),
        tenantId: args.identity.tenantId,
        userId: args.identity.userId,
        agentId: args.identity.agentId,
        // Forward the thread so query_context can scope Space-bound KBs to the
        // thread's Space (U7).
        threadId: args.identity.threadId,
        contextEngineConfig:
          typeof args.payload.context_engine_config === "object" &&
          args.payload.context_engine_config
            ? (args.payload.context_engine_config as Record<string, unknown>)
            : {},
      }),
    );
  }

  // Knowledge Graph (plan 2026-06-09-004 U8) — `knowledge_graph_search` over
  // the API's GraphQL `knowledgeGraphSearch` query. Gated on the
  // `knowledge_graph_enabled` payload flag (mirrors context_engine_enabled);
  // skipped in eval mode (user-less). Identity is turn-bound: the provider
  // snapshots the thread-turn reference at entry and the API resolves the
  // tenant server-side from it (R15) — no tenant assertion travels with the
  // request. `addExtension` folds the tool name into the allowlist; omit
  // that and the tool registers but is silently gated from the model.
  if (
    args.payload.eval_mode !== true &&
    args.payload.knowledge_graph_enabled === true
  ) {
    const kgApiUrl = asString(args.payload.thinkwork_api_url);
    const kgApiSecret = asString(args.payload.thinkwork_api_secret);
    const kgThreadTurnId = asString(args.payload.thread_turn_id);
    const kgThreadId = args.identity.threadId;
    if (kgApiUrl && kgApiSecret && (kgThreadTurnId || kgThreadId)) {
      addExtension(
        createKnowledgeGraphExtension({
          onError: (error, { phase }) =>
            logStructured({
              level: "warn",
              event: "knowledge_graph_search_failed",
              phase,
              tenantId: args.identity.tenantId,
              threadId: args.identity.threadId,
              error: error instanceof Error ? error.message : String(error),
            }),
        }),
        {
          knowledgeGraph: createApiKnowledgeGraphProvider({
            apiUrl: kgApiUrl,
            apiSecret: kgApiSecret,
            threadTurnId: kgThreadTurnId || undefined,
            threadId: kgThreadId || undefined,
          }),
        },
      );
    } else {
      logStructured({
        level: "warn",
        event: "knowledge_graph_skipped_missing_wiring",
        tenantId: args.identity.tenantId,
        threadId: args.identity.threadId,
        hasApiUrl: Boolean(kgApiUrl),
        hasApiSecret: Boolean(kgApiSecret),
        hasTurnReference: Boolean(kgThreadTurnId || kgThreadId),
      });
    }
  }

  // OKF Wiki Navigator (THNK-63 U5) — direct read-only traversal of the
  // tenant's materialized OKF wiki on EFS. The API must opt the turn in via
  // tool policy, and this runtime must independently prove the mount/root and
  // tenant slug before exposing any wiki_* tools to the model.
  if (
    args.payload.eval_mode !== true &&
    args.payload.okf_wiki_navigator_enabled === true
  ) {
    const okfRoot = asString(args.env.okfWikiRoot);
    const tenantSlug = asString(args.identity.tenantSlug);
    const currentRoot =
      okfRoot && tenantSlug
        ? path.join(okfRoot, "tenants", tenantSlug, "current")
        : "";
    const hasCurrentRoot = currentRoot
      ? await isAccessibleDirectory(currentRoot)
      : false;
    if (
      args.env.okfWikiNavigatorEnabled === true &&
      okfRoot &&
      tenantSlug &&
      hasCurrentRoot
    ) {
      addExtension(
        createOkfWikiNavigatorExtension({
          onError: (error, { phase }) =>
            logStructured({
              level: "warn",
              event: "okf_wiki_navigator_failed",
              phase,
              tenantId: args.identity.tenantId,
              threadId: args.identity.threadId,
              error: error instanceof Error ? error.message : String(error),
            }),
        }),
        {
          okfWiki: createOkfWikiProvider({
            currentRoot,
            maxResults: OKF_WIKI_NAVIGATOR_LIMITS.maxResults,
            maxBytes: OKF_WIKI_NAVIGATOR_LIMITS.maxBytes,
            maxDepth: OKF_WIKI_NAVIGATOR_LIMITS.maxDepth,
          }),
        },
      );
    } else {
      logStructured({
        level: "warn",
        event: "okf_wiki_navigator_skipped_missing_mount",
        tenantId: args.identity.tenantId,
        threadId: args.identity.threadId,
        runtimeEnabled: args.env.okfWikiNavigatorEnabled,
        hasRoot: Boolean(okfRoot),
        hasTenantSlug: Boolean(tenantSlug),
        hasCurrentRoot,
      });
    }
  }

  if (args.delegationProvider) {
    addExtension(createDelegationExtension(), {
      delegation: args.delegationProvider,
    });
  }

  // Memory — engine selector lives in env. Eval-mode and system-originated
  // invocations can be user-less by construction, so user-scoped memory is
  // skipped entirely when no invoking user exists.
  //
  // Plan §004 U5 — the Hindsight path is now a Pi EXTENSION (the tracer bullet):
  // a Hindsight-backed MemoryProvider wrapped by `createMemoryExtension`, loaded
  // via the resource loader's `extensionFactories` instead of hand-assembled
  // recall/reflect AgentTools. The managed AgentCore-Memory path stays as custom
  // tools until the firming plan's single-engine cutover retires it. Cognee /
  // Company Brain is exposed through plugin-owned MCP configs instead of this
  // legacy memory-extension block, so Pi can reach the substrate directly.
  const evalMode = args.payload.eval_mode === true;
  if (evalMode) {
    logStructured({
      level: "info",
      event: "memory_skipped_eval_mode",
      tenantId: args.identity.tenantId,
      threadId: args.identity.threadId,
    });
  } else if (!args.identity.userId) {
    logStructured({
      level: "info",
      event: "memory_skipped_no_user",
      tenantId: args.identity.tenantId,
      threadId: args.identity.threadId,
    });
  } else if (args.env.memoryEngine === "managed") {
    if (args.env.agentCoreMemoryId) {
      tools.push(
        ...buildMemoryTools({
          client: args.agentCoreClient,
          memoryId: args.env.agentCoreMemoryId,
          tenantId: args.identity.tenantId,
          userId: args.identity.userId,
          threadId: args.identity.threadId,
        }),
      );
    } else {
      logStructured({
        level: "warn",
        event: "memory_skipped_no_id",
        tenantId: args.identity.tenantId,
        threadId: args.identity.threadId,
      });
    }
  } else if (args.env.memoryEngine === "hindsight") {
    if (args.env.hindsightEndpoint) {
      const memoryProvider = createHindsightMemoryProvider({
        endpoint: args.env.hindsightEndpoint,
        tenantId: args.identity.tenantId,
        userId: args.identity.userId,
      });
      // Keep long-term memory available as an explicit tool, but do not
      // proactively recall on every turn. Requester profile facts are already
      // mounted as `/workspace/User/USER.md` and injected into the system
      // prompt; proactive grounding made those simple turns take the expensive
      // recall/reflect path anyway.
      const memoryExtension = createMemoryExtension({
        onError: (error, { phase }) =>
          logStructured({
            level: "warn",
            event: "memory_grounding_failed",
            phase,
            tenantId: args.identity.tenantId,
            threadId: args.identity.threadId,
            error: error instanceof Error ? error.message : String(error),
          }),
      });
      extensionFactories.push(
        toExtensionFactory(memoryExtension, { memory: memoryProvider }),
      );
      // Fold the extension's tool names into the allowlist or recall/reflect
      // register but never reach the model (the SDK gates to the allowlist).
      extensionToolNames.push(...(memoryExtension.toolNames ?? []));
      logStructured({
        level: "info",
        event: "memory_extension_loaded",
        tenantId: args.identity.tenantId,
        threadId: args.identity.threadId,
      });
    } else {
      logStructured({
        level: "warn",
        event: "hindsight_skipped_no_endpoint",
        tenantId: args.identity.tenantId,
        threadId: args.identity.threadId,
      });
    }
  } else {
    logStructured({
      level: "info",
      event:
        args.payload.context_engine_enabled === true
          ? "memory_cognee_plugin_mcp_mode"
          : "memory_cognee_plugin_mcp_mode_context_engine_disabled",
      tenantId: args.identity.tenantId,
      threadId: args.identity.threadId,
    });
  }

  // Workspace skills — the prompt lists installed skills, while the extension
  // exposes `workspace_skill` so the agent can read full SKILL.md instructions
  // on demand before applying one. When TOOLS.md declares a model route for a
  // skill, the tool executes that skill through the routed child model instead
  // of returning raw instructions to the parent model.
  const modelRoutingPolicy = normalizeModelRoutingPolicy(
    args.payload.model_routing_policy,
  );
  const approvedModelIds = normalizeApprovedModelIds(
    args.payload.approved_model_ids,
  );
  addExtension(
    createSkillsExtension({
      skills: args.workspaceSkills,
      modelRoutingPolicy,
      approvedModelIds,
      childModelCaller:
        modelRoutingPolicy.routes.length > 0
          ? args.childModelCaller
          : undefined,
    }),
  );

  // MCP (U7) — validate, mint, build.
  const rawConfigs = parseMcpConfigs(args.payload.mcp_configs);
  const validatedConfigs: McpServerConfig[] = [];
  for (const config of rawConfigs) {
    const validation = validateMcpUrl(config.url, {
      trustedInternal: config.trustedInternal === true,
    });
    if (!validation.ok) {
      logStructured({
        level: "warn",
        event: "mcp_url_rejected",
        tenantId: args.identity.tenantId,
        userId: args.identity.userId,
        serverName: config.serverName,
        rejectionReason: validation.reason,
      });
      continue;
    }
    validatedConfigs.push(config);
  }
  const mcpTools = await buildMcpTools({
    mcpConfigs: validatedConfigs,
    handleStore,
    connectMcpServer: args.connectMcpServer,
    onConnectError: (err, config) => {
      logStructured({
        level: "warn",
        event: "mcp_connect_failed",
        tenantId: args.identity.tenantId,
        userId: args.identity.userId,
        serverName: config.serverName,
        error: err instanceof Error ? err.message : String(err),
      });
    },
    // Plan §006 U4 — populate the per-invocation registry as part of the
    // existing tools/list pass. No extra network round-trip.
    registry: args.mcpRegistry,
    modelRoutingPolicy,
    approvedModelIds,
    childModelCaller:
      modelRoutingPolicy.routes.length > 0 ? args.childModelCaller : undefined,
  });
  tools.push(...mcpTools);

  // Plan §006 U4 — boot-time validation of the directTools allowlist
  // against the live registry. Hard-fail (throw → outer catch in
  // handleInvocation drains cleanup + returns 500) so a typo or a
  // renamed MCP tool surfaces in the agent's first turn instead of
  // silently demoting the entry to proxy-only.
  let mcpProxyRegistered = false;
  if (validatedConfigs.length > 0) {
    const directToolsResult = validateDirectTools(
      args.mcpJsonConfig.directTools,
      args.mcpRegistry,
    );
    if (!directToolsResult.ok) {
      // Log a structured tenant-scoped event with a bounded shape so
      // operators see the mismatch in CloudWatch without echoing the
      // entire availableTools array into the log message (already on
      // the error throw the agent sees).
      logStructured({
        level: "error",
        event: "directtools_validation_failed",
        tenantId: args.identity.tenantId,
        userId: args.identity.userId,
        missingCount: directToolsResult.missing.length,
        missing: directToolsResult.missing.map((m) => ({
          server: m.server,
          tool: m.tool,
          reason: m.reason,
          availableToolCount: m.availableTools.length,
        })),
      });
      throw new DirectToolsValidationError(directToolsResult.missing);
    }

    // Do not expose the inert proxy while the direct MCP tool surface is
    // available. Its description tells the model to prefer `mcp`, but the
    // inert body only throws; that blocks real plugin MCP use in threads.
    // When the proxy dispatcher is made live, this can flip back to
    // `mode: "live"` and replace the direct-tool surface intentionally.
    if (mcpTools.length === 0) {
      tools.push(
        buildMcpProxyTool({
          mode: "inert",
          registry: args.mcpRegistry,
          connectMcpServer: args.connectMcpServer,
        }),
      );
      mcpProxyRegistered = true;
    }
  }

  return {
    tools,
    extensionFactories,
    extensionToolNames,
    cleanup,
    workspaceSkills: args.workspaceSkills,
    handleStore,
    mcpProxyRegistered,
  };
}

// ---------------------------------------------------------------------------
// Completion callback — POST /api/skills/complete with snapshotted secret.
//
// IMPORTANT contract (validated against `packages/api/src/handlers/skills.ts`'s
// `completeSkillRunService`):
//
//   - Body uses camelCase: `runId`, `tenantId`, `status`, `failureReason?`,
//     `deliveredArtifactRef?`. Snake_case keys are silently ignored by the
//     endpoint and surface as a 400.
//   - Status enum is `complete | failed | cancelled | cost_bounded_error`.
//     `ok`/`error` are NOT accepted — they map to `complete`/`failed`.
//   - Auth is `Authorization: Bearer <api_auth_secret>` PLUS a per-run
//     `X-Skill-Run-Signature: sha256=<hmac>` header. The HMAC is computed
//     over the runId using the `completion_hmac_secret` shipped in the
//     run_skill envelope. A leaked API_AUTH_SECRET alone cannot forge a
//     completion for a different tenant.
//   - This callback ONLY fires for skill_run invocations (those carrying
//     `skill_run_id` + `completion_hmac_secret` in the payload). Chat-turn
//     invocations use the chat-finalize callback when Event-mode dispatch
//     supplies one; otherwise this remains a no-op for direct debug calls.
// ---------------------------------------------------------------------------

export interface SkillRunContext {
  /** skill_runs.id — the row the callback updates. */
  runId: string;
  /** Per-run HMAC secret shipped in the run_skill envelope. */
  hmacSecret: string;
}

export type CompletionStatus =
  | "complete"
  | "failed"
  | "cancelled"
  | "cost_bounded_error";

export interface CompletionCallbackArgs {
  secrets: SecretsSnapshot;
  identity: IdentitySnapshot;
  /**
   * Skill-run identifiers. `null` means this is a chat-turn invocation —
   * postCompletion is a no-op (chat-agent-invoke owns turn completion).
   */
  runContext: SkillRunContext | null;
  result:
    | { status: "ok"; runResult: RunAgentLoopResult; latencyMs: number }
    | { status: "error"; error: unknown; latencyMs: number };
  fetchImpl: typeof fetch;
  /** Per-attempt timeout (default 15s). Bounds the postCompletion stall. */
  attemptTimeoutMs?: number;
}

export class CompletionCallbackAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompletionCallbackAuthError";
  }
}

const COMPLETION_RETRY_DELAYS_MS = [200, 600, 1500] as const;
const DEFAULT_COMPLETION_ATTEMPT_TIMEOUT_MS = 15_000;

/**
 * Map the agent loop's success/error result onto the completion endpoint's
 * status enum.
 */
function asCompletionStatus(result: CompletionCallbackArgs["result"]): {
  status: CompletionStatus;
  failureReason: string | null;
} {
  if (result.status === "ok") {
    return { status: "complete", failureReason: null };
  }
  const message =
    result.error instanceof Error ? result.error.message : String(result.error);
  return { status: "failed", failureReason: message.slice(0, 500) };
}

/**
 * Per-run HMAC of the runId. Mirrors run_skill_dispatch.py's signature
 * computation so the server's `verifyCompletionHmac` accepts it.
 */
function computeCompletionHmac(runId: string, hmacSecret: string): string {
  // `crypto` is dynamically required so test-only paths that never call this
  // function don't have to load the module.
  const { createHmac } = require("node:crypto") as {
    createHmac: typeof import("node:crypto").createHmac;
  };
  return createHmac("sha256", hmacSecret).update(runId).digest("hex");
}

/**
 * POST `/api/skills/complete` with the snapshotted secret + per-run HMAC.
 *
 * 401 surfaces as `CompletionCallbackAuthError`
 * (per `feedback_avoid_fire_and_forget_lambda_invokes`) so a runtime-side
 * auth mismatch fails the invocation loudly instead of silently dropping
 * observability data. Other failures retry with bounded backoff. Each
 * attempt is bounded by `attemptTimeoutMs` (default 15s) so a hung
 * upstream cannot stall the Lambda for the full retry window.
 */
export async function postCompletion(
  args: CompletionCallbackArgs,
): Promise<void> {
  const { secrets, identity, runContext, result, fetchImpl } = args;
  const attemptTimeoutMs =
    args.attemptTimeoutMs ?? DEFAULT_COMPLETION_ATTEMPT_TIMEOUT_MS;

  if (!runContext) {
    // Chat-turn invocation — chat-finalize owns the writeback when configured.
    // Direct debug invocations do not carry skill-run ids, so there is nothing
    // for the skill completion endpoint to update.
    return;
  }
  if (!secrets.apiUrl || !secrets.apiAuthSecret) {
    logStructured({
      level: "warn",
      event: "completion_callback_disabled",
      tenantId: identity.tenantId,
      threadId: identity.threadId,
      reason: "missing_secret_or_url",
    });
    return;
  }
  // Refuse to send the bearer over plaintext HTTP. localhost / dev rigs that
  // intentionally use http should override THINKWORK_API_URL with https.
  let parsedApiUrl: URL;
  try {
    parsedApiUrl = new URL(secrets.apiUrl);
  } catch {
    logStructured({
      level: "error",
      event: "completion_callback_invalid_url",
      tenantId: identity.tenantId,
      threadId: identity.threadId,
    });
    return;
  }
  if (parsedApiUrl.protocol !== "https:") {
    logStructured({
      level: "error",
      event: "completion_callback_insecure_url",
      tenantId: identity.tenantId,
      threadId: identity.threadId,
      protocol: parsedApiUrl.protocol,
    });
    return;
  }

  const url = `${secrets.apiUrl.replace(/\/$/, "")}/api/skills/complete`;
  const { status, failureReason } = asCompletionStatus(result);
  const body = JSON.stringify({
    runId: runContext.runId,
    tenantId: identity.tenantId,
    status,
    ...(failureReason !== null ? { failureReason } : {}),
  });
  const signature = computeCompletionHmac(
    runContext.runId,
    runContext.hmacSecret,
  );

  const totalAttempts = COMPLETION_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // The Authorization header value never appears in logStructured —
          // the per-key redactor strips it before any log emission.
          authorization: `Bearer ${secrets.apiAuthSecret}`,
          "x-skill-run-signature": `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(attemptTimeoutMs),
      });
      if (response.status === 401) {
        // Don't log the response text — it can echo the bearer back.
        throw new CompletionCallbackAuthError(
          `Completion callback returned 401 for tenant ${identity.tenantId}.`,
        );
      }
      if (response.ok) return;
      logStructured({
        level: "warn",
        event: "completion_callback_non_2xx",
        tenantId: identity.tenantId,
        threadId: identity.threadId,
        runId: runContext.runId,
        statusCode: response.status,
        attempt,
      });
      // 4xx other than 401 are terminal — the request body is malformed and
      // retrying won't change that. Bail without retrying.
      if (response.status >= 400 && response.status < 500) {
        return;
      }
    } catch (err) {
      if (err instanceof CompletionCallbackAuthError) {
        // 401 is terminal. Surface to the handler — no retry.
        throw err;
      }
      logStructured({
        level: "warn",
        event: "completion_callback_failed",
        tenantId: identity.tenantId,
        threadId: identity.threadId,
        runId: runContext.runId,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (attempt < totalAttempts - 1) {
      // Add ±25% jitter so N concurrent failed invocations don't thunder-herd
      // against the API at the same backoff timestamps.
      const baseDelay = COMPLETION_RETRY_DELAYS_MS[attempt] ?? 0;
      const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
      const delay = Math.max(0, Math.round(baseDelay + jitter));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // All retries exhausted — log a terminal-failure event so an operator sees
  // it. The 15-min skill-runs reconciler is the backstop.
  logStructured({
    level: "error",
    event: "completion_callback_exhausted",
    tenantId: identity.tenantId,
    threadId: identity.threadId,
    runId: runContext.runId,
    attempts: totalAttempts,
  });
}

/**
 * Pull the run_skill envelope out of the invocation payload, if present.
 * Returns null for chat-turn invocations (where these fields aren't set).
 * Both fields must be present and non-empty for the callback to fire.
 */
export function extractSkillRunContext(
  payload: Record<string, unknown>,
): SkillRunContext | null {
  const runId = asString(payload.skill_run_id);
  const hmacSecret = asString(payload.completion_hmac_secret);
  if (!runId || !hmacSecret) return null;
  return { runId, hmacSecret };
}

// ---------------------------------------------------------------------------
// /invocations entry — the Lambda Web Adapter routes POSTs here.
// ---------------------------------------------------------------------------

export interface HandleInvocationArgs {
  payload: Record<string, unknown>;
  deps?: Partial<HandlerDependencies>;
}

export interface HandleInvocationResult {
  statusCode: number;
  body: Record<string, unknown>;
}

/**
 * The trusted handler entry point. Stateless w.r.t. module-load globals;
 * tests call this directly with a synthesized payload + injected deps.
 */
export async function handleInvocation(
  args: HandleInvocationArgs,
): Promise<HandleInvocationResult> {
  const deps: HandlerDependencies = { ...defaultDependencies, ...args.deps };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const runLoop = deps.runAgentLoop ?? runAgentLoop;
  const bootstrap = deps.bootstrapWorkspaceImpl ?? bootstrapWorkspace;
  const discoverSkills =
    deps.discoverWorkspaceSkillsImpl ?? discoverWorkspaceSkills;
  const sessionStoreFactory =
    deps.sessionStoreFactory ?? ((opts) => new AuroraSessionStore(opts));

  const start = Date.now();
  const runtimeDiagnostics: RuntimeDiagnostics = {
    agentcore_phases: [],
    agentcore_timings_ms: {},
  };
  const recordRuntimePhase = (phase: RuntimePhaseDiagnostic) => {
    runtimeDiagnostics.agentcore_phases.push(phase);
    if (typeof phase.duration_ms === "number") {
      runtimeDiagnostics.agentcore_timings_ms[
        `${phase.phase.replace(/^runtime\./, "").replace(/\./g, "_")}_ms`
      ] = phase.duration_ms;
    }
  };

  // Snapshot identity + secrets + env BEFORE constructing tools so
  // anything downstream sees a frozen view.
  let identity: IdentitySnapshot;
  try {
    identity = snapshotIdentity(args.payload);
  } catch (err) {
    if (err instanceof InvocationValidationError) {
      logStructured({
        level: "warn",
        event: "invocation_rejected",
        error: err.message,
        statusCode: err.statusCode,
      });
      return {
        statusCode: err.statusCode,
        body: { error: err.message, runtime: "pi" },
      };
    }
    throw err;
  }
  const secrets = snapshotSecrets(args.payload);
  const env = snapshotRuntimeEnv();
  const workspaceBucket =
    env.workspaceBucket || asString(args.payload.workspace_bucket);
  const threadTurnId = asString(args.payload.thread_turn_id);
  logAgentCorePhase({
    phase: "runtime.invocation.received",
    status: "started",
    tenantId: identity.tenantId,
    userId: identity.userId,
    agentId: identity.agentId,
    agentSlug: identity.agentSlug,
    threadId: identity.threadId,
    threadTurnId,
    traceId: identity.traceId,
    runtimeType: "pi",
  });

  const userMessage = asString(args.payload.message);
  const goalModeCommand = goalCommandForRuntimeMode(args.payload);
  const runtimeUserMessage = goalModeCommand ?? userMessage;
  if (!userMessage) {
    logStructured({
      level: "warn",
      event: "invocation_rejected",
      tenantId: identity.tenantId,
      error: "empty_message",
    });
    return {
      statusCode: 400,
      body: {
        error: "Pi invocation requires a non-empty `message`.",
        runtime: "pi",
      },
    };
  }

  try {
    await ensureWorkspaceDir(env.workspaceDir);
  } catch (err) {
    logStructured({
      level: "error",
      event: "workspace_root_prepare_failed",
      tenantId: identity.tenantId,
      agentSlug: identity.agentSlug,
      workspaceDir: env.workspaceDir,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      statusCode: 500,
      body: {
        error:
          err instanceof Error
            ? err.message
            : "Pi invocation could not prepare the workspace directory.",
        runtime: "pi",
      },
    };
  }

  // Workspace S3 sync — required for tenant isolation when the environment or
  // managed-runtime payload carries a workspace bucket. Warm containers persist
  // the workspace directory across invocations, so a turn that skips the
  // per-tenant sync would discover the prior tenant's SKILL.md files and leak
  // them into the system prompt. Fail closed when the bucket is known.
  let workspaceBaseline: WorkspaceBaseline | undefined;
  if (workspaceBucket) {
    if (!identity.tenantSlug || !identity.agentSlug) {
      logStructured({
        level: "error",
        event: "workspace_sync_required_but_unscoped",
        tenantId: identity.tenantId,
        agentId: identity.agentId,
        hasTenantSlug: Boolean(identity.tenantSlug),
        hasAgentSlug: Boolean(identity.agentSlug),
      });
      return {
        statusCode: 400,
        body: {
          error:
            "Pi invocation requires `tenant_slug` and `instance_id` (agent slug) when a workspace bucket is configured. Refusing to proceed against a potentially cross-tenant workspace.",
          runtime: "pi",
        },
      };
    }
    const workspaceBootstrapStart = Date.now();
    try {
      const renderedWorkspacePrefix = asString(
        args.payload.rendered_workspace_prefix,
      );
      const s3 = deps.s3ClientFactory(env.awsRegion);
      const bootstrapResult = await bootstrap(
        identity.tenantSlug,
        identity.agentSlug,
        env.workspaceDir,
        s3,
        workspaceBucket,
        {
          workspacePrefix: renderedWorkspacePrefix,
        },
      );
      const workspaceBootstrapDurationMs = Date.now() - workspaceBootstrapStart;
      runtimeDiagnostics.workspace_diagnostics = {
        workspace_sync_ms: workspaceBootstrapDurationMs,
        hydration_copy_ms: workspaceBootstrapDurationMs,
        file_count: bootstrapResult.total,
        total_files: bootstrapResult.total,
        hydrated_files: bootstrapResult.synced,
        synced_files: bootstrapResult.synced,
        skipped_files: bootstrapResult.skipped ?? 0,
        deleted_files: bootstrapResult.deleted,
        cache_hit:
          (bootstrapResult.skipped ?? 0) > 0 && bootstrapResult.synced === 0,
        prefix: bootstrapResult.prefix,
        rendered_workspace_prefix: renderedWorkspacePrefix || undefined,
      };
      logStructured({
        level: "info",
        event: "workspace_bootstrap_completed",
        tenantId: identity.tenantId,
        agentId: identity.agentId,
        agentSlug: identity.agentSlug,
        threadId: identity.threadId,
        prefix: bootstrapResult.prefix,
        renderedWorkspacePrefix: renderedWorkspacePrefix || undefined,
        synced: bootstrapResult.synced,
        deleted: bootstrapResult.deleted,
        total: bootstrapResult.total,
        durationMs: workspaceBootstrapDurationMs,
        skipped: bootstrapResult.skipped ?? 0,
      });
      recordRuntimePhase({
        phase: "runtime.workspace_bootstrap",
        status: "completed",
        duration_ms: workspaceBootstrapDurationMs,
        count: bootstrapResult.total,
        detail: `synced=${bootstrapResult.synced};skipped=${bootstrapResult.skipped ?? 0};deleted=${bootstrapResult.deleted}`,
      });
      logAgentCorePhase({
        phase: "runtime.workspace_bootstrap",
        status: "completed",
        tenantId: identity.tenantId,
        agentId: identity.agentId,
        agentSlug: identity.agentSlug,
        threadId: identity.threadId,
        threadTurnId,
        traceId: identity.traceId,
        runtimeType: "pi",
        durationMs: workspaceBootstrapDurationMs,
        count: bootstrapResult.total,
        detail: `synced=${bootstrapResult.synced};skipped=${bootstrapResult.skipped ?? 0};deleted=${bootstrapResult.deleted}`,
      });
    } catch (err) {
      const workspaceBootstrapDurationMs = Date.now() - workspaceBootstrapStart;
      logStructured({
        level: "warn",
        event: "workspace_bootstrap_failed",
        tenantId: identity.tenantId,
        agentSlug: identity.agentSlug,
        durationMs: workspaceBootstrapDurationMs,
        error: err instanceof Error ? err.message : String(err),
      });
      recordRuntimePhase({
        phase: "runtime.workspace_bootstrap",
        status: "failed",
        duration_ms: workspaceBootstrapDurationMs,
        detail: err instanceof Error ? err.message : String(err),
      });
      logAgentCorePhase({
        phase: "runtime.workspace_bootstrap",
        status: "failed",
        tenantId: identity.tenantId,
        agentId: identity.agentId,
        agentSlug: identity.agentSlug,
        threadId: identity.threadId,
        threadTurnId,
        traceId: identity.traceId,
        runtimeType: "pi",
        durationMs: workspaceBootstrapDurationMs,
        errorType: err instanceof Error ? err.name : "Error",
      });
      return {
        statusCode: 500,
        body: {
          error:
            err instanceof Error
              ? err.message
              : "Pi workspace bootstrap failed.",
          runtime: "pi",
        },
      };
    }
  }
  if (workspaceBucket) {
    workspaceBaseline = await createLocalWorkspaceBaseline({
      workspaceDir: env.workspaceDir,
      log: (event, fields) =>
        logStructured({
          level: "warn",
          event,
          tenantId: identity.tenantId,
          ...fields,
        }),
    });
  }

  const trustedSkillIds = trustedWorkspaceSkillIds(args.payload);
  const discoveredSkills = (await discoverSkills(env.workspaceDir)).filter(
    (skill) => trustedSkillIds.has(skill.slug),
  );

  // Ephemeral force-pinned skills (plan 2026-06-04-004 U4). The composer
  // slash-command can pin a tenant-catalog skill the agent has NOT installed;
  // fetch each pin's SKILL.md from the catalog for this turn only and merge it
  // into the discovered set, marking pinned slugs for system-prompt emphasis.
  // Fetch-per-turn keeps pins ephemeral — nothing is written to the workspace.
  const pinnedSkillRefs = parsePinnedSkillRefs(
    args.payload.pinned_skills,
  ).filter((ref) => trustedSkillIds.has(ref.skillId));
  let pinnedEmphasizedSlugs = new Set<string>();
  let workspaceSkills = discoveredSkills;
  if (pinnedSkillRefs.length > 0 && workspaceBucket) {
    const pinnedSkills = await loadPinnedSkills({
      refs: pinnedSkillRefs,
      bucket: workspaceBucket,
      s3: deps.s3ClientFactory(env.awsRegion),
      log: (event, fields) =>
        logStructured({
          level: "warn",
          event,
          tenantId: identity.tenantId,
          ...fields,
        }),
    });
    const merged = mergeWorkspaceSkills(discoveredSkills, pinnedSkills);
    workspaceSkills = merged.skills;
    pinnedEmphasizedSlugs = merged.emphasizedSlugs;
    logStructured({
      level: "info",
      event: "pinned_skills_loaded",
      tenantId: identity.tenantId,
      agentSlug: identity.agentSlug,
      requested: pinnedSkillRefs.length,
      loaded: pinnedSkills.length,
      emphasized: [...pinnedEmphasizedSlugs],
    });
  }
  const skillCreatorCommand = parseSkillCreatorCommandPayload(
    args.payload.skill_creator_command,
  );
  if (
    skillCreatorCommand &&
    workspaceSkills.some(
      (skill) => skill.slug === SKILL_CREATOR_WORKSPACE_SKILL_SLUG,
    )
  ) {
    pinnedEmphasizedSlugs.add(SKILL_CREATOR_WORKSPACE_SKILL_SLUG);
    logStructured({
      level: "info",
      event: "skill_creator_command_loaded",
      tenantId: identity.tenantId,
      threadId: identity.threadId,
    });
  }

  // Plan §006 U4 — read mcp.json from the bootstrapped workspace. A
  // malformed file aborts the invocation with a structured 500 (same
  // path tool-assembly failures take) so the operator sees the parse
  // error in the agent's first turn instead of silently disabling
  // directTools validation.
  let mcpJsonConfig: McpJsonConfig;
  try {
    mcpJsonConfig = await readMcpJson(env.workspaceDir);
  } catch (err) {
    if (err instanceof McpJsonError) {
      logStructured({
        level: "error",
        event: "mcp_json_invalid",
        tenantId: identity.tenantId,
        agentSlug: identity.agentSlug,
        error: err.message,
      });
      return {
        statusCode: 500,
        body: {
          error: err.message,
          runtime: "pi",
        },
      };
    }
    throw err;
  }
  const mcpRegistry = new McpToolRegistry();

  const agentCoreClient = deps.agentCoreClientFactory();

  // SessionStore — instantiate so failures surface here, BEFORE the agent
  // loop spends LLM tokens. The current placeholder dispatch reads no
  // session blob (Pi's session.prompt() would; the in-process Agent
  // loop is stateless across invocations beyond messages_history).
  if (env.dbClusterArn && env.dbSecretArn) {
    try {
      sessionStoreFactory({
        tenantId: identity.tenantId,
        agentId: identity.agentId,
        clusterArn: env.dbClusterArn,
        secretArn: env.dbSecretArn,
        database: env.dbName,
      });
    } catch (err) {
      logStructured({
        level: "warn",
        event: "session_store_init_failed",
        tenantId: identity.tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Non-fatal for U9 — the placeholder loop doesn't read session blobs.
    }
  }

  // Allocate the per-invocation cleanup queue here (the same array the
  // handler's `finally` block drains). The MCP connect factory and tool
  // builders share this reference, so transport teardown closures land in
  // the array we actually drain — not a private array owned by the
  // factory. This was a real defect in an earlier draft that the multi-
  // reviewer pass caught (correctness + reliability + maintainability +
  // adversarial + agent-native + kieran-typescript all flagged it).
  const cleanup: Array<() => Promise<void>> = [];

  // U16 — Allocate the per-invocation HandleStore here (was previously
  // created inside the resource builder). Both the scrubbing fetch
  // (createScrubbingFetch below) and the MCP tool builder
  // (resource builder → buildMcpTools) need to share this same instance
  // so the egress fetch resolves the handle the build minted. The
  // handler's `finally` block already calls `bundle.handleStore.clear()`
  // which now operates on the same store.
  const handleStore = new HandleStore();

  // U16 — Egress fetch interceptor. Swaps `Authorization: Handle <uuid>`
  // for `Bearer <bearer>` at HTTP-call time and scrubs response bodies
  // for bearer-shaped strings + the literal active bearer. Production
  // path; tests inject `connectMcpServerFactory` to bypass entirely.
  const scrubbingFetch = createScrubbingFetch({ handleStore });

  const connectMcpServer =
    deps.connectMcpServerFactory ??
    createConnectMcpServer({ cleanup, fetch: scrubbingFetch });

  // fetch_workspace_source host seam (plan 2026-06-12-002 U5) — only when a
  // workspace bucket + turn baseline exist (the tool mounts into the local
  // workspace and appends fetched contents to the diff baseline so the
  // end-of-turn diff reports zero changes for fetched paths).
  const fetchWorkspaceSourceHost: FetchWorkspaceSourceHost | undefined =
    workspaceBucket && workspaceBaseline
      ? (() => {
          const fetchSourceS3 = deps.s3ClientFactory(env.awsRegion);
          return {
            workspaceDir: env.workspaceDir,
            downloadObject: async (key: string) => {
              const object = await fetchSourceS3.send(
                new GetObjectCommand({ Bucket: workspaceBucket, Key: key }),
              );
              const bytes = await object.Body?.transformToByteArray();
              if (!bytes) {
                throw new Error(`Empty S3 body for workspace source ${key}`);
              }
              return bytes;
            },
            appendToBaseline: (files) => {
              if (!workspaceBaseline) return;
              appendFetchedFilesToWorkspaceBaseline(workspaceBaseline, files);
            },
          };
        })()
      : undefined;

  // Build tools last so any setup failure above short-circuits before
  // we touch the HandleStore.
  let bundle: InvocationResourceBundle;
  const toolAssemblyStart = Date.now();
  try {
    bundle = await buildInvocationResources({
      payload: args.payload,
      identity,
      env,
      agentCoreClient,
      workspaceSkills,
      connectMcpServer,
      sessionStoreFactory,
      cleanup,
      handleStore,
      mcpJsonConfig,
      mcpRegistry,
      fetchWorkspaceSourceHost,
      childModelCaller:
        deps.childModelCaller ??
        createBedrockChildModelCaller(
          deps.bedrockRuntimeClientFactory(env.awsRegion),
        ),
    });
    logAgentCorePhase({
      phase: "runtime.tool_assembly",
      status: "completed",
      tenantId: identity.tenantId,
      agentId: identity.agentId,
      agentSlug: identity.agentSlug,
      threadId: identity.threadId,
      threadTurnId,
      traceId: identity.traceId,
      runtimeType: "pi",
      durationMs: Date.now() - toolAssemblyStart,
      count: bundle.tools.length,
      detail: `extensionTools=${bundle.extensionToolNames.length}`,
    });
    recordRuntimePhase({
      phase: "runtime.tool_assembly",
      status: "completed",
      duration_ms: Date.now() - toolAssemblyStart,
      count: bundle.tools.length,
      detail: `extensionTools=${bundle.extensionToolNames.length}`,
    });
  } catch (err) {
    // U16 — the resource builder may have minted handles into `handleStore`
    // before failing (e.g., MCP transport opened then listTools timed
    // out). The runLoop's finally block is unreachable on this path, so
    // clear the store + drain any partial cleanup closures HERE to
    // honor the U7 invariant: `try { … } finally { handleStore.clear() }`
    // on every handleInvocation exit path.
    handleStore.clear();
    for (const fn of cleanup.reverse()) {
      try {
        await fn();
      } catch (cleanupErr) {
        logStructured({
          level: "warn",
          event: "cleanup_failed",
          tenantId: identity.tenantId,
          error:
            cleanupErr instanceof Error
              ? cleanupErr.message
              : String(cleanupErr),
        });
      }
    }
    logStructured({
      level: "error",
      event: "tool_assembly_failed",
      tenantId: identity.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    logAgentCorePhase({
      phase: "runtime.tool_assembly",
      status: "failed",
      tenantId: identity.tenantId,
      agentId: identity.agentId,
      agentSlug: identity.agentSlug,
      threadId: identity.threadId,
      threadTurnId,
      traceId: identity.traceId,
      runtimeType: "pi",
      durationMs: Date.now() - toolAssemblyStart,
      errorType: err instanceof Error ? err.name : "Error",
    });
    recordRuntimePhase({
      phase: "runtime.tool_assembly",
      status: "failed",
      duration_ms: Date.now() - toolAssemblyStart,
      detail: err instanceof Error ? err.message : String(err),
    });
    return {
      statusCode: 500,
      body: {
        error: err instanceof Error ? err.message : "Pi tool assembly failed.",
        runtime: "pi",
      },
    };
  }

  // Run the agent loop inside try/finally so the HandleStore is cleared
  // even if the LLM throws or a tool raises.
  let runResult: RunAgentLoopResult | undefined;
  let runError: unknown;
  let runLoopStart = 0;
  const stageAttachments =
    deps.stageMessageAttachmentsImpl ?? stageMessageAttachments;
  const stagedAttachments = await stageAttachments({
    attachments: args.payload.message_attachments,
    workspaceBucket,
    expectedTenantId: identity.tenantId,
    expectedThreadId: identity.threadId,
    s3Client: deps.s3ClientFactory(env.awsRegion),
    logger: (event, details) =>
      logStructured({
        level: "warn",
        event,
        tenantId: identity.tenantId,
        threadId: identity.threadId,
        ...details,
      }),
  });
  const attachmentPreamble = formatMessageAttachmentsPreamble(
    stagedAttachments.staged,
  );
  const fileReadTool = buildFileReadTool(stagedAttachments.staged);
  if (fileReadTool) {
    bundle.tools.push(fileReadTool);
  }
  // ask_user_question resume context (plan 2026-06-09-005 U4). Parsed with
  // the same tolerance as message_attachments: absence or a malformed
  // envelope renders no block and never fails the turn. The block is
  // PREPENDED to the turn prompt (ahead of the user content) — not the
  // system prompt — so the echoed Q/A pairs persist in the durable session
  // transcript alongside the message that carried them.
  const pendingQuestionContext = parsePendingUserQuestions(
    args.payload.pending_user_questions,
  );
  if (
    args.payload.pending_user_questions !== undefined &&
    args.payload.pending_user_questions !== null &&
    !pendingQuestionContext
  ) {
    logStructured({
      level: "warn",
      event: "pending_user_questions_invalid",
      tenantId: identity.tenantId,
      threadId: identity.threadId,
    });
  }
  const questionAnswerBlock = pendingQuestionContext
    ? formatUserQuestionAnswerContext(pendingQuestionContext)
    : "";
  const skillCreatorCommandBlock =
    formatSkillCreatorCommandContext(skillCreatorCommand);
  const withQuestionAnswerContext = (message: string): string =>
    questionAnswerBlock ? `${questionAnswerBlock}\n\n${message}` : message;
  const withTurnCommandContext = (message: string): string =>
    withQuestionAnswerContext(
      skillCreatorCommandBlock
        ? `${skillCreatorCommandBlock}\n\n${message}`
        : message,
    );
  const agentProfiles = normalizeAgentProfiles(args.payload.agent_profiles);
  const profileChildExtensionFactories = [...bundle.extensionFactories];
  // The current invocation's model id is what pi-ai's Agent will use
  // to serialize history -> Bedrock for THIS turn. We use the same id on
  // synthesized AssistantMessage history entries so the metadata is
  // self-consistent even though pi-ai doesn't actually read those
  // fields during serialization.
  const currentModelId =
    typeof args.payload.model === "string" && args.payload.model.trim()
      ? args.payload.model.trim()
      : "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
  const parentHistory = normalizeHistory(
    args.payload.messages_history,
    currentModelId,
  );
  // Live activity emitter (plan 2026-06-03-001). Config (url/secret/api-url)
  // is snapshotted HERE, at coroutine entry, and never re-read from the env
  // mid-turn (env-shadowing guard). No-op when the host didn't opt in.
  const activityEmitter = createActivityEmitter(
    readActivityCallbackConfig(args.payload),
    { logger: (entry) => logStructured(entry) },
  );
  const profileDelegationOptions = (
    parentModelId: string,
  ): ProfileDelegationToolOptions => ({
    profiles: agentProfiles,
    parentThreadTurnId: threadTurnId || identity.threadId,
    parentModelId,
    tools: bundle.tools,
    extensionFactories: profileChildExtensionFactories,
    extensionToolNames: bundle.extensionToolNames,
    workspaceSkills,
    mcpRegistry,
    cwd: env.workspaceDir,
    agentDir: env.piAgentDir,
    threadId: identity.threadId,
    gitSha: env.gitSha,
    identity,
    parentHistory,
    contextPreamble: attachmentPreamble || undefined,
    runLoop,
    emitActivity: activityEmitter.emit,
    // Plan 005 U6 — needs_clarification handling: eval mode converts the
    // escalation to a best-judgment re-invoke (R21); the resume turn's
    // delegation_context enforces the one-cycle-per-delegation budget (R20).
    evalMode: args.payload.eval_mode === true,
    resumeDelegationContext: pendingQuestionContext?.delegationContext
      ? resumeDelegationContextDetails(pendingQuestionContext.delegationContext)
      : null,
  });
  const profileTool = buildAgentProfileDelegationTool(
    profileDelegationOptions(currentModelId),
  );
  if (profileTool) {
    bundle.tools.push(profileTool);
  }
  // Plan §004 U6 — system-prompt composition runs inside the session via a
  // `before_agent_start` extension hook instead of being hand-built here and
  // passed as a string. The hook composes from workspace defaults + tool policy
  // + skills (+ the attachment preamble as suffix) and reports the final prompt
  // back through `onComposed` so we can still surface it as
  // `composed_system_prompt` on the response.
  let composedSystemPrompt = "";
  bundle.extensionFactories.push(
    toExtensionFactory(
      createSystemPromptExtension({
        payload: args.payload,
        workspaceDir: env.workspaceDir,
        availableToolNames: [
          ...BUILTIN_TOOL_NAMES,
          ...bundle.tools.map((tool) => tool.name),
          ...bundle.extensionToolNames,
        ],
        workspaceSkillsBlock: formatWorkspaceSkills(
          workspaceSkills,
          pinnedEmphasizedSlugs,
        ),
        suffix: attachmentPreamble || undefined,
        onComposed: (prompt) => {
          composedSystemPrompt = prompt;
        },
      }),
      {},
    ),
  );
  try {
    // Durable per-thread session (U4): resume the thread's persisted Pi session
    // from S3 instead of replaying full history as prompt text. Requires the
    // workspace bucket + a tenant slug for isolation; otherwise the loop falls
    // back to the transitional history-prepend path.
    const rawSessionStore =
      workspaceBucket && identity.tenantSlug
        ? createS3SessionStore({
            s3: deps.s3ClientFactory(env.awsRegion),
            bucket: workspaceBucket,
            keyPrefix: `pi-sessions/${identity.tenantSlug}/`,
          })
        : undefined;
    const sessionStore = rawSessionStore
      ? instrumentSessionStore(rawSessionStore, {
          tenantId: identity.tenantId,
          agentId: identity.agentId,
          agentSlug: identity.agentSlug,
          threadId: identity.threadId,
          threadTurnId,
          traceId: identity.traceId,
        })
      : undefined;
    const sessionStoreFallbackReason = sessionStore
      ? "s3"
      : !workspaceBucket
        ? "missing_workspace_bucket"
        : !identity.tenantSlug
          ? "missing_tenant_slug"
          : "unavailable";
    logStructured({
      level: "info",
      event: "session_store_configured",
      tenantId: identity.tenantId,
      agentId: identity.agentId,
      agentSlug: identity.agentSlug,
      threadId: identity.threadId,
      backing: sessionStore ? "s3" : "history_prompt",
      fallbackReason: sessionStore ? undefined : sessionStoreFallbackReason,
      workspaceBucketConfigured: Boolean(workspaceBucket),
      hasTenantSlug: Boolean(identity.tenantSlug),
    });
    logAgentCorePhase({
      phase: "runtime.session_store",
      status: sessionStore ? "completed" : "skipped",
      tenantId: identity.tenantId,
      agentId: identity.agentId,
      agentSlug: identity.agentSlug,
      threadId: identity.threadId,
      threadTurnId,
      traceId: identity.traceId,
      runtimeType: "pi",
      detail: sessionStore ? "s3" : sessionStoreFallbackReason,
    });
    recordRuntimePhase({
      phase: "runtime.session_store",
      status: sessionStore ? "completed" : "skipped",
      detail: sessionStore ? "s3" : sessionStoreFallbackReason,
    });
    logStructured({
      level: "info",
      event: "agent_loop_starting",
      tenantId: identity.tenantId,
      userId: identity.userId,
      agentId: identity.agentId,
      agentSlug: identity.agentSlug,
      threadId: identity.threadId,
      traceId: identity.traceId,
      tools: bundle.tools.length,
      extensionTools: bundle.extensionToolNames.length,
      workspaceSkills: workspaceSkills.length,
      agentProfiles: agentProfiles.length,
    });
    logAgentCorePhase({
      phase: "runtime.agent_loop",
      status: "started",
      tenantId: identity.tenantId,
      userId: identity.userId,
      agentId: identity.agentId,
      agentSlug: identity.agentSlug,
      threadId: identity.threadId,
      threadTurnId,
      traceId: identity.traceId,
      runtimeType: "pi",
      count: bundle.tools.length,
    });
    runLoopStart = Date.now();
    const requestedProfileSlugs = goalModeCommand
      ? []
      : requestedAgentProfileSlugs({
          payload: args.payload,
          message: userMessage,
          profiles: agentProfiles,
        });
    const automaticProfileSlug =
      goalModeCommand || requestedProfileSlugs.length > 0
        ? ""
        : inferAutomaticAgentProfileSlug(userMessage, agentProfiles);
    const orchestrationProfileSlugs =
      requestedProfileSlugs.length > 0
        ? requestedProfileSlugs
        : automaticProfileSlug
          ? [automaticProfileSlug]
          : [];
    if (orchestrationProfileSlugs.length > 0) {
      const requestedProfiles = orchestrationProfileSlugs
        .map((slug) => agentProfiles.find((profile) => profile.slug === slug))
        .filter(
          (profile): profile is AgentProfileConfig => profile !== undefined,
        );
      const baseTask =
        requestedProfileSlugs.length > 0
          ? stripProfileMentions(userMessage, requestedProfiles)
          : userMessage.trim();
      runResult = await runParentOwnedProfileOrchestration({
        originalMessage: userMessage,
        baseTask,
        requestedProfiles,
        profileDelegationOptions: profileDelegationOptions(currentModelId),
        // Answer context rides ahead of whichever chain message the
        // orchestration composes (it owns the final parent prompt); mention
        // detection and baseTask derivation above stay on the raw
        // userMessage so the block never perturbs profile routing.
        wrapParentMessage: withTurnCommandContext,
        parentRunInput: {
          message: parentProfileChainMessage({
            originalMessage: userMessage,
            baseTask,
            runs: [],
          }),
          history: parentHistory,
          tools: bundle.tools,
          extensionFactories: bundle.extensionFactories,
          extensionToolNames: bundle.extensionToolNames,
          modelId: args.payload.model,
          threadId: identity.threadId,
          gitSha: env.gitSha,
          identity,
          cwd: env.workspaceDir,
          agentDir: env.piAgentDir,
          sessionStore,
          sessionDir: "/tmp/pi-sessions",
        },
        runLoop,
        log: (entry) => logStructured(entry),
        emitActivity: activityEmitter.emit,
      });
    } else {
      runResult = await runLoop(
        {
          message: withTurnCommandContext(runtimeUserMessage),
          history: parentHistory,
          // U6 — no prebuilt system prompt; the system-prompt extension's
          // before_agent_start hook composes and sets it for the turn.
          tools: bundle.tools,
          // Plan §004 U5 — load thinkwork capabilities (memory first) as Pi
          // extensions over the resource loader, additive to the built-ins +
          // custom tools.
          extensionFactories: bundle.extensionFactories,
          // U6 — fold extension tool names into the allowlist so they're actually
          // enabled (the SDK gates to the allowlist).
          extensionToolNames: bundle.extensionToolNames,
          modelId: args.payload.model,
          threadId: identity.threadId,
          gitSha: env.gitSha,
          identity,
          cwd: env.workspaceDir,
          agentDir: env.piAgentDir,
          sessionStore,
          // Session scratch lives outside the workspace dir so the per-turn
          // workspace S3 sync (delete-extraneous) cannot reap an in-flight
          // session file.
          sessionDir: "/tmp/pi-sessions",
          goalRunExtractor: ({ sessionEntries, toolInvocations }) =>
            extractGoalRunEvidence({
              payload: args.payload,
              sessionEntries,
              toolInvocations,
            }),
        },
        {
          log: (entry) => logStructured(entry),
          emitActivity: activityEmitter.emit,
        },
      );
    }
    // Flush any in-flight live-activity POSTs now that the turn is done — the
    // turn already completed, so this never extends its wall-clock, and it
    // closes the Lambda-Web-Adapter unawaited-promise gap for the live view.
    await activityEmitter.drain();
    logStructured({
      level: "info",
      event: "agent_loop_completed",
      tenantId: identity.tenantId,
      userId: identity.userId,
      agentId: identity.agentId,
      agentSlug: identity.agentSlug,
      threadId: identity.threadId,
      traceId: identity.traceId,
      durationMs: Date.now() - runLoopStart,
      toolsCalled: runResult.toolsCalled,
      toolInvocations: runResult.toolInvocations.length,
    });
    logAgentCorePhase({
      phase: "runtime.agent_loop",
      status: "completed",
      tenantId: identity.tenantId,
      userId: identity.userId,
      agentId: identity.agentId,
      agentSlug: identity.agentSlug,
      threadId: identity.threadId,
      threadTurnId,
      traceId: identity.traceId,
      runtimeType: "pi",
      durationMs: Date.now() - runLoopStart,
      count: runResult.toolInvocations.length,
      detail: `toolsCalled=${runResult.toolsCalled.length}`,
    });
    recordRuntimePhase({
      phase: "runtime.agent_loop",
      status: "completed",
      duration_ms: Date.now() - runLoopStart,
      count: runResult.toolInvocations.length,
      detail: `toolsCalled=${runResult.toolsCalled.length}`,
    });
    runResult = mergeRuntimeDiagnostics(runResult, runtimeDiagnostics);
  } catch (err) {
    runError = err;
    logStructured({
      level: "error",
      event: "agent_loop_failed",
      tenantId: identity.tenantId,
      userId: identity.userId,
      agentId: identity.agentId,
      agentSlug: identity.agentSlug,
      threadId: identity.threadId,
      traceId: identity.traceId,
      durationMs: runLoopStart ? Date.now() - runLoopStart : undefined,
      error: err instanceof Error ? err.message : String(err),
    });
    logAgentCorePhase({
      phase: "runtime.agent_loop",
      status: "failed",
      tenantId: identity.tenantId,
      userId: identity.userId,
      agentId: identity.agentId,
      agentSlug: identity.agentSlug,
      threadId: identity.threadId,
      threadTurnId,
      traceId: identity.traceId,
      runtimeType: "pi",
      durationMs: runLoopStart ? Date.now() - runLoopStart : undefined,
      errorType: err instanceof Error ? err.name : "Error",
    });
    recordRuntimePhase({
      phase: "runtime.agent_loop",
      status: "failed",
      duration_ms: runLoopStart ? Date.now() - runLoopStart : undefined,
      detail: err instanceof Error ? err.message : String(err),
    });
  } finally {
    bundle.handleStore.clear();
    for (const fn of bundle.cleanup.reverse()) {
      try {
        await fn();
      } catch (err) {
        logStructured({
          level: "warn",
          event: "cleanup_failed",
          tenantId: identity.tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    try {
      await cleanupMessageAttachments(stagedAttachments.turnDir);
    } catch (err) {
      logStructured({
        level: "warn",
        event: "message_attachment_cleanup_failed",
        tenantId: identity.tenantId,
        threadId: identity.threadId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    deps.onHandlerComplete?.(bundle);
  }

  const latencyMs = Date.now() - start;

  // Skill-run invocations carry a runId + HMAC; chat-turn invocations don't.
  // Chat turns use the finalize callback when configured.
  const runContext = extractSkillRunContext(args.payload);
  const changedFiles = await collectLocalWorkspaceChangedFiles({
    workspaceDir: env.workspaceDir,
    baseline: workspaceBaseline,
    log: (event, fields) =>
      logStructured({
        level: "warn",
        event,
        tenantId: identity.tenantId,
        ...fields,
      }),
  });

  if (runError !== undefined || !runResult) {
    if (isFinalizeCallbackConfigured(args.payload)) {
      const finalizeStart = Date.now();
      const finalized = await postFinalizeCallback({
        payload: args.payload,
        identity,
        systemPrompt: composedSystemPrompt,
        changedFiles,
        result: { status: "error", error: runError, latencyMs },
        fetchImpl,
        logger: logStructured,
      });
      if (finalized) {
        logAgentCorePhase({
          phase: "runtime.finalize_callback",
          status: "completed",
          tenantId: identity.tenantId,
          agentId: identity.agentId,
          agentSlug: identity.agentSlug,
          threadId: identity.threadId,
          threadTurnId,
          traceId: identity.traceId,
          runtimeType: "pi",
          durationMs: Date.now() - finalizeStart,
          detail: "error_result",
        });
        return {
          statusCode: 200,
          body: { ok: true, finalize_dispatched: true, runtime: "pi" },
        };
      }
    }
    // Try to fire the completion callback (status=error). 401 from the
    // callback throws — that's an auth-config bug we want loud, not a
    // silent failure on top of a turn failure.
    try {
      await postCompletion({
        secrets,
        identity,
        runContext,
        result: { status: "error", error: runError, latencyMs },
        fetchImpl,
      });
    } catch (cbErr) {
      logStructured({
        level: "error",
        event: "completion_callback_threw",
        tenantId: identity.tenantId,
        error: cbErr instanceof Error ? cbErr.message : String(cbErr),
      });
    }
    return {
      statusCode: 500,
      body: {
        error: runError instanceof Error ? runError.message : String(runError),
        runtime: "pi",
      },
    };
  }

  // Leaked-tool-call rescue — Kimi K2.5 intermittently emits ask_user_question
  // as TEXT instead of a native tool-use block. This is the single seam every
  // downstream consumer of the parent turn's final assistant content shares
  // (memory retain, the finalize callback, and the synchronous response body
  // all read `runResult.content`), so the rescue runs here: re-post the
  // parsed questions through the same intake endpoint the extension uses
  // (the intake writes the question-card message), and strip the raw token
  // soup from the persisted content. Parent turns only by construction —
  // specialist child runs never reach this writeback. In eval mode (or when
  // a native ask already succeeded this turn) we strip without posting; the
  // intake's 409 backstops any already-pending race.
  if (detectLeakedAskUserQuestion(runResult.content)) {
    const rescueApiUrl = asString(args.payload.thinkwork_api_url);
    const rescueApiSecret = asString(args.payload.thinkwork_api_secret);
    const canPost =
      args.payload.eval_mode !== true &&
      !turnAlreadyAskedUserQuestion(runResult.toolInvocations) &&
      Boolean(
        rescueApiUrl && rescueApiSecret && identity.threadId && threadTurnId,
      );
    const rescued = await rescueLeakedAskUserQuestion({
      text: runResult.content,
      post: canPost
        ? createIntakeQuestionPost({
            apiUrl: rescueApiUrl,
            apiSecret: rescueApiSecret,
            threadId: identity.threadId,
            threadTurnId,
            fetchImpl,
          })
        : null,
    });
    logStructured({
      level: "warn",
      event: "leaked_ask_user_question_rescue",
      tenantId: identity.tenantId,
      threadId: identity.threadId,
      threadTurnId,
      traceId: identity.traceId,
      rescued: rescued.rescued,
      posted: canPost,
      ...(rescued.questionId ? { questionId: rescued.questionId } : {}),
    });
    runResult = { ...runResult, content: rescued.content };
  }

  // End-of-turn auto-retain — fire-and-forget invoke of the memory-retain
  // Lambda with the per-turn transcript. The receiving Lambda routes through
  // the API's normalized memory layer (Hindsight or AgentCore depending on
  // engine). Awaited so the Event invoke is queued before HTTP response —
  // Lambda Web Adapter's in-flight Promise lifecycle is undocumented in our
  // institutional record, so we trade ~tens of ms for guaranteed delivery.
  // Failures are logged but never bubble to the user (retain is best-effort).
  const retainOutcome = await retainConversation({
    payload: args.payload as RetainPayloadInput,
    identity,
    env,
    assistantContent: runResult.content,
    lambdaClient: deps.lambdaClientFactory(env.awsRegion),
  });
  if (retainOutcome.retained) {
    logStructured({
      level: "info",
      event: "memory_retain_dispatched",
      tenantId: identity.tenantId,
      threadId: identity.threadId,
    });
  } else if (retainOutcome.error) {
    logStructured({
      level: "warn",
      event: "memory_retain_failed",
      tenantId: identity.tenantId,
      threadId: identity.threadId,
      error: retainOutcome.error,
    });
  }

  if (isFinalizeCallbackConfigured(args.payload)) {
    const finalizeStart = Date.now();
    const finalized = await postFinalizeCallback({
      payload: args.payload,
      identity,
      systemPrompt: composedSystemPrompt,
      changedFiles,
      result: { status: "ok", runResult, latencyMs },
      fetchImpl,
      logger: logStructured,
    });
    if (finalized) {
      logAgentCorePhase({
        phase: "runtime.finalize_callback",
        status: "completed",
        tenantId: identity.tenantId,
        agentId: identity.agentId,
        agentSlug: identity.agentSlug,
        threadId: identity.threadId,
        threadTurnId,
        traceId: identity.traceId,
        runtimeType: "pi",
        durationMs: Date.now() - finalizeStart,
        detail: "ok_result",
      });
      return {
        statusCode: 200,
        body: { ok: true, finalize_dispatched: true, runtime: "pi" },
      };
    }
    logAgentCorePhase({
      phase: "runtime.finalize_callback",
      status: "failed",
      tenantId: identity.tenantId,
      agentId: identity.agentId,
      agentSlug: identity.agentSlug,
      threadId: identity.threadId,
      threadTurnId,
      traceId: identity.traceId,
      runtimeType: "pi",
      durationMs: Date.now() - finalizeStart,
      errorType: "FinalizeCallbackFailed",
    });
    return {
      statusCode: 500,
      body: {
        error: "Pi finalize callback failed; retrying invocation.",
        runtime: "pi",
      },
    };
  }

  await postCompletion({
    secrets,
    identity,
    runContext,
    result: { status: "ok", runResult, latencyMs },
    fetchImpl,
  });

  // The placeholder dispatch in U9 has no Hindsight retain pipeline yet;
  // U16's worker integration will populate this. Pass an empty array so
  // chat-agent-invoke's `responseData?.hindsight_usage || invokeResult.hindsight_usage || []`
  // fallback (chat-agent-invoke.ts:629) keeps working.
  const hindsightUsage: unknown[] = [];

  const responseBody: InvocationResponse = {
    runtime: "pi",
    composed_system_prompt: composedSystemPrompt,
    pi_usage: runResult.usage,
    pi_retain: retainOutcome.error
      ? { retained: retainOutcome.retained, error: retainOutcome.error }
      : { retained: retainOutcome.retained },
    // Plan §006 U4 — pin the proxy substrate. Always present as a boolean
    // so the smoke can assert the field shape regardless of whether the
    // current scenario carries MCP configs.
    mcp_proxy_registered: bundle.mcpProxyRegistered,
    tools_called: runResult.toolsCalled,
    tool_invocations: runResult.toolInvocations,
    ui_message_parts: runResult.uiMessageParts ?? [],
    model_routed_tool_calls: runResult.modelRoutedToolCalls ?? [],
    agent_profile_runs: runResult.agentProfileRuns ?? [],
    hindsight_usage: hindsightUsage,
    ...(runResult.goalRun ? { goal_run: runResult.goalRun } : {}),
    response: {
      role: "assistant",
      content: runResult.content,
      runtime: "pi",
      model: runResult.modelId,
      usage: runResult.usage,
      tools_called: runResult.toolsCalled,
      tool_invocations: runResult.toolInvocations,
      ui_message_parts: runResult.uiMessageParts ?? [],
      model_routed_tool_calls: runResult.modelRoutedToolCalls ?? [],
      agent_profile_runs: runResult.agentProfileRuns ?? [],
      tool_costs:
        runResult.toolCosts ??
        runResult.toolInvocations.flatMap((invocation) =>
          collectToolCosts(invocation.result),
        ),
      hindsight_usage: hindsightUsage,
      ...(runResult.goalRun ? { goal_run: runResult.goalRun } : {}),
    },
  };
  responseBody.tool_costs = responseBody.response.tool_costs;
  return {
    statusCode: 200,
    body: responseBody as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// HTTP plumbing — only `/ping` and `/invocations` matter to the runtime.
// ---------------------------------------------------------------------------

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown) {
  const encoded = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(encoded),
  });
  res.end(encoded);
}

/**
 * Lambda's request payload is capped at 6MB; AgentCore's runtime caps at a
 * comparable size. Honour that here so a malformed/oversized request fails
 * fast with 413 rather than buffering arbitrary bytes into memory.
 */
const MAX_INVOCATION_BODY_BYTES = 6 * 1024 * 1024;

class PayloadTooLargeError extends Error {
  constructor() {
    super("invocation payload exceeded MAX_INVOCATION_BODY_BYTES");
    this.name = "PayloadTooLargeError";
  }
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_INVOCATION_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleHttpInvocation(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  let body: string;
  try {
    body = await readBody(req);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      sendJson(res, 413, { error: err.message, runtime: "pi" });
      return;
    }
    sendJson(res, 400, {
      error: err instanceof Error ? err.message : "request read failed",
      runtime: "pi",
    });
    return;
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    sendJson(res, 400, { error: "invalid json", runtime: "pi" });
    return;
  }
  try {
    const result = await handleInvocation({ payload });
    sendJson(res, result.statusCode, result.body);
  } catch (err) {
    logStructured({
      level: "error",
      event: "invocation_unhandled",
      error: err instanceof Error ? err.message : String(err),
    });
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : String(err),
      runtime: "pi",
    });
  }
}

export function createServer() {
  return http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/ping") {
      sendJson(res, 200, {
        status: "Healthy",
        runtime: "pi",
        time_of_last_update: Math.floor(Date.now() / 1000),
      });
      return;
    }
    // Two transport paths route here:
    //   1. AgentCore runtime direct-invoke (`InvokeAgentRuntime`) → POST
    //      /invocations
    //   2. Lambda invoke (`lambda.Invoke` from chat-agent-invoke) bridged
    //      through AWS Lambda Web Adapter → POST /  (the LWA default
    //      when there's no API Gateway path on the event)
    // Accept POST regardless of path so chat-agent-invoke's existing
    // dispatcher (which goes via Lambda) hits the same handler as direct
    // runtime invokes. Without this, every Lambda-mediated invocation
    // returns `{"error":"not found","runtime":"pi"}` even though the
    // payload was correct.
    if (req.method === "POST") {
      void handleHttpInvocation(req, res);
      return;
    }
    sendJson(res, 404, { error: "not found", runtime: "pi" });
  });
}

if (process.env.NODE_ENV !== "test") {
  createServer().listen(PORT, "0.0.0.0", () => {
    // Use logStructured so prod logs are JSON-line on day one.
    logStructured({
      level: "info",
      event: "server_listening",
      port: PORT,
    });
  });
}
