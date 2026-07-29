/**
 * retractMemoryDerivation — enqueue a retraction for one derivation's
 * Hindsight document and process it inline once (THINK-193 U2).
 *
 * RequestResponse semantics: the enqueue and the single inline processing
 * pass both happen in this request and errors surface to the caller —
 * never fire-and-forget. Engines without a `deleteDocument` capability
 * throw a clear error naming the engine (deleteMemoryRecord idiom).
 */

import type { GraphQLContext } from "../../context.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import type { DocumentCapableMemoryAdapter } from "../../../lib/memory-sources/engine-capabilities.js";
import {
  enqueueDerivationRetraction,
  processRetractionAttempt,
} from "../../../lib/memory-sources/retraction.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";
import { toGraphqlRetractionAttempt } from "./memoryRetractionAttempts.query.js";

export async function retractMemoryDerivation(
  _parent: unknown,
  args: { tenantId?: string | null; derivationId: string },
  ctx: GraphQLContext,
) {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireTenantAdmin(ctx, tenantId);

  const { adapter: baseAdapter, config } = getMemoryServices();
  const adapter = baseAdapter as DocumentCapableMemoryAdapter;
  if (!adapter.deleteDocument) {
    throw new Error(
      `Memory retraction is not supported on engine "${config.engine}"`,
    );
  }

  const attempt = await enqueueDerivationRetraction(ctx.db, {
    tenantId,
    derivationId: args.derivationId,
  });
  if (!attempt) {
    throw new Error("Memory derivation not found or already retracted");
  }
  const processed = await processRetractionAttempt(
    { db: ctx.db, adapter },
    attempt.id,
  );
  return toGraphqlRetractionAttempt(processed);
}
