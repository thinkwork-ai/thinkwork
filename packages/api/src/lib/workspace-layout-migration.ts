import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  goals,
  spaces,
  tenants,
  threads,
  users,
} from "@thinkwork/database-pg/schema";
import {
  normalizeWorkspaceFolderName,
  workspaceFolderName,
} from "@thinkwork/database-pg/utils/workspace-folder-name";
import { renderWorkspaceTuple } from "./workspace-renderer/compose-tuple.js";

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const DEFAULT_BATCH_SIZE = 25;

export interface TenantRow {
  id: string;
  slug: string;
}

export interface EntityFolderRow {
  id: string;
  tenantId: string;
  displayName: string;
  fallbackName: string;
  workspaceFolderName: string | null;
}

export interface ThreadFolderRow extends EntityFolderRow {
  agentId: string | null;
  spaceId: string;
  userId: string | null;
}

export interface GoalFolderRow extends EntityFolderRow {
  threadId: string;
  folderS3Prefix: string;
}

export interface WorkspaceLayoutTenantSnapshot {
  tenant: TenantRow;
  agents: EntityFolderRow[];
  spaces: EntityFolderRow[];
  users: EntityFolderRow[];
  threads: ThreadFolderRow[];
  goals: GoalFolderRow[];
}

export interface FolderAssignment {
  table: "agents" | "spaces" | "users" | "threads" | "goals";
  id: string;
  previous: string | null;
  next: string;
}

export interface GoalPrefixAssignment {
  id: string;
  previous: string;
  next: string;
}

export interface PlannedCopy {
  sourcePrefix: string;
  destinationPrefix: string;
  sourceKey: string;
  destinationKey: string;
}

export interface PlannedDeletePrefix {
  prefix: string;
  reason: "legacy-source" | "retired-rendered";
  keys: string[];
}

export interface PlannedRender {
  tenantId: string;
  agentId: string;
  spaceId: string;
  threadId: string;
  userId: string | null;
  renderedPrefix: string;
}

export interface WorkspaceLayoutTenantPlan {
  tenant: TenantRow;
  status: "dry-run" | "apply" | "noop" | "conflict" | "error";
  folderAssignments: FolderAssignment[];
  goalPrefixAssignments: GoalPrefixAssignment[];
  plannedCopies: PlannedCopy[];
  deletePrefixes: PlannedDeletePrefix[];
  plannedRenders: PlannedRender[];
  conflicts: string[];
  errors: string[];
}

export interface WorkspaceLayoutMigrationSummary {
  tenants: number;
  noop: number;
  conflicts: number;
  errors: number;
  folderAssignments: number;
  goalPrefixAssignments: number;
  plannedCopies: number;
  deletedKeys: number;
  renderedThreads: number;
}

export interface WorkspaceLayoutMigrationResult {
  mode: "dry-run" | "apply";
  bucket: string;
  summary: WorkspaceLayoutMigrationSummary;
  tenants: WorkspaceLayoutTenantPlan[];
}

export interface WorkspaceLayoutMigrationOptions {
  mode?: "dry-run" | "apply";
  bucket?: string;
  tenantId?: string;
  batchSize?: number;
  deleteLegacySources?: boolean;
}

export interface ListedObject {
  key: string;
  etag?: string;
  size?: number;
}

export interface WorkspaceLayoutObjectStore {
  listObjects(input: {
    bucket: string;
    prefix: string;
  }): Promise<ListedObject[]>;
  copyObject(input: {
    bucket: string;
    sourceKey: string;
    destinationKey: string;
  }): Promise<void>;
  deleteObjects(input: { bucket: string; keys: string[] }): Promise<void>;
}

export interface WorkspaceLayoutRepository {
  snapshots(input: {
    tenantId?: string;
  }): Promise<WorkspaceLayoutTenantSnapshot[]>;
  applyFolderAssignments(input: {
    assignments: FolderAssignment[];
    goalPrefixAssignments: GoalPrefixAssignment[];
  }): Promise<void>;
}

export interface WorkspaceLayoutRenderer {
  render(input: {
    bucket: string;
    tenantId: string;
    agentId: string;
    spaceId: string;
    threadId: string;
    userId: string | null;
  }): Promise<void>;
}

export interface WorkspaceLayoutMigrationDeps {
  objectStore?: WorkspaceLayoutObjectStore;
  repository?: WorkspaceLayoutRepository;
  renderer?: WorkspaceLayoutRenderer;
}

