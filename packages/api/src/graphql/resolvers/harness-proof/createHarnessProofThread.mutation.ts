import { GraphQLError } from "graphql";
import { workspaceFolderName } from "@thinkwork/database-pg/utils/workspace-folder-name";

import type { GraphQLContext } from "../../context.js";
import {
  agents,
  and,
  db,
  eq,
  harnessManagedThreadEnrollments,
  sql,
  tenants,
  threadParticipants,
  threads,
} from "../../utils.js";
import { requireHarnessProofProfile } from "../../../lib/harness/proof-profile.js";
import { ensureDefaultThreadSpace } from "../../../lib/spaces/default-space.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";

const TRUST_PROFILE = "default";

export interface HarnessProofThreadResult {
  threadId: string;
  created: boolean;
  state: string;
  priorRuntime: string;
}

export async function createHarnessProofThread(
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
): Promise<HarnessProofThreadResult> {
  await requireTenantAdmin(ctx, args.tenantId);
  const callerUserId = await resolveCallerUserId(ctx);
  if (!callerUserId) {
    throw new GraphQLError("Operator identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, args.tenantId))
    .limit(1);
  if (!tenant) {
    throw new GraphQLError("Tenant not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  const profile = await requireHarnessProofProfile(tenant.slug);
  const space = await ensureDefaultThreadSpace({
    tenantId: args.tenantId,
    userId: callerUserId,
  });

  return db.transaction(async (tx) => {
    const [agent] = await tx
      .select({
        id: agents.id,
        runtime: agents.runtime,
        runtimeConfig: agents.runtime_config,
      })
      .from(agents)
      .where(
        and(
          eq(agents.tenant_id, args.tenantId),
          eq(agents.is_platform_default, true),
        ),
      )
      .limit(1);
    if (!agent) {
      throw new GraphQLError("Platform agent not found", {
        extensions: { code: "NOT_FOUND" },
      });
    }
    if (agent.runtime !== "harness") {
      throw new GraphQLError(
        "Select AgentCore Harness (proof) before creating the proof thread",
        { extensions: { code: "HARNESS_PROOF_NOT_SELECTED" } },
      );
    }

    const [existing] = await tx
      .select({
        threadId: harnessManagedThreadEnrollments.thread_id,
        logicalAgentId: harnessManagedThreadEnrollments.logical_agent_id,
        harnessArn: harnessManagedThreadEnrollments.harness_arn,
        qualifier: harnessManagedThreadEnrollments.qualifier,
        resolvedVersion: harnessManagedThreadEnrollments.resolved_version,
        priorRuntime: harnessManagedThreadEnrollments.prior_runtime,
        status: harnessManagedThreadEnrollments.status,
      })
      .from(harnessManagedThreadEnrollments)
      .where(
        and(
          eq(harnessManagedThreadEnrollments.tenant_id, args.tenantId),
          eq(harnessManagedThreadEnrollments.trust_profile, TRUST_PROFILE),
          eq(harnessManagedThreadEnrollments.status, "active"),
        ),
      )
      .limit(1);
    if (existing) {
      if (
        existing.logicalAgentId !== agent.id ||
        existing.harnessArn !== profile.harnessArn ||
        existing.qualifier !== profile.endpointName ||
        existing.resolvedVersion !== profile.liveVersion
      ) {
        throw new GraphQLError(
          "The active Harness proof thread is pinned to a stale runtime profile. Restore it, then create a new proof thread.",
          {
            extensions: {
              code: "HARNESS_PROOF_ENROLLMENT_DRIFT",
              threadId: existing.threadId,
            },
          },
        );
      }
      return {
        threadId: existing.threadId,
        created: false,
        state: existing.status,
        priorRuntime:
          existing.priorRuntime === "harness" ? "AGENTCORE" : "FLUE",
      };
    }

    const runtimeConfig =
      agent.runtimeConfig &&
      typeof agent.runtimeConfig === "object" &&
      !Array.isArray(agent.runtimeConfig)
        ? (agent.runtimeConfig as Record<string, unknown>)
        : {};
    const harnessProofConfig =
      runtimeConfig.harnessProof &&
      typeof runtimeConfig.harnessProof === "object" &&
      !Array.isArray(runtimeConfig.harnessProof)
        ? (runtimeConfig.harnessProof as Record<string, unknown>)
        : {};
    const priorRuntime =
      typeof harnessProofConfig.priorRuntime === "string" &&
      harnessProofConfig.priorRuntime !== "harness"
        ? harnessProofConfig.priorRuntime
        : "pi";

    const [counter] = await tx
      .update(tenants)
      .set({ issue_counter: sql`${tenants.issue_counter} + 1` })
      .where(eq(tenants.id, args.tenantId))
      .returning({ nextNumber: tenants.issue_counter });
    if (!counter) throw new Error("Tenant counter unavailable");

    const title = "AgentCore Harness multiplayer proof";
    const existingFolders = await tx
      .select({ id: threads.id, folder: threads.workspace_folder_name })
      .from(threads)
      .where(eq(threads.tenant_id, args.tenantId));
    const folder = workspaceFolderName(
      title,
      existingFolders.map((row) => row.folder ?? row.id),
      "thread",
    );
    const [thread] = await tx
      .insert(threads)
      .values({
        tenant_id: args.tenantId,
        agent_id: agent.id,
        space_id: space.id,
        user_id: callerUserId,
        number: counter.nextNumber,
        identifier: `THINK-${counter.nextNumber}`,
        title,
        workspace_folder_name: folder,
        status: "backlog",
        channel: "manual",
        mode_override: "multiplayer",
        created_by_type: "user",
        created_by_id: callerUserId,
        metadata: {
          harnessProof: {
            trustProfile: TRUST_PROFILE,
            qualifier: profile.endpointName,
            resolvedVersion: profile.liveVersion,
          },
        },
      })
      .returning({ id: threads.id });
    if (!thread) throw new Error("Harness proof thread was not created");

    await tx.insert(threadParticipants).values([
      {
        tenant_id: args.tenantId,
        thread_id: thread.id,
        space_id: space.id,
        participant_type: "user",
        user_id: callerUserId,
        role: "requester",
        source: "harness_proof_bootstrap",
      },
      {
        tenant_id: args.tenantId,
        thread_id: thread.id,
        space_id: space.id,
        participant_type: "agent",
        agent_id: agent.id,
        role: "assignee",
        source: "harness_proof_bootstrap",
      },
    ]);

    await tx.insert(harnessManagedThreadEnrollments).values({
      tenant_id: args.tenantId,
      thread_id: thread.id,
      logical_agent_id: agent.id,
      trust_profile: TRUST_PROFILE,
      harness_arn: profile.harnessArn,
      qualifier: profile.endpointName,
      resolved_version: profile.liveVersion,
      session_strategy: "fresh",
      prior_runtime: priorRuntime,
      status: "active",
      enrolled_by_user_id: callerUserId,
    });

    return {
      threadId: thread.id,
      created: true,
      state: "active",
      priorRuntime: priorRuntime === "harness" ? "AGENTCORE" : "FLUE",
    };
  });
}
