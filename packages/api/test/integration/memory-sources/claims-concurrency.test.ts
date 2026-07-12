/**
 * THINK-193 U2 (Codex concurrency finding): two concurrent evidence
 * editions upserting claims for the SAME subject must never leave
 * duplicate ACTIVE same-value claims. The advisory lock in
 * upsertClaimsForEvidence serializes them; the partial unique index
 * memory_claims_active_value_uidx (0237) backstops.
 *
 * Integration test — needs a real Postgres with the memory-source schema
 * (0232/0234/0237 applied). Runs only when DATABASE_URL is set; used
 * against the dev stack for U2 acceptance evidence.
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
  "upsertClaimsForEvidence concurrency (integration)",
  () => {
    const subjectKey = `twenty:company:test-${randomUUID()}`;
    const evidenceIds: string[] = [];
    let db: import("@thinkwork/database-pg").Database;

    beforeAll(async () => {
      const { getDb } = await import("@thinkwork/database-pg");
      const { memoryEvidenceItems } = await import(
        "@thinkwork/database-pg/schema"
      );
      db = getDb();
      for (let i = 0; i < 2; i += 1) {
        const [row] = await db
          .insert(memoryEvidenceItems)
          .values({
            tenant_id: TENANT_ID,
            source_config_id: SOURCE_CONFIG_ID,
            source_item_id: subjectKey,
            source_version: `test-${i}-${randomUUID()}`,
            content_hash: `test-${i}`,
            target_scope: "tenant",
            target_id: TENANT_ID,
            lifecycle: "active",
            extraction_recipe: {},
          })
          .returning({ id: memoryEvidenceItems.id });
        evidenceIds.push(row!.id);
      }
    });

    afterAll(async () => {
      const { inArray, eq } = await import("drizzle-orm");
      const { memoryClaims, memoryClaimEvidence, memoryEvidenceItems } =
        await import("@thinkwork/database-pg/schema");
      await db
        .delete(memoryClaimEvidence)
        .where(inArray(memoryClaimEvidence.evidence_item_id, evidenceIds));
      await db
        .delete(memoryClaims)
        .where(eq(memoryClaims.subject_key, subjectKey));
      await db
        .delete(memoryEvidenceItems)
        .where(inArray(memoryEvidenceItems.id, evidenceIds));
    });

    it("two concurrent editions leave exactly one active claim per value", async () => {
      const { upsertClaimsForEvidence } = await import(
        "../../../src/lib/memory-sources/claims.js"
      );
      const { computeContentHash } = await import(
        "../../../src/lib/memory-sources/evidence.js"
      );
      const { and, eq } = await import("drizzle-orm");
      const { memoryClaims } = await import("@thinkwork/database-pg/schema");

      const value = { text: "Concurrency Probe Co" };
      const personValue = { externalId: `p-${randomUUID()}` };
      const claimsFor = (effectiveFrom: Date) => [
        {
          subjectKey,
          subjectEntityType: "customer",
          ontologyPredicate: "customer.name",
          value,
          valueHash: computeContentHash(value),
          effectiveFrom,
          extractionVersion: "test",
        },
        {
          subjectKey,
          subjectEntityType: "customer",
          ontologyPredicate: "customer.person",
          value: personValue,
          valueHash: computeContentHash(personValue),
          effectiveFrom,
          extractionVersion: "test",
        },
      ];

      // Same values, DIFFERENT effective_from: both writers would miss an
      // exact-fingerprint match; without the lock both could insert.
      await Promise.all([
        upsertClaimsForEvidence(db, {
          tenantId: TENANT_ID,
          targetScope: "tenant",
          targetId: TENANT_ID,
          sourceConfigId: SOURCE_CONFIG_ID,
          evidenceItemId: evidenceIds[0]!,
          subjectKey,
          effectiveFrom: new Date("2026-07-12T00:00:00.000Z"),
          claims: claimsFor(new Date("2026-07-12T00:00:00.000Z")),
        }),
        upsertClaimsForEvidence(db, {
          tenantId: TENANT_ID,
          targetScope: "tenant",
          targetId: TENANT_ID,
          sourceConfigId: SOURCE_CONFIG_ID,
          evidenceItemId: evidenceIds[1]!,
          subjectKey,
          effectiveFrom: new Date("2026-07-12T00:00:01.000Z"),
          claims: claimsFor(new Date("2026-07-12T00:00:01.000Z")),
        }),
      ]);

      const rows = await db
        .select({
          predicate: memoryClaims.ontology_predicate,
          status: memoryClaims.status,
        })
        .from(memoryClaims)
        .where(
          and(
            eq(memoryClaims.subject_key, subjectKey),
            eq(memoryClaims.status, "active"),
          ),
        );
      const activeByPredicate = new Map<string, number>();
      for (const row of rows) {
        activeByPredicate.set(
          row.predicate,
          (activeByPredicate.get(row.predicate) ?? 0) + 1,
        );
      }
      expect(activeByPredicate.get("customer.name")).toBe(1);
      expect(activeByPredicate.get("customer.person")).toBe(1);
    });
  },
);
