/**
 * First-run binding capture (THINK-227 U3, KTD1).
 *
 * A create-mode document binding locks onto the artifact its first successful
 * run created: after a run-derived finalize pins the document, the created
 * artifact id is written back into the automation's live
 * `target_spec.documentBinding.capturedArtifactId` — the ONE place dispatch
 * resolves the binding from (U2), so run 2 revises the same document.
 *
 * First writer wins: the write is a single conditional jsonb UPDATE guarded on
 * `mode = 'create' AND capturedArtifactId IS NULL`, so a concurrent second
 * finalize (or a retried one) no-ops instead of overwriting. Existing-mode
 * bindings never write. Best-effort by contract — the caller must not fail an
 * otherwise-successful finalize on a capture fault.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { agentLoopVersions, agentLoops } from "@thinkwork/database-pg/schema";
import { db } from "../../graphql/utils.js";

export interface CaptureDocumentBindingResult {
  /** True when THIS call wrote the captured id (first writer). */
  captured: boolean;
}

export async function captureDocumentBindingArtifact(input: {
  tenantId: string;
  agentLoopId: string;
  artifactId: string;
}): Promise<CaptureDocumentBindingResult> {
  const [loop] = await db
    .select({ current_version_id: agentLoops.current_version_id })
    .from(agentLoops)
    .where(
      and(
        eq(agentLoops.id, input.agentLoopId),
        eq(agentLoops.tenant_id, input.tenantId),
      ),
    )
    .limit(1);
  if (!loop?.current_version_id) return { captured: false };

  const updated = await db
    .update(agentLoopVersions)
    .set({
      target_spec: sql`jsonb_set(${agentLoopVersions.target_spec}, '{documentBinding,capturedArtifactId}', to_jsonb(${input.artifactId}::text))`,
    })
    .where(
      and(
        eq(agentLoopVersions.id, loop.current_version_id),
        eq(agentLoopVersions.tenant_id, input.tenantId),
        sql`${agentLoopVersions.target_spec}->'documentBinding'->>'mode' = 'create'`,
        isNull(
          sql`${agentLoopVersions.target_spec}->'documentBinding'->>'capturedArtifactId'`,
        ),
      ),
    )
    .returning({ id: agentLoopVersions.id });

  return { captured: updated.length > 0 };
}
