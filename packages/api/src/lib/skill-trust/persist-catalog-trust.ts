import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { skillCatalog } from "@thinkwork/database-pg/schema";
import type { SkillTrustPipelineReport } from "./catalog-report.js";
import { SKILL_TRUST_PIPELINE_VERSION } from "./runtime-gate.js";

/**
 * Persist a skill's trust report onto its `skill_catalog` row so the runtime
 * gate (`isCurrentPassedSkillTrustReport`) can find a current, passing report.
 *
 * This is the single write shape for the gate columns — both the interactive
 * workspace-files trust actions (`run-skill-trust`, `fix-skill-trust-evidence`)
 * and the deploy-time default-skill seeder call through here so the persisted
 * shape never drifts between the two paths. The load-bearing invariant is that
 * `trust_report_content_sha` equals the row's `content_sha` (the sha the
 * catalog index writes over the same S3 file set) and the pipeline version
 * matches — see runtime-gate.ts.
 */
export async function persistCatalogSkillTrustReport(input: {
  tenantId: string;
  slug: string;
  report: SkillTrustPipelineReport;
  catalogContentSha: string;
  signedByUserId: string | null;
  /**
   * Drizzle client override. Defaults to the shared `getDb()` singleton; the
   * interactive workspace-files handler passes its own (test-mockable)
   * instance so both paths share this write shape without breaking mocks.
   */
  db?: ReturnType<typeof getDb>;
}): Promise<void> {
  const db = input.db ?? getDb();
  const signatureVerified = input.report.evidence.signature === "verified";
  await db
    .update(skillCatalog)
    .set({
      trust_report: input.report,
      trust_report_content_sha: input.catalogContentSha,
      trust_report_pipeline_version: SKILL_TRUST_PIPELINE_VERSION,
      trust_report_updated_at: sql`now()`,
      signature_status: input.report.evidence.signature,
      signature_payload: {
        artifactPath: input.report.artifactPaths.signature ?? null,
        signedPayloadHash: input.report.signedPayloadHash ?? null,
        status: input.report.evidence.signature,
      },
      signed_content_sha: signatureVerified ? input.catalogContentSha : null,
      signed_payload_hash: signatureVerified
        ? (input.report.signedPayloadHash ?? null)
        : null,
      signed_at: signatureVerified ? sql`now()` : null,
      signed_by_user_id:
        signatureVerified && input.signedByUserId ? input.signedByUserId : null,
      updated_at: sql`now()`,
    })
    .where(
      and(
        eq(skillCatalog.tenant_id, input.tenantId),
        eq(skillCatalog.slug, input.slug),
      ),
    );
}
