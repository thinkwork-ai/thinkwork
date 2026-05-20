import { S3Client } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import {
  agents,
  spaces,
  tenants,
  threads,
} from "@thinkwork/database-pg/schema";
import { getDb } from "@thinkwork/database-pg";
import { spaceSourcePrefix } from "./spaces/template-migration.js";
import { regenerateManifest } from "./workspace-manifest.js";
import {
  composeWorkspacePolicy,
  type EffectiveWorkspacePolicy,
} from "./workspace-policy.js";
import {
  contentTypeForWorkspacePath,
  S3WorkspaceObjectStore,
  shouldRenderWorkspaceSourcePath,
  type WorkspaceObjectStore,
} from "./workspace-renderer.js";

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });

export interface ResolvedTurnContext {
  tenantId: string;
  tenantSlug: string;
  agentId: string;
  agentSlug: string;
  agentName: string;
  spaceId: string;
  spaceSlug: string;
  spaceName: string;
  spacePrompt: string | null;
  spaceContextConfig: unknown;
  spaceToolPolicy: unknown;
  spaceMcpPolicy: unknown;
}

export interface TurnContextRepository {
  resolve(input: {
    tenantId: string;
    agentId: string;
    threadId?: string | null;
    spaceId?: string | null;
  }): Promise<ResolvedTurnContext | null>;
}

export interface RenderTurnContextInput {
  tenantId: string;
  agentId: string;
  threadId?: string | null;
  spaceId?: string | null;
  turnId?: string | null;
  agentBlockedTools?: unknown;
  agentAllowedTools?: unknown;
}

export interface RenderedTurnContext {
  rendered: true;
  tenantSlug: string;
  agentSlug: string;
  spaceId: string;
  spaceSlug: string;
  copiedFiles: string[];
  generatedFiles: string[];
  effectivePolicy: EffectiveWorkspacePolicy;
  payload: {
    spaceId: string;
    spaceSlug: string;
    activeContextPath: string;
    effectivePolicyPath: string;
  };
}

export type RenderTurnContextResult =
  | RenderedTurnContext
  | { rendered: false; reason: string };

export interface RenderTurnContextDeps {
  bucket?: string;
  now?: () => Date;
  objectStore?: WorkspaceObjectStore;
  repository?: TurnContextRepository;
  regenerateManifest?: typeof regenerateManifest | false;
}

