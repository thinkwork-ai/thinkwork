import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  artifacts,
  spaceMembers,
  spaces,
  tenants,
  threads,
  users,
} from "@thinkwork/database-pg/schema";
import {
  CANVAS_LIVING_KIND,
  CANVAS_SNAPSHOT_KIND,
} from "../artifacts/canvas-access.js";
import {
  lookupBindings,
  type CapabilityScopeRef,
} from "../capabilities/approval-registry.js";
import { bindingScanKey } from "../capabilities/manifest-compile.js";
import type {
  CapabilityBindingLookupKey,
  CapabilityBindingLookupRow,
  ResolvedWorkspaceRenderTuple,
  WorkspaceCanvasIndexEntry,
  WorkspaceSpaceIndexEntry,
  WorkspaceSpaceParticipantEntry,
  WorkspaceRenderTupleInput,
  WorkspaceTupleRepository,
} from "./types.js";

function userSlug(user: { email: string | null; name: string | null }): string {
  const base = user.email?.split("@")[0] || user.name || "user";
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export class DrizzleWorkspaceTupleRepository
  implements WorkspaceTupleRepository
{
  private readonly db = getDb();

  async resolve(
    input: WorkspaceRenderTupleInput,
  ): Promise<ResolvedWorkspaceRenderTuple | null> {
    const [tenant] = await this.db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        capabilityRegistryTrust: tenants.capability_registry_trust,
      })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId));
    if (!tenant?.slug) return null;

    const [agent] = await this.db
      .select({
        id: agents.id,
        slug: agents.slug,
        workspaceFolderName: agents.workspace_folder_name,
        name: agents.name,
      })
      .from(agents)
      .where(
        and(eq(agents.id, input.agentId), eq(agents.tenant_id, input.tenantId)),
      );
    if (!agent?.slug) return null;

    const [space] = await this.db
      .select({
        id: spaces.id,
        slug: spaces.slug,
        workspaceFolderName: spaces.workspace_folder_name,
        name: spaces.name,
        kind: spaces.kind,
        accessMode: spaces.access_mode,
        prompt: spaces.prompt,
        toolPolicy: spaces.tool_policy,
        mcpPolicy: spaces.mcp_policy,
        status: spaces.status,
      })
      .from(spaces)
      .where(
        and(eq(spaces.id, input.spaceId), eq(spaces.tenant_id, input.tenantId)),
      );
    if (!space || space.status !== "active") return null;

    let resolvedUser: {
      id: string;
      slug: string;
      name: string | null;
    } | null = null;
    if (input.userId) {
      const [user] = await this.db
        .select({
          id: users.id,
          workspaceFolderName: users.workspace_folder_name,
          name: users.name,
          email: users.email,
        })
        .from(users)
        .where(
          and(eq(users.id, input.userId), eq(users.tenant_id, input.tenantId)),
        );
      if (user) {
        resolvedUser = {
          id: user.id,
          slug: user.workspaceFolderName ?? userSlug(user),
          name: user.name,
        };
      }
    }

    let resolvedThreadSlug: string | null = input.threadSlug ?? null;
    if (input.threadId) {
      const [thread] = await this.db
        .select({
          id: threads.id,
          workspaceFolderName: threads.workspace_folder_name,
        })
        .from(threads)
        .where(
          and(
            eq(threads.id, input.threadId),
            eq(threads.tenant_id, input.tenantId),
          ),
        )
        .limit(1);
      resolvedThreadSlug =
        thread?.workspaceFolderName ?? input.threadSlug ?? input.threadId;
    }

    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      agentId: agent.id,
      agentSlug: agent.workspaceFolderName ?? agent.slug,
      agentName: agent.name,
      spaceId: space.id,
      spaceSlug: space.workspaceFolderName ?? space.slug,
      spaceName: space.name,
      spaceKind: space.kind,
      spaceAccessMode: space.accessMode,
      spacePrompt: space.prompt,
      threadId: input.threadId ?? null,
      threadSlug: resolvedThreadSlug,
      userId: resolvedUser?.id ?? input.userId ?? null,
      userSlug: resolvedUser?.slug ?? null,
      userName: resolvedUser?.name ?? null,
      capabilityRegistryTrust: tenant.capabilityRegistryTrust === true,
    };
  }

  async lookupCapabilityBindings(input: {
    tenantId: string;
    keys: CapabilityBindingLookupKey[];
  }): Promise<CapabilityBindingLookupRow[]> {
    const found = await lookupBindings(this.db, {
      tenantId: input.tenantId,
      keys: input.keys.map((key) => ({
        scopeRef: key.scopeRef as CapabilityScopeRef,
        class: key.class,
        slug: key.slug,
      })),
    });
    const rows: CapabilityBindingLookupRow[] = [];
    for (const row of found.values()) {
      // THINK-302: emit the COMPILE's lookup-key format (`bindingScanKey`,
      // space-separated). `lookupBindings` keys its internal Map with
      // `bindingMapKey` (NUL-separated) for dedup; compose-tuple stores these
      // rows under `row.mapKey` and the compiler looks them up with
      // `bindingScanKey`. The two key formats MUST agree or every registry
      // grant misses its binding and compiles to an `unsigned` proposal.
      rows.push({
        mapKey: bindingScanKey(row.scope_ref, row.class, row.slug),
        markerSha: row.marker_sha,
        folderAttestationSha: row.folder_attestation_sha,
        filesEtagSignature: row.files_etag_signature,
      });
    }
    return rows;
  }

  async listAuthorizedSpaces(
    tuple: ResolvedWorkspaceRenderTuple,
  ): Promise<WorkspaceSpaceIndexEntry[]> {
    const rows = await this.db
      .select({
        id: spaces.id,
        slug: spaces.slug,
        workspaceFolderName: spaces.workspace_folder_name,
        name: spaces.name,
        accessMode: spaces.access_mode,
      })
      .from(spaces)
      .where(
        and(eq(spaces.tenant_id, tuple.tenantId), eq(spaces.status, "active")),
      );

    const memberSpaceIds = new Set<string>();
    if (tuple.userId) {
      const memberships = await this.db
        .select({ spaceId: spaceMembers.space_id })
        .from(spaceMembers)
        .where(
          and(
            eq(spaceMembers.tenant_id, tuple.tenantId),
            eq(spaceMembers.user_id, tuple.userId),
          ),
        );
      for (const membership of memberships) {
        memberSpaceIds.add(membership.spaceId);
      }
    }

    return rows
      .filter(
        (space) =>
          space.id === tuple.spaceId ||
          space.accessMode === "public" ||
          memberSpaceIds.has(space.id),
      )
      .map((space) => ({
        id: space.id,
        slug: space.workspaceFolderName ?? space.slug,
        name: space.name,
        accessMode: space.accessMode,
        isActive: space.id === tuple.spaceId,
      }))
      .sort((left, right) => {
        if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
  }

  async listSpaceParticipants(
    tuple: ResolvedWorkspaceRenderTuple,
  ): Promise<WorkspaceSpaceParticipantEntry[]> {
    const rows = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        workspaceFolderName: users.workspace_folder_name,
      })
      .from(spaceMembers)
      .innerJoin(users, eq(spaceMembers.user_id, users.id))
      .where(
        and(
          eq(spaceMembers.tenant_id, tuple.tenantId),
          eq(spaceMembers.space_id, tuple.spaceId),
        ),
      );

    return rows
      .map((row) => ({
        id: row.id,
        name: row.name?.trim() || row.email?.split("@")[0] || row.id,
        // Same derivation as resolve(): the routing section renders this as
        // the fetchable `Users/<slug>/` path for fetch_workspace_source.
        slug: row.workspaceFolderName ?? userSlug(row),
      }))
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id),
      );
  }

  async listSavedCanvases(
    tuple: ResolvedWorkspaceRenderTuple,
  ): Promise<WorkspaceCanvasIndexEntry[]> {
    if (!tuple.spaceId) return [];
    const rows = await this.db
      .select({ id: artifacts.id, title: artifacts.title })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.tenant_id, tuple.tenantId),
          eq(artifacts.space_id, tuple.spaceId),
          eq(artifacts.status, "final"),
          sql`(${artifacts.metadata}->>'kind' = ${CANVAS_LIVING_KIND}
            OR ${artifacts.metadata}->>'kind' = ${CANVAS_SNAPSHOT_KIND})`,
        ),
      )
      .orderBy(desc(artifacts.updated_at))
      .limit(100);
    return rows.map((row) => ({
      artifactId: row.id,
      name: row.title ?? "",
    }));
  }
}