interface EntityWithFolder<T extends EntityFolderRow> {
  row: T;
  folder: string;
}

class S3WorkspaceLayoutObjectStore implements WorkspaceLayoutObjectStore {
  constructor(private readonly client: Pick<S3Client, "send">) {}

  async listObjects(input: {
    bucket: string;
    prefix: string;
  }): Promise<ListedObject[]> {
    const objects: ListedObject[] = [];
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: input.bucket,
          Prefix: input.prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of page.Contents ?? []) {
        if (!object.Key) continue;
        objects.push({
          key: object.Key,
          etag: object.ETag,
          size: object.Size,
        });
      }
      continuationToken = page.IsTruncated
        ? page.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return objects;
  }

  async copyObject(input: {
    bucket: string;
    sourceKey: string;
    destinationKey: string;
  }): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: input.bucket,
        CopySource: `${input.bucket}/${encodeS3CopySourceKey(input.sourceKey)}`,
        Key: input.destinationKey,
      }),
    );
  }

  async deleteObjects(input: {
    bucket: string;
    keys: string[];
  }): Promise<void> {
    for (let offset = 0; offset < input.keys.length; offset += 1000) {
      const batch = input.keys.slice(offset, offset + 1000);
      if (batch.length === 0) continue;
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: input.bucket,
          Delete: {
            Objects: batch.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    }
  }
}

class DrizzleWorkspaceLayoutRepository implements WorkspaceLayoutRepository {
  private readonly db = getDb();

  async snapshots(input: {
    tenantId?: string;
  }): Promise<WorkspaceLayoutTenantSnapshot[]> {
    const tenantRows = await this.db
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(input.tenantId ? eq(tenants.id, input.tenantId) : undefined);

    const out: WorkspaceLayoutTenantSnapshot[] = [];
    for (const tenant of tenantRows) {
      const [agentRows, spaceRows, userRows, threadRows, goalRows] =
        await Promise.all([
          this.db
            .select({
              id: agents.id,
              tenantId: agents.tenant_id,
              displayName: agents.name,
              fallbackName: agents.slug,
              workspaceFolderName: agents.workspace_folder_name,
            })
            .from(agents)
            .where(and(eq(agents.tenant_id, tenant.id))),
          this.db
            .select({
              id: spaces.id,
              tenantId: spaces.tenant_id,
              displayName: spaces.name,
              fallbackName: spaces.slug,
              workspaceFolderName: spaces.workspace_folder_name,
            })
            .from(spaces)
            .where(and(eq(spaces.tenant_id, tenant.id))),
          this.db
            .select({
              id: users.id,
              tenantId: users.tenant_id,
              displayName: users.name,
              fallbackName: users.email,
              workspaceFolderName: users.workspace_folder_name,
            })
            .from(users)
            .where(and(eq(users.tenant_id, tenant.id))),
          this.db
            .select({
              id: threads.id,
              tenantId: threads.tenant_id,
              displayName: threads.title,
              fallbackName: threads.id,
              workspaceFolderName: threads.workspace_folder_name,
              agentId: threads.agent_id,
              spaceId: threads.space_id,
              userId: threads.user_id,
            })
            .from(threads)
            .where(and(eq(threads.tenant_id, tenant.id))),
          this.db
            .select({
              id: goals.id,
              tenantId: goals.tenant_id,
              displayName: goals.outcome,
              fallbackName: goals.id,
              workspaceFolderName: goals.workspace_folder_name,
              threadId: goals.thread_id,
              folderS3Prefix: goals.folder_s3_prefix,
            })
            .from(goals)
            .where(and(eq(goals.tenant_id, tenant.id))),
        ]);

      out.push({
        tenant,
        agents: agentRows.map((row) => ({
          ...row,
          fallbackName: row.fallbackName ?? row.id,
        })),
        spaces: spaceRows,
        users: userRows
          .filter((row) => row.tenantId === tenant.id)
          .map((row) => ({
            ...row,
            tenantId: tenant.id,
            displayName: row.displayName ?? row.fallbackName ?? "User",
            fallbackName: userFallbackName(row.fallbackName, row.displayName),
          })),
        threads: threadRows,
        goals: goalRows,
      });
    }
    return out;
  }

