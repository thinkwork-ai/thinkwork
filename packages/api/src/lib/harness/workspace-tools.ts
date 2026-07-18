import { createHash } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { getDb } from "@thinkwork/database-pg";
import { getConfig } from "@thinkwork/runtime-config";
import { isBuiltinToolSlug } from "../builtin-tool-slugs.js";
import { toolPolicyAliases } from "../builtin-tool-policy-aliases.js";
import { CAPABILITY_SLUG_PATTERN } from "../capabilities/definition-schemas.js";
import { resolveDispatchPinnedSkills } from "../skills/message-pinned-skills.js";
import { loadTrustedCatalogSkillIds } from "../skill-trust/runtime-gate.js";
import { renderWorkspaceTuple } from "../workspace-renderer/compose-tuple.js";
import { isToolAllowed } from "../workspace-renderer/effective-policy-composer.js";
import { S3WorkspaceRendererObjectStore } from "../workspace-renderer/s3-store.js";
import type {
  RenderedWorkspaceTuple,
  WorkspaceHydrateFile,
  WorkspaceRenderTupleInput,
} from "../workspace-renderer/types.js";
import {
  guardHarnessPublication,
  HarnessPublicationBlockedError,
} from "./publication-guard.js";

const MAX_SKILL_BODY_BYTES = 64 * 1024;

export interface WorkspaceSkillContext {
  tenantId: string;
  userId: string;
  agentId: string;
  threadId: string;
  turnId: string;
  triggeringMessageId: string;
  spaceId: string | null;
}

export interface AuthorizedWorkspaceSkill {
  slug: string;
  scope: "agent" | "space" | "user" | "message";
}

interface ResolvedWorkspaceSkill extends AuthorizedWorkspaceSkill {
  sourceKey: string;
  size?: number;
}

export interface WorkspaceSkillReaderDeps {
  render?: (
    input: WorkspaceRenderTupleInput,
  ) => Promise<RenderedWorkspaceTuple>;
  readText?: (key: string) => Promise<string | null>;
  resolvePinnedSkillIds?: (context: WorkspaceSkillContext) => Promise<string[]>;
  loadTrustedSkillIds?: (
    context: WorkspaceSkillContext,
    skillIds: string[],
  ) => Promise<Set<string>>;
  bucket?: string;
}

export type WorkspaceSkillAccessErrorCode =
  | "invalid_workspace_skill"
  | "workspace_skill_not_authorized"
  | "workspace_skill_source_unavailable"
  | "workspace_skill_too_large"
  | "workspace_skill_content_blocked";

export class WorkspaceSkillAccessError extends Error {
  constructor(readonly code: WorkspaceSkillAccessErrorCode) {
    super(`AgentCore workspace skill access failed (${code})`);
    this.name = "WorkspaceSkillAccessError";
  }
}

export async function listAuthorizedWorkspaceSkills(
  context: WorkspaceSkillContext,
  deps: WorkspaceSkillReaderDeps = {},
): Promise<{
  manifestFingerprint: string;
  skills: AuthorizedWorkspaceSkill[];
}> {
  const projection = await resolveProjection(context, deps);
  return {
    manifestFingerprint: projection.manifestFingerprint,
    skills: projection.skills.map(({ slug, scope }) => ({ slug, scope })),
  };
}

export async function loadAuthorizedWorkspaceSkill(
  context: WorkspaceSkillContext,
  slug: string,
  deps: WorkspaceSkillReaderDeps = {},
): Promise<
  AuthorizedWorkspaceSkill & {
    content: string;
    contentSha256: string;
    sizeBytes: number;
    manifestFingerprint: string;
  }
