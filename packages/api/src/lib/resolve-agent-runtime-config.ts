/**
 * Resolve an agent's runtime configuration for an AgentCore invocation.
 *
 * Two callers today:
 * - `packages/api/src/handlers/chat-agent-invoke.ts` — chat turn flow.
 * - `packages/api/src/handlers/agents-runtime-config.ts` — service-auth REST
 *   endpoint consumed by the runtime skill dispatcher
 *   (plan `docs/plans/2026-04-24-008-feat-skill-run-dispatcher-plan.md` §U1).
 *
 * Keeping both callers on a single helper is the anti-drift invariant. Any
 * field the chat path needs must also be available to the dispatcher, and
 * vice versa — they run the same agent in the same runtime and expect the
 * same resolved shape.
 *
 * What this helper resolves:
 *   - agent + tenant metadata (name, slug, model, blocked tools, sandbox config)
 *   - guardrail (agent-assigned, else tenant default)
 *   - `skillsConfig`: the full skill list the container should register,
 *     including tenant catalog defaults (agent-thread-management, artifacts,
 *     workspace-memory), tenant-configured built-in tools, and
 *     per-skill env overrides (OAuth-resolved tokens, CURRENT_USER_EMAIL when
 *     a human invoker is known) with the template blocked-tools filter
 *     applied last
 *   - `knowledgeBasesConfig`: legacy Bedrock KBs assigned to the agent when
 *     explicitly enabled for compatibility
 *   - `mcpConfigs`: agent + tenant MCP servers with auth resolved
 *
 * What this helper does NOT resolve (per-turn concerns, filled by callers):
 *   - `message`, `messages_history`, `trace_id`
 *   - `thread_id`
 *   - `trigger_channel`
 *   - sandbox preflight (needs `currentUserId` — per-invoker, see R15)
 *
 * The helper is passed `currentUserId` + `currentUserEmail` to drive the
 * per-invoker env overlays (e.g. `CURRENT_USER_EMAIL` on workspace-memory).
 * Both are optional — an empty invoker lands the "no invoker" R15 path
 * inside the container (admin-skill refusals).
 */

import {
  getConfig,
  getApiAuthSecret,
  getAppsyncApiKey,
} from "@thinkwork/runtime-config";
import { eq, and } from "drizzle-orm";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  agentCapabilities,
  agentSkills,
  tenants,
  users,
  agentKnowledgeBases,
  knowledgeBases,
  guardrails,
  spaces,
  agentProfiles,
  agentProfileSpaceAssignments,
  tenantMcpServers,
} from "@thinkwork/database-pg/schema";
import { buildSkillEnvOverrides } from "./oauth-token.js";
import { buildMcpConfigs } from "./mcp-configs.js";
import type { McpRuntimeRecordLinkHints } from "./mcp-configs.js";
import {
  normalizeAgentRuntimeType,
  type AgentRuntimeType,
} from "./resolve-runtime-function-name.js";
import { loadTenantBuiltinTools } from "../handlers/skills.js";
import type { TemplateSandboxConfig } from "./sandbox-preflight.js";
import { validateTemplateBrowser } from "./templates/browser-config.js";
import { validateTemplateContextEngine } from "./templates/context-engine-config.js";
import type { TemplateContextEngineConfig } from "./templates/context-engine-config.js";
import { validateTemplateSendEmail } from "./templates/send-email-config.js";
import { validateTemplateWebExtract } from "./templates/web-extract-config.js";
import { validateTemplateWebSearch } from "./templates/web-search-config.js";
import {
  constrainTemplateContextEngineConfig,
  loadTenantContextProviderSettings,
} from "./context-engine/admin-config.js";
import {
  resolveWebSearchConfigFromSkills,
  type WebSearchRuntimeConfig,
} from "./web-search-config.js";
import {
  loadTenantWebExtractConfig,
  type TenantWebExtractConfig,
} from "./builtin-tools/web-extract.js";
import {
  applyRuntimeOverrides,
  type SpaceRuntimeOverrides,
} from "./workspace-renderer/runtime-overrides-applier.js";
import { threadJsonRenderUiEnabledFromCapabilities } from "./thread-json-render/capability.js";
import { discoverWorkspaceSkillsFromPaths } from "./skills-tree-walker.js";
import { isBuiltinToolSlug } from "./builtin-tool-slugs.js";
import {
  normalizeAgentProfileExecutionControls,
  type AgentLoopPolicy,
} from "./agent-profile-loop-policy.js";
import { listTenantModelCatalogByIds } from "./model-catalog/tenant-catalog.js";
import { loadTrustedCatalogSkillIds } from "./skill-trust/runtime-gate.js";

export interface SkillConfig {
  skillId: string;
  s3Key: string;
  secretRef?: string;
  envOverrides?: Record<string, string>;
  mcpServer?: string;
}

export interface KnowledgeBaseConfig {
  awsKbId: string | null;
  name: string | null;
  description: string | null;
  searchConfig: unknown;
}

export interface McpConfig {
  name: string;
  url: string;
  transport?: string;
  auth?: unknown;
  tools?: string[];
  availableTools?: string[];
  recordLinkHints?: McpRuntimeRecordLinkHints;
}

