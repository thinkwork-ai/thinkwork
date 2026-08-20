/**
 * Plan §005 U9 — Trusted handler shell (the keystone unit).
 *
 * This is the production entry point for the agentcore-pi Lambda /
 * AgentCore runtime container. It binds U4-U8 into a single per-invocation
 * orchestrator:
 *
 *   - U4: AuroraSessionStore — Pi's session-blob persistence.
 *   - U5: run_skill ToolDef   — subprocess bridge to Python script-skills.
 *   - U6: Memory ToolDefs     — AgentCore managed memory (the only engine).
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
import { createHash } from "node:crypto";
import { mkdir, readFile, readlink, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  createArtifactsExtension,
  createAskUserQuestionExtension,
  createBrowserAutomationExtension,
  createDelegationExtension,
  createDocumentComposerExtension,
  createFetchWorkspaceSourceExtension,
  createIdentityResolutionExtension,
  createSearchExtension,
  createSkillsExtension,
  createRequestIdentityExtension,
  createSendEmailExtension,
  buildTurnContextBlock,
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
import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  BUILTIN_TOOL_NAMES,
  buildEmitAnalyticsChartTool,
  buildEmitJsonRenderUiTool,
  collectToolCosts,
  createActivityEmitter,
  createToolExecutionEmitter,
  readToolExecutionCallbackConfig,
  type ToolExecutionEmitEvent,
  type ActivityEmitEvent,
  type DelegationProvider,
  isFinalizeCallbackConfigured,
  mergeFinalUiMessageParts,
  normalizeHistory,
  normalizeApprovedModelIds,
  normalizeModelRoutingPolicy,
  postCapabilityManifest,
  postFinalizeCallback,
  readActivityCallbackConfig,
  readCapabilityManifestSinkConfig,
  runAgentLoop,
  threadJsonRenderActivityEvent,
  type AgentProfileRunRecord,
  type ChildModelCaller,
  type InvocationResponse,
  type PiRetainStatus,
  type RunAgentLoopResult,
  type SessionStore,
  type ToolCostRecord,
  type ToolInvocationRecord,
  type WorkspaceBaseline,
  resolveToolNameClaims,
  sessionKey,
  type ToolNameClaim,
} from "@thinkwork/pi-runtime-core";
import {
  THREAD_JSON_RENDER_PART_TYPE,
  detectAndConvert,
  type ThreadJsonRenderPart,
} from "@thinkwork/thread-json-render";

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
  McpHandleAuthScheme,
  buildMcpTools,
  type ConnectMcpServerFn,
  type McpRuntimeRecordLinkHints,
  type McpServerConfig,
} from "./mcp.js";
import {
  createConnectMcpServer,
  createMcpConnectionRetention,
  type McpConnectionRetention,
  type OnBehalfOfIdentity,
} from "./mcp-connect.js";
import {
  createWarmSessionCacheIfRuntime,
  warmSessionKey,
  type WarmSessionCache,
  type WarmSessionEntry,
} from "./warm-session-cache.js";
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
  agentProfilesFromManifest,
  diffProfileSources,
} from "./runtime/manifest-agent-profiles.js";
import {
  CapabilitiesJsonError,
  readCapabilitiesManifest,
  type CapabilitiesManifestFile,
  type CapabilityManifestEntry,
} from "./runtime/capabilities-json.js";
import { formatWithheldCapabilitiesNotice } from "./runtime/withheld-capabilities-notice.js";
import {
  buildPromptBreakdown,
  type PromptBreakdown,
} from "./runtime/prompt-breakdown.js";
import {
  mcpServersInTools,
  readSidecarOperations,
  resolveToolScopeMode,
  scopeTools,
  type ScopeManifest,
  type ToolScopeMode,
} from "./runtime/tool-scope.js";
import {
  createPiGoalExtensionFactory,
  extractGoalRunEvidence,
  goalCommandForRuntimeMode,
  hasPiGoalMode,
  PI_GOAL_TOOL_NAMES,
} from "./runtime/pi-goal-adapter.js";
import { createScrubbingFetch } from "./scrubbing-fetch.js";
import { buildMemoryTools } from "./tools/memory.js";
import { explicitMemoryTurn } from "./runtime/memory-question.js";
import { createApiCanvasProvider } from "./runtime/providers/canvas-provider.js";
import { createApiIdentityResolutionProvider } from "./runtime/providers/identity-resolution-provider.js";
import { createApiSearchProvider } from "./runtime/providers/search-provider.js";
import {
  AuroraSessionStore,
  type AuroraSessionStoreOptions,
} from "./sessionstore-aurora.js";
import { resolveSandboxFactory } from "./runtime/sandbox-factory.js";
import { loadDynamicPiExtensions } from "./runtime/dynamic-extensions.js";
import { bootstrapWorkspace } from "./runtime/bootstrap-workspace.js";
import {
  appendFetchedFilesToWorkspaceBaseline,
  collectLocalWorkspaceChangedFiles,
  createLocalWorkspaceBaseline,
} from "./runtime/workspace-diff.js";
import { createLambdaCallbackFetch } from "./runtime/callback-lambda-fetch.js";
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
import {
  buildExecuteCodeTool,
  type ExecuteCodeExportContext,
} from "./runtime/tools/execute-code.js";
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
import {
  EMPTY_RESPONSE_CONTINUATION_PROMPT,
  applyEmptyResponseBackstop,
} from "./empty-response-backstop.js";

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

/** output_files export needs the workspace bucket + tenant/thread scoping
 * + API auth for attachment registration; absent any piece, execute_code
 * still works but refuses file exports with a clear message. */
function resolveExecuteCodeExportContext(
  payload: Record<string, unknown>,
): ExecuteCodeExportContext | undefined {
  const workspaceBucket = asString(payload.workspace_bucket);
  const tenantId = asString(payload.tenant_id);
  const threadId = asString(payload.thread_id);
  const apiUrl = asString(payload.thinkwork_api_url);
  const apiSecret = asString(payload.thinkwork_api_secret);
  if (!workspaceBucket || !tenantId || !threadId || !apiUrl || !apiSecret) {
    return undefined;
  }
  return { workspaceBucket, tenantId, threadId, apiUrl, apiSecret };
}

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
        `(^|\\s)#${escapeRegExp(alias)}(?=$|\\s|[.,!?;:])`,
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
        `(^|\\s)#${escapeRegExp(alias)}(?=$|\\s|[.,!?;:])`,
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
  emitToolExecution?: (event: ToolExecutionEmitEvent) => void;
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
      emitToolExecution: input.emitToolExecution,
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
  // THINK-245 U4 — request identity: stamp child-model Converse calls with
  // requestMetadata and surface response requestIds for exact reconciliation.
  requestIdentity?: {
    requestMetadata?: Record<string, string>;
    onRequestId?: (requestId: string) => void;
  },
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
        ...(requestIdentity?.requestMetadata &&
        Object.keys(requestIdentity.requestMetadata).length > 0
          ? { requestMetadata: requestIdentity.requestMetadata }
          : {}),
      }),
    );
    const responseRequestId = response.$metadata?.requestId;
    if (responseRequestId) {
      requestIdentity?.onRequestId?.(responseRequestId);
    }
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
  /**
   * THINK-586 U7 (R17) — whether this turn reused the in-container warm
   * session (`warm`) or ran the full cold bootstrap (`cold`). Only set on
   * the AgentCore runtime path (where the warm cache exists); Lambda-path
   * turns omit the field entirely.
   */
  session_reuse?: "warm" | "cold";
  /**
   * THINK-910 — per-turn prompt-size self-report (system-prompt chars vs
   * tool-schema chars vs tool counts). Lands in
   * `thread_turns.usage_json -> diagnostics -> prompt_breakdown` so prompt
   * bloat can be queried from ops without re-running a live turn.
   */
  prompt_breakdown?: PromptBreakdown;
  /**
   * THINK-910 — capability-scoped tool loading outcome. Always present so a
   * turn record states which mode was in force, including the default
   * no-op `all`.
   */
  tool_scope?: {
    mode: ToolScopeMode;
    before: number;
    after: number;
    dropped: string[];
    connections: Array<{
      server: string;
      kept: number;
      dropped: number;
      reason: string;
    }>;
  };
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
      ...(diagnostics.session_reuse
        ? { session_reuse: diagnostics.session_reuse }
        : {}),
      ...(diagnostics.prompt_breakdown
        ? { prompt_breakdown: diagnostics.prompt_breakdown }
        : {}),
      ...(diagnostics.tool_scope ? { tool_scope: diagnostics.tool_scope } : {}),
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

/**
 * THINK-626 — the acting end-user for this turn, for MCP servers that
 * opted into on-behalf-of assertion.
 *
 * The ONLY trustworthy source is the dispatch payload the platform builds
 * server-side: `current_user_email` is written by `chat-agent-invoke.ts`
 * from a `users` row keyed on the resolved human invoker (message sender →
 * thread creator → paired human), and `current_user_cognito_sub` is the
 * same row's Cognito subject when the producer supplies it. Never read
 * identity from model output, tool arguments, or the conversation — the
 * whole point of the assertion is that the agent cannot choose whose
 * claims it runs under.
 *
 * Returns null when the turn has no signed-in human (wakeups, evals,
 * scheduled runs, webhook/email channels), which is exactly when no
 * assertion should be sent.
 */
export function resolveOnBehalfOfIdentity(
  payload: Record<string, unknown>,
): OnBehalfOfIdentity | null {
  const sub = asString(payload.current_user_cognito_sub);
  const email = asString(payload.current_user_email);
  if (!sub && !email) return null;
  return {
    ...(sub ? { sub } : {}),
    ...(email ? { email } : {}),
  };
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
        ...(record.longRunning === true ? { longRunning: true } : {}),
        ...(record.onBehalfOf === true ? { onBehalfOf: true } : {}),
        transport: record.transport === "sse" ? "sse" : "streamable-http",
        toolWhitelist: Array.isArray(record.tools)
          ? (record.tools.filter(
              (tool): tool is string => typeof tool === "string",
            ) as string[])
          : undefined,
        recordLinkHints: parseMcpRecordLinkHints(record.recordLinkHints),
        resultTransforms: parseMcpResultTransforms(record.resultTransforms),
      } as McpServerConfig,
    ];
  });
}

function parseMcpResultTransforms(
  value: unknown,
): McpServerConfig["resultTransforms"] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    return undefined;
  }
  const transforms: NonNullable<McpServerConfig["resultTransforms"]> = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return undefined;
    }
    const record = item as Record<string, unknown>;
    const sourceField = asString(record.sourceField);
    const targetField = asString(record.targetField);
    if (
      record.type !== "scaled-integer-to-decimal" ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(sourceField) ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(targetField) ||
      sourceField === targetField ||
      !Number.isInteger(record.scale) ||
      (record.scale as number) < 0 ||
      (record.scale as number) > 12 ||
      (record.removeSource !== undefined &&
        typeof record.removeSource !== "boolean")
    ) {
      return undefined;
    }
    transforms.push({
      type: "scaled-integer-to-decimal",
      sourceField,
      targetField,
      scale: record.scale as number,
      ...(record.removeSource !== undefined
        ? { removeSource: record.removeSource }
        : {}),
    });
  }
  return transforms;
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
  /**
   * THINK-586 U7 — warm-session cache override. `undefined` (production)
   * resolves the process-wide factory singleton, which is null unless the
   * runtime-only env signal is present (Lambda path structurally cannot
   * reach the cache). Tests inject a cache (or explicit null).
   */
  warmSessionCache?: WarmSessionCache<WarmTurnProducts> | null;
  /**
   * THINK-586 U7 test seam — MCP connection retention factory for
   * warm-cacheable turns. Production omits this and uses the real
   * `createMcpConnectionRetention` from mcp-connect.
   */
  mcpRetentionFactory?: () => McpConnectionRetention;
}

