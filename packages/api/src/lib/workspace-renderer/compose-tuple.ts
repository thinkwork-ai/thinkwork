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
  WorkspaceSpaceIndexEntry,
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

interface GeneratedWorkspaceFile {
  path: string;
  key: string;
  content: string;
  owner: Exclude<WorkspaceHydrateOwner, "system">;
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
  const sourcePath = runtimeSourcePath(relPath);
  return (
    sourcePath !== "effective-policy.json" &&
    sourcePath !== "TOOLS.md" &&
    sourcePath !== "MCP.md"
  );
}

const THREAD_GOAL_STATUS_FILES = [
  "THREAD.md",
  "GOAL.md",
  "PROGRESS.md",
  "TASKS.md",
] as const;
const THREAD_GOAL_STATUS_PATHS = new Set<string>(THREAD_GOAL_STATUS_FILES);
const THREAD_GOAL_NARRATIVE_PATHS = new Set([
  "DECISIONS.md",
  "ARTIFACTS.md",
  "HANDOFFS.md",
]);

function shouldRenderThreadGoalSourcePath(relPath: string): boolean {
  if (THREAD_GOAL_NARRATIVE_PATHS.has(relPath)) return true;
  if (/^stages\/[^/]+\/(?:CONTEXT|OUTPUT)\.md$/.test(relPath)) return true;
  return false;
}

function shouldRenderThreadGoalStatusPath(relPath: string): boolean {
  return THREAD_GOAL_STATUS_PATHS.has(relPath);
}

function runtimeFolderSegment(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "default";
  return trimmed.replace(/^\/+|\/+$/g, "").replaceAll("/", "-") || "default";
}

function runtimeSourcePath(relPath: string): string {
  if (relPath.startsWith("source/")) return relPath.slice("source/".length);
  return relPath.startsWith("workspace/")
    ? relPath.slice("workspace/".length)
    : relPath;
}

function hydratePathForSource(
  source: SourceSet,
  object: SourceObject,
  tuple: ResolvedWorkspaceRenderTuple,
): string {
  const sourcePath = runtimeSourcePath(object.relPath);
  switch (source.owner) {
    case "agent":
      return sourcePath;
    case "user":
      return `User/${sourcePath}`;
    case "space":
      return `Spaces/${runtimeFolderSegment(tuple.spaceSlug)}/${sourcePath}`;
    case "thread_goal":
      return `Thread/${sourcePath}`;
    case "thread_notes":
      return `Thread/${sourcePath}`;
  }
}

function manifestFileForSource(
  source: SourceSet,
  object: SourceObject,
  tuple: ResolvedWorkspaceRenderTuple,
): WorkspaceHydrateFile {
  return {
    path: hydratePathForSource(source, object, tuple),
    owner: source.owner,
    sourceKey: object.key,
    sourcePrefix: source.prefix,
    sourcePath: runtimeSourcePath(object.relPath),
    lastModified: object.lastModified?.toISOString(),
    etag: object.etag,
    size: object.size,
    readOnly: false,
  };
}

