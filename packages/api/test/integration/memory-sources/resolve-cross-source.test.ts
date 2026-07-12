/**
 * THINK-193 acceptance AE1 at the CLAIM layer: two subjects from different
 * source families (a Twenty company and a scraped web page) that assert the
 * same `customer.domain` must resolve to ONE canonical entity, and every
 * ACTIVE claim of both subjects must carry that entity in
 * memory_claims.canonical_subject_id.
 *
 * Integration test — needs a real Postgres with the memory-source + identity
 * schema (0232/0234/0237/0239 applied). Runs only when DATABASE_URL is set;
 * used against the dev stack for acceptance evidence.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const TENANT_ID =
  process.env.MEMORY_TEST_TENANT_ID ?? "0015953e-aa13-4cab-8398-2e70f73dda63";
const SOURCE_CONFIG_ID =
  process.env.MEMORY_TEST_SOURCE_CONFIG_ID ??
  "44a5684b-f236-4f87-8336-6373c2e926da";

describe.skipIf(!DATABASE_URL)(
  "runResolve cross-source canonical join (integration)",
  () => {
    const marker = randomUUID().slice(0, 8);
    const domain = `probe-${marker}.example.com`;
    const companySubject = `twenty:company:probe-${marker}`;
    const pageSubject = `web:page:https://${domain}/pricing`;
    // memory_run_items.workflow_run_id is a real FK — the fixture needs a
    // persisted workflow + run, not a synthetic uuid.
    let workflowId = "";
    let workflowRunId = "";
    const evidenceIds: string[] = [];
    let db: import("@thinkwork/database-pg").Database;
    let eraseGeneration = 0;

    beforeAll(async () => {
      const { getDb } = await import("@thinkwork/database-pg");
      const { eq, and } = await import("drizzle-orm");
      const {
        memoryEvidenceItems,
        memorySourceConfigs,
        memoryClaims,
        memoryClaimEvidence,
      } = await import("@thinkwork/database-pg/schema");
      const { computeContentHash } = await import(
        "../../../src/lib/memory-sources/evidence.js"
      );
      db = getDb();
      {
        const { workflowRuns, workflows } = await import(
          "@thinkwork/database-pg/schema"
        );
        const [wf] = await db
          .insert(workflows)
          .values({
            tenant_id: TENANT_ID,
            name: "Resolve cross-source fixture",
            slug: `resolve-fixture-${marker}-${randomUUID()}`,
            lifecycle_status: "active",
            primary_trigger_family: "manual",
          })
          .returning({ id: workflows.id });
        workflowId = wf!.id;
        const [run] = await db
          .insert(workflowRuns)
          .values({
            tenant_id: TENANT_ID,
            workflow_id: workflowId,
            status: "succeeded",
            trigger_family: "manual",
            trigger_source: "resolve-fixture",
          })
          .returning({ id: workflowRuns.id });
        workflowRunId = run!.id;
      }

      const [source] = await db
        .select({ erase_generation: memorySourceConfigs.erase_generation })
        .from(memorySourceConfigs)
        .where(
          and(
            eq(memorySourceConfigs.id, SOURCE_CONFIG_ID),
            eq(memorySourceConfigs.tenant_id, TENANT_ID),
          ),
        )
        .limit(1);
      if (!source) throw new Error(`source config ${SOURCE_CONFIG_ID} missing`);
      eraseGeneration = source.erase_generation ?? 0;

      const seed = async (
        subjectKey: string,
        claims: Array<{ predicate: string; value: Record<string, unknown> }>,
      ): Promise<void> => {
        const [evidence] = await db
          .insert(memoryEvidenceItems)
          .values({
            tenant_id: TENANT_ID,
            source_config_id: SOURCE_CONFIG_ID,
            source_item_id: subjectKey,
            source_version: `resolve-${marker}-${randomUUID()}`,
            content_hash: `resolve-${marker}`,
            target_scope: "tenant",
            target_id: TENANT_ID,
            lifecycle: "active",
            extraction_recipe: {},
          })
          .returning({ id: memoryEvidenceItems.id });
        evidenceIds.push(evidence!.id);
        for (const claim of claims) {
          const [row] = await db
            .insert(memoryClaims)
            .values({
              tenant_id: TENANT_ID,
              target_scope: "tenant",
              target_id: TENANT_ID,
              subject_key: subjectKey,
              subject_entity_type: "customer",
              ontology_predicate: claim.predicate,
              value: claim.value,
              value_hash: computeContentHash(claim.value),
              status: "active",
              extraction_version: "integration",
            })
            .returning({ id: memoryClaims.id });
          await db.insert(memoryClaimEvidence).values({
            tenant_id: TENANT_ID,
            claim_id: row!.id,
            evidence_item_id: evidence!.id,
            source_config_id: SOURCE_CONFIG_ID,
            status: "active",
          });
        }
      };

      await seed(companySubject, [
        { predicate: "customer.name", value: { text: `Probe Co ${marker}` } },
        { predicate: "customer.domain", value: { url: domain } },
      ]);
      await seed(pageSubject, [
        { predicate: "customer.domain", value: { url: `www.${domain}` } },
        {
          predicate: "customer.web_page_title",
          value: { text: `Probe Co ${marker} — Pricing` },
        },
      ]);
    });

    afterAll(async () => {
      const { inArray, eq, and, like } = await import("drizzle-orm");
      const {
        memoryClaims,
        memoryClaimEvidence,
        memoryEvidenceItems,
        memoryRunItems,
        canonicalEntities,
        entitySourceMappings,
        entityIdentityClaims,
      } = await import("@thinkwork/database-pg/schema");
      if (evidenceIds.length > 0) {
        await db
          .delete(memoryClaimEvidence)
          .where(inArray(memoryClaimEvidence.evidence_item_id, evidenceIds));
      }
      await db
        .delete(memoryClaims)
        .where(
          inArray(memoryClaims.subject_key, [companySubject, pageSubject]),
        );
      if (evidenceIds.length > 0) {
        await db
          .delete(memoryEvidenceItems)
          .where(inArray(memoryEvidenceItems.id, evidenceIds));
      }
      await db
        .delete(memoryRunItems)
        .where(eq(memoryRunItems.workflow_run_id, workflowRunId));
      // Identity rows created by the run.
      const created = await db
        .select({ id: canonicalEntities.id })
        .from(canonicalEntities)
        .where(
          and(
            eq(canonicalEntities.tenant_id, TENANT_ID),
            like(canonicalEntities.display_name, `Probe Co ${marker}%`),
          ),
        );
      const ids = created.map((row) => row.id);
      if (ids.length > 0) {
        await db
          .delete(entitySourceMappings)
          .where(inArray(entitySourceMappings.canonical_entity_id, ids));
        await db
          .delete(entityIdentityClaims)
          .where(inArray(entityIdentityClaims.canonical_entity_id, ids));
        await db
          .delete(canonicalEntities)
          .where(inArray(canonicalEntities.id, ids));
      }
      if (workflowId) {
        const { workflows } = await import("@thinkwork/database-pg/schema");
        const { eq: eqOp } = await import("drizzle-orm");
        // workflow_runs (and their run items) cascade from the workflow.
        await db.delete(workflows).where(eqOp(workflows.id, workflowId));
      }
    });

    it("stamps both subjects' active claims with ONE canonical entity", async () => {
      const { runResolve } = await import(
        "../../../src/lib/memory-sources/stages.js"
      );
      const { and, eq, inArray } = await import("drizzle-orm");
      const { memoryClaims } = await import("@thinkwork/database-pg/schema");

      const result = await runResolve({
        db,
        event: {
          workflowRunId,
          tenantId: TENANT_ID,
          stepId: "resolve",
          iteration: 0,
          stage: "resolve",
          processorConfigId: randomUUID(),
          sourceConfigId: null,
          options: null,
        },
        processor: {
          id: randomUUID(),
          tenant_id: TENANT_ID,
          mode: "shared",
          target_scope: "tenant",
          target_id: TENANT_ID,
          enabled: true,
          status: "active",
          budget: {},
        } as never,
        sources: [
          {
            id: SOURCE_CONFIG_ID,
            tenant_id: TENANT_ID,
            source_family: "twenty",
            enabled: true,
            boundary: {},
            erase_generation: eraseGeneration,
          } as never,
        ],
      });

      expect(result.status).toBe("succeeded");

      const rows = await db
        .select({
          subject_key: memoryClaims.subject_key,
          canonical_subject_id: memoryClaims.canonical_subject_id,
        })
        .from(memoryClaims)
        .where(
          and(
            eq(memoryClaims.tenant_id, TENANT_ID),
            eq(memoryClaims.status, "active"),
            inArray(memoryClaims.subject_key, [companySubject, pageSubject]),
          ),
        );

      expect(rows).toHaveLength(4);
      const canonicalIds = new Set(
        rows.map((row) => row.canonical_subject_id ?? "null"),
      );
      expect(canonicalIds.size).toBe(1);
      expect([...canonicalIds][0]).not.toBe("null");
    });
  },
);