// THINK-324 C4 — memoize the default SDK clients at module scope so warm
// containers reuse credential chains + keep-alive socket pools across
// invocations instead of building 4+ fresh clients per turn. Tests inject
// their own factories via HandlerDependencies and never hit this cache.
const memoized = <K, V>(create: (key: K) => V) => {
  const cache = new Map<K, V>();
  return (key: K): V => {
    let value = cache.get(key);
    if (value === undefined) {
      value = create(key);
      cache.set(key, value);
    }
    return value;
  };
};

let defaultAgentCoreClient: BedrockAgentCoreClient | undefined;

const defaultDependencies: HandlerDependencies = {
  agentCoreClientFactory: () =>
    (defaultAgentCoreClient ??= new BedrockAgentCoreClient({})),
  s3ClientFactory: memoized((region: string) => new S3Client({ region })),
  lambdaClientFactory: memoized(
    (region: string) => new LambdaClient({ region }),
  ),
  bedrockRuntimeClientFactory: memoized(
    (region: string) => new BedrockRuntimeClient({ region }),
  ),
};

// ---------------------------------------------------------------------------
// THINK-586 U7 — warm-session fast path (KTD6).
// ---------------------------------------------------------------------------

/**
 * The expensive per-thread bootstrap products a warm AgentCore microVM
 * reuses. Everything here is either immutable across turns or explicitly
 * re-pointed at per-turn state on reuse (retained MCP transports via
 * `mcpRetention.rebind`, the `bedrockRequestIds` collector by emptying it
 * under the per-thread lock). HandleStore and McpToolRegistry stay
 * per-turn: handles are re-minted and the registry is replayed from
 * `mcpRegistryEntries` on every warm turn.
 */
export interface WarmTurnProducts {
  tools: AgentTool<any>[];
  builtinToolNames: string[];
  extensionFactories: ExtensionFactory[];
  extensionToolNames: string[];
  workspaceSkills: WorkspaceSkill[];
  capabilitiesManifest: CapabilitiesManifestFile | null;
  mcpJsonConfig: McpJsonConfig;
  mcpProxyRegistered: boolean;
  mcpLoadRecord: InvocationResourceBundle["mcpLoadRecord"];
  capabilityLoadRecord: InvocationResourceBundle["capabilityLoadRecord"];
  mcpRegistryEntries: ReturnType<McpToolRegistry["entries"]>;
  /** Shared collector the cached request-identity extension pushes into;
   * emptied at warm-turn start (safe: the per-thread lock is held). */
  bedrockRequestIds: string[];
  mcpRetention: McpConnectionRetention | null;
  /** The rendered workspace prefix the caching turn bootstrapped — checked
   * against the on-disk hydrate stamp before a warm reuse. */
  workspacePrefix: string;
  /** Last observed durable session body+version (S3 ETag). Serves the
   * warm turn's session read without S3 and carries the freshness marker. */
  session: { body: string; version: string } | null;
}

/**
 * Process-wide lazy singleton. Factory-constructed (never a module-level
 * bare Map — tenant-isolation audit) and gated on the runtime-only env
 * signal: the Pi Lambda env never defines AGENTCORE_RUNTIME_SESSION_CACHE,
 * so the Lambda path resolves null here and takes today's cold path.
 */
let warmSessionCacheSingleton:
  | WarmSessionCache<WarmTurnProducts>
  | null
  | undefined;

function getWarmSessionCache(): WarmSessionCache<WarmTurnProducts> | null {
  if (warmSessionCacheSingleton === undefined) {
    warmSessionCacheSingleton =
      createWarmSessionCacheIfRuntime<WarmTurnProducts>();
  }
  return warmSessionCacheSingleton;
}

/**
 * Credential/authorization-version signal (R20): a deterministic hash of
 * every credential- or capability-bearing payload field that shapes the
 * assembled toolset. Any change (rotated MCP bearer, different trusted
 * skills, manifest flip, mode toggles) misses the reuse gate → cold path
 * with fresh MCP clients.
 */
function warmAuthorizationVersion(payload: Record<string, unknown>): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        mcp_configs: payload.mcp_configs ?? null,
        trusted_skill_ids: payload.trusted_skill_ids ?? null,
        skills: payload.skills ?? null,
        capabilities_manifest_fingerprint:
          payload.capabilities_manifest_fingerprint ?? null,
        eval_mode: payload.eval_mode === true,
        goal_mode: hasPiGoalMode(payload),
        browser_automation_enabled: payload.browser_automation_enabled === true,
        thread_json_render_ui_enabled:
          payload.thread_json_render_ui_enabled === true,
        send_email_config: payload.send_email_config ?? null,
        model_routing_policy: payload.model_routing_policy ?? null,
        approved_model_ids: payload.approved_model_ids ?? null,
      }),
    )
    .digest("hex");
}

/**
 * Durable-store freshness probe: the live S3 session head (object ETag)
 * for `pi-sessions/<tenantSlug>/<threadId>.jsonl`, "none" when absent.
 * Cheap (HeadObject, no body); any probe error returns a value that can
 * never match a cached marker so doubt takes the cold path (R10 — S3
 * stays the correctness source).
 */
async function probeDurableSessionHead(options: {
  s3: S3Client;
  bucket: string;
  tenantSlug: string;
  threadId: string;
}): Promise<string> {
  try {
    const response = await options.s3.send(
      new HeadObjectCommand({
        Bucket: options.bucket,
        Key: `pi-sessions/${options.tenantSlug}/${sessionKey(options.threadId)}`,
      }),
    );
    return (response as { ETag?: string })?.ETag ?? "unknown";
  } catch (err) {
    const name = (err as { name?: string })?.name;
    const status = (err as { $metadata?: { httpStatusCode?: number } })
      ?.$metadata?.httpStatusCode;
    if (name === "NotFound" || name === "NoSuchKey" || status === 404) {
      return "none";
    }
    return `probe_error:${Date.now()}`;
  }
}

/**
 * Cheap local workspace freshness probe for warm hits: the bootstrap's
 * sibling `.hydrate-cache.json` stamp must still name THIS tenant/agent
 * (and the cached rendered prefix). A warm container that ran another
 * tenant's turn in between rewrote the stamp — skipping re-bootstrap then
 * would leak the other tenant's workspace, so any mismatch/missing stamp
 * fails the probe and takes the cold path.
 */
