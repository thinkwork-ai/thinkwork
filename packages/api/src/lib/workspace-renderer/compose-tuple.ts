import { S3Client } from "@aws-sdk/client-s3";
import {
  contentTypeForWorkspacePath,
  shouldRenderWorkspaceSourcePath,
} from "../workspace-renderer.js";
import { composeAgentsMd } from "./agents-md-composer.js";
import {
  agentWorkspacePrefix,
  renderedWorkspacePrefix,
  spaceSourcePrefix,
  userWorkspacePrefix,
} from "./prefixes.js";
import { composeWorkspacePolicy } from "./effective-policy-composer.js";
import { DrizzleWorkspaceTupleRepository } from "./repository.js";
import { S3WorkspaceRendererObjectStore } from "./s3-store.js";
import {
  assertSpaceAccessAllowed,
  type SpaceMembershipRepository,
} from "./space-membership-check.js";
import { parseMentionableWorkspaces } from "./space-md-parser.js";
import type {
  RenderedWorkspaceTuple,
  ResolvedWorkspaceRenderTuple,
  WorkspaceObjectMetadata,
  WorkspaceRendererObjectStore,
  WorkspaceRenderTupleInput,
  WorkspaceTupleRepository,
} from "./types.js";
import { WorkspaceRenderError } from "./types.js";

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });

export interface RenderWorkspaceTupleDeps {
  bucket?: string;
  now?: () => Date;
  objectStore?: WorkspaceRendererObjectStore;
  repository?: WorkspaceTupleRepository;
  spaceMembershipRepository?: SpaceMembershipRepository;
}

interface SourceObject extends WorkspaceObjectMetadata {
  relPath: string;
}

interface SourceSet {
  prefix: string;
  objects: SourceObject[];
}

function latestMtime(sources: SourceSet[]): Date | null {
  let latest: Date | null = null;
  for (const source of sources) {
    for (const object of source.objects) {
      if (!object.lastModified) continue;
      if (!latest || object.lastModified > latest) latest = object.lastModified;
    }
  }
  return latest;
}

function markerIsFresh(marker: string | null, latest: Date | null): boolean {
  if (!marker || !latest) return false;
  const markerTime = new Date(marker.trim());
  return Number.isFinite(markerTime.getTime()) && markerTime >= latest;
}

async function listRenderableSource(
  objectStore: WorkspaceRendererObjectStore,
  bucket: string,
  prefix: string,
  shouldIncludePath: (relPath: string) => boolean = () => true,
): Promise<SourceSet> {
  const listed = await objectStore.listObjects({ bucket, prefix });
  return {
    prefix,
    objects: listed
      .map((object) => ({
        ...object,
        relPath: object.key.slice(prefix.length),
      }))
      .filter(
        (object) =>
          shouldRenderWorkspaceSourcePath(object.relPath) &&
          shouldIncludePath(object.relPath),
      ),
  };
}

async function readSourceFiles(
  objectStore: WorkspaceRendererObjectStore,
  bucket: string,
  source: SourceSet,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const object of source.objects) {
    const content = await objectStore.getText({ bucket, key: object.key });
    if (content !== null) files.set(object.relPath, content);
  }
  return files;
}

function renderDefaultSpaceMd(tuple: ResolvedWorkspaceRenderTuple): string {
  const lines = [`# ${tuple.spaceName}`, ""];
  if (tuple.spacePrompt) {
    lines.push(tuple.spacePrompt.trim(), "");
  }
  lines.push(
    `This file describes the active Space rendered from ${tuple.spaceSlug}.`,
  );
  return `${lines.join("\n").trimEnd()}\n`;
}

function isDefaultSpace(tuple: ResolvedWorkspaceRenderTuple): boolean {
  return tuple.spaceSlug === "default" || tuple.spaceKind === "default";
}

function shouldRenderAgentBaselinePath(relPath: string): boolean {
  return (
    relPath !== "SPACE.md" &&
    relPath !== "SPACE_CONTEXT.md" &&
    relPath !== "effective-policy.json" &&
    !relPath.startsWith("space/") &&
    !relPath.startsWith("spaces/")
  );
}

function shouldRenderSpaceSourcePath(relPath: string): boolean {
  return relPath === "SPACE.md" || relPath.startsWith("knowledge/");
}