export type WebSearchConfig = WebSearchRuntimeConfig;

export type WebExtractConfig = Omit<TenantWebExtractConfig, "secretRef">;

export interface SendEmailConfig {
  agentId: string;
  tenantId: string;
  apiUrl: string;
  apiSecret: string;
}

export interface GuardrailPayload {
  guardrailIdentifier: string;
  guardrailVersion: string;
}

export interface AgentProfileRuntimeMcpServer {
  id: string;
  slug: string;
  name: string;
  availableTools: string[];
  allowedTools: string[];
}

export interface AgentProfileRuntimeConfig {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  routingGuidance: string | null;
  instructions: string;
  modelId: string;
  builtInKey: string | null;
  enabled: true;
  availability: {
    scope: "global" | "space_restricted";
    spaceIds: string[];
  };
  /**
   * Space that owns this profile when it was projected from a Space source's
   * `agents/` folder (plan 2026-06-12-002 U7). Null for central profiles.
   */
  sourceSpaceId: string | null;
  /**
   * When a space-local profile shadows a central profile with the same slug
   * for the active Space, the shadowed central profile's id is recorded here
   * on the winning space-local config (diagnostic — dispatch sites may log).
   */
  shadowedCentralProfileId: string | null;
  builtInTools: string[];
  mcpServers: AgentProfileRuntimeMcpServer[];
  mcpToolAllowlist: Record<string, string[]>;
  skillSlugs: string[];
  executionControls: {
    foreground: true;
    clarify: boolean;
    maxSubagentDepth: number;
    maxRuntimeMs?: number;
    maxTokens?: number;
    costBudgetUsd?: number;
    thinking?: string;
    reviewGate?: boolean;
    maxReviewLoops?: number;
    loopPolicy: AgentLoopPolicy;
  };
}

export interface AgentRuntimeConfig {
  tenantId: string;
  tenantSlug: string;
  agentId: string;
  agentName: string;
  agentSlug: string;
  agentSystemPrompt: string | null;
  humanName: string | undefined;
  humanPairId: string | null;
  templateId: string | null;
  templateModel: string | null;
  budgetMonthlyCents: number | null;
  budgetPaused: boolean;
  blockedTools: string[];
  sandboxTemplate: TemplateSandboxConfig | null;
  browserAutomationEnabled: boolean;
  threadJsonRenderUiEnabled: boolean;
  contextEngineEnabled: boolean;
  contextEngineConfig?: TemplateContextEngineConfig;
  /**
   * Internal `guardrails.id` of the resolved guardrail (template or
   * tenant-default) — used by callers that record `guardrail_blocks`
   * rows. Null when no guardrail is active.
   */
  guardrailId: string | null;
  guardrailConfig: GuardrailPayload | undefined;
  runtimeType: AgentRuntimeType;
  skillsConfig: SkillConfig[];
  trustedSkillIds: string[];
  webSearchConfig?: WebSearchConfig;
  webExtractConfig?: WebExtractConfig;
  sendEmailConfig?: SendEmailConfig;
  knowledgeBasesConfig: KnowledgeBaseConfig[] | undefined;
  mcpConfigs: McpConfig[];
  agentProfilesConfig: AgentProfileRuntimeConfig[];
}

export class AgentNotFoundError extends Error {
  constructor(public readonly agentId: string) {
    super(`Agent not found: ${agentId}`);
    this.name = "AgentNotFoundError";
  }
}

export interface ResolveAgentRuntimeConfigOptions {
  tenantId: string;
  agentId: string;
  /**
   * Active Space for this invocation. Null/undefined means no Space override
   * overlay is applied and the platform-agent baseline is returned unchanged.
   */
  spaceId?: string | null;
  /**
   * Human invoker's user id. Required to light up CURRENT_USER_EMAIL overlays
   * and (downstream) sandbox preflight. Leave empty for wakeup-style runs where
   * no specific human triggered the invocation — the container's R15 refusal
   * path handles this cleanly.
   */
  currentUserId?: string;
  /**
   * Human invoker's email. Drives CURRENT_USER_EMAIL on default skills. When
   * omitted but `currentUserId` is present, the helper resolves from `users`.
   */
  currentUserEmail?: string;
  /**
   * Optional fallback for CURRENT_USER_EMAIL personalization only — never used
   * as `currentUserId`. Matches the chat path's "email-only fallback to the
   * agent's human pair" behavior in R15.
   */
  allowHumanPairEmailFallback?: boolean;
  /**
   * Logging prefix (e.g. "[chat-agent-invoke]", "[skill-run-dispatcher]") so
   * logs trace back to the caller context.
   */
  logPrefix?: string;
  /**
   * Env-var-backed service credentials the helper plumbs into default skills'
   * envOverrides. Defaults to `getConfig("THINKWORK_API_URL")` /
   * `THINKWORK_API_SECRET` / `APPSYNC_API_KEY`. Passed explicitly so tests can
   * avoid touching process.env globally.
   */
  thinkworkApiUrl?: string;
  thinkworkApiSecret?: string;
  appsyncApiKey?: string;
}