  async applyFolderAssignments(input: {
    assignments: FolderAssignment[];
    goalPrefixAssignments: GoalPrefixAssignment[];
  }): Promise<void> {
    if (
      input.assignments.length === 0 &&
      input.goalPrefixAssignments.length === 0
    ) {
      return;
    }
    await this.db.transaction(async (tx) => {
      for (const assignment of input.assignments) {
        if (assignment.table === "agents") {
          await tx
            .update(agents)
            .set({ workspace_folder_name: assignment.next })
            .where(eq(agents.id, assignment.id));
        } else if (assignment.table === "spaces") {
          await tx
            .update(spaces)
            .set({ workspace_folder_name: assignment.next })
            .where(eq(spaces.id, assignment.id));
        } else if (assignment.table === "users") {
          await tx
            .update(users)
            .set({ workspace_folder_name: assignment.next })
            .where(eq(users.id, assignment.id));
        } else if (assignment.table === "threads") {
          await tx
            .update(threads)
            .set({ workspace_folder_name: assignment.next })
            .where(eq(threads.id, assignment.id));
        } else {
          const prefixAssignment = input.goalPrefixAssignments.find(
            (candidate) => candidate.id === assignment.id,
          );
          await tx
            .update(goals)
            .set({
              workspace_folder_name: assignment.next,
              ...(prefixAssignment
                ? { folder_s3_prefix: prefixAssignment.next }
                : {}),
            })
            .where(eq(goals.id, assignment.id));
        }
      }

      const goalOnlyPrefixAssignments = input.goalPrefixAssignments.filter(
        (prefixAssignment) =>
          !input.assignments.some(
            (assignment) =>
              assignment.table === "goals" &&
              assignment.id === prefixAssignment.id,
          ),
      );
      for (const prefixAssignment of goalOnlyPrefixAssignments) {
        await tx
          .update(goals)
          .set({ folder_s3_prefix: prefixAssignment.next })
          .where(eq(goals.id, prefixAssignment.id));
      }
    });
  }
}

class DefaultWorkspaceLayoutRenderer implements WorkspaceLayoutRenderer {
  async render(input: {
    bucket: string;
    tenantId: string;
    agentId: string;
    spaceId: string;
    threadId: string;
    userId: string | null;
  }): Promise<void> {
    await renderWorkspaceTuple(
      {
        tenantId: input.tenantId,
        agentId: input.agentId,
        spaceId: input.spaceId,
        threadId: input.threadId,
        userId: input.userId,
        invokingServiceIdentity: "workspace-layout-migration",
      },
      { bucket: input.bucket },
    );
  }
}

function userFallbackName(email: string | null, name: string | null): string {
  return email?.split("@")[0] || name || "user";
}

function keyById<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

function assignFolders<T extends EntityFolderRow>(
  table: FolderAssignment["table"],
  rows: T[],
  fallback: string,
): {
  assignments: FolderAssignment[];
  resolved: Array<EntityWithFolder<T>>;
} {
  const occupied = new Set(
    rows
      .map((row) => row.workspaceFolderName)
      .filter((value): value is string => Boolean(value))
      .map((value) => normalizeWorkspaceFolderName(value, fallback)),
  );
  const assignments: FolderAssignment[] = [];
  const resolved: Array<EntityWithFolder<T>> = [];

  for (const row of rows) {
    if (row.workspaceFolderName) {
      const folder = normalizeWorkspaceFolderName(
        row.workspaceFolderName,
        fallback,
      );
      occupied.add(folder);
      resolved.push({ row, folder });
      continue;
    }
    const folder = workspaceFolderName(
      row.displayName || row.fallbackName,
      occupied,
      fallback,
    );
    occupied.add(folder);
    assignments.push({
      table,
      id: row.id,
      previous: null,
      next: folder,
    });
    resolved.push({ row, folder });
  }

  return { assignments, resolved };
}

function prefix(segments: string[]): string {
  return `${segments.map((segment) => segment.replace(/^\/+|\/+$/g, "")).join("/")}/`;
}

export function encodeS3CopySourceKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function agentSourcePrefix(tenantSlug: string, agentFolder: string): string {
  return prefix(["tenants", tenantSlug, "agents", agentFolder]);
}

function legacyAgentWorkspacePrefix(
  tenantSlug: string,
  agentSlug: string,
): string {
  return prefix(["tenants", tenantSlug, "agents", agentSlug, "workspace"]);
}