> {
  if (!CAPABILITY_SLUG_PATTERN.test(slug)) {
    throw new WorkspaceSkillAccessError("invalid_workspace_skill");
  }

  // Authorization is deliberately recomputed for every body read. A list
  // result is advisory and never acts as a grant after assignment or policy
  // state changes.
  const projection = await resolveProjection(context, deps);
  const skill = projection.skills.find((candidate) => candidate.slug === slug);
  if (!skill) {
    throw new WorkspaceSkillAccessError("workspace_skill_not_authorized");
  }
  if (skill.size !== undefined && skill.size > MAX_SKILL_BODY_BYTES) {
    throw new WorkspaceSkillAccessError("workspace_skill_too_large");
  }

  const content = await readWorkspaceText(skill.sourceKey, deps);
  if (content === null) {
    throw new WorkspaceSkillAccessError("workspace_skill_source_unavailable");
  }
  const sizeBytes = Buffer.byteLength(content, "utf8");
  if (sizeBytes > MAX_SKILL_BODY_BYTES) {
    throw new WorkspaceSkillAccessError("workspace_skill_too_large");
  }
  try {
    guardHarnessPublication(content);
  } catch (error) {
    if (error instanceof HarnessPublicationBlockedError) {
      throw new WorkspaceSkillAccessError("workspace_skill_content_blocked");
    }
    throw error;
  }

  return {
    slug: skill.slug,
    scope: skill.scope,
    content,
    contentSha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes,
    manifestFingerprint: projection.manifestFingerprint,
  };
}

async function resolveProjection(
  context: WorkspaceSkillContext,
  deps: WorkspaceSkillReaderDeps,
): Promise<{
  manifestFingerprint: string;
  skills: ResolvedWorkspaceSkill[];
}> {
  if (!context.spaceId) {
    return { manifestFingerprint: "", skills: [] };
  }
  const render = deps.render ?? defaultRender;
  const rendered = await render({
    tenantId: context.tenantId,
    agentId: context.agentId,
    spaceId: context.spaceId,
    threadId: context.threadId,
    userId: context.userId,
  });
  const tenantSourcePrefix = tenantSourcePrefixFrom(rendered.renderedPrefix);
  if (!tenantSourcePrefix) {
    throw new WorkspaceSkillAccessError("workspace_skill_source_unavailable");
  }
  const files = rendered.hydrateManifest.files;
  const bySlug = new Map<string, ResolvedWorkspaceSkill>();
  for (const entry of rendered.capabilities.manifest.active) {
    if (
      entry.class !== "skill" ||
      !CAPABILITY_SLUG_PATTERN.test(entry.slug) ||
      bySlug.has(entry.slug)
    ) {
      continue;
    }
    const scope = authorizedScope(entry.source_scope, context);
    if (!scope) continue;
    const source = matchingSkillSource(
      files,
      entry.slug,
      scope,
      tenantSourcePrefix,
    );
    if (!source) continue;
    bySlug.set(entry.slug, {
      slug: entry.slug,
      scope,
      sourceKey: source.sourceKey,
      ...(source.size === undefined ? {} : { size: source.size }),
    });
  }
  const resolvePinnedSkillIds =
    deps.resolvePinnedSkillIds ?? defaultResolvePinnedSkillIds;
  const pinnedSkillIds = await resolvePinnedSkillIds(context);
  if (pinnedSkillIds.length > 0) {
    const loadTrustedSkillIds =
      deps.loadTrustedSkillIds ?? defaultLoadTrustedSkillIds;
    const trustedPinnedSkillIds = await loadTrustedSkillIds(
      context,
      pinnedSkillIds,
    );
    for (const slug of pinnedSkillIds) {
      if (
        bySlug.has(slug) ||
        !CAPABILITY_SLUG_PATTERN.test(slug) ||
        !trustedPinnedSkillIds.has(slug) ||
        !skillAllowedByPolicy(slug, rendered.effectivePolicy)
      ) {
        continue;
      }
      bySlug.set(slug, {
        slug,
        scope: "message",
        sourceKey: `${tenantSourcePrefix}skill-catalog/${slug}/SKILL.md`,
      });
    }
  }
  return {
    manifestFingerprint: rendered.capabilities.fingerprint,
    skills: [...bySlug.values()].sort((left, right) =>
      left.slug.localeCompare(right.slug),
    ),
  };
}