const DEFAULT_SKILLS: ReadonlyArray<{ skillId: string }> = [
  { skillId: "agent-thread-management" },
  { skillId: "artifacts" },
  { skillId: "workspace-memory" },
];

export function tenantCatalogSkillS3Key(
  tenantSlug: string,
  skillId: string,
): string {
  return `tenants/${tenantSlug}/skill-catalog/${skillId}`;
}

const BROWSER_AUTOMATION_CAPABILITY = "browser_automation";
const s3 = new S3Client({
  region:
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

export async function resolveAgentRuntimeConfig(
  opts: ResolveAgentRuntimeConfigOptions,
): Promise<AgentRuntimeConfig> {
  const db = getDb();
  const logPrefix = opts.logPrefix ?? "[agent-runtime-config]";
  const thinkworkApiUrl =
    opts.thinkworkApiUrl ?? getConfig("THINKWORK_API_URL") ?? "";
  const thinkworkApiSecret =
    opts.thinkworkApiSecret ?? getApiAuthSecret() ?? "";
  const appsyncApiKey = opts.appsyncApiKey ?? getAppsyncApiKey();

  const [agent] = await db
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      system_prompt: agents.system_prompt,
      human_pair_id: agents.human_pair_id,
      template_id: agents.template_id,
      runtime: agents.runtime,
      model: agents.model,
      guardrail_id: agents.guardrail_id,
      budget_monthly_cents: agents.budget_monthly_cents,
      budget_paused: agents.budget_paused,
      blocked_tools: agents.blocked_tools,
      sandbox: agents.sandbox,
      browser: agents.browser,
      web_search: agents.web_search,
      web_extract: agents.web_extract,
      send_email: agents.send_email,
      context_engine: agents.context_engine,
    })
    .from(agents)
    .where(
      and(eq(agents.id, opts.agentId), eq(agents.tenant_id, opts.tenantId)),
    );
  if (!agent) throw new AgentNotFoundError(opts.agentId);

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, opts.tenantId));
  const tenantSlug = tenant?.slug ?? "";
  const agentSlug = agent.slug ?? "";

  // Resolve email: explicit override → users lookup → optional human-pair fallback.
  //
  // All three users lookups are tenant-scoped because this function is
  // reachable via the service-auth REST endpoint where `currentUserId` is
  // a query-string parameter. Without the tenant predicate any holder of
  // API_AUTH_SECRET could enumerate arbitrary users' emails by flipping
  // the tenantId they claim to own while passing another tenant's userId.
  // The human_pair_id lookups are already derived from the tenant-scoped
  // agent row, but we scope them the same way as defense-in-depth.
  let currentUserEmail = opts.currentUserEmail ?? "";
  if (!currentUserEmail && opts.currentUserId) {
    const [u] = await db
      .select({ email: users.email })
      .from(users)
      .where(
        and(
          eq(users.id, opts.currentUserId),
          eq(users.tenant_id, opts.tenantId),
        ),
      );
    currentUserEmail = u?.email ?? "";
  }
  if (
    !currentUserEmail &&
    opts.allowHumanPairEmailFallback &&
    agent.human_pair_id
  ) {
    const [u] = await db
      .select({ email: users.email })
      .from(users)
      .where(
        and(
          eq(users.id, agent.human_pair_id),
          eq(users.tenant_id, opts.tenantId),
        ),
      );
    currentUserEmail = u?.email ?? "";
  }

  let humanName: string | undefined;
  if (agent.human_pair_id) {
    const [human] = await db
      .select({ name: users.name })
      .from(users)
      .where(
        and(
          eq(users.id, agent.human_pair_id),
          eq(users.tenant_id, opts.tenantId),
        ),
      );
    humanName = human?.name ?? undefined;
  }

  // Guardrail: agent-assigned → tenant default → none.
  let guardrailId: string | null = null;
  let guardrailConfig: GuardrailPayload | undefined;
  if (agent.guardrail_id) {
    const [gr] = await db
      .select({
        bedrock_guardrail_id: guardrails.bedrock_guardrail_id,
        bedrock_version: guardrails.bedrock_version,
      })
      .from(guardrails)
      .where(
        and(
          eq(guardrails.id, agent.guardrail_id),
          eq(guardrails.tenant_id, opts.tenantId),
        ),
      );
    if (gr?.bedrock_guardrail_id && gr?.bedrock_version) {
      guardrailId = agent.guardrail_id;
      guardrailConfig = {
        guardrailIdentifier: gr.bedrock_guardrail_id,
        guardrailVersion: gr.bedrock_version,
      };
    }
  } else {
    const [defaultGr] = await db
      .select({
        id: guardrails.id,
        bedrock_guardrail_id: guardrails.bedrock_guardrail_id,
        bedrock_version: guardrails.bedrock_version,
      })
      .from(guardrails)
      .where(
        and(
          eq(guardrails.tenant_id, opts.tenantId),
          eq(guardrails.is_default, true),
        ),
      );
    if (defaultGr?.bedrock_guardrail_id && defaultGr?.bedrock_version) {
      guardrailId = defaultGr.id;
      guardrailConfig = {
        guardrailIdentifier: defaultGr.bedrock_guardrail_id,
        guardrailVersion: defaultGr.bedrock_version,
      };
    }
  }

  const blockedTools: string[] = (agent.blocked_tools as string[] | null) ?? [];
  const templateBrowserResult = validateTemplateBrowser(agent.browser);
  const templateBrowserEnabled = templateBrowserResult.ok
    ? templateBrowserResult.value?.enabled === true
    : false;
  if (!templateBrowserResult.ok) {
    console.warn(
      `${logPrefix} Invalid agent browser config ignored for agent ${opts.agentId}: ${templateBrowserResult.error}`,
    );
  }
  const templateWebSearchResult = validateTemplateWebSearch(agent.web_search);
  const templateWebSearchEnabled = templateWebSearchResult.ok
    ? templateWebSearchResult.value?.enabled === true
    : false;
  if (!templateWebSearchResult.ok) {
    console.warn(
      `${logPrefix} Invalid agent webSearch config ignored for agent ${opts.agentId}: ${templateWebSearchResult.error}`,
    );
  }
  const templateWebExtractResult = validateTemplateWebExtract(
    agent.web_extract,
  );
  const templateWebExtractEnabled = templateWebExtractResult.ok
    ? templateWebExtractResult.value?.enabled === true
    : false;
  if (!templateWebExtractResult.ok) {
    console.warn(
      `${logPrefix} Invalid agent webExtract config ignored for agent ${opts.agentId}: ${templateWebExtractResult.error}`,
    );
  }
  const templateSendEmailResult = validateTemplateSendEmail(agent.send_email);
  const templateSendEmailEnabled = templateSendEmailResult.ok
    ? templateSendEmailResult.value?.enabled === true
    : false;
  if (!templateSendEmailResult.ok) {
    console.warn(
      `${logPrefix} Invalid agent sendEmail config ignored for agent ${opts.agentId}: ${templateSendEmailResult.error}`,
    );
  }
  const templateContextEngineResult = validateTemplateContextEngine(
    agent.context_engine,
  );
  const templateContextEngineEnabled = templateContextEngineResult.ok
    ? templateContextEngineResult.value?.enabled === true
    : false;
  if (!templateContextEngineResult.ok) {
    console.warn(
      `${logPrefix} Invalid agent contextEngine config ignored for agent ${opts.agentId}: ${templateContextEngineResult.error}`,
    );
  }

  // --- Skills --------------------------------------------------------------
  // Workspace skill folders first, then default skills the container always
  // needs, then tenant-configured built-in tools (web-search etc.), then the
  // template's blocked-tools filter.

  let skillsConfig: SkillConfig[] = await loadWorkspaceSkillConfigs({
    tenantSlug,
    agentSlug,
    logPrefix,
  });
  skillsConfig = await applyAgentSkillMetadata({
    skillsConfig,
    agentId: opts.agentId,
    tenantId: opts.tenantId,
    logPrefix,
  });

  // Other default skills (always-on script skills).
  for (const ds of DEFAULT_SKILLS) {
    if (skillsConfig.some((s) => s.skillId === ds.skillId)) continue;
    const env: Record<string, string> = {
      THINKWORK_API_URL: thinkworkApiUrl,
      THINKWORK_API_SECRET: thinkworkApiSecret,
      GRAPHQL_API_KEY: appsyncApiKey,
      AGENT_ID: opts.agentId,
    };
    if (currentUserEmail) env.CURRENT_USER_EMAIL = currentUserEmail;
    skillsConfig.push({
      ...ds,
      s3Key: tenantCatalogSkillS3Key(tenantSlug, ds.skillId),
      secretRef: undefined,
      envOverrides: env,
    });
  }

  // Tenant built-in tools (web-search etc.) — only injected when a row exists
  // with enabled=true AND a usable API key in Secrets Manager.
  try {
    const builtinTools = await loadTenantBuiltinTools(opts.tenantId);
    for (const bt of builtinTools) {
      if (bt.toolSlug === "web-search" && !templateWebSearchEnabled) {
        continue;
      }
      const existing = skillsConfig.find((s) => s.skillId === bt.toolSlug);
      if (existing) {
        existing.envOverrides = {
          ...(existing.envOverrides || {}),
          ...bt.envOverrides,
        };
        console.log(
          `${logPrefix} Overlaid env for built-in tool '${bt.toolSlug}' (provider=${bt.provider})`,
        );
        continue;
      }
      skillsConfig.push({
        skillId: bt.toolSlug,
        s3Key: tenantCatalogSkillS3Key(tenantSlug, bt.toolSlug),
        secretRef: undefined,
        envOverrides: bt.envOverrides,
      });
      console.log(
        `${logPrefix} Injected built-in tool '${bt.toolSlug}' (provider=${bt.provider})`,
      );
    }
  } catch (err) {
    console.warn(`${logPrefix} Failed to load tenant built-in tools:`, err);
  }

  // Apply template blocked-tools filter last.
  if (blockedTools.length > 0) {
    const before = skillsConfig.length;
    skillsConfig = skillsConfig.filter(
      (s) => !blockedTools.includes(s.skillId),
    );
    const removed = before - skillsConfig.length;
    if (removed > 0) {
      console.log(
        `${logPrefix} Class tool_access: removed ${removed} blocked skill(s)`,
      );
    }
  }

  // Built-ins are credentialed platform tools, not catalog skills; keep their
  // runtime config while the catalog trust gate still filters workspace skills.
  const builtInSkillIds = new Set(
    skillsConfig
      .filter((skill) => isBuiltinToolSlug(skill.skillId))
      .map((skill) => skill.skillId),
  );
  const catalogSkillIds = skillsConfig
    .filter((skill) => !isBuiltinToolSlug(skill.skillId))
    .map((skill) => skill.skillId);
  const trustedCatalogSkillIds = await loadTrustedCatalogSkillIds({
    tenantId: opts.tenantId,
    skillIds: catalogSkillIds,
    logPrefix,
  });
  const runtimeAllowedSkillIds = new Set([
    ...trustedCatalogSkillIds,
    ...builtInSkillIds,
  ]);
  skillsConfig = skillsConfig.filter((skill) =>
    runtimeAllowedSkillIds.has(skill.skillId),
  );

  const webSearchConfig = resolveWebSearchConfigFromSkills(skillsConfig);
  const webExtractConfig =
    templateWebExtractEnabled &&
    !blockedTools.includes("web-extract") &&
    !blockedTools.includes("web_extract")
      ? await loadTenantWebExtractConfig(opts.tenantId)
      : null;

  // --- Knowledge bases -----------------------------------------------------

  const kbRowsRaw = await db
    .select({
      aws_kb_id: knowledgeBases.aws_kb_id,
      name: knowledgeBases.name,
      description: knowledgeBases.description,
      search_config: agentKnowledgeBases.search_config,
    })
    .from(agentKnowledgeBases)
    .innerJoin(
      knowledgeBases,
      eq(agentKnowledgeBases.knowledge_base_id, knowledgeBases.id),
    )
    .where(
      and(
        eq(agentKnowledgeBases.agent_id, opts.agentId),
        eq(agentKnowledgeBases.enabled, true),
      ),
    );
  const kbRows = kbRowsRaw.filter((r) => r.aws_kb_id);

  const legacyAgentKnowledgeBasesEnabled =
    process.env.ENABLE_LEGACY_AGENT_KNOWLEDGE_BASES === "true";
  const knowledgeBasesConfig: KnowledgeBaseConfig[] | undefined =
    legacyAgentKnowledgeBasesEnabled && kbRows.length > 0
      ? kbRows.map((kb) => ({
          awsKbId: kb.aws_kb_id,
          name: kb.name,
          description: kb.description,
          searchConfig: kb.search_config,
        }))
      : undefined;

  // --- Per-agent Browser Automation override ------------------------------

  const capabilityRows = await db
    .select({
      capability: agentCapabilities.capability,
      enabled: agentCapabilities.enabled,
      config: agentCapabilities.config,
    })
    .from(agentCapabilities)
    .where(
      and(
        eq(agentCapabilities.agent_id, opts.agentId),
        eq(agentCapabilities.tenant_id, opts.tenantId),
      ),
    );
  const browserCapability = capabilityRows.find(
    (row) => row.capability === BROWSER_AUTOMATION_CAPABILITY,
  );
  const browserAutomationEnabled =
    !blockedTools.includes(BROWSER_AUTOMATION_CAPABILITY) &&
    (browserCapability
      ? browserCapability.enabled === true
      : templateBrowserEnabled);
  const threadJsonRenderUiEnabled = threadJsonRenderUiEnabledFromCapabilities(
    capabilityRows,
    blockedTools,
  );
  const sendEmailConfig =
    templateSendEmailEnabled && !blockedTools.includes("send_email")
      ? {
          agentId: opts.agentId,
          tenantId: opts.tenantId,
          apiUrl: thinkworkApiUrl,
          apiSecret: thinkworkApiSecret,
        }
      : undefined;
  const contextEngineEnabled =
    templateContextEngineEnabled &&
    !blockedTools.includes("query_context") &&
    !blockedTools.includes("context_engine");
  let contextEngineConfig = contextEngineEnabled
    ? templateContextEngineResult.ok
      ? (templateContextEngineResult.value ?? undefined)
      : undefined
    : undefined;
  if (contextEngineConfig?.providers?.ids) {
    const constrained = constrainTemplateContextEngineConfig(
      contextEngineConfig,
      await loadTenantContextProviderSettings(opts.tenantId),
    );
    contextEngineConfig = constrained.config;
    if (constrained.removedProviderIds.length > 0) {
      console.warn(
        `${logPrefix} Removed tenant-disabled Context Engine provider(s) from agent ${opts.agentId}: ${constrained.removedProviderIds.join(", ")}`,
      );
    }
  }

  // --- MCP configs ---------------------------------------------------------

  // Dispatch identity (plan 2026-06-12-001 U6): direct per_user_oauth
  // servers resolve by the agent's human pair (R16); plugin-managed
  // servers resolve by the REQUESTING user — the thread turn's invoker
  // (`opts.currentUserId`, resolved by chat-agent-invoke's identity
  // step). No invoker → plugin servers are excluded (fail closed).
  const mcpConfigs = await buildMcpConfigs(
    opts.agentId,
    {
      humanPairId: agent.human_pair_id,
      requesterUserId: opts.currentUserId ?? null,
    },
    logPrefix,
  );

  const resolvedConfig: AgentRuntimeConfig = {
    tenantId: opts.tenantId,
    tenantSlug,
    agentId: opts.agentId,
    agentName: agent.name,
    agentSlug,
    agentSystemPrompt: agent.system_prompt,
    humanName,
    humanPairId: agent.human_pair_id,
    templateId: agent.template_id ?? null,
    templateModel: agent.model ?? null,
    budgetMonthlyCents: agent.budget_monthly_cents ?? null,
    budgetPaused: agent.budget_paused ?? false,
    blockedTools,
    sandboxTemplate: (agent.sandbox as TemplateSandboxConfig | null) ?? null,
    browserAutomationEnabled,
    threadJsonRenderUiEnabled,
    contextEngineEnabled,
    contextEngineConfig,
    guardrailId,
    guardrailConfig,
    runtimeType: normalizeAgentRuntimeType(agent.runtime),
    skillsConfig,
    trustedSkillIds: skillsConfig.map((skill) => skill.skillId),
    webSearchConfig,
    webExtractConfig: webExtractConfig
      ? {
          toolSlug: webExtractConfig.toolSlug,
          provider: webExtractConfig.provider,
          apiKey: webExtractConfig.apiKey,
          config: webExtractConfig.config,
        }
      : undefined,
    sendEmailConfig,
    knowledgeBasesConfig,
    mcpConfigs,
    agentProfilesConfig: [],
  };

  const overrides = await resolveSpaceRuntimeOverrides({
    tenantId: opts.tenantId,
    spaceId: opts.spaceId ?? null,
    logPrefix,
  });

  const overriddenConfig = applyRuntimeOverrides(resolvedConfig, overrides);
  overriddenConfig.agentProfilesConfig = await loadAgentProfileRuntimeConfigs({
    tenantId: opts.tenantId,
    spaceId: opts.spaceId ?? null,
    mcpConfigs,
    logPrefix,
  });
  return overriddenConfig;
}

