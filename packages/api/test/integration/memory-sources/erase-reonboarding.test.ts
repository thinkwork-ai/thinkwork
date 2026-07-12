/**
 * THINK-193 U8 P1 (erase epoch): post-erase re-onboarding must work end to
 * end against the REAL schema. Before the fix it broke two ways:
 *   (a) erase left lifecycle='deleted' evidence tombstones occupying the
 *       (source_config_id, source_item_id, source_version) unique slot, so
 *       re-acquiring identical provider content was a silent acquire no-op;
 *   (b) exact-fingerprint claim reuse never reactivated retracted claims,
 *       so unchanged re-projected content stayed retracted forever.
 *
 * The fix: the erase cleanup hard-DELETEs the source's evidence rows (their
 * claim edges and derivations go with them, explicitly, in the same
 * transaction), and upsertClaimsForEvidence mints a NEW claim edition when
 * an exact-fingerprint match is non-active, has zero remaining evidence
 * edges, and the source carries erase_generation > 0.
 *
 * Integration test — needs a real Postgres with the memory-source schema.
 * Runs only when DATABASE_URL is set; used against the dev stack for U8
 * acceptance evidence. Creates its OWN processor/source config rows so the
 * erase never touches shared dev fixtures.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const TENANT_ID =
  process.env.MEMORY_TEST_TENANT_ID ?? "0015953e-aa13-4cab-8398-2e70f73dda63";

describe.skipIf(!DATABASE_URL)(
  "erase epoch → re-onboarding (integration)",
  () => {
    const sourceItemId = `co-erase-${randomUUID()}`;
    const subjectKey = `twenty:company:${sourceItemId}`;
    const sourceVersion = "v1-stable";
    const snapshot = { id: sourceItemId, name: "Erase Epoch Probe Co" };
    let db: import("@thinkwork/database-pg").Database;
    let processorId: string;
    let sourceConfigId: string;

    const acquireIdentical = async (workflowRunId: string | null) => {
      const { recordAcquiredPage, computeContentHash } = await import(
        "../../../src/lib/memory-sources/evidence.js"
      );
      const { ensureCheckpoint } = await import(
        "../../../src/lib/memory-sources/repository.js"
      );
      const checkpoint = await ensureCheckpoint(db, {
        tenantId: TENANT_ID,
        sourceConfigId,
        partitionKey: "default",
      });
      return recordAcquiredPage(db, {
        tenantId: TENANT_ID,
        sourceConfigId,
        workflowRunId: workflowRunId ?? randomUUID(),
        partitionKey: "default",
        expectedCheckpointVersion: checkpoint.version,
        nextCursor: { probe: true },
        skipCheckpointAdvance: true,
        items: [
          {
            sourceItemId,
            sourceVersion,
            contentHash: computeContentHash(snapshot),
            targetScope: "tenant" as const,
            targetId: TENANT_ID,
            normalizedSnapshot: snapshot,
            extractionRecipe: { version: "u8-test" },
          },
        ],
      });
    };

    const projectIdentical = async (evidenceItemId: string) => {
      const { upsertClaimsForEvidence } = await import(
        "../../../src/lib/memory-sources/claims.js"
      );
      const { computeContentHash } = await import(
        "../../../src/lib/memory-sources/evidence.js"
      );
      const value = { text: "Erase Epoch Probe Co" };
      return upsertClaimsForEvidence(db, {
        tenantId: TENANT_ID,
        targetScope: "tenant",
        targetId: TENANT_ID,
        sourceConfigId,
        evidenceItemId,
        subjectKey,
        effectiveFrom: new Date("2026-07-10T00:00:00.000Z"),
        claims: [
          {
            subjectKey,
            subjectEntityType: "customer",
            ontologyPredicate: "customer.name",
            value,
            valueHash: computeContentHash(value),
            effectiveFrom: new Date("2026-07-10T00:00:00.000Z"),
            extractionVersion: "u8-test",
          },
        ],
      });
    };

    beforeAll(async () => {
      const { getDb } = await import("@thinkwork/database-pg");
      const { memoryProcessorConfigs, memorySourceConfigs } = await import(
        "@thinkwork/database-pg/schema"
      );
      db = getDb();
      const [processor] = await db
        .insert(memoryProcessorConfigs)
        .values({
          tenant_id: TENANT_ID,
          mode: "shared",
          target_scope: "tenant",
          target_id: TENANT_ID,
          enabled: true,
          // 'disabled' status keeps this fixture out of the tenant's ACTIVE
          // processor partial-unique slot (one active shared processor per
          // target) while all FK/erase behavior under test stays identical.
          status: "disabled",
        })
        .returning({ id: memoryProcessorConfigs.id });
      processorId = processor!.id;
      const [source] = await db
        .insert(memorySourceConfigs)
        .values({
          tenant_id: TENANT_ID,
          processor_config_id: processorId,
          source_family: "twenty",
          source_binding_key: `erase-epoch-test-${randomUUID()}`,
          enabled: true,
          boundary: {},
        })
        .returning({ id: memorySourceConfigs.id });
      sourceConfigId = source!.id;
    });

    afterAll(async () => {
      if (!db) return;
      const { eq } = await import("drizzle-orm");
      const {
        memoryClaims,
        memoryProcessorConfigs,
        memoryRetractionAttempts,
        memorySourceConfigs,
      } = await import("@thinkwork/database-pg/schema");
      // Evidence / edges / derivations / checkpoints cascade from the
      // source config; run items reference workflow runs we never created.
      await db
        .delete(memoryRetractionAttempts)
        .where(eq(memoryRetractionAttempts.source_config_id, sourceConfigId));
      await db
        .delete(memoryClaims)
        .where(eq(memoryClaims.subject_key, subjectKey));
      await db
        .delete(memorySourceConfigs)
        .where(eq(memorySourceConfigs.id, sourceConfigId));
      await db
        .delete(memoryProcessorConfigs)
        .where(eq(memoryProcessorConfigs.id, processorId));
    });

    it("erase → re-enable → re-acquire identical content yields active evidence, active claims, and a retained doc lineage", async () => {
      const { and, eq } = await import("drizzle-orm");
      const {
        memoryClaims,
        memoryClaimEvidence,
        memoryDerivations,
        memoryEvidenceItems,
        memorySourceConfigs,
      } = await import("@thinkwork/database-pg/schema");
      const { recordDerivation } = await import(
        "../../../src/lib/memory-sources/evidence.js"
      );
      const { beginSourceErase, runSourceErase } = await import(
        "../../../src/lib/memory-sources/retraction.js"
      );

      // ---- First onboarding: acquire → claims → derivation -------------
      const firstAcquire = await acquireIdentical(null);
      expect(firstAcquire.changed).toHaveLength(1);
      const firstEvidenceId = firstAcquire.changed[0]!.id;
      const firstUpsert = await projectIdentical(firstEvidenceId);
      expect(firstUpsert.created).toBe(1);
      await recordDerivation(db, {
        tenantId: TENANT_ID,
        sourceConfigId,
        evidenceItemId: firstEvidenceId,
        projectionKey: `company:${sourceItemId}`,
        targetBankId: `tenant_${TENANT_ID}`,
        hindsightDocumentId: `external:${sourceConfigId}:company:${sourceItemId}`,
        currentVersion: sourceVersion,
      });

      // ---- Erase: begin + self-finalizing aggregate ---------------------
      const { eraseGeneration } = await beginSourceErase(db, {
        tenantId: TENANT_ID,
        sourceConfigId,
      });
      expect(eraseGeneration).toBe(1);
      const eraseResult = await runSourceErase(
        {
          db,
          adapter: {
            deleteDocument: async () => "deleted" as const,
            consolidateBankById: async () => {},
          },
          deleteSnapshots: async () => ({
            objects: 0,
            versions: 0,
            truncated: false,
          }),
          destructiveCleanup: true,
        },
        { tenantId: TENANT_ID, sourceConfigId },
      );
      expect(eraseResult.status).toBe("completed");

      // Epoch invariant: evidence rows are GONE (not tombstoned), edges and
      // derivations went with them, dead claims have zero edges.
      const evidenceLeft = await db
        .select({ id: memoryEvidenceItems.id })
        .from(memoryEvidenceItems)
        .where(eq(memoryEvidenceItems.source_config_id, sourceConfigId));
      expect(evidenceLeft).toHaveLength(0);
      const derivationsLeft = await db
        .select({ id: memoryDerivations.id })
        .from(memoryDerivations)
        .where(eq(memoryDerivations.source_config_id, sourceConfigId));
      expect(derivationsLeft).toHaveLength(0);
      const edgesLeft = await db
        .select({ id: memoryClaimEvidence.id })
        .from(memoryClaimEvidence)
        .where(eq(memoryClaimEvidence.source_config_id, sourceConfigId));
      expect(edgesLeft).toHaveLength(0);
      const deadClaims = await db
        .select({ status: memoryClaims.status })
        .from(memoryClaims)
        .where(eq(memoryClaims.subject_key, subjectKey));
      expect(deadClaims).toHaveLength(1);
      expect(deadClaims[0]!.status).toBe("retracted");

      // ---- Re-enable + re-onboard with IDENTICAL provider content ------
      await db
        .update(memorySourceConfigs)
        .set({ enabled: true })
        .where(eq(memorySourceConfigs.id, sourceConfigId));

      const secondAcquire = await acquireIdentical(null);
      // (a) no tombstone in the unique slot: identical content re-inserts.
      expect(secondAcquire.changed).toHaveLength(1);
      const secondEvidenceId = secondAcquire.changed[0]!.id;
      expect(secondEvidenceId).not.toBe(firstEvidenceId);
      expect(secondAcquire.changed[0]!.lifecycle).toBe("active");

      // (b) the retracted claim is replaced by a NEW active edition.
      const secondUpsert = await projectIdentical(secondEvidenceId);
      expect(secondUpsert.created).toBe(1);
      const claimsNow = await db
        .select()
        .from(memoryClaims)
        .where(
          and(
            eq(memoryClaims.subject_key, subjectKey),
            eq(memoryClaims.status, "active"),
          ),
        );
      expect(claimsNow).toHaveLength(1);
      expect(claimsNow[0]!.effective_to).toBeNull();
      const allClaims = await db
        .select({ id: memoryClaims.id })
        .from(memoryClaims)
        .where(eq(memoryClaims.subject_key, subjectKey));
      expect(allClaims).toHaveLength(1); // dead row deleted, not kept

      // Retained doc lineage: derivation upserts back to active.
      const derivation = await recordDerivation(db, {
        tenantId: TENANT_ID,
        sourceConfigId,
        evidenceItemId: secondEvidenceId,
        projectionKey: `company:${sourceItemId}`,
        targetBankId: `tenant_${TENANT_ID}`,
        hindsightDocumentId: `external:${sourceConfigId}:company:${sourceItemId}`,
        currentVersion: sourceVersion,
      });
      expect(derivation.lifecycle).toBe("active");
      expect(derivation.evidence_item_id).toBe(secondEvidenceId);
    });
  },
);