function sortedManifestFiles(
  sources: SourceSet[],
  tuple: ResolvedWorkspaceRenderTuple,
  generatedFiles: GeneratedWorkspaceFile[],
): WorkspaceHydrateFile[] {
  const filesByPath = new Map<string, WorkspaceHydrateFile>();
  for (const source of sources) {
    for (const object of source.objects) {
      const file = manifestFileForSource(source, object, tuple);
      filesByPath.set(file.path, file);
    }
  }
  for (const generatedFile of generatedFiles) {
    filesByPath.set(generatedFile.path, {
      path: generatedFile.path,
      owner: generatedFile.owner,
      sourceKey: generatedFile.key,
      sourcePrefix: generatedFile.key.slice(
        0,
        generatedFile.key.length - generatedFile.path.length,
      ),
      sourcePath: generatedFile.path,
      readOnly: true,
      generated: true,
      size: Buffer.byteLength(generatedFile.content),
    });
  }
  return Array.from(filesByPath.values()).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function statusMountsForTuple(input: {
  tuple: ResolvedWorkspaceRenderTuple;
  statusObjects: SourceObject[];
}): WorkspaceHydrateStatusMount[] {
  if (!input.tuple.threadId && !input.tuple.threadSlug) return [];
  const byPath = new Map(
    input.statusObjects.map((object) => [object.relPath, object]),
  );
  return THREAD_GOAL_STATUS_FILES.map((sourcePath) => {
    const object = byPath.get(sourcePath);
    const path = `Thread/${sourcePath}`;
    return {
      path,
      owner: "system",
      source: "database",
      provider: "thread-goals",
      readOnly: true,
      available: Boolean(object),
      ...(object
        ? {
            sourceKey: object.key,
            lastModified: object.lastModified?.toISOString(),
            etag: object.etag,
            size: object.size,
          }
        : {}),
    };
  });
}

function buildHydrateManifest(input: {
  renderedPrefix: string;
  generatedAt: string;
  sources: SourceSet[];
  statusObjects: SourceObject[];
  generatedFiles: GeneratedWorkspaceFile[];
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
    files: sortedManifestFiles(
      input.sources,
      input.tuple,
      input.generatedFiles,
    ),
    statusMounts: statusMountsForTuple({
      tuple: input.tuple,
      statusObjects: input.statusObjects,
    }),
  };
}

function existingManifestMatchesContract(
  existingManifest: string,
  expectedManifest: WorkspaceHydrateManifest,
): boolean {
  try {
    const parsed = JSON.parse(existingManifest) as WorkspaceHydrateManifest;
    if (parsed.version !== expectedManifest.version) return false;
    if (
      !Array.isArray(parsed.sources) ||
      !Array.isArray(parsed.files) ||
      !Array.isArray(parsed.statusMounts)
    ) {
      return false;
    }

    for (const source of expectedManifest.sources) {
      if (
        !parsed.sources.some(
          (candidate) =>
            candidate.owner === source.owner &&
            candidate.prefix === source.prefix,
        )
      ) {
        return false;
      }
    }

    for (const mount of expectedManifest.statusMounts) {
      const candidate = parsed.statusMounts.find(
        (statusMount) => statusMount.path === mount.path,
      );
      if (
        !candidate ||
        candidate.owner !== "system" ||
        candidate.source !== "database" ||
        candidate.provider !== "thread-goals" ||
        candidate.readOnly !== true
      ) {
        return false;
      }
    }

    for (const file of expectedManifest.files) {
      const candidate = parsed.files.find(
        (manifestFile) => manifestFile.path === file.path,
      );
      if (
        !candidate ||
        candidate.owner !== file.owner ||
        candidate.sourceKey !== file.sourceKey ||
        candidate.sourcePath !== file.sourcePath ||
        candidate.readOnly !== file.readOnly ||
        Boolean(candidate.generated) !== Boolean(file.generated)
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

function fallbackAuthorizedSpaces(
  tuple: ResolvedWorkspaceRenderTuple,
): WorkspaceSpaceIndexEntry[] {
  return [
    {
      id: tuple.spaceId,
      slug: tuple.spaceSlug,
      name: tuple.spaceName,
      accessMode: tuple.spaceAccessMode,
      isActive: true,
    },
  ];
}

function renderSpaceIndexMarkdown(input: {
  tuple: ResolvedWorkspaceRenderTuple;
  spaces: WorkspaceSpaceIndexEntry[];
}): string {
  const normalizedSpaces = input.spaces.length
    ? input.spaces
    : fallbackAuthorizedSpaces(input.tuple);
  const active =
    normalizedSpaces.find((space) => space.isActive) ??
    fallbackAuthorizedSpaces(input.tuple)[0];
  const lines = [
    "# Spaces",
    "",
    `Active Space: ${active.name} (${active.slug})`,
    "",
    "Only the active Space is fully hydrated in this workspace. Other authorized Spaces are listed here for routing context.",
    "",
    "## Authorized Spaces",
    "",
  ];
  for (const space of normalizedSpaces) {
    const marker = space.isActive ? "active" : space.accessMode;
    lines.push(`- ${space.name} (${space.slug}) - ${marker}`);
  }
  lines.push("");
  return `${lines.join("\n")}`;
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
  const spaceIndexKey = `${renderedPrefix}Spaces/INDEX.md`;
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

  const [
    agentSource,
    spaceSource,
    userSource,
    threadGoalSource,
    threadGoalStatusSource,
  ] = await Promise.all([
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
    listRenderableSource(
      objectStore,
      bucket,
      renderedPrefix,
      "thread_goal",
      shouldRenderThreadGoalSourcePath,
    ),
    listRenderableSource(
      objectStore,
      bucket,
      renderedPrefix,
      "thread_goal",
      shouldRenderThreadGoalStatusPath,
    ),
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

  const sourcePrefixes = [
    agentPrefix,
    spacePrefix,
    userPrefix,
    renderedPrefix,
  ].filter((prefix): prefix is string => Boolean(prefix));
  const effectivePolicy = composeWorkspacePolicy({
    agentBlockedTools: input.agentBlockedTools,
    agentAllowedTools: input.agentAllowedTools,
  });
  const [authorizedSpaces, marker, existingManifest, existingSpaceIndex] =
    await Promise.all([
      repository.listAuthorizedSpaces?.(tuple) ??
        Promise.resolve(fallbackAuthorizedSpaces(tuple)),
      objectStore.getText({ bucket, key: markerKey }),
      objectStore.getText({ bucket, key: manifestKey }),
      objectStore.getText({ bucket, key: spaceIndexKey }),
    ]);
  const spaceIndex = renderSpaceIndexMarkdown({
    tuple,
    spaces: authorizedSpaces,
  });
  const generatedFiles: GeneratedWorkspaceFile[] = [
    {
      path: "Spaces/INDEX.md",
      key: spaceIndexKey,
      content: spaceIndex,
      owner: "thread_goal",
    },
  ];
  const sourceLatest = latestMtime([
    agentSource,
    spaceSource,
    userSource,
    threadGoalSource,
    threadGoalStatusSource,
  ]);
  const markerFresh = markerIsFresh(marker, sourceLatest);
  const generatedAtCandidate =
    markerFresh && marker?.trim()
      ? marker.trim()
      : (deps.now?.() ?? new Date()).toISOString();
  const hydrateManifest = buildHydrateManifest({
    renderedPrefix,
    generatedAt: generatedAtCandidate,
    sources: [agentSource, spaceSource, userSource, threadGoalSource],
    statusObjects: threadGoalStatusSource.objects,
    generatedFiles,
    tuple,
  });
  const cacheIsFresh =
    existingManifest !== null &&
    existingSpaceIndex === spaceIndex &&
    markerFresh &&
    existingManifestMatchesContract(existingManifest, hydrateManifest);
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

  const generatedAt = (deps.now?.() ?? new Date()).toISOString();
  const nextHydrateManifest =
    hydrateManifest.generatedAt === generatedAt
      ? hydrateManifest
      : buildHydrateManifest({
          renderedPrefix,
          generatedAt,
          sources: [agentSource, spaceSource, userSource, threadGoalSource],
          statusObjects: threadGoalStatusSource.objects,
          generatedFiles,
          tuple,
        });
  const writtenFiles = ["Spaces/INDEX.md", HYDRATE_MANIFEST_PATH];
  await objectStore.putText({
    bucket,
    key: spaceIndexKey,
    content: spaceIndex,
    contentType: "text/markdown; charset=utf-8",
  });
  await objectStore.putText({
    bucket,
    key: manifestKey,
    content: `${JSON.stringify(nextHydrateManifest, null, 2)}\n`,
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
    hydrateManifest: nextHydrateManifest,
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