/**
 * Loads the tenant's enabled Agent Profiles as runtime configs, filtered to
 * the active Space (space-restricted profiles only ship when their Space is
 * active). Exported so the wakeup dispatch path resolves `agent_profiles`
 * exactly the way the chat path does (plan 2026-06-12-002 U1 parity).
 *
 * Space-local profiles (U7): rows with `source_space_id` set ship only when
 * that Space is the active Space. On slug collision the space-local profile
 * wins while its Space is active — the central profile is dropped for that
 * thread and its id is surfaced as `shadowedCentralProfileId` on the winning
 * config. Central profiles resolve alone everywhere else.
 */
export async function loadAgentProfileRuntimeConfigs(input: {
  tenantId: string;
  spaceId: string | null;
  mcpConfigs: McpConfig[];
  logPrefix: string;
}): Promise<AgentProfileRuntimeConfig[]> {
  const db = getDb();
  const profileRows = await db
    .select({
      id: agentProfiles.id,
      slug: agentProfiles.slug,
      name: agentProfiles.name,
      description: agentProfiles.description,
      routing_guidance: agentProfiles.routing_guidance,
      instructions: agentProfiles.instructions,
      model_id: agentProfiles.model_id,
      enabled: agentProfiles.enabled,
      built_in_key: agentProfiles.built_in_key,
      tool_policy: agentProfiles.tool_policy,
      skill_policy: agentProfiles.skill_policy,
      execution_controls: agentProfiles.execution_controls,
      source_space_id: agentProfiles.source_space_id,
    })
    .from(agentProfiles)
    .where(
      and(
        eq(agentProfiles.tenant_id, input.tenantId),
        eq(agentProfiles.enabled, true),
      ),
    );

  if (profileRows.length === 0) return [];

  const profileModelIds = [
    ...new Set(profileRows.map((profile) => profile.model_id)),
  ];
  const availableModelRows = await listTenantModelCatalogByIds(
    {
      tenantId: input.tenantId,
      modelIds: profileModelIds,
    },
    { db },
  );
  const availableModelIds = new Set(
    availableModelRows.map((row) => row.modelId),
  );

  const assignmentRows = await db
    .select({
      profile_id: agentProfileSpaceAssignments.profile_id,
      space_id: agentProfileSpaceAssignments.space_id,
    })
    .from(agentProfileSpaceAssignments)
    .where(eq(agentProfileSpaceAssignments.tenant_id, input.tenantId));
  const spaceIdsByProfileId = new Map<string, string[]>();
  for (const row of assignmentRows) {
    const list = spaceIdsByProfileId.get(row.profile_id) ?? [];
    list.push(row.space_id);
    spaceIdsByProfileId.set(row.profile_id, list);
  }

  const mcpRows = await db
    .select({
      id: tenantMcpServers.id,
      slug: tenantMcpServers.slug,
      name: tenantMcpServers.name,
      tools: tenantMcpServers.tools,
    })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, input.tenantId),
        eq(tenantMcpServers.status, "approved"),
        eq(tenantMcpServers.enabled, true),
      ),
    );
  const mcpRowsBySlug = new Map(mcpRows.map((row) => [row.slug, row]));
  const mcpConfigByName = new Map(
    input.mcpConfigs.map((cfg) => [cfg.name, cfg]),
  );

  // U7 shadowing pre-pass: slugs of space-local profiles that will actually
  // ship for the active Space (model must be available). A central profile
  // with the same slug is shadowed for this thread.
  const activeSpaceLocalSlugs = new Set<string>();
  const eligibleCentralIdBySlug = new Map<string, string>();
  for (const profile of profileRows) {
    if (profile.enabled !== true) continue;
    if (!availableModelIds.has(profile.model_id)) continue;
    if (profile.source_space_id) {
      if (input.spaceId && profile.source_space_id === input.spaceId) {
        activeSpaceLocalSlugs.add(profile.slug);
      }
    } else {
      const assigned = spaceIdsByProfileId.get(profile.id) ?? [];
      if (
        assigned.length === 0 ||
        (input.spaceId && assigned.includes(input.spaceId))
      ) {
        eligibleCentralIdBySlug.set(profile.slug, profile.id);
      }
    }
  }

  const configs: AgentProfileRuntimeConfig[] = [];
  for (const profile of profileRows) {
    if (profile.enabled !== true) continue;
    if (!availableModelIds.has(profile.model_id)) {
      console.warn(
        `${input.logPrefix} Agent Profile ${profile.slug} skipped: model ${profile.model_id} is not available`,
      );
      continue;
    }
    if (profile.source_space_id) {
      // Space-local profile: ships only while its Space is active.
      if (!input.spaceId || profile.source_space_id !== input.spaceId) {
        continue;
      }
    } else if (activeSpaceLocalSlugs.has(profile.slug)) {
      // Central profile shadowed by an active space-local profile (U7).
      console.warn(
        `${input.logPrefix} Agent Profile ${profile.slug} (central ${profile.id}) shadowed by space-local profile for space ${input.spaceId}`,
      );
      continue;
    }
    const assignedSpaceIds = [
      ...new Set(
        profile.source_space_id
          ? // Space-local rows are scoped by their origin Space regardless of
            // assignment-row drift.
            [
              profile.source_space_id,
              ...(spaceIdsByProfileId.get(profile.id) ?? []),
            ]
          : (spaceIdsByProfileId.get(profile.id) ?? []),
      ),
    ];
    if (
      !profile.source_space_id &&
      assignedSpaceIds.length > 0 &&
      (!input.spaceId || !assignedSpaceIds.includes(input.spaceId))
    ) {
      continue;
    }

    const toolPolicy = normalizeRecord(profile.tool_policy);
    const skillPolicy = normalizeRecord(profile.skill_policy);
    const executionControls = normalizeAgentProfileExecutionControls(
      profile.execution_controls,
    );
    const builtInTools = normalizeStringArray(toolPolicy.builtInTools);
    const mcpServerSlugs = normalizeStringArray(toolPolicy.mcpServers);
    const skillSlugs = normalizeStringArray(skillPolicy.skillSlugs);
    const mcpServers = mcpServerSlugs
      .map((slug) => {
        const row = mcpRowsBySlug.get(slug);
        const runtimeConfig = mcpConfigByName.get(slug);
        if (!row || !runtimeConfig) return null;
        const availableTools = normalizeMcpToolNames(
          runtimeConfig.availableTools ?? row.tools,
        );
        const allowedTools =
          runtimeConfig.tools && runtimeConfig.tools.length > 0
            ? normalizeStringArray(runtimeConfig.tools)
            : availableTools;
        return {
          id: row.id,
          slug: row.slug,
          name: row.name,
          availableTools,
          allowedTools,
        };
      })
      .filter((server): server is AgentProfileRuntimeMcpServer =>
        Boolean(server),
      );
    const mcpToolAllowlist = Object.fromEntries(
      mcpServers.map((server) => [server.slug, server.allowedTools]),
    );

    configs.push({
      id: profile.id,
      slug: profile.slug,
      name: profile.name,
      description: profile.description ?? null,
      routingGuidance: profile.routing_guidance ?? null,
      instructions: profile.instructions,
      modelId: profile.model_id,
      builtInKey: profile.built_in_key ?? null,
      enabled: true,
      availability: {
        scope: assignedSpaceIds.length > 0 ? "space_restricted" : "global",
        spaceIds: assignedSpaceIds,
      },
      sourceSpaceId: profile.source_space_id ?? null,
      shadowedCentralProfileId: profile.source_space_id
        ? (eligibleCentralIdBySlug.get(profile.slug) ?? null)
        : null,
      builtInTools,
      mcpServers,
      mcpToolAllowlist,
      skillSlugs,
      executionControls,
    });
  }

  return configs;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0),
    ),
  ];
}

function normalizeMcpToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((tool) => {
          if (typeof tool === "string") return tool.trim();
          if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
            return "";
          }
          const name = (tool as Record<string, unknown>).name;
          return typeof name === "string" ? name.trim() : "";
        })
        .filter((name) => name.length > 0),
    ),
  ];
}

export async function loadWorkspaceSkillConfigs(input: {
  tenantSlug: string;
  agentSlug: string;
  logPrefix: string;
}): Promise<SkillConfig[]> {
  const bucket = getConfig("WORKSPACE_BUCKET") || "";
  if (!bucket || !input.tenantSlug || !input.agentSlug) return [];

  const prefix = `tenants/${input.tenantSlug}/agents/${input.agentSlug}/workspace/`;
  const paths: string[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const item of response.Contents ?? []) {
      if (!item.Key?.startsWith(prefix)) continue;
      const relPath = item.Key.slice(prefix.length);
      if (relPath) paths.push(relPath);
    }
    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  const skills = await discoverWorkspaceSkillsFromPaths(paths, async (path) => {
    try {
      const response = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: prefix + path }),
      );
      return (await response.Body?.transformToString("utf-8")) ?? "";
    } catch (err) {
      console.warn(
        `${input.logPrefix} Failed to read workspace skill marker ${path}:`,
        err,
      );
      return null;
    }
  });

  return skills
    .filter((skill) => !isBuiltinToolSlug(skill.slug))
    .map((skill) => ({
      skillId: skill.slug,
      s3Key: `${prefix}${skill.skillPath.replace(/\/SKILL\.md$/, "")}`,
    }));
}