function legacyAgentArchivesPrefix(
  tenantSlug: string,
  agentSlug: string,
): string {
  return prefix([
    "tenants",
    tenantSlug,
    "agents",
    agentSlug,
    "workspace-archives",
  ]);
}

function spaceSourcePrefix(tenantSlug: string, spaceFolder: string): string {
  return prefix(["tenants", tenantSlug, "spaces", spaceFolder]);
}

function userSourcePrefix(tenantSlug: string, userFolder: string): string {
  return prefix(["tenants", tenantSlug, "users", userFolder]);
}

function threadRuntimePrefix(tenantSlug: string, threadFolder: string): string {
  return prefix(["tenants", tenantSlug, "threads", threadFolder]);
}

function renderedPrefix(tenantSlug: string): string {
  return prefix(["tenants", tenantSlug, "rendered"]);
}

function sameObject(left: ListedObject, right: ListedObject): boolean {
  if (left.etag || right.etag) {
    return Boolean(left.etag && right.etag && left.etag === right.etag);
  }
  if (left.size !== undefined && right.size !== undefined) {
    return left.size === right.size;
  }
  return false;
}

async function planPrefixMove(input: {
  bucket: string;
  objectStore: WorkspaceLayoutObjectStore;
  sourcePrefix: string;
  destinationPrefix: string;
  deleteLegacySources: boolean;
  reason: "legacy-source";
  mapRelativePath?: (relativePath: string) => string | null;
}): Promise<{
  copies: PlannedCopy[];
  deletes: PlannedDeletePrefix[];
  conflicts: string[];
}> {
  if (
    input.sourcePrefix === input.destinationPrefix &&
    !input.mapRelativePath
  ) {
    return { copies: [], deletes: [], conflicts: [] };
  }

  const [sourceObjects, destinationObjects] = await Promise.all([
    input.objectStore.listObjects({
      bucket: input.bucket,
      prefix: input.sourcePrefix,
    }),
    input.objectStore.listObjects({
      bucket: input.bucket,
      prefix: input.destinationPrefix,
    }),
  ]);
  if (sourceObjects.length === 0) {
    return { copies: [], deletes: [], conflicts: [] };
  }

  const destinationByKey = new Map(
    destinationObjects.map((object) => [object.key, object]),
  );
  const copies: PlannedCopy[] = [];
  const conflicts: string[] = [];
  const legacyKeysToDelete: string[] = [];
  for (const sourceObject of sourceObjects) {
    const relativePath = sourceObject.key.slice(input.sourcePrefix.length);
    const mappedPath = input.mapRelativePath
      ? input.mapRelativePath(relativePath)
      : relativePath;
    if (!mappedPath) continue;
    const destinationKey = `${input.destinationPrefix}${mappedPath}`;
    if (sourceObject.key === destinationKey) continue;
    legacyKeysToDelete.push(sourceObject.key);
    const destinationObject = destinationByKey.get(destinationKey);
    if (destinationObject) {
      if (!sameObject(sourceObject, destinationObject)) {
        conflicts.push(
          `${sourceObject.key} -> ${destinationKey} already exists with different metadata`,
        );
      }
      continue;
    }
    copies.push({
      sourcePrefix: input.sourcePrefix,
      destinationPrefix: input.destinationPrefix,
      sourceKey: sourceObject.key,
      destinationKey,
    });
  }

  return {
    copies,
    conflicts,
    deletes:
      input.deleteLegacySources && conflicts.length === 0
        ? [
            {
              prefix: input.sourcePrefix,
              reason: input.reason,
              keys: legacyKeysToDelete,
            },
          ]
        : [],
  };
}

async function planDeletePrefix(input: {
  bucket: string;
  objectStore: WorkspaceLayoutObjectStore;
  prefix: string;
  reason: "legacy-source";
}): Promise<PlannedDeletePrefix[]> {
  const objects = await input.objectStore.listObjects({
    bucket: input.bucket,
    prefix: input.prefix,
  });
  return objects.length > 0
    ? [
        {
          prefix: input.prefix,
          reason: input.reason,
          keys: objects.map((object) => object.key),
        },
      ]
    : [];
}

function legacySpaceRelativePath(relativePath: string): string | null {
  if (!relativePath) return null;
  if (relativePath === "source") return null;
  if (relativePath.startsWith("source/")) {
    return relativePath.slice("source/".length);
  }
  return relativePath;
}

