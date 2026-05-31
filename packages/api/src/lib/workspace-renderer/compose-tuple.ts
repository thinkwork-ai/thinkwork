import { S3Client } from "@aws-sdk/client-s3";
import { shouldRenderWorkspaceSourcePath } from "../workspace-renderer.js";
import {
  agentWorkspacePrefix,
  spaceSourcePrefix,
  threadRuntimePrefix,
  userWorkspacePrefix,
} from "./prefixes.js";
import { composeWorkspacePolicy } from "./effective-policy-composer.js";
import { DrizzleWorkspaceTupleRepository } from "./repository.js";
import { S3WorkspaceRendererObjectStore } from "./s3-store.js";
import {
  assertSpaceAccessAllowed,
  type SpaceMembershipRepository,
} from "./space-membership-check.js";
import type {
  WorkspaceHydrateFile,
  WorkspaceHydrateManifest,
  WorkspaceHydrateOwner,
  WorkspaceHydrateSource,
  WorkspaceHydrateStatusMount,
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
const HYDRATE_MANIFEST_PATH = ".hydrate_manifest.json";

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
  owner: Exclude<WorkspaceHydrateOwner, "system">;
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
  owner: Exclude<WorkspaceHydrateOwner, "system">,
  shouldIncludePath: (relPath: string) => boolean = () => true,
): Promise<SourceSet> {
  const listed = await objectStore.listObjects({ bucket, prefix });
  return {
    owner,
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
  return (
    relPath === "SPACE.md" ||
    relPath.startsWith("docs/") ||
    relPath.startsWith("goals/") ||
    relPath.startsWith("knowledge/")
  );
}

function hydratePathForSource(object: SourceObject): string {
  return object.relPath;
}

function manifestFileForSource(
  source: SourceSet,
  object: SourceObject,
): WorkspaceHydrateFile {
  return {
    path: hydratePathForSource(object),
    owner: source.owner,
    sourceKey: object.key,
    sourcePrefix: source.prefix,
    sourcePath: object.relPath,
    lastModified: object.lastModified?.toISOString(),
    etag: object.etag,
    size: object.size,
    readOnly: false,
  };
}

function sortedManifestFiles(sources: SourceSet[]): WorkspaceHydrateFile[] {
  const filesByPath = new Map<string, WorkspaceHydrateFile>();
  for (const source of sources) {
    for (const object of source.objects) {
      const file = manifestFileForSource(source, object);
      filesByPath.set(file.path, file);
    }
  }
  return Array.from(filesByPath.values()).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function statusMountsForTuple(
  tuple: ResolvedWorkspaceRenderTuple,
): WorkspaceHydrateStatusMount[] {
  if (!tuple.threadId && !tuple.threadSlug) return [];
  return [
    {
      path: "GOAL.md",
      owner: "system",
      source: "database",
      provider: "thread-goals",
      readOnly: true,
      available: false,
    },
    {
      path: "PROGRESS.md",
      owner: "system",
      source: "database",
      provider: "thread-goals",
      readOnly: true,
      available: false,
    },
  ];
}

function buildHydrateManifest(input: {
  renderedPrefix: string;
  generatedAt: string;
  sources: SourceSet[];
  tuple: ResolvedWorkspaceRenderTuple;
}): WorkspaceHydrateManifest {
  const hydrateSources: WorkspaceHydrateSource[] = input.sources
    .filter((source) => source.prefix)
    .map((source) => ({
      owner: source.owner,
      prefix: source.prefix,
    }));
  return {
    version: 1,
    renderedPrefix: input.renderedPrefix,
    generatedAt: input.generatedAt,
    sources: hydrateSources,
    files: sortedManifestFiles(input.sources),
    statusMounts: statusMountsForTuple(input.tuple),
  };
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
  const renderedPrefix = threadRuntimePrefix(tuple);
  const manifestKey = `${renderedPrefix}${HYDRATE_MANIFEST_PATH}`;
  const markerKey = `${renderedPrefix}.rendered_at`;
  const agentPrefix = agentWorkspacePrefix(tuple);
  const spacePrefix = spaceSourcePrefix(tuple);
  const userFolderName = tuple.userSlug ?? tuple.userId;
  const userPrefix = userFolderName
    ? userWorkspacePrefix({
        tenantSlug: tuple.tenantSlug,
        userSlug: userFolderName,
      })
    : null;

  const [agentSource, spaceSource, userSource] = await Promise.all([
    listRenderableSource(
      objectStore,
      bucket,
      agentPrefix,
      "agent",
      shouldRenderAgentBaselinePath,
    ),
    listRenderableSource(
      objectStore,
      bucket,
      spacePrefix,
      "space",
      shouldRenderSpaceSourcePath,
    ),
    userPrefix
      ? listRenderableSource(objectStore, bucket, userPrefix, "user")
      : Promise.resolve({ owner: "user" as const, prefix: "", objects: [] }),
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
  const [marker, existingManifest] = await Promise.all([
    objectStore.getText({ bucket, key: markerKey }),
    objectStore.getText({ bucket, key: manifestKey }),
  ]);
  const sourceLatest = latestMtime([agentSource, spaceSource, userSource]);
  const cacheIsFresh =
    existingManifest !== null && markerIsFresh(marker, sourceLatest);
  const generatedAt = cacheIsFresh
    ? marker?.trim() || (deps.now?.() ?? new Date()).toISOString()
    : (deps.now?.() ?? new Date()).toISOString();
  const hydrateManifest = buildHydrateManifest({
    renderedPrefix,
    generatedAt,
    sources: [agentSource, spaceSource, userSource],
    tuple,
  });
  if (cacheIsFresh) {
    return {
      renderedPrefix,
      cacheStatus: "hit",
      sourcePrefixes,
      writtenFiles: [],
      hydrateManifest,
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

  const writtenFiles = [HYDRATE_MANIFEST_PATH];
  await objectStore.putText({
    bucket,
    key: manifestKey,
    content: `${JSON.stringify(hydrateManifest, null, 2)}\n`,
    contentType: "application/json",
  });
  await objectStore.putText({
    bucket,
    key: markerKey,
    content: generatedAt,
    contentType: "text/plain; charset=utf-8",
  });

  return {
    renderedPrefix,
    cacheStatus: "miss",
    sourcePrefixes,
    writtenFiles,
    hydrateManifest,
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