export async function applyAgentSkillMetadata(input: {
  skillsConfig: SkillConfig[];
  agentId: string;
  tenantId: string;
  logPrefix: string;
}): Promise<SkillConfig[]> {
  if (input.skillsConfig.length === 0) return input.skillsConfig;

  const db = getDb();
  const skillRows = await db
    .select({
      skill_id: agentSkills.skill_id,
      config: agentSkills.config,
    })
    .from(agentSkills)
    .where(eq(agentSkills.agent_id, input.agentId));

  if (skillRows.length === 0) return input.skillsConfig;

  const bySkillId = new Map(
    input.skillsConfig.map((skill) => [skill.skillId, { ...skill }]),
  );

  for (const row of skillRows) {
    const skill = bySkillId.get(row.skill_id);
    if (!skill) continue;
    const config = (row.config as Record<string, unknown>) || {};
    const envOverrides = await buildSkillEnvOverrides(
      config,
      input.tenantId,
    ).catch((err) => {
      console.warn(
        `${input.logPrefix} envOverrides failed for skill ${row.skill_id}:`,
        err,
      );
      return null;
    });
    if (config.secretRef) skill.secretRef = config.secretRef as string;
    if (config.mcpServer) skill.mcpServer = config.mcpServer as string;
    if (envOverrides && Object.keys(envOverrides).length > 0) {
      skill.envOverrides = {
        ...(skill.envOverrides || {}),
        ...envOverrides,
      };
    }
  }

  return input.skillsConfig.map(
    (skill) => bySkillId.get(skill.skillId) ?? skill,
  );
}