function legacyRenderedUserRelativePath(relativePath: string): string | null {
  if (relativePath === "USER.md" || relativePath.startsWith("memory/")) {
    return relativePath;
  }
  return null;
}

async function planRenderedDelete(input: {
  bucket: string;
  objectStore: WorkspaceLayoutObjectStore;
  tenantSlug: string;
}): Promise<PlannedDeletePrefix[]> {
  const prefixToDelete = renderedPrefix(input.tenantSlug);
  const keys = await input.objectStore.listObjects({
    bucket: input.bucket,
    prefix: prefixToDelete,
  });
  return keys.length > 0
    ? [
        {
          prefix: prefixToDelete,
          reason: "retired-rendered",
          keys: keys.map((object) => object.key),
        },
      ]
    : [];
}

export async function planWorkspaceLayoutTenant(input: {
  bucket: string;
  snapshot: WorkspaceLayoutTenantSnapshot;
  objectStore: WorkspaceLayoutObjectStore;
  deleteLegacySources: boolean;
}): Promise<WorkspaceLayoutTenantPlan> {
  const tenantSlug = input.snapshot.tenant.slug;
  const agentFolders = assignFolders("agents", input.snapshot.agents, "agent");
  const spaceFolders = assignFolders("spaces", input.snapshot.spaces, "space");
  const userFolders = assignFolders("users", input.snapshot.users, "user");
  const threadFolders = assignFolders(
    "threads",
    input.snapshot.threads,
    "thread",
  );
  const goalFolders = assignFolders("goals", input.snapshot.goals, "goal");
  const threadsById = keyById(
    threadFolders.resolved.map((item) => ({
      ...item.row,
      workspaceFolderName: item.folder,
    })),
  );

  const folderAssignments = [
    ...agentFolders.assignments,
    ...spaceFolders.assignments,
    ...userFolders.assignments,
    ...threadFolders.assignments,
    ...goalFolders.assignments,
  ];
  const goalPrefixAssignments: GoalPrefixAssignment[] = [];
  for (const goal of goalFolders.resolved) {
    const thread = threadsById.get(goal.row.threadId);
    if (!thread?.workspaceFolderName) continue;
    const next = threadRuntimePrefix(tenantSlug, thread.workspaceFolderName);
    if (goal.row.folderS3Prefix !== next) {
      goalPrefixAssignments.push({
        id: goal.row.id,
        previous: goal.row.folderS3Prefix,
        next,
      });
    }
  }

  const prefixPlans = [];
  const deletePlans = [];
  for (const agent of agentFolders.resolved) {
    if (!agent.row.fallbackName) continue;
    prefixPlans.push(
      planPrefixMove({
        bucket: input.bucket,
        objectStore: input.objectStore,
        sourcePrefix: legacyAgentWorkspacePrefix(
          tenantSlug,
          agent.row.fallbackName,
        ),
        destinationPrefix: agentSourcePrefix(tenantSlug, agent.folder),
        deleteLegacySources: input.deleteLegacySources,
        reason: "legacy-source",
      }),
    );
    if (input.deleteLegacySources) {
      deletePlans.push(
        planDeletePrefix({
          bucket: input.bucket,
          objectStore: input.objectStore,
          prefix: legacyAgentArchivesPrefix(tenantSlug, agent.row.fallbackName),
          reason: "legacy-source",
        }),
      );
      if (agent.folder !== agent.row.fallbackName) {
        deletePlans.push(
          planDeletePrefix({
            bucket: input.bucket,
            objectStore: input.objectStore,
            prefix: legacyAgentArchivesPrefix(tenantSlug, agent.folder),
            reason: "legacy-source",
          }),
        );
      }
    }
  }
  for (const space of spaceFolders.resolved) {
    prefixPlans.push(
      planPrefixMove({
        bucket: input.bucket,
        objectStore: input.objectStore,
        sourcePrefix: spaceSourcePrefix(tenantSlug, space.row.fallbackName),
        destinationPrefix: spaceSourcePrefix(tenantSlug, space.folder),
        deleteLegacySources: input.deleteLegacySources,
        reason: "legacy-source",
        mapRelativePath: legacySpaceRelativePath,
      }),
    );
  }
  for (const user of userFolders.resolved) {
    const oldUserFolder = normalizeWorkspaceFolderName(
      user.row.fallbackName,
      "user",
    );
    prefixPlans.push(
      planPrefixMove({
        bucket: input.bucket,
        objectStore: input.objectStore,
        sourcePrefix: userSourcePrefix(tenantSlug, oldUserFolder),
        destinationPrefix: userSourcePrefix(tenantSlug, user.folder),
        deleteLegacySources: input.deleteLegacySources,
        reason: "legacy-source",
      }),
    );
    prefixPlans.push(
      planPrefixMove({
        bucket: input.bucket,
        objectStore: input.objectStore,
        sourcePrefix: userSourcePrefix(user.row.tenantId, user.row.id),
        destinationPrefix: userSourcePrefix(tenantSlug, user.folder),
        deleteLegacySources: input.deleteLegacySources,
        reason: "legacy-source",
      }),
    );
    prefixPlans.push(
      planPrefixMove({
        bucket: input.bucket,
        objectStore: input.objectStore,
        sourcePrefix: userSourcePrefix(tenantSlug, user.row.id),
        destinationPrefix: userSourcePrefix(tenantSlug, user.folder),
        deleteLegacySources: input.deleteLegacySources,
        reason: "legacy-source",
      }),
    );
  }
  const renderedUserPrefixPlans = [];
  for (const agent of agentFolders.resolved) {
    const agentFolderCandidates = new Set([
      agent.folder,
      agent.row.fallbackName,
    ]);
    for (const space of spaceFolders.resolved) {
      const spaceFolderCandidates = new Set([
        space.folder,
        space.row.fallbackName,
      ]);
      for (const user of userFolders.resolved) {
        const userFolderCandidates = new Set([
          user.folder,
          normalizeWorkspaceFolderName(user.row.fallbackName, "user"),
          normalizeWorkspaceFolderName(user.row.displayName, "user"),
          user.row.id,
        ]);
        for (const agentFolder of agentFolderCandidates) {
          for (const spaceFolder of spaceFolderCandidates) {
            for (const userFolder of userFolderCandidates) {
              renderedUserPrefixPlans.push(
                planPrefixMove({
                  bucket: input.bucket,
                  objectStore: input.objectStore,
                  sourcePrefix: prefix([
                    "tenants",
                    tenantSlug,
                    "rendered",
                    agentFolder,
                    spaceFolder,
                    userFolder,
                  ]),
                  destinationPrefix: userSourcePrefix(tenantSlug, user.folder),
                  deleteLegacySources: false,
                  reason: "legacy-source",
                  mapRelativePath: legacyRenderedUserRelativePath,
                }),
              );
            }
          }
        }
      }
    }
  }
  for (const thread of threadFolders.resolved) {
    prefixPlans.push(
      planPrefixMove({
        bucket: input.bucket,
        objectStore: input.objectStore,
        sourcePrefix: threadRuntimePrefix(tenantSlug, thread.row.fallbackName),
        destinationPrefix: threadRuntimePrefix(tenantSlug, thread.folder),
        deleteLegacySources: input.deleteLegacySources,
        reason: "legacy-source",
      }),
    );
  }

  const [legacyPrefixResults, renderedUserPrefixResults, deleteResults] =
    await Promise.all([
      Promise.all(prefixPlans),
      Promise.all(renderedUserPrefixPlans),
      Promise.all(deletePlans),
    ]);
  const legacyPlannedDestinations = new Set(
    legacyPrefixResults.flatMap((result) =>
      result.copies.map((copy) => copy.destinationKey),
    ),
  );
  const renderedUserResults = renderedUserPrefixResults.map((result) => ({
    ...result,
    copies: result.copies.filter(
      (copy) => !legacyPlannedDestinations.has(copy.destinationKey),
    ),
  }));
  const prefixResults = [...legacyPrefixResults, ...renderedUserResults];
  const renderedDeletes = await planRenderedDelete({
    bucket: input.bucket,
    objectStore: input.objectStore,
    tenantSlug,
  });
  const plannedCopies = prefixResults.flatMap((result) => result.copies);
  const deletePrefixes = [
    ...prefixResults.flatMap((result) => result.deletes),
    ...deleteResults.flat(),
    ...renderedDeletes,
  ];
  const conflicts = prefixResults.flatMap((result) => result.conflicts);
  const tenantHasLayoutChanges =
    folderAssignments.length > 0 ||
    goalPrefixAssignments.length > 0 ||
    plannedCopies.length > 0 ||
    deletePrefixes.some((deletePrefix) => deletePrefix.keys.length > 0);
  const threadManifestChecks = await Promise.all(
    threadFolders.resolved.map(async (thread) => {
      const threadPrefix = threadRuntimePrefix(tenantSlug, thread.folder);
      const objects = await input.objectStore.listObjects({
        bucket: input.bucket,
        prefix: threadPrefix,
      });
      return {
        thread,
        threadPrefix,
        hasHydrateManifest: objects.some(
          (object) => object.key === `${threadPrefix}.hydrate_manifest.json`,
        ),
      };
    }),
  );
  const plannedRenders = threadManifestChecks
    .filter(
      ({ thread, hasHydrateManifest }) =>
        thread.row.agentId && (tenantHasLayoutChanges || !hasHydrateManifest),
    )
    .map(({ thread, threadPrefix }) => ({
      tenantId: input.snapshot.tenant.id,
      agentId: thread.row.agentId as string,
      spaceId: thread.row.spaceId,
      threadId: thread.row.id,
      userId: thread.row.userId,
      renderedPrefix: threadPrefix,
    }));

  const hasWork = tenantHasLayoutChanges || plannedRenders.length > 0;

  return {
    tenant: input.snapshot.tenant,
    status: conflicts.length > 0 ? "conflict" : hasWork ? "dry-run" : "noop",
    folderAssignments,
    goalPrefixAssignments,
    plannedCopies,
    deletePrefixes,
    plannedRenders,
    conflicts,
    errors: [],
  };
}

