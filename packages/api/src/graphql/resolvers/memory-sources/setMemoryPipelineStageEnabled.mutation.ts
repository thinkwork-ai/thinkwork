/**
 * setMemoryPipelineStageEnabled — switch one optional memory stage on/off
 * (THINK-264).
 *
 * OWNER-ONLY: resolved through the caller's own system Automation row, so
 * there is no way to toggle another user's pipeline.
 *
 * Only the optional tail (compound/graph/wiki) is toggleable. A request for a
 * spine stage is REJECTED, not ignored: acquire → project → resolve → retain
 * feed each other, so switching one off would leave the automation running and
 * reporting success while quietly retaining nothing.
 *
 * The toggle is stored as intent on the processor. The workflow's step list is
 * still code-owned — ensureMemoryBlueprintVersion rebuilds the definition from
 * the blueprint and supersedes the active version through the normal lazy
 * path, so in-flight runs stay pinned to the version they captured.
 */

import { and, eq } from "drizzle-orm";
import {
  isToggleableMemoryStage,
  normalizeDisabledStages,
  TOGGLEABLE_MEMORY_STAGES,
} from "@thinkwork/agent-loops-core";
import { ensureMemoryBlueprintVersion } from "@thinkwork/database-pg";
import {
  agentLoops,
  agentLoopVersions,
  memoryProcessorConfigs,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { buildMemoryPipelineView } from "../../../lib/memory-sources/pipeline-view.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";

export async function setMemoryPipelineStageEnabled(
  _parent: unknown,
  args: { agentLoopId: string; stage: string; enabled: boolean },
  ctx: GraphQLContext,
) {
  const tenantId = ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  const userId = await resolveCallerUserId(ctx);
  if (!userId) {
    throw new Error("A signed-in user is required to configure memory stages");
  }

  if (!isToggleableMemoryStage(args.stage)) {
    throw new Error(
      `"${
        args.stage
      }" cannot be turned off — acquire, project, resolve, and retain are required steps, and disabling one would stop memory from being written at all. Only ${TOGGLEABLE_MEMORY_STAGES.join(
        ", ",
      )} can be switched off.`,
    );
  }

  const [loop] = await db
    .select()
    .from(agentLoops)
    .where(
      and(
        eq(agentLoops.id, args.agentLoopId),
        eq(agentLoops.tenant_id, tenantId),
        eq(agentLoops.owner_user_id, userId),
      ),
    )
    .limit(1);
  if (!loop || loop.kind !== "system") {
    throw new Error("Memory automation not found");
  }
  if (!loop.current_version_id) {
    throw new Error("Memory automation has no definition yet");
  }

  const [version] = await db
    .select({ target_spec: agentLoopVersions.target_spec })
    .from(agentLoopVersions)
    .where(eq(agentLoopVersions.id, loop.current_version_id))
    .limit(1);
  const spec = version?.target_spec as
    | { kind?: string; processorConfigId?: string }
    | undefined;
  if (spec?.kind !== "memory_pipeline" || !spec.processorConfigId) {
    throw new Error("This automation has no memory pipeline");
  }

  const [processor] = await db
    .select()
    .from(memoryProcessorConfigs)
    .where(
      and(
        eq(memoryProcessorConfigs.id, spec.processorConfigId),
        eq(memoryProcessorConfigs.tenant_id, tenantId),
      ),
    )
    .limit(1);
  if (!processor) throw new Error("Memory processor not found");

  const disabled = new Set(normalizeDisabledStages(processor.stage_overrides));
  if (args.enabled) disabled.delete(args.stage);
  else disabled.add(args.stage);

  await db
    .update(memoryProcessorConfigs)
    .set({
      stage_overrides: {
        ...(processor.stage_overrides ?? {}),
        // Store in canonical order so the value is stable to compare against
        // the version's source_metadata.
        disabledStages: TOGGLEABLE_MEMORY_STAGES.filter((s) => disabled.has(s)),
      },
      updated_at: new Date(),
    })
    .where(eq(memoryProcessorConfigs.id, processor.id));

  // Republish the definition now rather than at the next run, so the
  // Definition tab and the interpreter agree the moment the toggle flips.
  if (processor.workflow_id) {
    await ensureMemoryBlueprintVersion(db, {
      tenantId,
      workflowId: processor.workflow_id,
    });
  }

  const view = await buildMemoryPipelineView(db, {
    tenantId,
    processorConfigId: processor.id,
  });
  if (!view) throw new Error("Memory pipeline could not be loaded");
  return view;
}
