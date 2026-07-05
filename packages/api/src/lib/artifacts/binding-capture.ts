/**
 * Living Artifacts (THINK-145 U5): data-source binding capture.
 *
 * The runtime declares a widget's data source (KTD4) and stamps a binding
 * descriptor onto the json-render activity-event payload. This runs server-side
 * in the chat-agent-activity append path — right after the born-as-artifact
 * upsert (U4) — and upserts the `artifact_data_bindings` row for the canvas.
 *
 * Two things the runtime canNOT know are classified here:
 *  - **auth context** (tenant-scoped vs per-user OAuth): the runtime holds only
 *    the MCP server NAME, so we resolve it against `tenant_mcp_servers.auth_type`
 *    for this tenant (`oauth` → per_user_oauth; anything else, or an unresolved
 *    server → tenant_mcp).
 *  - **owner user** for a per-user binding: resolved from `threads.user_id` (the
 *    thread the canvas was emitted in), so a per-user refresh can name the owner.
 *
 * Preserve-on-absent (KTD4): a canvas event WITHOUT a binding never reaches this
 * function (the caller gates on `bindingDescriptorFromPayload`), so re-emissions
 * that drop the source reference leave the existing binding row untouched.
 *
 * v1 binds one primary source per part → `element_id = ""`. Idempotent on the
 * (artifact, part, element) unique key: re-capture updates the descriptor in
 * place AND marks the binding fresh (THINK-165). A descriptor only reaches
 * this function when the runtime validated `sourceToolCallId` against the
 * CURRENT turn's completed, non-errored MCP invocations
 * (`buildCanvasDataBinding`) — so capture is, by construction, evidence that
 * fresh data was just fetched: quality → `good`, stamp `last_fetched_at` +
 * `last_good_at`. Without this, an agent-mediated refresh (per-user-OAuth
 * re-run + same-id re-emit) left the row STALE right after fresh data landed.
 */

import { bindingDescriptorFromPayload } from "@thinkwork/thread-json-render";
import {
  artifactDataBindings,
  db,
  eq,
  and,
  or,
  sql,
  tenantMcpServers,
  threads,
} from "../../graphql/utils.js";
import { deriveCanvasArtifactId } from "./canvas-lifecycle.js";

type AuthContext = "tenant_mcp" | "per_user_oauth";

/**
 * Classify a binding's refresh identity from the tenant's MCP server registry.
 * `oauth` auth_type is the per-user OAuth pattern (resolved via user_mcp_tokens
 * at refresh time); everything else (none / tenant_api_key / service_credential)
 * is tenant-scoped and refreshable unattended. An unresolved server name is
 * treated as tenant_mcp — the missing-server case degrades to a terminal BAD
 * state at refresh time (U6), not a mis-scoped credential.
 *
 * The runtime identifies a server by its SLUG (the mcp_configs key, e.g.
 * `twenty--crm`), not its display name ("Twenty CRM"). Matching only on
 * `name` silently misclassified every slug-named binding as tenant_mcp
 * (observed live: a Twenty per-user-OAuth chart captured as tenant_mcp with
 * no owner, THINK-145 U11). Match slug first; keep name as a fallback for
 * rows registered before slugs were backfilled.
 */
async function classifyAuthContext(
  tenantId: string,
  serverName: string,
): Promise<AuthContext> {
  const [row] = await db
    .select({ auth_type: tenantMcpServers.auth_type })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, tenantId),
        or(
          eq(tenantMcpServers.slug, serverName),
          eq(tenantMcpServers.name, serverName),
        ),
      ),
    )
    .limit(1);
  return row?.auth_type === "oauth" ? "per_user_oauth" : "tenant_mcp";
}

/**
 * Upsert the data-source binding row for a json-render activity event that
 * carries a binding descriptor. Returns the binding id on write, or null when
 * the event carries no valid binding (nothing to do — existing rows preserved).
 */
export async function upsertBindingFromActivityEvent(input: {
  tenantId: string;
  threadId: string;
  payload: unknown;
}): Promise<{ bindingId: string } | null> {
  const binding = bindingDescriptorFromPayload(input.payload);
  if (!binding) return null;

  const artifactId = deriveCanvasArtifactId(
    input.tenantId,
    input.threadId,
    binding.partId,
  );
  const elementId = binding.elementId ?? "";

  const authContext = await classifyAuthContext(
    input.tenantId,
    binding.serverName,
  );

  // Owner user only matters for per-user bindings (names the credential owner,
  // gates unattended refresh). Resolve from the emitting thread's owner.
  let ownerUserId: string | null = null;
  if (authContext === "per_user_oauth") {
    const [thread] = await db
      .select({ user_id: threads.user_id })
      .from(threads)
      .where(eq(threads.id, input.threadId))
      .limit(1);
    ownerUserId = thread?.user_id ?? null;
  }

  const [row] = await db
    .insert(artifactDataBindings)
    .values({
      tenant_id: input.tenantId,
      artifact_id: artifactId,
      part_id: binding.partId,
      element_id: elementId,
      mcp_server_ref: binding.serverRef,
      server_name: binding.serverName,
      tool_name: binding.toolName,
      frozen_args: binding.frozenArgs,
      result_shape_hash: binding.resultShapeHash,
      auth_context: authContext,
      owner_user_id: ownerUserId,
      quality: "good",
      last_fetched_at: sql`now()`,
      last_good_at: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [
        artifactDataBindings.artifact_id,
        artifactDataBindings.part_id,
        artifactDataBindings.element_id,
      ],
      // Re-capture refreshes the descriptor AND freshness state: the runtime
      // only stamps a binding when `sourceToolCallId` resolved to a completed
      // in-turn MCP call, so this row's data was fetched moments ago.
      set: {
        mcp_server_ref: binding.serverRef,
        server_name: binding.serverName,
        tool_name: binding.toolName,
        frozen_args: binding.frozenArgs,
        result_shape_hash: binding.resultShapeHash,
        auth_context: authContext,
        owner_user_id: ownerUserId,
        quality: "good",
        last_fetched_at: sql`now()`,
        last_good_at: sql`now()`,
        updated_at: sql`now()`,
      },
    })
    .returning({ id: artifactDataBindings.id });

  return row ? { bindingId: row.id } : null;
}