async function applyTenantPlan(input: {
  plan: WorkspaceLayoutTenantPlan;
  bucket: string;
  objectStore: WorkspaceLayoutObjectStore;
  repository: WorkspaceLayoutRepository;
  renderer: WorkspaceLayoutRenderer;
  batchSize: number;
}): Promise<WorkspaceLayoutTenantPlan> {
  if (input.plan.conflicts.length > 0) {
    return { ...input.plan, status: "conflict" };
  }

  const errors: string[] = [];
  try {
    for (const copy of input.plan.plannedCopies) {
      await input.objectStore.copyObject({
        bucket: input.bucket,
        sourceKey: copy.sourceKey,
        destinationKey: copy.destinationKey,
      });
    }

    await input.repository.applyFolderAssignments({
      assignments: input.plan.folderAssignments,
      goalPrefixAssignments: input.plan.goalPrefixAssignments,
    });

    for (
      let offset = 0;
      offset < input.plan.plannedRenders.length;
      offset += input.batchSize
    ) {
      const batch = input.plan.plannedRenders.slice(
        offset,
        offset + input.batchSize,
      );
      await Promise.all(
        batch.map((render) =>
          input.renderer.render({
            bucket: input.bucket,
            tenantId: render.tenantId,
            agentId: render.agentId,
            spaceId: render.spaceId,
            threadId: render.threadId,
            userId: render.userId,
          }),
        ),
      );
    }

    for (const deletePrefix of input.plan.deletePrefixes) {
      await input.objectStore.deleteObjects({
        bucket: input.bucket,
        keys: deletePrefix.keys,
      });
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return {
    ...input.plan,
    status: errors.length > 0 ? "error" : "apply",
    errors,
  };
}

export async function runWorkspaceLayoutMigration(
  options: WorkspaceLayoutMigrationOptions = {},
  deps: WorkspaceLayoutMigrationDeps = {},
): Promise<WorkspaceLayoutMigrationResult> {
  const bucket = options.bucket ?? process.env.WORKSPACE_BUCKET ?? "";
  if (!bucket) {
    throw new Error("WORKSPACE_BUCKET is required");
  }
  const mode = options.mode ?? "dry-run";
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("--batch-size must be a positive integer");
  }
  const objectStore =
    deps.objectStore ??
    new S3WorkspaceLayoutObjectStore(new S3Client({ region: REGION }));
  const repository = deps.repository ?? new DrizzleWorkspaceLayoutRepository();
  const renderer = deps.renderer ?? new DefaultWorkspaceLayoutRenderer();
  const deleteLegacySources = options.deleteLegacySources ?? false;

  const snapshots = await repository.snapshots({ tenantId: options.tenantId });
  const planned = await Promise.all(
    snapshots.map((snapshot) =>
      planWorkspaceLayoutTenant({
        bucket,
        snapshot,
        objectStore,
        deleteLegacySources,
      }),
    ),
  );
  const tenantsOut: WorkspaceLayoutTenantPlan[] = [];
  if (mode === "apply") {
    for (const plan of planned) {
      tenantsOut.push(
        await applyTenantPlan({
          plan,
          bucket,
          objectStore,
          repository,
          renderer,
          batchSize,
        }),
      );
    }
  } else {
    tenantsOut.push(...planned);
  }
  if (mode === "apply") {
    for (const plan of tenantsOut) {
      if (plan.status === "dry-run") plan.status = "apply";
    }
  }

  return {
    mode,
    bucket,
    summary: summarize(tenantsOut),
    tenants: tenantsOut,
  };
}

function summarize(
  tenantPlans: WorkspaceLayoutTenantPlan[],
): WorkspaceLayoutMigrationSummary {
  return {
    tenants: tenantPlans.length,
    noop: tenantPlans.filter((tenant) => tenant.status === "noop").length,
    conflicts: tenantPlans.filter((tenant) => tenant.status === "conflict")
      .length,
    errors: tenantPlans.filter((tenant) => tenant.status === "error").length,
    folderAssignments: tenantPlans.reduce(
      (sum, tenant) => sum + tenant.folderAssignments.length,
      0,
    ),
    goalPrefixAssignments: tenantPlans.reduce(
      (sum, tenant) => sum + tenant.goalPrefixAssignments.length,
      0,
    ),
    plannedCopies: tenantPlans.reduce(
      (sum, tenant) => sum + tenant.plannedCopies.length,
      0,
    ),
    deletedKeys: tenantPlans.reduce(
      (sum, tenant) =>
        sum +
        tenant.deletePrefixes.reduce(
          (tenantSum, deletePrefix) => tenantSum + deletePrefix.keys.length,
          0,
        ),
      0,
    ),
    renderedThreads: tenantPlans.reduce(
      (sum, tenant) => sum + tenant.plannedRenders.length,
      0,
    ),
  };
}

function parseArgs(argv: string[]): WorkspaceLayoutMigrationOptions {
  const options: WorkspaceLayoutMigrationOptions = { mode: "dry-run" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.mode = "apply";
    } else if (arg === "--dry-run") {
      options.mode = "dry-run";
    } else if (arg === "--workspace-bucket") {
      options.bucket = argv[++index];
    } else if (arg.startsWith("--workspace-bucket=")) {
      options.bucket = arg.slice("--workspace-bucket=".length);
    } else if (arg === "--tenant-id") {
      options.tenantId = argv[++index];
    } else if (arg.startsWith("--tenant-id=")) {
      options.tenantId = arg.slice("--tenant-id=".length);
    } else if (arg === "--batch-size") {
      options.batchSize = Number(argv[++index]);
    } else if (arg.startsWith("--batch-size=")) {
      options.batchSize = Number(arg.slice("--batch-size=".length));
    } else if (arg === "--preserve-legacy-sources") {
      options.deleteLegacySources = false;
    } else if (arg === "--delete-legacy-sources") {
      options.deleteLegacySources = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printUsage(): void {
  console.log(`Usage:
  pnpm exec tsx scripts/migrate-workspace-layout.ts --dry-run --workspace-bucket <bucket>
  pnpm exec tsx scripts/migrate-workspace-layout.ts --apply --workspace-bucket <bucket>

Options:
  --tenant-id <id>              Limit to one tenant UUID.
  --batch-size <n>              Number of thread renders to run concurrently. Default: ${DEFAULT_BATCH_SIZE}.
  --preserve-legacy-sources     Copy into the new layout and keep old source prefixes. Default.
  --delete-legacy-sources       Delete old source prefixes after copy once a fresh consumer survey is clean.

The script always deletes retired tenants/<tenant>/rendered/ tuple objects in --apply mode.`);
}

export async function runWorkspaceLayoutMigrationCli(
  argv = process.argv.slice(2),
): Promise<void> {
  const result = await runWorkspaceLayoutMigration(parseArgs(argv));
  console.log(JSON.stringify(result, null, 2));
  if (result.summary.conflicts > 0 || result.summary.errors > 0) {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runWorkspaceLayoutMigrationCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
