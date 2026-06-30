import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { skillCatalog } from "@thinkwork/database-pg/schema";
import type { SkillTrustPipelineReport } from "./catalog-report.js";

export const SKILL_TRUST_PIPELINE_VERSION = "thinkwork-skill-trust-v1";

export interface TrustedSkillGateRow {
  slug: string;
  content_sha: string;
  trust_report: unknown;
  trust_report_content_sha: string | null;
  trust_report_pipeline_version: string | null;
}

function hasRuntimeTrustedSignature(
  evidence: SkillTrustPipelineReport["evidence"] | undefined,
): boolean {
  return (
    evidence?.signature === "verified" ||
    evidence?.signature === "approved_unverified"
  );
}

export function isCurrentPassedSkillTrustReport(
  row: TrustedSkillGateRow,
): boolean {
  if (!row.trust_report || typeof row.trust_report !== "object") return false;
  const report = row.trust_report as Partial<SkillTrustPipelineReport>;
  const evidence = report.evidence;
  return (
    report.status === "passed" &&
    report.spec?.status === "passed" &&
    report.scanner?.status === "completed" &&
    (evidence?.skillCard === "present" ||
      evidence?.skillCard === "starter_generated") &&
    (evidence?.evalDataset === "present" ||
      evidence?.evalDataset === "starter_generated") &&
    (evidence?.benchmark === "present" ||
      evidence?.benchmark === "starter_generated") &&
    hasRuntimeTrustedSignature(evidence) &&
    row.trust_report_content_sha === row.content_sha &&
    row.trust_report_pipeline_version === SKILL_TRUST_PIPELINE_VERSION
  );
}

export async function loadTrustedCatalogSkillIds(input: {
  tenantId: string;
  skillIds: string[];
  logPrefix: string;
}): Promise<Set<string>> {
  const uniqueSkillIds = [...new Set(input.skillIds.filter(Boolean))];
  if (uniqueSkillIds.length === 0) return new Set();

  const db = getDb();
  const rows = await db
    .select({
      slug: skillCatalog.slug,
      content_sha: skillCatalog.content_sha,
      trust_report: skillCatalog.trust_report,
      trust_report_content_sha: skillCatalog.trust_report_content_sha,
      trust_report_pipeline_version: skillCatalog.trust_report_pipeline_version,
    })
    .from(skillCatalog)
    .where(
      and(
        eq(skillCatalog.tenant_id, input.tenantId),
        inArray(skillCatalog.slug, uniqueSkillIds),
      ),
    );

  const trusted = new Set(
    rows.filter(isCurrentPassedSkillTrustReport).map((row) => row.slug),
  );
  const removed = uniqueSkillIds.length - trusted.size;
  if (removed > 0) {
    console.log(
      `${input.logPrefix} Skill trust gate removed ${removed} untrusted skill(s) from runtime injection`,
    );
  }
  return trusted;
}

export async function filterTrustedCatalogSkillIds(input: {
  tenantId: string;
  skillIds: string[];
  logPrefix: string;
}): Promise<string[]> {
  const trusted = await loadTrustedCatalogSkillIds(input);
  return input.skillIds.filter((skillId) => trusted.has(skillId));
}
