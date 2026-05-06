import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, agentTemplates, templateToCamel } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { runWithIdempotency } from "../../../lib/idempotency.js";
import { validateTemplateBrowser } from "../../../lib/templates/browser-config.js";
import { validateTemplateContextEngine } from "../../../lib/templates/context-engine-config.js";
import { validateTemplateSandbox } from "../../../lib/templates/sandbox-config.js";
import { validateTemplateSendEmail } from "../../../lib/templates/send-email-config.js";
import { validateTemplateWebSearch } from "../../../lib/templates/web-search-config.js";
import {
  parseAgentRuntimeInput,
  withGraphqlAgentRuntime,
} from "../agents/runtime.js";

export async function createAgentTemplate(
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) {
  const i = args.input;
  await requireTenantAdmin(ctx, i.tenantId);

  const invokerUserId =
    ctx.auth.authType === "apikey"
      ? ctx.auth.principalId
      : await resolveCallerUserId(ctx);

  return runWithIdempotency({
    tenantId: i.tenantId,
    invokerUserId,
    mutationName: "createAgentTemplate",
    inputs: i,
    clientKey: i.idempotencyKey ?? null,
    fn: () => createAgentTemplateCore(i),
  });
}

async function createAgentTemplateCore(i: any) {
  const config = i.config
    ? typeof i.config === "string"
      ? JSON.parse(i.config)
      : i.config
    : undefined;
  const skills = i.skills
    ? typeof i.skills === "string"
      ? JSON.parse(i.skills)
      : i.skills
    : undefined;
  const knowledgeBaseIds = i.knowledgeBaseIds
    ? typeof i.knowledgeBaseIds === "string"
      ? JSON.parse(i.knowledgeBaseIds)
      : i.knowledgeBaseIds
    : undefined;
  const blockedTools = i.blockedTools
    ? typeof i.blockedTools === "string"
      ? JSON.parse(i.blockedTools)
      : i.blockedTools
    : undefined;

  const sandboxResult = validateTemplateSandbox(i.sandbox);
  if (!sandboxResult.ok) throw new Error(sandboxResult.error);
  const browserResult = validateTemplateBrowser(i.browser);
  if (!browserResult.ok) throw new Error(browserResult.error);
  const webSearchResult = validateTemplateWebSearch(
    i.webSearch === undefined ? { enabled: true } : i.webSearch,
  );
  if (!webSearchResult.ok) throw new Error(webSearchResult.error);
  const sendEmailResult = validateTemplateSendEmail(
    i.sendEmail === undefined ? { enabled: true } : i.sendEmail,
  );
  if (!sendEmailResult.ok) throw new Error(sendEmailResult.error);
  const contextEngineResult = validateTemplateContextEngine(
    i.contextEngine === undefined ? { enabled: true } : i.contextEngine,
  );
  if (!contextEngineResult.ok) throw new Error(contextEngineResult.error);

  const [row] = await db
    .insert(agentTemplates)
    .values({
      tenant_id: i.tenantId,
      name: i.name,
      slug: i.slug,
      description: i.description,
      category: i.category,
      icon: i.icon,
      runtime: parseAgentRuntimeInput(i.runtime),
      template_kind: parseTemplateKindInput(i.templateKind),
      model: i.model,
      guardrail_id: i.guardrailId,
      blocked_tools: blockedTools,
      config,
      skills,
      knowledge_base_ids: knowledgeBaseIds,
      sandbox: sandboxResult.value,
      browser: browserResult.value,
      web_search: webSearchResult.value,
      send_email: sendEmailResult.value,
      context_engine: contextEngineResult.value,
      is_published: i.isPublished ?? true,
    })
    .returning();

  // Copy default workspace files to the new template
  try {
    const { copyDefaultsToTemplate } = await import(
      "../../../lib/workspace-copy.js"
    );
    await copyDefaultsToTemplate(i.tenantId, i.slug);
  } catch (err) {
    console.warn(
      `[createAgentTemplate] Failed to copy default workspace files:`,
      err,
    );
  }

  return withGraphqlAgentRuntime(templateToCamel(row));
}

function parseTemplateKindInput(kind: unknown): "agent" | "computer" {
  if (kind === undefined || kind === null) return "agent";
  const normalized = String(kind).toLowerCase();
  if (normalized === "agent" || normalized === "computer") return normalized;
  throw new GraphQLError(`Invalid template kind: ${String(kind)}`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}