async function warmWorkspaceStampMatches(options: {
  workspaceDir: string;
  tenantSlug: string;
  agentSlug: string;
  workspacePrefix: string;
}): Promise<boolean> {
  let cachePath: string;
  try {
    cachePath = `${await realpath(options.workspaceDir)}.hydrate-cache.json`;
  } catch {
    cachePath = `${options.workspaceDir}.hydrate-cache.json`;
  }
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8")) as {
      tenantSlug?: unknown;
      agentSlug?: unknown;
      prefix?: unknown;
    } | null;
    return (
      parsed?.tenantSlug === options.tenantSlug &&
      parsed?.agentSlug === options.agentSlug &&
      (options.workspacePrefix === "" ||
        parsed?.prefix === options.workspacePrefix)
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tool assembly — pure given the snapshots + payload + factories.
// ---------------------------------------------------------------------------

export interface InvocationResourceBundle {
  tools: AgentTool<any>[];
  /**
   * Per-turn built-in tool surface. Explicit memory turns withhold
   * file/shell built-ins instead of relying on prompt compliance to avoid
   * USER.md/SPACE.md shortcuts.
   */
  builtinToolNames: string[];
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
  /**
   * Per-server MCP load outcomes for the per-turn capability manifest
   * (capability-mapping plan U12): every server in the payload's mcp_configs
   * lands here as connected, rejected_url, or connect_failed.
   */
  mcpLoadRecord: Array<{
    serverName: string;
    status: "connected" | "rejected_url" | "connect_failed";
    reason?: string;
  }>;
  /**
   * THINK-173 U6 — per-entry outcomes for manifest-mode capability
   * registration. Empty when the invocation is not in manifest mode.
   */
  capabilityLoadRecord: Array<{
    name: string;
    kind: string;
    status: "registered" | "skipped";
    reason?: string;
  }>;
  /**
   * THINK-245 U4 — Bedrock response requestIds observed during this
   * invocation (parent agent loop via the request-identity extension, plus
   * child-model callers). Mutated as calls complete; the finalize payload
   * sends the accumulated list as `bedrock_request_ids` so the trace-ledger
   * reconciler can match invocation-log records exactly.
   */
  bedrockRequestIds: string[];
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
   * THINK-245 U4 — optional caller-allocated collector for Bedrock response
   * requestIds (same idiom as `cleanup`): the caller shares one array between
   * its child-model caller and the request-identity extension built here, so
   * every model call in the invocation lands in one list for finalize.
   */
  bedrockRequestIds?: string[];
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
   * THINK-173 U6 — verified capabilities manifest for MANIFEST MODE
   * invocations (payload carries `capabilities_manifest_fingerprint`).
   * The trusted handler reads + verifies it post-bootstrap (loud 500 on
   * any failure); null/absent = legacy capability path, byte-identical
   * to pre-manifest behavior.
   */
  capabilitiesManifest?: CapabilitiesManifestFile | null;
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
  const builtinToolNames = explicitMemoryTurn(args.payload.message)
    ? []
    : [...BUILTIN_TOOL_NAMES];
  const cleanup = args.cleanup;
  // U16 — caller allocates the HandleStore so the scrubbing fetch
  // closure (built alongside `connectMcpServer` in handleInvocation)
  // resolves handles against the same store this build mints into.
  const handleStore = args.handleStore;
  const extensionFactories: ExtensionFactory[] = [];
  const extensionToolNames: string[] = [];
  // THINK-245 U4 — request identity for cost reconciliation: stamp Bedrock
  // Converse payloads with requestMetadata and collect response requestIds.
  // Hook-only extension (no tools), so it bypasses the addExtension helper.
  // Caller may allocate the collector (same idiom as `cleanup`) so its own
  // child-model callers feed the same list.
  const bedrockRequestIds: string[] = args.bedrockRequestIds ?? [];
  extensionFactories.push(
    toExtensionFactory(
      createRequestIdentityExtension({
        threadTurnId: asString(args.payload.thread_turn_id) || null,
        traceId: asString(args.payload.trace_id) || null,
        onRequestId: (requestId) => {
          if (!bedrockRequestIds.includes(requestId)) {
            bedrockRequestIds.push(requestId);
          }
        },
      }),
      {},
    ),
  );
  const addExtension = (
    extension: ThinkworkExtension,
    providers: ProviderBundle = {},
  ) => {
    if ((extension.toolNames?.length ?? 0) === 0) return;
    extensionFactories.push(toExtensionFactory(extension, providers));
    extensionToolNames.push(...(extension.toolNames ?? []));
  };

  const sandboxInterpreterId = asString(args.payload.sandbox_interpreter_id);
  // Hoisted so manifest-mode `script` capability tools (below) can share
  // the same sandbox factory instance as execute_code.
  let sandboxFactory: ReturnType<typeof resolveSandboxFactory> | null = null;
  if (sandboxInterpreterId) {
    sandboxFactory = resolveSandboxFactory(
      args.payload as { sandbox_interpreter_id: string },
      {
        client: args.agentCoreClient,
      },
    );
    tools.push(
      buildExecuteCodeTool({
        sandboxFactory,
        cleanup,
        exportContext: resolveExecuteCodeExportContext(args.payload),
      }),
    );
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

  // Charts are ALWAYS ON (THINK-672): unlike emit_json_render_ui there is no
  // per-agent opt-in column and no capability gate. Drawing the numbers an
  // agent already computed is a presentation choice, not a granted capability,
  // so every agent gets the tool on every dispatch.
  tools.push(buildEmitAnalyticsChartTool());

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

  // Living Artifacts agent parity — save/load/refresh/list canvases (THINK-145
  // U9). Gated exactly like task-status/ask-user-question (never in eval mode;
  // requires identity + API wiring) PLUS the acting user id: the canvas
  // mutations assert R15 space-membership against that user (KTD8), so a
  // userless turn (system channel) has no one to gate against and the tools
  // must not register. `addExtension` folds the four tool names into the
  // allowlist — omit that and they register but are silently gated from the
  // model (the dark-tool failure mode; a guard test enumerates them).
  if (
    args.payload.eval_mode !== true &&
    args.identity.tenantId &&
    args.identity.userId &&
    args.identity.threadId &&
    asString(args.payload.thinkwork_api_url) &&
    asString(args.payload.thinkwork_api_secret)
  ) {
    addExtension(
      createArtifactsExtension({
        // Surface the real ApiCanvasProviderError (with the GraphQL error text)
        // to CloudWatch. Without this the underlying failure was swallowed and
        // only the friendly tool message reached the transcript — the reason
        // the KTD8 "Tenant membership required" root cause was invisible.
        onError: (error, { phase }) =>
          logStructured({
            level: "warn",
            event: "canvas_tool_error",
            phase,
            tenantId: args.identity.tenantId,
            threadId: args.identity.threadId,
            error: error instanceof Error ? error.message : String(error),
          }),
      }),
      {
        canvas: createApiCanvasProvider({
          apiUrl: asString(args.payload.thinkwork_api_url),
          apiSecret: asString(args.payload.thinkwork_api_secret),
          tenantId: args.identity.tenantId,
          threadId: args.identity.threadId,
          actingUserId: args.identity.userId,
        }),
      },
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

  // emit_document — HTML Document Artifacts (THINK-147 U4). Registration is
  // unconditional (no dispatch-payload flag; R6 satisfied a fortiori) gated
  // only on the standard wiring fields and never in eval mode. The tool posts
  // the dual-body document to the activity endpoint's document.emit branch
  // over the callback fetch (no HTTP egress). `addExtension` folds the tool
  // name into the allowlist — omit that and it never reaches the model.
  if (
    args.payload.eval_mode !== true &&
    args.identity.tenantId &&
    args.identity.threadId &&
    asString(args.payload.thinkwork_api_url) &&
    asString(args.payload.thinkwork_api_secret) &&
    asString(args.payload.thread_turn_id)
  ) {
    addExtension(
      createDocumentComposerExtension({
        documentComposerConfig: {
          apiUrl: asString(args.payload.thinkwork_api_url),
          apiSecret: asString(args.payload.thinkwork_api_secret),
          tenantId: args.identity.tenantId,
          threadId: args.identity.threadId,
          threadTurnId: asString(args.payload.thread_turn_id),
          agentId: args.identity.agentId ?? undefined,
          // THINK-153 KTD4: the tenant's registered plates ride the dispatch
          // payload; the extension composes the genre surface from them and
          // falls back to the core four when the field is absent/malformed.
          documentPlates: args.payload.document_plates,
        },
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

  // Identity Resolution (THINK-321 U5+U6) — `resolve_entities` /
  // `propose_mapping_candidates` / `confirm_mapping` /
  // `decline_mapping_candidates` over the API's entity-identity GraphQL
  // surface. Gated on the
  // `identity_resolution_enabled` payload flag; skipped in eval mode
  // (user-less). Identity is turn-bound: the provider snapshots the
  // thread-turn reference at entry and the API resolves tenant/user/thread
  // server-side from it (KTD-1) — no tenant assertion travels with the
  // request. `addExtension` folds the tool names into the allowlist; omit
  // that and the tools register but are silently gated from the model.
  if (
    args.payload.eval_mode !== true &&
    args.payload.identity_resolution_enabled === true
  ) {
    const idApiUrl = asString(args.payload.thinkwork_api_url);
    const idApiSecret = asString(args.payload.thinkwork_api_secret);
    const idThreadTurnId = asString(args.payload.thread_turn_id);
    const idThreadId = args.identity.threadId;
    if (idApiUrl && idApiSecret && (idThreadTurnId || idThreadId)) {
      addExtension(
        createIdentityResolutionExtension({
          onError: (error, { phase }) =>
            logStructured({
              level: "warn",
              event: "identity_resolution_failed",
              phase,
              tenantId: args.identity.tenantId,
              threadId: args.identity.threadId,
              error: error instanceof Error ? error.message : String(error),
            }),
        }),
        {
          identityResolution: createApiIdentityResolutionProvider({
            apiUrl: idApiUrl,
            apiSecret: idApiSecret,
            threadTurnId: idThreadTurnId || undefined,
            threadId: idThreadId || undefined,
          }),
        },
      );
    } else {
      logStructured({
        level: "warn",
        event: "identity_resolution_skipped_missing_wiring",
        tenantId: args.identity.tenantId,
        threadId: args.identity.threadId,
        hasApiUrl: Boolean(idApiUrl),
        hasApiSecret: Boolean(idApiSecret),
        hasTurnReference: Boolean(idThreadTurnId || idThreadId),
      });
    }
  }

  // ThinkWork Search (THINK-263 U8) — the unified fan-out broker as one
  // agent tool, reaching the API's GraphQL `search` query over the callback
  // fetch (no HTTP egress). Fixes the wrong-source problem: one `search`
  // call fans out across threads/entities instead of the model guessing
  // between recall/graph tools. Gated on `search_tool_enabled`
  // (ships inert until tool policy opts a turn in); skipped in eval mode
  // (user-less). Identity is turn-bound — the provider snapshots the
  // thread-turn reference and the API derives BOTH tenant and the invoking
  // user server-side, so the broker runs with that user's scope.
  if (
    args.payload.eval_mode !== true &&
    args.payload.search_tool_enabled === true
  ) {
    const searchApiUrl = asString(args.payload.thinkwork_api_url);
    const searchApiSecret = asString(args.payload.thinkwork_api_secret);
    const searchThreadTurnId = asString(args.payload.thread_turn_id);
    const searchThreadId = args.identity.threadId;
    if (
      searchApiUrl &&
      searchApiSecret &&
      (searchThreadTurnId || searchThreadId)
    ) {
      addExtension(
        createSearchExtension({
          onError: (error, { phase }) =>
            logStructured({
              level: "warn",
              event: "search_tool_failed",
              phase,
              tenantId: args.identity.tenantId,
              threadId: args.identity.threadId,
              error: error instanceof Error ? error.message : String(error),
            }),
        }),
        {
          search: createApiSearchProvider({
            apiUrl: searchApiUrl,
            apiSecret: searchApiSecret,
            tenantId: args.identity.tenantId,
            threadTurnId: searchThreadTurnId || undefined,
            threadId: searchThreadId || undefined,
          }),
        },
      );
    } else {
      logStructured({
        level: "warn",
        event: "search_tool_skipped_missing_wiring",
        tenantId: args.identity.tenantId,
        threadId: args.identity.threadId,
        hasApiUrl: Boolean(searchApiUrl),
        hasApiSecret: Boolean(searchApiSecret),
        hasTurnReference: Boolean(searchThreadTurnId || searchThreadId),
      });
    }
  }

  if (args.delegationProvider) {
    addExtension(createDelegationExtension(), {
      delegation: args.delegationProvider,
    });
  }

  // Memory — AgentCore managed memory is the only engine (THINK-406).
  // Eval-mode and system-originated invocations can be user-less by
  // construction, so user-scoped memory is skipped entirely when no invoking
  // user exists.
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
  } else if (args.env.agentCoreMemoryId) {
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
  const mcpLoadRecord: InvocationResourceBundle["mcpLoadRecord"] = [];
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
      mcpLoadRecord.push({
        serverName: config.serverName,
        status: "rejected_url",
        reason: validation.reason,
      });
      continue;
    }
    validatedConfigs.push(config);
  }
  const mcpConnectFailures = new Set<string>();
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
      mcpConnectFailures.add(config.serverName);
      mcpLoadRecord.push({
        serverName: config.serverName,
        status: "connect_failed",
        reason: err instanceof Error ? err.message : String(err),
      });
    },
    // Plan §006 U4 — populate the per-invocation registry as part of the
    // existing tools/list pass. No extra network round-trip.
    registry: args.mcpRegistry,
    // THINK-626 — server-built identity only; reaches opted-in servers.
    onBehalfOfIdentity: resolveOnBehalfOfIdentity(args.payload),
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

  for (const config of validatedConfigs) {
    if (!mcpConnectFailures.has(config.serverName)) {
      mcpLoadRecord.push({
        serverName: config.serverName,
        status: "connected",
      });
    }
  }

  // ── THINK-173 U6: manifest-mode capability registration ────────────────
  // Runs LAST so platform/extension validation sees the fully assembled
  // tool + extension surface, and the collision second line (R10) can
  // reserve every already-claimed name. `active` is the only section
  // read — withheld entries never register (render decided; AE1/AE3).
  const capabilityLoadRecord: InvocationResourceBundle["capabilityLoadRecord"] =
    [];
  if (args.capabilitiesManifest) {
    registerManifestCapabilityTools({
      manifest: args.capabilitiesManifest,
      tools,
      mcpTools,
      builtinToolNames,
      extensionToolNames,
      mcpRegistry: args.mcpRegistry,
      validatedMcpServerNames: new Set(
        validatedConfigs.map((config) => config.serverName),
      ),
      sandboxFactory,
      cleanup,
      workspaceDir: args.env.workspaceDir,
      identity: args.identity,
      record: capabilityLoadRecord,
    });
  }

  return {
    tools,
    builtinToolNames,
    extensionFactories,
    extensionToolNames,
    cleanup,
    workspaceSkills: args.workspaceSkills,
    handleStore,
    mcpProxyRegistered,
    mcpLoadRecord,
    capabilityLoadRecord,
    bedrockRequestIds,
  };
}

// ---------------------------------------------------------------------------
// THINK-173 U6 — manifest-mode capability registration helpers.
// ---------------------------------------------------------------------------

interface RegisterManifestCapabilityToolsArgs {
  manifest: CapabilitiesManifestFile;
  /** Mutated: manifest binding/script tools are appended. */
  tools: AgentTool<any>[];
  /** The MCP-built AgentTools — binding execution delegates to these. */
  mcpTools: AgentTool<any>[];
  builtinToolNames: string[];
  extensionToolNames: string[];
  mcpRegistry: McpToolRegistry;
  validatedMcpServerNames: Set<string>;
  sandboxFactory: ReturnType<typeof resolveSandboxFactory> | null;
  cleanup: Array<() => Promise<void>>;
  workspaceDir: string;
  identity: IdentitySnapshot;
  record: InvocationResourceBundle["capabilityLoadRecord"];
}

/**
 * Register the manifest's ACTIVE tool entries. Failure semantics are R9's:
 * a bad entry is skipped with a structured log + load-record row and the
 * turn proceeds — only the manifest read/verify itself (upstream) is fatal.
 * Classes builtin/skill/connection are informational here: builtins and
 * skills load via their existing paths, connections ride the dispatch's
 * mcp_configs payload.
 */
function registerManifestCapabilityTools(
  args: RegisterManifestCapabilityToolsArgs,
): void {
  const skip = (
    entry: CapabilityManifestEntry,
    reason: string,
    detail?: string,
  ) => {
    args.record.push({
      name: entry.name,
      kind: entry.kind ?? "unknown",
      status: "skipped",
      reason,
    });
    logStructured({
      level: "warn",
      event: "capability_tool_skipped",
      tenantId: args.identity.tenantId,
      threadId: args.identity.threadId,
      toolName: entry.name,
      kind: entry.kind ?? "unknown",
      reason,
      ...(detail ? { detail } : {}),
    });
  };
  const registered = (entry: CapabilityManifestEntry) => {
    args.record.push({
      name: entry.name,
      kind: entry.kind ?? "unknown",
      status: "registered",
    });
  };

  const toolEntries = args.manifest.active.filter(
    (entry) => entry.class === "tool",
  );
  if (toolEntries.length === 0) return;

  // Collision second line (R10): reserve every name already claimed this
  // invocation, then judge the manifest entries with the SAME shared
  // registry render used. Assembled tools are seeded at "platform"
  // precedence (they exist; a manifest binding/script must never shadow
  // them). Render should have caught any of this — defense in depth.
  const assembledNames = [
    ...new Set([
      ...BUILTIN_TOOL_NAMES,
      ...args.builtinToolNames,
      ...args.extensionToolNames,
      ...args.tools.map((tool) => tool.name),
    ]),
  ];
  const claims: ToolNameClaim[] = [
    ...assembledNames.map((name) => ({
      name,
      source: "platform" as const,
      origin: "assembled",
    })),
    ...toolEntries.map((entry) => ({
      name: entry.name,
      source: manifestClaimSource(entry.kind),
      origin: entry.slug,
    })),
  ];
  const verdicts = resolveToolNameClaims(claims).slice(assembledNames.length);

  const assembledNameSet = new Set(assembledNames);
  toolEntries.forEach((entry, index) => {
    const kind = entry.kind;
    // platform/extension entries do not add new tool names — they bind
    // an already-assembled surface, so the collision verdict does not
    // apply to them.
    if (kind === "platform") {
      const platformTool = entry.platformTool ?? "";
      if (platformTool && assembledNameSet.has(platformTool)) {
        registered(entry);
      } else {
        // Container version skew (R9): skip the one entry, keep the turn.
        skip(entry, "unknown_platform_tool", platformTool);
      }
      return;
    }
    if (kind === "extension") {
      const extensionTool = entry.extensionTool ?? "";
      if (extensionTool && args.extensionToolNames.includes(extensionTool)) {
        registered(entry);
      } else {
        skip(entry, "extension_tool_unavailable", extensionTool);
      }
      return;
    }

    const verdict = verdicts[index]!;
    if (!verdict.ok) {
      skip(
        entry,
        verdict.reason === "collision" ? "collision" : "malformed_name",
        verdict.reason === "collision"
          ? `held by ${verdict.winner?.source ?? "unknown"}`
          : undefined,
      );
      return;
    }

    if (kind === "binding") {
      const connection = entry.connection ?? "";
      const operation = entry.operation ?? "";
      if (!args.validatedMcpServerNames.has(connection)) {
        skip(entry, "connection_unavailable", connection);
        return;
      }
      if (!args.mcpRegistry.get(connection, operation)) {
        skip(entry, "operation_unavailable", `${connection}/${operation}`);
        return;
      }
      const underlying = findUnderlyingMcpTool(
        args.mcpTools,
        connection,
        operation,
      );
      if (!underlying) {
        skip(entry, "operation_unavailable", `${connection}/${operation}`);
        return;
      }
      args.tools.push(buildBindingCapabilityTool(entry, underlying));
      registered(entry);
      return;
    }

    if (kind === "script") {
      if (!args.sandboxFactory) {
        skip(entry, "sandbox_unavailable");
        return;
      }
      const entryFile = entry.entry ?? "";
      if (
        !entryFile ||
        entryFile.startsWith("/") ||
        entryFile.split("/").includes("..")
      ) {
        skip(entry, "malformed_entry", entryFile);
        return;
      }
      args.tools.push(
        buildScriptCapabilityTool({
          entry,
          entryFile,
          workspaceDir: args.workspaceDir,
          sandboxFactory: args.sandboxFactory,
          cleanup: args.cleanup,
        }),
      );
      registered(entry);
      return;
    }

    skip(entry, "unknown_kind", String(kind));
  });
}

function manifestClaimSource(
  kind: CapabilityManifestEntry["kind"],
): ToolNameClaim["source"] {
  switch (kind) {
    case "platform":
      return "platform";
    case "extension":
      return "extension";
    case "script":
      return "script";
    case "binding":
    default:
      return "binding";
  }
}

/**
 * Locate the MCP-built AgentTool for (server, operation). Primary match
 * is the production naming scheme (`mcp_<server>_<tool>`, sanitized +
 * length-capped); fallback is the `"<server>: <tool>"` label both the
 * production factory and the test fakes emit.
 */
function findUnderlyingMcpTool(
  mcpTools: AgentTool<any>[],
  server: string,
  operation: string,
): AgentTool<any> | null {
  const sanitized = (value: string) =>
    value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
  const directName = `mcp_${sanitized(server)}_${sanitized(operation)}`;
  const label = `${server}: ${operation}`;
  return (
    mcpTools.find((tool) => tool.name === directName) ??
    mcpTools.find((tool) => (tool as { label?: string }).label === label) ??
    null
  );
}

/** Deep merge: preset args UNDER the model's arguments (model wins). */
function mergePresetArgs(
  preset: Record<string, unknown> | undefined,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (!preset) return params;
  const out: Record<string, unknown> = { ...preset };
  for (const [key, value] of Object.entries(params)) {
    const existing = out[key];
    if (
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      out[key] = mergePresetArgs(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Binding tool (R5): a stable-named wrapper over one operation of an
 * admitted connection, delegating to the MCP AgentTool the connect path
 * already built (same auth handles, timeouts, record-link enrichment).
 * `output` shaping is cosmetic in v1 — the raw result passes through
 * unchanged; THINK-174's surface work owns real shaping.
 */
function buildBindingCapabilityTool(
  entry: CapabilityManifestEntry,
  underlying: AgentTool<any>,
): AgentTool<any> {
  return {
    name: entry.name,
    label: `${entry.connection}: ${entry.operation} (binding)`,
    description:
      entry.description ||
      `Call ${entry.operation} on ${entry.connection} with preset arguments.`,
    parameters: underlying.parameters,
    executionMode: "sequential",
    execute: async (toolCallId, params) => {
      const merged = mergePresetArgs(
        entry.presetArgs,
        params && typeof params === "object" && !Array.isArray(params)
          ? (params as Record<string, unknown>)
          : {},
      );
      return underlying.execute(
        toolCallId,
        merged as never,
        undefined as never,
      );
    },
  };
}

/**
 * Script tool (R8): executes the folder's sandbox payload through the
 * SAME AgentCore Code Interpreter session factory as execute_code. The
 * model's arguments reach the script as a JSON string in `TOOL_ARGS`.
 * Registration is trust-gated upstream: render only emits ACTIVE script
 * entries whose sidecar carries a current passed trust report.
 */
function buildScriptCapabilityTool(options: {
  entry: CapabilityManifestEntry;
  entryFile: string;
  workspaceDir: string;
  sandboxFactory: NonNullable<ReturnType<typeof resolveSandboxFactory>>;
  cleanup: Array<() => Promise<void>>;
}): AgentTool<any> {
  let session: Awaited<
    ReturnType<(typeof options.sandboxFactory)["createSessionEnv"]>
  > | null = null;
  async function getSession() {
    if (session) return session;
    session = await options.sandboxFactory.createSessionEnv({
      id: `capability-script-${options.entry.slug}`,
      cwd: "/home/user",
    });
    if (session.cleanup) {
      options.cleanup.push(() => session?.cleanup?.() ?? Promise.resolve());
    }
    return session;
  }
  return {
    name: options.entry.name,
    label: `${options.entry.slug} (script tool)`,
    description:
      options.entry.description ||
      `Run the ${options.entry.slug} workspace script tool.`,
    parameters: Type.Object({}, { additionalProperties: true }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const scriptPath = path.join(
        options.workspaceDir,
        "tools",
        options.entry.slug,
        options.entryFile,
      );
      const source = await readWorkspaceFile(scriptPath);
      const env = await getSession();
      const command = scriptSandboxCommand(
        options.entryFile,
        source,
        params ?? {},
      );
      const result = await env.exec(command, { timeout: 120_000 });
      const text = [
        `exit_code: ${result.exitCode}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      if (result.exitCode !== 0) {
        throw new Error(text);
      }
      return {
        content: [{ type: "text", text }],
        details: {
          capability_tool: options.entry.name,
          entry: options.entryFile,
          exit_code: result.exitCode,
        },
      };
    },
  };
}

async function readWorkspaceFile(filePath: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(filePath, "utf-8");
}

/**
 * Build the sandbox command for a script tool. Python entries exec via
 * base64 (mirrors execute_code's escaping-proof pattern); everything
 * else runs as bash. TOOL_ARGS carries the model's arguments as JSON.
 */
function scriptSandboxCommand(
  entryFile: string,
  source: string,
  params: unknown,
): string {
  const argsJson = JSON.stringify(params ?? {});
  const argsB64 = Buffer.from(argsJson, "utf8").toString("base64");
  const sourceB64 = Buffer.from(source, "utf8").toString("base64");
  if (entryFile.endsWith(".py")) {
    const py = [
      "import base64, os",
      `os.environ["TOOL_ARGS"] = base64.b64decode("${argsB64}").decode("utf-8")`,
      `code = base64.b64decode("${sourceB64}").decode("utf-8")`,
      'exec(compile(code, "<thinkwork-capability-script>", "exec"))',
    ].join("; ");
    return `python3 -c '${py}'`;
  }
  return (
    `TOOL_ARGS="$(echo ${argsB64} | base64 -d)" ` +
    `bash -c "$(echo ${sourceB64} | base64 -d)"`
  );
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
  // THINK-586 U7 — warm-session fast path (KTD6). `undefined` means "not
  // injected": resolve the process singleton (null off the AgentCore
  // runtime). An explicit null injection disables the cache.
  const warmCache =
    deps.warmSessionCache !== undefined
      ? deps.warmSessionCache
      : getWarmSessionCache();
  const lockThreadId = asString(args.payload.thread_id);
  if (!warmCache || !lockThreadId) {
    return runInvocationTurn(args, deps, warmCache ?? null);
  }
  // Per-thread in-process lock around the fast path: concurrent turns for
  // the same thread on one container must not interleave cache state.
  return warmCache.withThreadLock(lockThreadId, () =>
    runInvocationTurn(args, deps, warmCache),
  );
}

async function runInvocationTurn(
  args: HandleInvocationArgs,
  deps: HandlerDependencies,
  warmCache: WarmSessionCache<WarmTurnProducts> | null,
): Promise<HandleInvocationResult> {
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
  const callbackLogger = (entry: Record<string, unknown>) => {
    const level =
      entry.level === "error" ||
      entry.level === "warn" ||
      entry.level === "info"
        ? entry.level
        : "info";
    const event =
      typeof entry.event === "string" ? entry.event : "lambda_callback_fetch";
    logStructured({ ...entry, level, event } as LogFields);
  };
  const callbackFetchImpl =
    deps.fetchImpl ??
    createLambdaCallbackFetch({
      fallbackFetch: fetchImpl,
      lambdaClient: deps.lambdaClientFactory(env.awsRegion),
      finalizeFunctionName: env.chatAgentFinalizeFnName || "",
      activityFunctionName: env.chatAgentActivityFnName || "",
      manifestFunctionName: env.manifestLogFnName || "",
      toolExecutionsFunctionName: env.toolExecutionsFnName || "",
      logger: callbackLogger,
    });
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

  // Allocate the per-invocation cleanup queue here (the same array the
  // handler's `finally` block drains). The MCP connect factory and tool
  // builders share this reference, so transport teardown closures land in
  // the array we actually drain — not a private array owned by the
  // factory. This was a real defect in an earlier draft that the multi-
  // reviewer pass caught (correctness + reliability + maintainability +
  // adversarial + agent-native + kieran-typescript all flagged it).
  // (Hoisted above the workspace bootstrap for THINK-586 U7: the warm
  // fast-path decision needs the HandleStore + scrubbing fetch to re-mint
  // handles for retained MCP transports BEFORE deciding to skip
  // re-bootstrap.)
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

  // ── THINK-586 U7: warm-session fast-path decision (KTD6) ────────────────
  // Eligibility excludes payload shapes whose tool surface is inherently
  // per-turn (explicit memory turns, pinned skills, skill-creator
  // commands): those always run the cold path and are never cached.
  // A provisioned sandbox interpreter does NOT disqualify: execute_code is
  // lazy (no session/cleanup until first call), stripped from the cached
  // toolset, and rebuilt per warm turn bound to that turn's client +
  // cleanup queue — so the cached products never hold sandbox state.
  const warmConfigFingerprint = asString(args.payload.config_fingerprint);
  const warmEligibility = {
    cache: Boolean(warmCache),
    bucket: Boolean(workspaceBucket),
    fingerprint: Boolean(warmConfigFingerprint),
    tenantSlug: Boolean(identity.tenantSlug),
    agentSlug: Boolean(identity.agentSlug),
    userId: Boolean(identity.userId),
    noExplicitMemory: !explicitMemoryTurn(args.payload.message),
    noPinnedSkills:
      parsePinnedSkillRefs(args.payload.pinned_skills).length === 0,
    noSkillCreator: !parseSkillCreatorCommandPayload(
      args.payload.skill_creator_command,
    ),
  };
  const warmEligible = Object.values(warmEligibility).every(Boolean);
  let warmKey = "";
  let warmAuthVersion = "";
  let warmEntry: WarmSessionEntry<WarmTurnProducts> | null = null;
  if (warmCache && warmEligible) {
    warmKey = warmSessionKey({
      tenantSlug: identity.tenantSlug,
      agentSlug: identity.agentSlug,
      userId: identity.userId,
      threadId: identity.threadId,
      configFingerprint: warmConfigFingerprint,
    });
    warmAuthVersion = warmAuthorizationVersion(args.payload);
    const candidate = warmCache.peek(warmKey);
    if (candidate) {
      // Reuse gates: durable-store freshness (cached marker vs live S3
      // session head) + credential/authorization version (R20) + local
      // workspace stamp. Any mismatch evicts and takes the cold path.
      const liveHead = await probeDurableSessionHead({
        s3: deps.s3ClientFactory(env.awsRegion),
        bucket: workspaceBucket,
        tenantSlug: identity.tenantSlug,
        threadId: identity.threadId,
      });
      warmEntry = warmCache.take(warmKey, {
        durableStoreMarker: liveHead,
        authorizationVersion: warmAuthVersion,
      });
      if (!warmEntry) {
        // The gate mismatch evicted the entry: close its retained
        // transports so a replaced credential set gets fresh clients.
        void candidate.value.mcpRetention?.close().catch(() => undefined);
      } else if (
        !(await warmWorkspaceStampMatches({
          workspaceDir: env.workspaceDir,
          tenantSlug: identity.tenantSlug,
          agentSlug: identity.agentSlug,
          workspacePrefix: candidate.value.workspacePrefix,
        }))
      ) {
        logStructured({
          level: "info",
          event: "warm_session_workspace_stamp_mismatch",
          tenantId: identity.tenantId,
          agentSlug: identity.agentSlug,
          threadId: identity.threadId,
        });
        void warmEntry.value.mcpRetention?.close().catch(() => undefined);
        warmCache.evict(warmKey);
        warmEntry = null;
      }
    }
    if (warmEntry?.value.mcpRetention) {
      // Re-mint the current payload's bearers into THIS turn's fresh
      // HandleStore and repoint the retained transports at this turn's
      // scrubbing fetch, then liveness-ping every server. Any failure
      // (dead transport, missing bearer) evicts → cold path.
      const bearerByServer: Record<string, string> = {};
      for (const config of parseMcpConfigs(args.payload.mcp_configs)) {
        if (typeof config.bearer === "string" && config.bearer.trim()) {
          bearerByServer[config.serverName] = config.bearer;
        }
      }
      try {
        await warmEntry.value.mcpRetention.rebind({
          fetch: scrubbingFetch,
          authorizationForServer: (serverName) => {
            const bearer = bearerByServer[serverName];
            return bearer
              ? `${McpHandleAuthScheme} ${handleStore.mint(bearer)}`
              : null;
          },
        });
      } catch (err) {
        logStructured({
          level: "warn",
          event: "warm_session_mcp_rebind_failed",
          tenantId: identity.tenantId,
          threadId: identity.threadId,
          error: err instanceof Error ? err.message : String(err),
        });
        void warmEntry.value.mcpRetention.close().catch(() => undefined);
        warmCache.evict(warmKey);
        warmEntry = null;
      }
    }
  }
  // Retention for a cold-but-cacheable turn's newly built MCP clients:
  // diverts transport teardown away from the per-turn cleanup queue so the
  // clients survive into the cache. Null on non-cacheable turns → today's
  // per-turn teardown, byte-identical.
  const mcpRetention: McpConnectionRetention | null = warmEntry
    ? warmEntry.value.mcpRetention
    : warmCache && warmEligible
      ? (deps.mcpRetentionFactory ?? createMcpConnectionRetention)()
      : null;
  if (warmCache) {
    runtimeDiagnostics.session_reuse = warmEntry ? "warm" : "cold";
  }

  const connectMcpServer =
    deps.connectMcpServerFactory ??
    createConnectMcpServer({
      cleanup,
      fetch: scrubbingFetch,
      ...(mcpRetention && !warmEntry ? { retention: mcpRetention } : {}),
    });

  // Workspace S3 sync — required for tenant isolation when the environment or
  // managed-runtime payload carries a workspace bucket. Warm containers persist
  // the workspace directory across invocations, so a turn that skips the
  // per-tenant sync would discover the prior tenant's SKILL.md files and leak
  // them into the system prompt. Fail closed when the bucket is known.
  let workspaceBaseline: WorkspaceBaseline | undefined;
  let coldWorkspacePrefix = "";
  if (workspaceBucket && warmEntry) {
    // Warm hit (THINK-586 U7): every reuse gate passed — the workspace on
    // this container is the one this tenant/agent last synced. Skip the
    // full re-bootstrap; the S3 durable session store remains the
    // correctness source.
    recordRuntimePhase({
      phase: "runtime.workspace_bootstrap",
      status: "skipped",
      detail: "session_reuse=warm",
    });
    logAgentCorePhase({
      phase: "runtime.workspace_bootstrap",
      status: "skipped",
      tenantId: identity.tenantId,
      agentId: identity.agentId,
      agentSlug: identity.agentSlug,
      threadId: identity.threadId,
      threadTurnId,
      traceId: identity.traceId,
      runtimeType: "pi",
      detail: "session_reuse=warm",
    });
  } else if (workspaceBucket) {
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
      coldWorkspacePrefix = bootstrapResult.prefix;
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
  // Warm hit: reuse the cached (already trust-filtered) skill set — the
  // authorization-version gate covers trusted-skill changes. Cold: walk the
  // local workspace tree as before.
  const discoveredSkills = warmEntry
    ? warmEntry.value.workspaceSkills
    : (await discoverSkills(env.workspaceDir)).filter((skill) =>
        trustedSkillIds.has(skill.slug),
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
    // Warm hit: the workspace was not re-synced, so mcp.json cannot have
    // changed — reuse the parse from the caching turn (it only feeds the
    // skipped tool assembly anyway).
    mcpJsonConfig = warmEntry
      ? warmEntry.value.mcpJsonConfig
      : await readMcpJson(env.workspaceDir);
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
  if (warmEntry) {
    // McpToolRegistry stays per-turn (stated invariant): replay the cached
    // tools/list metadata into this turn's fresh registry — no network.
    for (const entry of warmEntry.value.mcpRegistryEntries) {
      mcpRegistry.register(entry.server, entry);
    }
  }

  // THINK-173 U6 — MANIFEST MODE: the dispatch pinned a capabilities
  // manifest fingerprint (only sent for capability_folder_dispatch
  // agents). Read + verify the pinned bytes from the bootstrapped
  // workspace. Any failure — missing file, malformed JSON, bad shape,
  // unverifiable signature — is a structured 500 (R9: loud, never a
  // silent legacy fallback). No fingerprint = legacy path, untouched.
  let capabilitiesManifest: CapabilitiesManifestFile | null = null;
  const capabilitiesManifestFingerprint = asString(
    args.payload.capabilities_manifest_fingerprint,
  );
  if (warmEntry) {
    // Warm hit: fingerprint changes miss the authorization-version gate,
    // so the cached verified manifest is current for this turn.
    capabilitiesManifest = warmEntry.value.capabilitiesManifest;
  } else if (capabilitiesManifestFingerprint) {
    try {
      capabilitiesManifest = await readCapabilitiesManifest(
        env.workspaceDir,
        capabilitiesManifestFingerprint,
      );
    } catch (err) {
      if (err instanceof CapabilitiesJsonError) {
        logStructured({
          level: "error",
          event: "capabilities_manifest_invalid",
          tenantId: identity.tenantId,
          agentSlug: identity.agentSlug,
          fingerprint: capabilitiesManifestFingerprint,
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
  }

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

  // (THINK-586 U7: the per-invocation cleanup queue, HandleStore, scrubbing
  // fetch, and connectMcpServer factory are allocated earlier — above the
  // workspace bootstrap — so the warm fast-path decision can re-mint
  // handles for retained MCP transports. Same per-turn lifecycle.)

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
  // THINK-245 U4 — one collector shared by the request-identity extension
  // (parent agent loop) and the Bedrock child-model caller, so every model
  // call's response requestId reaches the finalize payload.
  // THINK-586 U7 — warm turns reuse the cached collector array (the cached
  // request-identity extension closure pushes into that exact instance),
  // emptied at turn start. Safe: the per-thread lock is held for the turn.
  const bedrockRequestIds: string[] = warmEntry
    ? warmEntry.value.bedrockRequestIds
    : [];
  bedrockRequestIds.length = 0;
  const collectBedrockRequestId = (requestId: string) => {
    if (!bedrockRequestIds.includes(requestId)) {
      bedrockRequestIds.push(requestId);
    }
  };
  const childRequestMetadata: Record<string, string> = {
    ...(threadTurnId ? { thread_turn_id: threadTurnId } : {}),
    ...(identity.traceId ? { trace_id: identity.traceId } : {}),
  };
  // THINK-324 C4 — attachment staging (S3 downloads to /tmp) is independent
  // of tool assembly (MCP connects), so run both concurrently. The failure
  // path below awaits this promise and removes any staged turn dir, keeping
  // the "no leaked /tmp attachments" invariant on every exit.
  const stageAttachments =
    deps.stageMessageAttachmentsImpl ?? stageMessageAttachments;
  const stagedAttachmentsPromise = stageAttachments({
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
  // Suppress the unhandled-rejection warning for a staging failure that
  // lands while tool assembly is still in flight — the later await of this
  // same promise still observes (and rethrows) the rejection.
  stagedAttachmentsPromise.catch(() => {});
  let coldWarmProducts: WarmTurnProducts | null = null;
  let warmSessionAssemblyCleanupCount = -1;
  if (warmEntry) {
    // Warm hit (THINK-586 U7): reuse the cached bootstrap products instead
    // of reconnecting MCP servers and reassembling tools. The per-turn
    // bundle gets fresh array copies (later per-turn pushes — file_read,
    // profile tool, dynamic extensions — must never accrete into the
    // cache), this turn's HandleStore, and this turn's cleanup queue.
    // The cached toolset never contains execute_code (stripped at snapshot):
    // its closure holds the caching turn's lazy sandbox session + cleanup
    // queue. Rebuild it here bound to THIS turn's client and cleanup — the
    // build is closure-only (no session until first call), so this costs
    // nothing on turns that don't run code.
    const warmTools = [...warmEntry.value.tools];
    const warmSandboxInterpreterId = asString(
      args.payload.sandbox_interpreter_id,
    );
    if (warmSandboxInterpreterId) {
      warmTools.push(
        buildExecuteCodeTool({
          sandboxFactory: resolveSandboxFactory(
            args.payload as { sandbox_interpreter_id: string },
            { client: agentCoreClient },
          ),
          cleanup,
          exportContext: resolveExecuteCodeExportContext(args.payload),
        }),
      );
    }
    bundle = {
      tools: warmTools,
      builtinToolNames: [...warmEntry.value.builtinToolNames],
      extensionFactories: [...warmEntry.value.extensionFactories],
      extensionToolNames: [...warmEntry.value.extensionToolNames],
      cleanup,
      workspaceSkills: warmEntry.value.workspaceSkills,
      handleStore,
      mcpProxyRegistered: warmEntry.value.mcpProxyRegistered,
      mcpLoadRecord: warmEntry.value.mcpLoadRecord,
      capabilityLoadRecord: warmEntry.value.capabilityLoadRecord,
      bedrockRequestIds,
    };
    logAgentCorePhase({
      phase: "runtime.tool_assembly",
      status: "skipped",
      tenantId: identity.tenantId,
      agentId: identity.agentId,
      agentSlug: identity.agentSlug,
      threadId: identity.threadId,
      threadTurnId,
      traceId: identity.traceId,
      runtimeType: "pi",
      count: bundle.tools.length,
      detail: "session_reuse=warm",
    });
    recordRuntimePhase({
      phase: "runtime.tool_assembly",
      status: "skipped",
      count: bundle.tools.length,
      detail: "session_reuse=warm",
    });
  } else
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
        bedrockRequestIds,
        handleStore,
        mcpJsonConfig,
        capabilitiesManifest,
        mcpRegistry,
        fetchWorkspaceSourceHost,
        childModelCaller:
          deps.childModelCaller ??
          createBedrockChildModelCaller(
            deps.bedrockRuntimeClientFactory(env.awsRegion),
            {
              requestMetadata: childRequestMetadata,
              onRequestId: collectBedrockRequestId,
            },
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
      if (warmCache && warmEligible) {
        // THINK-586 U7 — snapshot the reusable products NOW, before per-turn
        // additions mutate the bundle arrays. Stored into the cache only
        // after the turn succeeds. An assembly-time cleanup closure (other
        // than the retained MCP teardowns, which were diverted) means the
        // toolset holds per-turn resources → not cacheable.
        warmSessionAssemblyCleanupCount = cleanup.length;
        coldWarmProducts =
          cleanup.length === 0
            ? {
                // execute_code is stripped: its closure binds this turn's
                // lazy sandbox session + cleanup queue. Warm reuse rebuilds
                // it fresh from the then-current payload (see the warm
                // bundle above).
                tools: bundle.tools.filter(
                  (tool) => tool.name !== "execute_code",
                ),
                builtinToolNames: [...bundle.builtinToolNames],
                extensionFactories: [...bundle.extensionFactories],
                extensionToolNames: [...bundle.extensionToolNames],
                workspaceSkills: bundle.workspaceSkills,
                capabilitiesManifest,
                mcpJsonConfig,
                mcpProxyRegistered: bundle.mcpProxyRegistered,
                mcpLoadRecord: bundle.mcpLoadRecord,
                capabilityLoadRecord: bundle.capabilityLoadRecord,
                mcpRegistryEntries: mcpRegistry.entries(),
                bedrockRequestIds,
                mcpRetention,
                workspacePrefix: coldWorkspacePrefix,
                session: null,
              }
            : null;
      }
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
      if (mcpRetention) {
        // THINK-586 U7 — the retained MCP teardowns were diverted away from
        // the cleanup queue; nothing will cache them on this failed path.
        await mcpRetention.close();
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
      // The concurrent staging may have downloaded attachments into /tmp; the
      // normal cleanup path (post-loop finally) is unreachable from here.
      try {
        const staged = await stagedAttachmentsPromise;
        await cleanupMessageAttachments(staged.turnDir);
      } catch (stagingErr) {
        logStructured({
          level: "warn",
          event: "message_attachment_cleanup_failed",
          tenantId: identity.tenantId,
          error:
            stagingErr instanceof Error
              ? stagingErr.message
              : String(stagingErr),
        });
      }
      return {
        statusCode: 500,
        body: {
          error:
            err instanceof Error ? err.message : "Pi tool assembly failed.",
          runtime: "pi",
        },
      };
    }

  // ── THINK-910: capability-scoped tool loading ──────────────────────────
  // Ships DARK: `TOOL_SCOPE_MODE` defaults to `all`, which returns the
  // assembled tool list untouched. Applied here — after both the warm and
  // cold assembly paths converge, and after the warm-cache snapshot was
  // taken — so the cache keeps the full assembled surface and the scope
  // decision is re-made from the current manifest/sidecars every turn.
  // Only MCP-built tools are ever candidates for removal; built-ins,
  // extension tools, and every platform/manifest capability tool are
  // untouched (see runtime/tool-scope.ts).
  const toolScopeMode = resolveToolScopeMode(process.env);
  const scopeResult = scopeTools({
    mode: toolScopeMode,
    tools: bundle.tools,
    manifest: (capabilitiesManifest ?? null) as ScopeManifest | null,
    sidecarOperations:
      toolScopeMode === "all"
        ? new Map()
        : await readSidecarOperations(
            env.workspaceDir,
            mcpServersInTools(bundle.tools),
          ).catch(() => new Map<string, string[]>()),
  });
  if (scopeResult.droppedNames.length > 0) {
    const droppedToolNames = new Set(scopeResult.droppedNames);
    bundle.tools = bundle.tools.filter(
      (tool) => !droppedToolNames.has(tool.name),
    );
    logStructured({
      level: "info",
      event: "tool_scope_applied",
      tenantId: identity.tenantId,
      agentSlug: identity.agentSlug,
      threadId: identity.threadId,
      mode: scopeResult.mode,
      before: scopeResult.before,
      after: scopeResult.after,
      droppedCount: scopeResult.before - scopeResult.after,
    });
  }
  runtimeDiagnostics.tool_scope = {
    mode: scopeResult.mode,
    before: scopeResult.before,
    after: scopeResult.after,
    dropped: scopeResult.dropped,
    connections: scopeResult.connections,
  };

  // Run the agent loop inside try/finally so the HandleStore is cleared
  // even if the LLM throws or a tool raises.
  // THINK-586 U7 — the products this turn will cache (warm: the reused
  // entry's value; cold: the post-assembly snapshot, null when not
  // cacheable). Shared with the session-store wrapper below so the durable
  // body/version markers stay current.
  const warmProducts: WarmTurnProducts | null = warmEntry
    ? warmEntry.value
    : coldWarmProducts;
  let warmSessionWriteFailed = false;
  let runResult: RunAgentLoopResult | undefined;
  let runError: unknown;
  let runLoopStart = 0;
  const stagedAttachments = await stagedAttachmentsPromise;
  const attachmentPreamble = formatMessageAttachmentsPreamble(
    stagedAttachments.staged,
  );
  // THINK-302 U13 (R30): surface withheld capabilities (drift, pending
  // approval, gated, …) so the model reports "pending re-approval" instead
  // of confabulating about a missing tool. Bounded + best-effort.
  const withheldNotice = formatWithheldCapabilitiesNotice(
    (capabilitiesManifest?.withheld ?? null) as ReadonlyArray<
      Record<string, unknown>
    > | null,
  );
  const systemPromptSuffix =
    [attachmentPreamble, withheldNotice].filter(Boolean).join("\n\n") ||
    undefined;
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
  // THINK-324 C2b — date + requester context ride the TURN prompt, not the
  // system prompt, so the cached system prefix stops churning daily and per
  // requester. Outermost prepend: the block leads the message it describes.
  // Goal-mode turns carry a synthetic runtime command as the message — the
  // goal extension parses it verbatim, so those turns get no prefix.
  const turnContextBlock = goalModeCommand
    ? ""
    : buildTurnContextBlock(args.payload);
  const withTurnCommandContext = (message: string): string => {
    const wrapped = withQuestionAnswerContext(
      skillCreatorCommandBlock
        ? `${skillCreatorCommandBlock}\n\n${message}`
        : message,
    );
    return turnContextBlock ? `${turnContextBlock}\n\n${wrapped}` : wrapped;
  };
  let agentProfiles = normalizeAgentProfiles(args.payload.agent_profiles);
  // Subagent-folders U9/U10: when this dispatch pinned a capabilities
  // manifest, resolve sub-agent profiles from its agent entries + the
  // synced agents/<slug>/INSTRUCTIONS.md files.
  //   - authority "manifest" (U10 per-agent flip): manifest profiles ARE
  //     the central truth; the payload carries only space-local profiles
  //     in full, which win on slug collision (today's shadowing rule).
  //   - otherwise (dual-read soak): divergence is a structured warning
  //     and the payload stays authoritative.
  if (capabilitiesManifest) {
    try {
      const manifestProfiles = await agentProfilesFromManifest({
        manifest: capabilitiesManifest,
        workspaceDir: env.workspaceDir,
      });
      for (const skippedProfile of manifestProfiles.skipped) {
        logStructured({
          level: "warn",
          event: "agent_profile_manifest_skip",
          tenantId: identity.tenantId,
          agentSlug: identity.agentSlug,
          profileSlug: skippedProfile.slug,
          reason: skippedProfile.reason,
          detail: skippedProfile.detail,
        });
      }
      if (args.payload.agent_profiles_authority === "manifest") {
        const payloadSlugs = new Set(
          agentProfiles.map((profile) => profile.slug),
        );
        agentProfiles = [
          ...agentProfiles,
          ...manifestProfiles.profiles.filter(
            (profile) => !payloadSlugs.has(profile.slug),
          ),
        ];
        logStructured({
          level: "info",
          event: "agent_profiles_manifest_authority",
          tenantId: identity.tenantId,
          agentSlug: identity.agentSlug,
          manifestProfiles: manifestProfiles.profiles.length,
          spaceLocalProfiles: payloadSlugs.size,
          fingerprint: capabilitiesManifestFingerprint,
        });
      } else {
        for (const divergence of diffProfileSources({
          payloadProfiles: agentProfiles,
          manifestProfiles: manifestProfiles.profiles,
        })) {
          logStructured({
            level: "warn",
            event: "agent_profile_manifest_divergence",
            tenantId: identity.tenantId,
            agentSlug: identity.agentSlug,
            profileSlug: divergence.slug,
            fields: divergence.fields,
          });
        }
      }
    } catch (err) {
      logStructured({
        level: "warn",
        event: "agent_profile_manifest_dual_read_failed",
        tenantId: identity.tenantId,
        agentSlug: identity.agentSlug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // THINK-229 U4 (R8): withheld-connection notices from the dispatch's
  // MCP build — injected into delegated-child context so the model names
  // the outage instead of estimating.
  const withheldConnections = Array.isArray(args.payload.withheld_connections)
    ? (args.payload.withheld_connections as unknown[])
        .map((entry) => {
          const record = (entry ?? {}) as { slug?: unknown; detail?: unknown };
          return typeof record.slug === "string" &&
            typeof record.detail === "string"
            ? { slug: record.slug, detail: record.detail }
            : null;
        })
        .filter((entry): entry is { slug: string; detail: string } =>
          Boolean(entry),
        )
    : [];
  const profileChildExtensionFactories = [...bundle.extensionFactories];
  const profileChildExtensionToolNames = [...bundle.extensionToolNames];
  const dynamicDefaultExtensions = loadDynamicPiExtensions({
    value: args.payload.pi_extensions,
    targetType: "default_agent",
    reservedToolNames: [
      ...bundle.builtinToolNames,
      ...bundle.tools.map((tool) => tool.name),
      ...bundle.extensionToolNames,
    ],
    log: (event, fields) =>
      logStructured({
        level: fields.status === "loaded" ? "info" : "warn",
        event,
        tenantId: identity.tenantId,
        threadId: identity.threadId,
        ...fields,
      }),
  });
  bundle.extensionFactories.push(
    ...dynamicDefaultExtensions.extensionFactories,
  );
  bundle.extensionToolNames.push(
    ...dynamicDefaultExtensions.extensionToolNames,
  );
  const profileExtensionFactoriesById = new Map<string, ExtensionFactory[]>();
  const profileExtensionToolNamesById = new Map<string, string[]>();
  for (const profile of agentProfiles) {
    const loaded = loadDynamicPiExtensions({
      value: profile.piExtensions,
      targetType: "agent_profile",
      agentProfileId: profile.id,
      reservedToolNames: [
        ...bundle.builtinToolNames,
        ...bundle.tools.map((tool) => tool.name),
        ...profileChildExtensionToolNames,
      ],
      log: (event, fields) =>
        logStructured({
          level: fields.status === "loaded" ? "info" : "warn",
          event,
          tenantId: identity.tenantId,
          threadId: identity.threadId,
          agentProfileId: profile.id,
          ...fields,
        }),
    });
    if (loaded.extensionFactories.length > 0) {
      profileExtensionFactoriesById.set(profile.id, loaded.extensionFactories);
      profileExtensionToolNamesById.set(profile.id, loaded.extensionToolNames);
    }
  }
  // The single model id for THIS turn: every runLoop call site and the
  // synthesized AssistantMessage history entries must use it so the loop
  // model and history metadata stay self-consistent. `payload.model` is
  // optional — chat-agent-invoke sends null when the agent row has no
  // configured model, and runLoop throws UnsupportedModelError on a
  // missing id — so the fallback here is load-bearing, not cosmetic.
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
    { fetchImpl: callbackFetchImpl, logger: (entry) => logStructured(entry) },
  );
  // Tool-execution ledger emitter (THINK-324 C17). Same snapshot-at-entry and
  // best-effort contract as the activity emitter; the endpoint URL derives
  // from thinkwork_api_url and rides the same callback secret.
  const toolExecutionEmitter = createToolExecutionEmitter(
    readToolExecutionCallbackConfig(args.payload),
    { fetchImpl: callbackFetchImpl, logger: (entry) => logStructured(entry) },
  );
  const profileDelegationOptions = (
    parentModelId: string,
  ): ProfileDelegationToolOptions => ({
    profiles: agentProfiles,
    withheldConnections,
    parentThreadTurnId: threadTurnId || identity.threadId,
    parentModelId,
    tools: bundle.tools,
    extensionFactories: profileChildExtensionFactories,
    extensionToolNames: profileChildExtensionToolNames,
    profileExtensionFactoriesById,
    profileExtensionToolNamesById,
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
          ...bundle.builtinToolNames,
          ...bundle.tools.map((tool) => tool.name),
          ...bundle.extensionToolNames,
        ],
        workspaceSkillsBlock: formatWorkspaceSkills(
          workspaceSkills,
          pinnedEmphasizedSlugs,
        ),
        suffix: systemPromptSuffix,
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
    const instrumentedSessionStore = rawSessionStore
      ? instrumentSessionStore(rawSessionStore, {
          tenantId: identity.tenantId,
          agentId: identity.agentId,
          agentSlug: identity.agentSlug,
          threadId: identity.threadId,
          threadTurnId,
          traceId: identity.traceId,
        })
      : undefined;
    // THINK-586 U7 — warm-session store wrapper. A warm hit serves the
    // cached session body/version without the S3 read; every write passes
    // through to S3 (correctness source, R10) and refreshes the cached
    // markers. A failed durable append evicts the cache entry — divergent
    // history must not survive to the next turn (KTD6).
    const expectedSessionKey = sessionKey(identity.threadId);
    const sessionStore: SessionStore | undefined =
      instrumentedSessionStore && warmProducts && warmCache
        ? {
            read: async (key) => {
              if (
                warmEntry &&
                key === expectedSessionKey &&
                warmProducts.session
              ) {
                logAgentCorePhase({
                  phase: "runtime.session_resume",
                  status: "skipped",
                  tenantId: identity.tenantId,
                  agentId: identity.agentId,
                  agentSlug: identity.agentSlug,
                  threadId: identity.threadId,
                  threadTurnId,
                  traceId: identity.traceId,
                  runtimeType: "pi",
                  detail: "session_reuse=warm",
                });
                recordRuntimePhase({
                  phase: "runtime.session_resume",
                  status: "skipped",
                  detail: "session_reuse=warm",
                });
                return {
                  body: warmProducts.session.body,
                  version: warmProducts.session.version,
                };
              }
              const result = await instrumentedSessionStore.read(key);
              if (result && key === expectedSessionKey) {
                warmProducts.session = {
                  body: result.body,
                  version: result.version,
                };
              }
              return result;
            },
            write: async (key, body, expectedVersion) => {
              try {
                const version = await instrumentedSessionStore.write(
                  key,
                  body,
                  expectedVersion,
                );
                if (key === expectedSessionKey) {
                  warmProducts.session = { body, version };
                }
                return version;
              } catch (err) {
                warmSessionWriteFailed = true;
                if (warmKey) warmCache.evict(warmKey);
                // Evicted entries own their retained transports — close
                // them (idempotent; per-connection failures swallowed).
                void warmProducts.mcpRetention?.close().catch(() => undefined);
                logStructured({
                  level: "warn",
                  event: "warm_session_evicted_on_write_failure",
                  tenantId: identity.tenantId,
                  threadId: identity.threadId,
                  error: err instanceof Error ? err.message : String(err),
                });
                throw err;
              }
            },
          }
        : instrumentedSessionStore;
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
          modelId: currentModelId,
          threadId: identity.threadId,
          gitSha: env.gitSha,
          identity,
          cwd: env.workspaceDir,
          agentDir: env.piAgentDir,
          builtinToolNames: bundle.builtinToolNames,
          sessionStore,
          sessionDir: "/tmp/pi-sessions",
        },
        runLoop,
        log: (entry) => logStructured(entry),
        emitActivity: activityEmitter.emit,
        emitToolExecution: toolExecutionEmitter.emit,
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
          modelId: currentModelId,
          threadId: identity.threadId,
          gitSha: env.gitSha,
          identity,
          cwd: env.workspaceDir,
          agentDir: env.piAgentDir,
          builtinToolNames: bundle.builtinToolNames,
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
          emitToolExecution: toolExecutionEmitter.emit,
        },
      );
    }
    // Silent empty-turn backstop (THINK-145). A completed turn that produced no
    // user-visible output (no assistant text, no UI part, no question/document
    // card) is the "dead silence" bug observed live. Force ONE continuation to
    // coax a final answer; if still empty, fail loudly so the platform marks the
    // turn failed rather than recording a bare empty success. Runs BEFORE the
    // safety-net/finalize so a recovered reply flows through the same sinks.
    runResult = await applyEmptyResponseBackstop({
      runResult,
      threadId: identity.threadId,
      threadTurnId,
      log: (entry) => logStructured(entry),
      retry: () =>
        runLoop(
          {
            message: EMPTY_RESPONSE_CONTINUATION_PROMPT,
            history: parentHistory,
            tools: bundle.tools,
            extensionFactories: bundle.extensionFactories,
            extensionToolNames: bundle.extensionToolNames,
            modelId: currentModelId,
            threadId: identity.threadId,
            gitSha: env.gitSha,
            identity,
            cwd: env.workspaceDir,
            agentDir: env.piAgentDir,
            builtinToolNames: bundle.builtinToolNames,
            sessionStore,
            sessionDir: "/tmp/pi-sessions",
          },
          {
            log: (entry) => logStructured(entry),
            emitActivity: activityEmitter.emit,
            emitToolExecution: toolExecutionEmitter.emit,
          },
        ),
    });
    // Deterministic GenUI safety-net backstop (THINK-116 U7, KTD5). Catches
    // structured content the model returned as *markdown* (a GFM table or a
    // clean list of records) and, if it converts + validates through the SAME
    // strict validator the emit tool uses, emits it as an additional
    // data-json-render part. DEFAULT-ON (THINK-145): live dev evidence showed
    // models return markdown tables despite the advisory trigger policy, so
    // first-class components must not depend on model compliance. Hosts can
    // kill-switch per dispatch with
    // `thread_json_render_safety_net_enabled: false`. The original assistant
    // prose is always kept intact — this augments, never replaces.
    if (args.payload.thread_json_render_safety_net_enabled !== false) {
      try {
        const conversion = detectAndConvert(runResult.content);
        if (conversion.matched && conversion.part) {
          const safetyNetPart: ThreadJsonRenderPart = {
            type: THREAD_JSON_RENDER_PART_TYPE,
            id: `json-render:safety-net:${conversion.part.specHash ?? "table"}`,
            data: conversion.part,
          };
          // Merge into the durable parts (finalize callback + response body)
          // and emit the live-activity chunk — the same two sinks the emit
          // tool feeds. mergeFinalUiMessageParts dedupes by id, so a part the
          // model already emitted with the same id is not duplicated.
          runResult = {
            ...runResult,
            uiMessageParts: mergeFinalUiMessageParts(runResult.uiMessageParts, [
              safetyNetPart,
            ]),
          };
          activityEmitter.emit(threadJsonRenderActivityEvent(safetyNetPart));
          logStructured({
            level: "info",
            event: "json_render_safety_net_converted",
            tenantId: identity.tenantId,
            threadId: identity.threadId,
            threadTurnId,
            traceId: identity.traceId,
            partId: safetyNetPart.id,
          });
        } else if (
          conversion.diagnostics &&
          conversion.diagnostics.length > 0
        ) {
          // Structured content WAS detected but the converted spec failed the
          // strict validator, so it silently stayed as prose. This is the
          // exact "silent fallback" case R6 makes observable. Log the
          // diagnostic CODES only — never the assistant content.
          logStructured({
            level: "warn",
            event: "json_render_safety_net_rejected",
            tenantId: identity.tenantId,
            threadId: identity.threadId,
            threadTurnId,
            traceId: identity.traceId,
            diagnosticCodes: conversion.diagnostics.map((d) => d.code),
          });
        }
      } catch (safetyNetErr) {
        // Best-effort: any failure leaves the prose untouched and the turn
        // unaffected. Log the error class only — never the assistant content.
        logStructured({
          level: "warn",
          event: "json_render_safety_net_failed",
          tenantId: identity.tenantId,
          threadId: identity.threadId,
          error:
            safetyNetErr instanceof Error
              ? safetyNetErr.message
              : String(safetyNetErr),
        });
      }
    }
    // Flush any in-flight live-activity POSTs now that the turn is done — the
    // turn already completed, so this never extends its wall-clock, and it
    // closes the Lambda-Web-Adapter unawaited-promise gap for the live view.
    await activityEmitter.drain();
    await toolExecutionEmitter.drain();
    // Per-turn capability manifest (capability-mapping plan U12, R14).
    // Gated on the API wiring every dispatch path carries (KTD-6) — never on
    // the chat-only finalize callback, so wakeup/automation turns emit too.
    // Best-effort: a failed POST renders as "manifest missing" in the
    // inspector and never blocks the turn.
    const manifestSink = readCapabilityManifestSinkConfig(args.payload);
    if (manifestSink) {
      const payloadSkillIds = Array.isArray(args.payload.skills)
        ? args.payload.skills.flatMap((skill) => {
            if (!skill || typeof skill !== "object") return [];
            const skillId = asString((skill as { skillId?: unknown }).skillId);
            return skillId ? [skillId] : [];
          })
        : [];
      const dynamicEvidence = dynamicDefaultExtensions.evidence;
      const extensionEvidenceId = (
        entry: (typeof dynamicEvidence)[number],
      ): string => entry.assignmentId || entry.name || entry.extensionId;
      await postCapabilityManifest({
        config: manifestSink,
        manifestJson: {
          schema_version: 2,
          resolved: {
            skills: payloadSkillIds,
            builtInTools: bundle.builtinToolNames,
            mcpServers: bundle.mcpLoadRecord.map((record) => record.serverName),
            piExtensions: dynamicEvidence.map(extensionEvidenceId),
          },
          loaded: {
            skills: bundle.workspaceSkills.map((skill) => skill.slug),
            builtInTools: bundle.builtinToolNames,
            mcpServers: bundle.mcpLoadRecord
              .filter((record) => record.status === "connected")
              .map((record) => record.serverName),
            piExtensions: dynamicEvidence
              .filter((entry) => entry.status === "loaded")
              .map(extensionEvidenceId),
            extensionTools: bundle.extensionToolNames,
          },
          gated: [
            ...bundle.mcpLoadRecord
              .filter((record) => record.status !== "connected")
              .map((record) => ({
                capabilityClass: "mcp_server",
                capabilityId: record.serverName,
                reason:
                  record.status === "rejected_url"
                    ? "mcp_server_not_resolved"
                    : "resolution_fault",
                detail: record.reason,
              })),
            ...dynamicEvidence
              .filter((entry) => entry.status !== "loaded")
              .map((entry) => ({
                capabilityClass: "pi_extension",
                capabilityId: extensionEvidenceId(entry),
                // Container gate reasons that already exist in the shared
                // taxonomy pass through verbatim; everything else folds into
                // extension_validation_failed with the raw reason as detail.
                reason:
                  entry.reason === "unavailable_provider" ||
                  entry.reason === "missing_granted_provider"
                    ? entry.reason
                    : "extension_validation_failed",
                detail: entry.reason,
              })),
          ],
          delegatedProfiles: agentProfiles.map((profile) => ({
            profileId: profile.id,
            slug: profile.slug,
            loadedExtensionTools:
              profileExtensionToolNamesById.get(profile.id) ?? [],
          })),
        },
        fetchImpl: callbackFetchImpl,
        logger: (entry) =>
          logStructured({
            ...entry,
            tenantId: identity.tenantId,
            threadId: identity.threadId,
          }),
      });
    }
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
    // THINK-910 — prompt-size self-report. Computed HERE (not at loop start)
    // because `composedSystemPrompt` is only populated once the system-prompt
    // extension's `before_agent_start` hook has run inside the session. One
    // JSON.stringify over the tool specs; never allowed to fail the turn.
    try {
      runtimeDiagnostics.prompt_breakdown = buildPromptBreakdown({
        systemPrompt: composedSystemPrompt,
        tools: bundle.tools,
        builtinToolNames: bundle.builtinToolNames,
        extensionToolNames: bundle.extensionToolNames,
        payload: args.payload as Record<string, unknown>,
      });
    } catch (err) {
      logStructured({
        level: "warn",
        event: "prompt_breakdown_failed",
        tenantId: identity.tenantId,
        threadId: identity.threadId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    runResult = mergeRuntimeDiagnostics(runResult, runtimeDiagnostics);
    if (warmCache && !warmEntry) {
      // THINK-586 U7 — name the exact reason a cold turn did not populate
      // the cache; without this the warm path can silently never engage.
      logStructured({
        level: "info",
        event: "warm_session_cold_reason",
        tenantId: identity.tenantId,
        threadId: identity.threadId,
        detail: JSON.stringify({
          eligible: warmEligible,
          // Per-leg breakdown: `false` legs name exactly why the fast path
          // was disqualified (booleans only — never field values).
          eligibility: warmEligibility,
          hasKey: Boolean(warmKey),
          hasProducts: Boolean(warmProducts),
          writeFailed: warmSessionWriteFailed,
          assemblyCleanupCount: warmSessionAssemblyCleanupCount,
        }),
      });
    }
    if (warmCache && warmKey && warmProducts && !warmSessionWriteFailed) {
      // THINK-586 U7 — populate/refresh the cache with this turn's products
      // and fresh freshness markers (durable head + authorization version).
      warmCache.set(warmKey, {
        value: warmProducts,
        durableStoreMarker: warmProducts.session?.version ?? "none",
        authorizationVersion: warmAuthVersion,
        cachedAtMs: Date.now(),
      });
    } else if (mcpRetention && !warmEntry) {
      // Cold turn that ended up not cacheable: close the retained MCP
      // transports the cleanup drain deliberately skipped.
      await mcpRetention.close();
    }
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
    // THINK-586 U7 — a failed cold turn caches nothing: close the retained
    // MCP transports the per-turn cleanup drain deliberately skipped. (A
    // failed WARM turn keeps its entry — the durable-store head probe
    // decides freshness on the next turn.)
    if (mcpRetention && !warmEntry) {
      await mcpRetention.close();
    }
    if (isFinalizeCallbackConfigured(args.payload)) {
      const finalizeStart = Date.now();
      const finalized = await postFinalizeCallback({
        payload: args.payload,
        identity,
        systemPrompt: composedSystemPrompt,
        changedFiles,
        result: { status: "error", error: runError, latencyMs },
        bedrockRequestIds,
        fetchImpl: callbackFetchImpl,
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
  // the API's normalized memory layer (AgentCore managed memory).
  // Awaited so the Event invoke is queued before HTTP response —
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
      bedrockRequestIds,
      fetchImpl: callbackFetchImpl,
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
  // THINK-585 U6 (KTD1): container-side session verification. When the
  // AgentCore runtime exposes the session ID as a request header, recompute
  // the expected per-thread session key from the envelope's identity fields
  // and hard-fail a mismatch — a tampered envelope cannot ride another
  // thread's warm session. Lambda-path requests carry no header and skip
  // this check (LWA does not forward AgentCore session headers).
  const sessionHeader =
    req.headers["x-amzn-bedrock-agentcore-runtime-session-id"];
  const presentedSessionId = Array.isArray(sessionHeader)
    ? sessionHeader[0]
    : sessionHeader;
  if (presentedSessionId) {
    const identity = [
      payload.tenant_id,
      payload.assistant_id,
      payload.user_id,
      payload.thread_id,
    ];
    if (identity.every((value) => typeof value === "string" && value !== "")) {
      const expected = createHash("sha256")
        .update(`session:${identity.join(":")}`)
        .digest("hex");
      if (presentedSessionId !== expected) {
        logStructured({
          level: "error",
          event: "session_id_mismatch",
          error:
            "runtime session ID does not match the envelope identity fields",
          statusCode: 403,
        });
        sendJson(res, 403, {
          error: "session/identity mismatch",
          runtime: "pi",
        });
        return;
      }
    }
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
