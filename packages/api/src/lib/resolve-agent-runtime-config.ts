/**
 * Resolve an agent's runtime configuration for an AgentCore invocation.
 *
 * Two callers today:
 * - `packages/api/src/handlers/chat-agent-invoke.ts` — chat turn flow.
 * - `packages/api/src/handlers/agents-runtime-config.ts` — service-auth REST
 *   endpoint consumed by the Strands container's `kind=run_skill` dispatcher
 *   (plan `docs/plans/2026-04-24-008-feat-skill-run-dispatcher-plan.md` §U1).
 *
 * Keeping both callers on a single helper is the anti-drift invariant. Any
 * field the chat path needs must also be available to the dispatcher, and
 * vice versa — they run the same agent in the same container and expect the
 * same shape from `_call_strands_agent`.
 *
 * What this helper resolves:
 *   - agent + template + tenant metadata (name, slug, model, blocked tools,
 *     sandbox template config)
 *   - guardrail (template-assigned, else tenant default)
 *   - `skillsConfig`: the full skill list the container should register,
 *     including catalog defaults (agent-email-send, agent-thread-management,
 *     artifacts, workspace-memory), tenant-configured built-in tools, and
 *     per-skill env overrides (OAuth-resolved tokens, CURRENT_USER_EMAIL when
 *     a human invoker is known) with the template blocked-tools filter
 *     applied last
 *   - `knowledgeBasesConfig`: enabled KBs assigned to the agent
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

import { eq, and } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  agentCapabilities,
  agentTemplates,
  agentSkills,
  tenants,
  tenantSkills,
  users,
  agentKnowledgeBases,
  knowledgeBases,
  guardrails,
} from "@thinkwork/database-pg/schema";
import { buildSkillEnvOverrides } from "./oauth-token.js";
import { buildMcpConfigs } from "./mcp-configs.js";
import {
  normalizeAgentRuntimeType,
  type AgentRuntimeType,
} from "./resolve-runtime-function-name.js";
import { loadTenantBuiltinTools } from "../handlers/skills.js";
import type { TemplateSandboxConfig } from "./sandbox-preflight.js";
import { validateTemplateBrowser } from "./templates/browser-config.js";

export interface SkillConfig {
  skillId: string;
  s3Key: string;
  secretRef?: string;
  envOverrides?: Record<string, string>;
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
}

export interface WebSearchConfig {
  provider: "exa" | "serpapi";
  apiKey: string;
}

export interface GuardrailPayload {
  guardrailIdentifier: string;
  guardrailVersion: string;
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
  templateId: string;
  templateModel: string | null;
  blockedTools: string[];
  sandboxTemplate: TemplateSandboxConfig | null;
  browserAutomationEnabled: boolean;
  /**
   * Internal `guardrails.id` of the resolved guardrail (template or
   * tenant-default) — used by callers that record `guardrail_blocks`
   * rows. Null when no guardrail is active.
   */
  guardrailId: string | null;
  guardrailConfig: GuardrailPayload | undefined;
  runtimeType: AgentRuntimeType;
  skillsConfig: SkillConfig[];
  webSearchConfig?: WebSearchConfig;
  knowledgeBasesConfig: KnowledgeBaseConfig[] | undefined;
  mcpConfigs: McpConfig[];
}

export class AgentNotFoundError extends Error {
  constructor(public readonly agentId: string) {
    super(`Agent not found: ${agentId}`);
    this.name = "AgentNotFoundError";
  }
}

export class AgentTemplateNotFoundError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly templateId: string,
  ) {
    super(
      `Agent template not found: agentId=${agentId} templateId=${templateId}`,
    );
    this.name = "AgentTemplateNotFoundError";
  }
}

export interface ResolveAgentRuntimeConfigOptions {
  tenantId: string;
  agentId: string;
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
   * envOverrides. Defaults to `process.env.THINKWORK_API_URL` /
   * `THINKWORK_API_SECRET` / `APPSYNC_API_KEY`. Passed explicitly so tests can
   * avoid touching process.env globally.
   */
  thinkworkApiUrl?: string;
  thinkworkApiSecret?: string;
  appsyncApiKey?: string;
}