function agentWorkspacePrefix(tenantSlug: string, agentSlug: string): string {
  return `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
}

export function renderSpaceContextMarkdown(input: {
  context: ResolvedTurnContext;
  copiedFiles: string[];
  effectivePolicy: EffectiveWorkspacePolicy;
  renderedAt: Date;
}): string {
  const { context, copiedFiles, effectivePolicy, renderedAt } = input;
  const lines: string[] = [];
  lines.push(`# Active Space Context: ${context.spaceName}`);
  lines.push("");
  lines.push(`Rendered at: ${renderedAt.toISOString()}`);
  lines.push(`Space slug: ${context.spaceSlug}`);
  if (context.spacePrompt) {
    lines.push("");
    lines.push("## Space Prompt");
    lines.push("");
    lines.push(context.spacePrompt);
  }
  lines.push("");
  lines.push("## Files");
  lines.push("");
  if (copiedFiles.length === 0) {
    lines.push("No Space source files were rendered for this turn.");
  } else {
    for (const path of copiedFiles) {
      lines.push(`- spaces/${context.spaceSlug}/${path}`);
    }
  }
  lines.push("");
  lines.push("## Effective Policy");
  lines.push("");
  lines.push(
    `Blocked tools: ${
      effectivePolicy.blockedTools.length > 0
        ? effectivePolicy.blockedTools.join(", ")
        : "none"
    }`,
  );
  if (effectivePolicy.allowedTools) {
    lines.push(`Allowed tools: ${effectivePolicy.allowedTools.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function renderTurnContext(
  input: RenderTurnContextInput,
  deps: RenderTurnContextDeps = {},
): Promise<RenderTurnContextResult> {
  const bucket = deps.bucket ?? process.env.WORKSPACE_BUCKET ?? "";
  if (!bucket) return { rendered: false, reason: "bucket_unconfigured" };

  const repository = deps.repository ?? new DrizzleTurnContextRepository();
  const context = await repository.resolve(input);
  if (!context) return { rendered: false, reason: "context_unresolved" };

  const objectStore = deps.objectStore ?? new S3WorkspaceObjectStore(s3);
  const now = deps.now ?? (() => new Date());
  const renderedAt = now();
  const sourcePrefix = spaceSourcePrefix(context.tenantSlug, context.spaceSlug);
  const targetPrefix = `${agentWorkspacePrefix(
    context.tenantSlug,
    context.agentSlug,
  )}spaces/${context.spaceSlug}/`;

  const sourceKeys = await objectStore.listKeys({
    bucket,
    prefix: sourcePrefix,
  });
  const copiedFiles: string[] = [];
  for (const sourceKey of sourceKeys) {
    const relPath = sourceKey.slice(sourcePrefix.length);
    if (!shouldRenderWorkspaceSourcePath(relPath)) continue;
    await objectStore.copyObject({
      bucket,
      sourceKey,
      targetKey: `${targetPrefix}${relPath}`,
    });
    copiedFiles.push(relPath);
  }
  copiedFiles.sort();

  const effectivePolicy = composeWorkspacePolicy({
    agentBlockedTools: input.agentBlockedTools,
    agentAllowedTools: input.agentAllowedTools,
    spaceToolPolicy: context.spaceToolPolicy,
    spaceMcpPolicy: context.spaceMcpPolicy,
  });
  const rootPrefix = agentWorkspacePrefix(
    context.tenantSlug,
    context.agentSlug,
  );
  const activeContextPath = "SPACE_CONTEXT.md";
  const effectivePolicyPath = "effective-policy.json";
  const generatedFiles = [activeContextPath, effectivePolicyPath];
  await objectStore.putText({
    bucket,
    key: `${rootPrefix}${activeContextPath}`,
    content: renderSpaceContextMarkdown({
      context,
      copiedFiles,
      effectivePolicy,
      renderedAt,
    }),
    contentType: contentTypeForWorkspacePath(activeContextPath),
  });
  await objectStore.putText({
    bucket,
    key: `${rootPrefix}${effectivePolicyPath}`,
    content: `${JSON.stringify(
      {
        version: 1,
        generatedAt: renderedAt.toISOString(),
        threadId: input.threadId ?? null,
        turnId: input.turnId ?? null,
        spaceId: context.spaceId,
        spaceSlug: context.spaceSlug,
        policy: effectivePolicy,
      },
      null,
      2,
    )}\n`,
    contentType: contentTypeForWorkspacePath(effectivePolicyPath),
  });

  if (deps.regenerateManifest !== false) {
    const regen = deps.regenerateManifest ?? regenerateManifest;
    await regen(bucket, context.tenantSlug, context.agentSlug);
  }

  return {
    rendered: true,
    tenantSlug: context.tenantSlug,
    agentSlug: context.agentSlug,
    spaceId: context.spaceId,
    spaceSlug: context.spaceSlug,
    copiedFiles,
    generatedFiles,
    effectivePolicy,
    payload: {
      spaceId: context.spaceId,
      spaceSlug: context.spaceSlug,
      activeContextPath,
      effectivePolicyPath,
    },
  };
}

class DrizzleTurnContextRepository implements TurnContextRepository {
  private readonly db = getDb();

  async resolve(input: {
    tenantId: string;
    agentId: string;
    threadId?: string | null;
    spaceId?: string | null;
  }): Promise<ResolvedTurnContext | null> {
    const [agent] = await this.db
      .select({
        id: agents.id,
        slug: agents.slug,
        name: agents.name,
        tenantId: agents.tenant_id,
      })
      .from(agents)
      .where(
        and(eq(agents.id, input.agentId), eq(agents.tenant_id, input.tenantId)),
      );
    if (!agent?.slug) return null;

    const [tenant] = await this.db
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId));
    if (!tenant?.slug) return null;

    let spaceId = input.spaceId ?? null;
    if (!spaceId && input.threadId) {
      const [thread] = await this.db
        .select({ spaceId: threads.space_id })
        .from(threads)
        .where(
          and(
            eq(threads.id, input.threadId),
            eq(threads.tenant_id, input.tenantId),
          ),
        );
      spaceId = thread?.spaceId ?? null;
    }
    if (!spaceId) return null;

    const [space] = await this.db
      .select({
        id: spaces.id,
        slug: spaces.slug,
        name: spaces.name,
        prompt: spaces.prompt,
        tenantId: spaces.tenant_id,
        status: spaces.status,
        contextConfig: spaces.context_config,
        toolPolicy: spaces.tool_policy,
        mcpPolicy: spaces.mcp_policy,
      })
      .from(spaces)
      .where(and(eq(spaces.id, spaceId), eq(spaces.tenant_id, input.tenantId)));
    if (!space || space.status !== "active") return null;

    return {
      tenantId: input.tenantId,
      tenantSlug: tenant.slug,
      agentId: agent.id,
      agentSlug: agent.slug,
      agentName: agent.name,
      spaceId: space.id,
      spaceSlug: space.slug,
      spaceName: space.name,
      spacePrompt: space.prompt,
      spaceContextConfig: space.contextConfig,
      spaceToolPolicy: space.toolPolicy,
      spaceMcpPolicy: space.mcpPolicy,
    };
  }
}