async function resolveSpaceRuntimeOverrides(input: {
  tenantId: string;
  spaceId: string | null;
  logPrefix: string;
}): Promise<SpaceRuntimeOverrides | null> {
  if (!input.spaceId) return null;

  const db = getDb();
  const [space] = await db
    .select({
      model_override: spaces.model_override,
      guardrail_id_override: spaces.guardrail_id_override,
      budget_monthly_cents_override: spaces.budget_monthly_cents_override,
      budget_paused_override: spaces.budget_paused_override,
      sandbox_override: spaces.sandbox_override,
    })
    .from(spaces)
    .where(
      and(eq(spaces.id, input.spaceId), eq(spaces.tenant_id, input.tenantId)),
    )
    .limit(1);

  if (!space) {
    console.warn(
      `${input.logPrefix} Space ${input.spaceId} not found for tenant ${input.tenantId}; runtime overrides skipped`,
    );
    return null;
  }

  const overrides: SpaceRuntimeOverrides = {
    modelOverride: space.model_override ?? null,
    guardrailIdOverride: space.guardrail_id_override ?? null,
    budgetMonthlyCentsOverride: space.budget_monthly_cents_override ?? null,
    budgetPausedOverride: space.budget_paused_override ?? null,
    sandboxOverride: space.sandbox_override ?? null,
  };

  if (overrides.guardrailIdOverride) {
    const [guardrail] = await db
      .select({
        bedrock_guardrail_id: guardrails.bedrock_guardrail_id,
        bedrock_version: guardrails.bedrock_version,
      })
      .from(guardrails)
      .where(
        and(
          eq(guardrails.id, overrides.guardrailIdOverride),
          eq(guardrails.tenant_id, input.tenantId),
        ),
      )
      .limit(1);
    if (guardrail?.bedrock_guardrail_id && guardrail?.bedrock_version) {
      overrides.guardrailConfigOverride = {
        guardrailIdentifier: guardrail.bedrock_guardrail_id,
        guardrailVersion: guardrail.bedrock_version,
      };
    } else {
      console.warn(
        `${input.logPrefix} Space guardrail override ${overrides.guardrailIdOverride} did not resolve for tenant ${input.tenantId}; guardrail config omitted`,
      );
      overrides.guardrailIdOverride = null;
    }
  }

  return overrides;
}
