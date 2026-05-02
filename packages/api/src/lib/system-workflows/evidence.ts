import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { systemWorkflowEvidence } from "@thinkwork/database-pg/schema";

export type RecordSystemWorkflowEvidenceInput = {
  tenantId: string;
  runId: string;
  evidenceType: string;
  title: string;
  summary?: string | null;
  artifactUri?: string | null;
  artifactJson?: unknown;
  complianceTags?: string[];
  idempotencyKey?: string | null;
};

export type RecordSystemWorkflowEvidenceResult = {
  evidence: typeof systemWorkflowEvidence.$inferSelect;
  inserted: boolean;
  deduped: boolean;
};

export async function recordSystemWorkflowEvidence(
  input: RecordSystemWorkflowEvidenceInput,
  db = getDb(),
): Promise<RecordSystemWorkflowEvidenceResult> {
  const inserted = await db
    .insert(systemWorkflowEvidence)
    .values({
      tenant_id: input.tenantId,
      run_id: input.runId,
      evidence_type: input.evidenceType,
      title: input.title,
      summary: input.summary ?? null,
      artifact_uri: input.artifactUri ?? null,
      artifact_json: input.artifactJson ?? {},
      compliance_tags: input.complianceTags ?? [],
      idempotency_key: input.idempotencyKey ?? null,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) {
    return { evidence: inserted[0], inserted: true, deduped: false };
  }

  if (!input.idempotencyKey) {
    throw new Error(
      "System Workflow evidence insert skipped without an idempotency key",
    );
  }

  const existing = await db
    .select()
    .from(systemWorkflowEvidence)
    .where(
      and(
        eq(systemWorkflowEvidence.run_id, input.runId),
        eq(systemWorkflowEvidence.idempotency_key, input.idempotencyKey),
      ),
    )
    .limit(1);

  if (!existing[0]) {
    throw new Error(
      `System Workflow evidence dedupe key ${input.idempotencyKey} conflicted but no row was found`,
    );
  }

  console.warn(
    `[system-workflows] deduped evidence run=${input.runId} type=${input.evidenceType} key=${input.idempotencyKey}`,
  );
  return { evidence: existing[0], inserted: false, deduped: true };
}