export async function renderWorkspaceTuple(
  input: WorkspaceRenderTupleInput,
  deps: RenderWorkspaceTupleDeps = {},
): Promise<RenderedWorkspaceTuple> {
  const bucket = deps.bucket ?? process.env.WORKSPACE_BUCKET ?? "";
  if (!bucket) {
    throw new WorkspaceRenderError(
      "WorkspaceBucketNotConfigured",
      "WORKSPACE_BUCKET is required to render a workspace tuple.",
    );
  }

  const repository = deps.repository ?? new DrizzleWorkspaceTupleRepository();
  const tuple = await repository.resolve(input);
  if (!tuple) {
    throw new WorkspaceRenderError(
      "WorkspaceTupleNotFound",
      "Tenant, agent, Space, or user context could not be resolved.",
    );
  }
  await assertSpaceAccessAllowed(
    {
      tenantId: tuple.tenantId,
      spaceId: tuple.spaceId,
      spaceSlug: tuple.spaceSlug,
      accessMode: tuple.spaceAccessMode,
      invokingUserId: tuple.userId,
      invokingServiceIdentity: input.invokingServiceIdentity,
    },
    deps.spaceMembershipRepository,
  );

  const objectStore =
    deps.objectStore ?? new S3WorkspaceRendererObjectStore(s3);
  const renderedPrefix = renderedWorkspacePrefix(tuple);
  const markerKey = `${renderedPrefix}.rendered_at`;
  const agentPrefix = agentWorkspacePrefix(tuple);
  const spacePrefix = spaceSourcePrefix(tuple);
  const userPrefix = tuple.userId
    ? userWorkspacePrefix({ tenantId: tuple.tenantId, userId: tuple.userId })
    : null;

  const [agentSource, spaceSource, userSource] = await Promise.all([
    listRenderableSource(
      objectStore,
      bucket,
      agentPrefix,
      shouldRenderAgentBaselinePath,
    ),
    listRenderableSource(
      objectStore,
      bucket,
      spacePrefix,
      shouldRenderSpaceSourcePath,
    ),
    userPrefix
      ? listRenderableSource(objectStore, bucket, userPrefix)
      : Promise.resolve({ prefix: "", objects: [] }),
  ]);

  if (agentSource.objects.length === 0) {
    throw new WorkspaceRenderError(
      "AgentBaselineNotFound",
      `No renderable agent workspace files found at ${agentPrefix}.`,
    );
  }
  if (!isDefaultSpace(tuple) && spaceSource.objects.length === 0) {
    throw new WorkspaceRenderError(
      "SpaceSourcesNotFound",
      `No renderable Space source files found at ${spacePrefix}.`,
    );
  }

  const sourcePrefixes = [agentPrefix, spacePrefix, userPrefix].filter(
    (prefix): prefix is string => Boolean(prefix),
  );
  const effectivePolicy = composeWorkspacePolicy({
    agentBlockedTools: input.agentBlockedTools,
    agentAllowedTools: input.agentAllowedTools,
  });
  const marker = await objectStore.getText({ bucket, key: markerKey });
  if (
    markerIsFresh(marker, latestMtime([agentSource, spaceSource, userSource]))
  ) {
    return {
      renderedPrefix,
      cacheStatus: "hit",
      sourcePrefixes,
      writtenFiles: [],
      activeSpace: {
        id: tuple.spaceId,
        slug: tuple.spaceSlug,
        name: tuple.spaceName,
        isDefault: isDefaultSpace(tuple),
      },
      effectivePolicy,
      user: {
        id: tuple.userId,
        slug: tuple.userSlug,
        name: tuple.userName,
      },
    };
  }

  const [agentFiles, spaceFiles, userFiles] = await Promise.all([
    readSourceFiles(objectStore, bucket, agentSource),
    readSourceFiles(objectStore, bucket, spaceSource),
    readSourceFiles(objectStore, bucket, userSource),
  ]);

  const rendered = new Map<string, string>();
  for (const [relPath, content] of agentFiles) rendered.set(relPath, content);
  for (const [relPath, content] of userFiles) rendered.set(relPath, content);
  for (const [relPath, content] of spaceFiles) {
    rendered.set(`space/${relPath}`, content);
    rendered.set(`spaces/${tuple.spaceSlug}/${relPath}`, content);
  }

  const spaceMd = spaceFiles.get("SPACE.md") ?? renderDefaultSpaceMd(tuple);
  rendered.set("SPACE.md", spaceMd);

  rendered.set(
    "AGENTS.md",
    composeAgentsMd({
      baseline: agentFiles.get("AGENTS.md") ?? "",
      mentionableWorkspaces: parseMentionableWorkspaces(spaceMd),
      spaceSlug: tuple.spaceSlug,
      spaceName: tuple.spaceName,
      isDefaultSpace: isDefaultSpace(tuple),
      renderedAt: deps.now?.() ?? new Date(),
      topLevelSpaceMdPath: "SPACE.md",
      activeSpaceMdPath: "space/SPACE.md",
      provenanceSpaceMdPath: `spaces/${tuple.spaceSlug}/SPACE.md`,
      userMdPath: tuple.userId ? "USER.md" : null,
    }),
  );

  const writtenFiles = Array.from(rendered.keys()).sort();
  for (const relPath of writtenFiles) {
    await objectStore.putText({
      bucket,
      key: `${renderedPrefix}${relPath}`,
      content: rendered.get(relPath) ?? "",
      contentType: contentTypeForWorkspacePath(relPath),
    });
  }
  await objectStore.putText({
    bucket,
    key: markerKey,
    content: (deps.now?.() ?? new Date()).toISOString(),
    contentType: "text/plain; charset=utf-8",
  });

  return {
    renderedPrefix,
    cacheStatus: "miss",
    sourcePrefixes,
    writtenFiles,
    activeSpace: {
      id: tuple.spaceId,
      slug: tuple.spaceSlug,
      name: tuple.spaceName,
      isDefault: isDefaultSpace(tuple),
    },
    effectivePolicy,
    user: {
      id: tuple.userId,
      slug: tuple.userSlug,
      name: tuple.userName,
    },
  };
}