function skillAllowedByPolicy(
  slug: string,
  policy: RenderedWorkspaceTuple["effectivePolicy"],
): boolean {
  const aliases = toolPolicyAliases(slug);
  if (aliases.some((alias) => policy.blockedTools.includes(alias))) {
    return false;
  }
  if (!isBuiltinToolSlug(slug)) return true;
  return aliases.some((alias) => isToolAllowed(policy, alias));
}

function authorizedScope(
  sourceScope: string | undefined,
  context: WorkspaceSkillContext,
): AuthorizedWorkspaceSkill["scope"] | null {
  // Pre-registry manifests did not carry source_scope and compiled only the
  // agent-root skill inventory. Treat absence as agent scope; never guess a
  // user or Space identity from an unscoped entry.
  if (!sourceScope) return "agent";
  if (sourceScope === `agent:${context.agentId}`) return "agent";
  if (sourceScope === `space:${context.spaceId}`) return "space";
  if (sourceScope === `user:${context.userId}`) return "user";
  return null;
}

function matchingSkillSource(
  files: WorkspaceHydrateFile[],
  slug: string,
  scope: AuthorizedWorkspaceSkill["scope"],
  tenantSourcePrefix: string,
): WorkspaceHydrateFile | null {
  const expectedPath = `skills/${slug}/SKILL.md`;
  return (
    files.find(
      (file) =>
        !file.generated &&
        file.owner === scope &&
        file.sourcePath === expectedPath &&
        file.sourceKey.startsWith(tenantSourcePrefix) &&
        file.sourcePrefix.startsWith(tenantSourcePrefix) &&
        file.sourceKey.startsWith(file.sourcePrefix) &&
        !file.sourceKey.includes("\0") &&
        !file.sourceKey.split("/").includes(".."),
    ) ?? null
  );
}

function tenantSourcePrefixFrom(renderedPrefix: string): string | null {
  const match = /^tenants\/[^/]+\//.exec(renderedPrefix);
  if (!match || match[0].split("/").includes("..")) return null;
  return match[0];
}

async function defaultRender(
  input: WorkspaceRenderTupleInput,
): Promise<RenderedWorkspaceTuple> {
  const { bucket, store } = defaultStore();
  return renderWorkspaceTuple(input, {
    persist: false,
    bucket,
    objectStore: store,
  });
}

async function readWorkspaceText(
  key: string,
  deps: WorkspaceSkillReaderDeps,
): Promise<string | null> {
  if (deps.readText) return deps.readText(key);
  const { bucket, store } = defaultStore(deps.bucket);
  return store.getText({ bucket, key });
}

async function defaultResolvePinnedSkillIds(
  context: WorkspaceSkillContext,
): Promise<string[]> {
  return resolveDispatchPinnedSkills({
    db: getDb(),
    tenantId: context.tenantId,
    threadId: context.threadId,
    messageId: context.triggeringMessageId,
  });
}

async function defaultLoadTrustedSkillIds(
  context: WorkspaceSkillContext,
  skillIds: string[],
): Promise<Set<string>> {
  return loadTrustedCatalogSkillIds({
    tenantId: context.tenantId,
    skillIds,
    logPrefix: "[harness-workspace-skills]",
  });
}

let sharedStore: S3WorkspaceRendererObjectStore | null = null;

function defaultStore(bucketOverride?: string): {
  bucket: string;
  store: S3WorkspaceRendererObjectStore;
} {
  let bucket = bucketOverride ?? "";
  if (!bucket) {
    try {
      bucket = getConfig("WORKSPACE_BUCKET") ?? "";
    } catch {
      bucket = "";
    }
  }
  if (!bucket) {
    throw new WorkspaceSkillAccessError("workspace_skill_source_unavailable");
  }
  sharedStore ??= new S3WorkspaceRendererObjectStore(
    new S3Client({
      region:
        process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
    }),
  );
  return { bucket, store: sharedStore };
}
