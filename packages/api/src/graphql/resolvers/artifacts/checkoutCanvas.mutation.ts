/**
 * checkoutCanvas (Living Artifacts THINK-145 U8, R13).
 *
 * Reopen a SAVED canvas in a thread in the SAME space: its head materializes as
 * a live `data-json-render` part under its ORIGINAL stable part id, the agent
 * can edit it via chat, and re-saving appends a new version to the SAME
 * artifact — never a duplicate. Cross-space check-out is rejected (R13, v1).
 *
 * How re-save targets the same artifact from a new thread: check-out records a
 * `{threadId}` entry in the artifact's `metadata.checkouts` array. When the
 * agent re-emits the part in the checked-out thread, the born-as-artifact
 * upsert (`born-artifact.ts` `findCheckoutRoutedArtifact`) sees the record and
 * routes the head update to THIS artifact instead of minting a new
 * (thread, part)-derived draft. An unrelated thread emitting the same stable id
 * with no check-out record still gets its own artifact.
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { and, artifacts, db, eq, sql, threads } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
import { assertCanvasAccess } from "../../../lib/artifacts/canvas-access.js";
import {
  isLivingCanvasMetadata,
  loadCanvasHeadContent,
  type CanvasArtifactRow,
} from "../../../lib/artifacts/canvas-lifecycle.js";
import { materializeCanvasIntoThread } from "../../../lib/artifacts/canvas-materialize.js";
import {
  validateThreadJsonRenderPersistedPart,
  type ThreadJsonRenderPart,
} from "../../../lib/thread-json-render/persisted-parts.js";
import { artifactToCamelWithPayload } from "./payload.js";

interface CheckoutCanvasArgs {
  artifactId: string;
  threadId: string;
}

export const checkoutCanvas = async (
  _parent: unknown,
  args: CheckoutCanvasArgs,
  ctx: GraphQLContext,
) => {
  const artifactId = requiredString(args.artifactId, "artifactId");
  const threadId = requiredString(args.threadId, "threadId");

  const caller = await resolveCallerFromAuth(ctx.auth);
  if (!caller.userId || !caller.tenantId) {
    throw new GraphQLError("Requester user identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  const [row] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, artifactId));
  if (!row) {
    throw new GraphQLError("Canvas artifact not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireTenantMember(ctx, row.tenant_id);
  if (row.tenant_id !== caller.tenantId) {
    throw new GraphQLError("Canvas belongs to a different tenant", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  if (!isLivingCanvasMetadata(row.metadata)) {
    throw new GraphQLError("checkoutCanvas is only valid for GenUI canvases", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  // Only a SAVED canvas (space-homed) can be checked out — a draft has no space
  // to enforce same-space against, and check-out is a save-lifecycle op (R13).
  if (!row.space_id) {
    throw new GraphQLError("Only a saved canvas can be checked out", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  // Write access to the canvas: member-or-above on its space (R15/U2).
  await assertCanvasAccess(ctx, row, "write");

  // Same-space enforcement (R13): the target thread's space must equal the
  // artifact's space, else a typed cross-space rejection.
  const [thread] = await db
    .select({
      id: threads.id,
      tenant_id: threads.tenant_id,
      space_id: threads.space_id,
      agent_id: threads.agent_id,
    })
    .from(threads)
    .where(eq(threads.id, threadId));
  if (!thread || thread.tenant_id !== row.tenant_id) {
    throw new GraphQLError("Target thread not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  if (thread.space_id !== row.space_id) {
    throw new GraphQLError(
      "A canvas can only be checked out into a thread in the same space",
      { extensions: { code: "FORBIDDEN", reason: "CROSS_SPACE_CHECKOUT" } },
    );
  }

  // Load the head content and re-validate it as a json-render part before
  // materializing it under its original stable part id.
  const headContent = await loadCanvasHeadContent(row as CanvasArtifactRow);
  const part = parseHeadPart(headContent);

  // Record the check-out linkage on the artifact (dedup by threadId so repeated
  // check-outs of the same thread don't grow the array). This is what routes a
  // later re-emission in `threadId` back to THIS artifact.
  const checkoutEntry = JSON.stringify([
    { threadId, at: new Date().toISOString() },
  ]);
  await db
    .update(artifacts)
    .set({
      metadata: sql`jsonb_set(
        coalesce(${artifacts.metadata}, '{}'::jsonb),
        '{checkouts}',
        coalesce(
          (
            SELECT jsonb_agg(elem)
              FROM jsonb_array_elements(
                     coalesce(${artifacts.metadata}->'checkouts', '[]'::jsonb)
                   ) elem
             WHERE elem->>'threadId' <> ${threadId}
          ),
          '[]'::jsonb
        ) || ${checkoutEntry}::jsonb
      )`,
      updated_at: new Date(),
    })
    .where(eq(artifacts.id, artifactId));

  // Materialize: durable message row + best-effort state_snapshot event.
  await materializeCanvasIntoThread({
    tenantId: row.tenant_id,
    threadId,
    agentId: thread.agent_id ?? row.agent_id ?? null,
    part,
  });

  // Return the (unchanged head) artifact — the check-out doesn't bump the head.
  const [refreshed] = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.id, artifactId), eq(artifacts.tenant_id, row.tenant_id)));
  return artifactToCamelWithPayload(refreshed ?? row);
};

function parseHeadPart(headContent: string): ThreadJsonRenderPart {
  let parsed: unknown;
  try {
    parsed = JSON.parse(headContent);
  } catch {
    throw new GraphQLError("Canvas head content is not valid JSON", {
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  }
  const validation = validateThreadJsonRenderPersistedPart(parsed);
  if (!validation.ok) {
    throw new GraphQLError("Canvas head is not a valid json-render part", {
      extensions: {
        code: "INTERNAL_SERVER_ERROR",
        diagnostics: validation.diagnostics,
      },
    });
  }
  return validation.part;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GraphQLError(`checkoutCanvas ${field} is required`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return value.trim();
}