const DEFAULT_SKILLS: ReadonlyArray<{ skillId: string; s3Key: string }> = [
  {
    skillId: "agent-thread-management",
    s3Key: "skills/catalog/agent-thread-management",
  },
  { skillId: "artifacts", s3Key: "skills/catalog/artifacts" },
  { skillId: "workspace-memory", s3Key: "skills/catalog/workspace-memory" },
];

const BROWSER_AUTOMATION_CAPABILITY = "browser_automation";

export async function resolveAgentRuntimeConfig(
  opts: ResolveAgentRuntimeConfigOptions,
): Promise<AgentRuntimeConfig> {
  const db = getDb();
  const logPrefix = opts.logPrefix ?? "[agent-runtime-config]";
  const thinkworkApiUrl =
    opts.thinkworkApiUrl ?? process.env.THINKWORK_API_URL ?? "";
  const thinkworkApiSecret =
    opts.thinkworkApiSecret ?? process.env.THINKWORK_API_SECRET ?? "";
  const appsyncApiKey = opts.appsyncApiKey ?? process.env.APPSYNC_API_KEY ?? "";

  const [agent] = await db
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      system_prompt: agents.system_prompt,
      human_pair_id: agents.human_pair_id,
      template_id: agents.template_id,
      runtime: agents.runtime,
    })
    .from(agents)
    .where(
      and(eq(agents.id, opts.agentId), eq(agents.tenant_id, opts.tenantId)),
    );
  if (!agent) throw new AgentNotFoundError(opts.agentId);

  const [agentTemplate] = await db
    .select({
      model: agentTemplates.model,
      guardrail_id: agentTemplates.guardrail_id,
      blocked_tools: agentTemplates.blocked_tools,
      sandbox: agentTemplates.sandbox,
      browser: agentTemplates.browser,
      runtime: agentTemplates.runtime,
    })
    .from(agentTemplates)
    .where(eq(agentTemplates.id, agent.template_id));
  if (!agentTemplate) {
    throw new AgentTemplateNotFoundError(opts.agentId, agent.template_id);
  }

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

  // Guardrail: template-assigned → tenant default → none.
  let guardrailId: string | null = null;
  let guardrailConfig: GuardrailPayload | undefined;
  if (agentTemplate.guardrail_id) {
    const [gr] = await db
      .select({
        bedrock_guardrail_id: guardrails.bedrock_guardrail_id,
        bedrock_version: guardrails.bedrock_version,
      })
      .from(guardrails)
      .where(eq(guardrails.id, agentTemplate.guardrail_id));
    if (gr?.bedrock_guardrail_id && gr?.bedrock_version) {
      guardrailId = agentTemplate.guardrail_id;
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

  const blockedTools: string[] =
    (agentTemplate.blocked_tools as string[] | null) ?? [];
  const templateBrowserResult = validateTemplateBrowser(agentTemplate.browser);
  const templateBrowserEnabled = templateBrowserResult.ok
    ? templateBrowserResult.value?.enabled === true
    : false;
  if (!templateBrowserResult.ok) {
    console.warn(
      `${logPrefix} Invalid template browser config ignored for agent ${opts.agentId}: ${templateBrowserResult.error}`,
    );
  }

  // --- Skills --------------------------------------------------------------
  // Per-agent installs first, then default skills the container always needs,
  // then tenant-configured built-in tools (web-search etc.), then the
  // template's blocked-tools filter.

  const skillRows = await db
    .select({
      skill_id: agentSkills.skill_id,
      config: agentSkills.config,
      source: tenantSkills.source,
    })
    .from(agentSkills)
    .leftJoin(
      tenantSkills,
      and(
        eq(tenantSkills.tenant_id, opts.tenantId),
        eq(tenantSkills.skill_id, agentSkills.skill_id),
      ),
    )
    .where(eq(agentSkills.agent_id, opts.agentId));

  let skillsConfig: SkillConfig[] = await Promise.all(
    skillRows.map(
      async (s: {
        skill_id: string;
        config: unknown;
        source: string | null;
      }): Promise<SkillConfig> => {
        const config = (s.config as Record<string, unknown>) || {};
        const envOverrides = await buildSkillEnvOverrides(
          config,
          opts.tenantId,
        ).catch((err) => {
          console.warn(
            `${logPrefix} envOverrides failed for skill ${s.skill_id}:`,
            err,
          );
          return null;
        });
        const s3Key = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/skills/${s.skill_id}`;
        const merged = envOverrides ? { ...envOverrides } : {};
        return {
          skillId: s.skill_id,
          s3Key,
          secretRef: (config.secretRef as string) || undefined,
          envOverrides: Object.keys(merged).length > 0 ? merged : undefined,
        };
      },
    ),
  );

  // agent-email-send default.
  if (!skillsConfig.some((s) => s.skillId === "agent-email-send")) {
    skillsConfig.push({
      skillId: "agent-email-send",
      s3Key: "skills/catalog/agent-email-send",
      secretRef: undefined,
      envOverrides: {
        AGENT_EMAIL_ADDRESS: `${agentSlug}@agents.thinkwork.ai`,
        AGENT_ID: opts.agentId,
        THINKWORK_API_URL: thinkworkApiUrl,
        THINKWORK_API_SECRET: thinkworkApiSecret,
        INBOUND_MESSAGE_ID: "",
        INBOUND_SUBJECT: "",
        INBOUND_FROM: "",
        INBOUND_BODY: "",
      },
    });
  }

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
      secretRef: undefined,
      envOverrides: env,
    });
  }

  // Tenant built-in tools (web-search etc.) — only injected when a row exists
  // with enabled=true AND a usable API key in Secrets Manager.
  try {
    const builtinTools = await loadTenantBuiltinTools(opts.tenantId);
    for (const bt of builtinTools) {
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
        s3Key: `skills/catalog/${bt.toolSlug}`,
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

  const webSearchSkill = skillsConfig.find((s) => s.skillId === "web-search");
  const webSearchProvider = webSearchSkill?.envOverrides?.WEB_SEARCH_PROVIDER;
  let webSearchConfig: WebSearchConfig | undefined;
  if (
    webSearchProvider === "serpapi" &&
    webSearchSkill?.envOverrides?.SERPAPI_KEY
  ) {
    webSearchConfig = {
      provider: "serpapi",
      apiKey: webSearchSkill.envOverrides.SERPAPI_KEY,
    };
  } else if (webSearchSkill?.envOverrides?.EXA_API_KEY) {
    webSearchConfig = {
      provider: "exa",
      apiKey: webSearchSkill.envOverrides.EXA_API_KEY,
    };
  }

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

  const knowledgeBasesConfig: KnowledgeBaseConfig[] | undefined =
    kbRows.length > 0
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

  // --- MCP configs ---------------------------------------------------------

  const mcpConfigs = await buildMcpConfigs(
    opts.agentId,
    agent.human_pair_id,
    logPrefix,
  );

  return {
    tenantId: opts.tenantId,
    tenantSlug,
    agentId: opts.agentId,
    agentName: agent.name,
    agentSlug,
    agentSystemPrompt: agent.system_prompt,
    humanName,
    humanPairId: agent.human_pair_id,
    templateId: agent.template_id,
    templateModel: agentTemplate.model ?? null,
    blockedTools,
    sandboxTemplate:
      (agentTemplate.sandbox as TemplateSandboxConfig | null) ?? null,
    browserAutomationEnabled,
    guardrailId,
    guardrailConfig,
    runtimeType: normalizeAgentRuntimeType(
      agent.runtime ?? agentTemplate.runtime,
    ),
    skillsConfig,
    webSearchConfig,
    knowledgeBasesConfig,
    mcpConfigs,
  };
}
