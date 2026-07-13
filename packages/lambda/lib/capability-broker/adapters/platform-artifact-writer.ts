/**
 * Drizzle-backed platform Artifact writer for the platform adapter (THINK-280
 * U5). Kept in its own module so `platform.ts` stays DB-free and unit-testable;
 * the DB client is loaded lazily (dynamic import) exactly like the broker
 * evidence store, so importing the adapter never drags Aurora into the pure
 * broker core.
 *
 * This is the ONLY database write the platform adapter performs. It is narrow
 * by construction: a single `insert(artifacts)` that stamps service-principal
 * attribution and broker provenance into `metadata`. It never calls a GraphQL
 * resolver and never touches the user-facing auth path.
 */

import type {
  PlatformArtifactInsert,
  PlatformArtifactWriter,
} from "./platform.js";

/**
 * Build the real writer. `createdByUserId` is passed through verbatim from the
 * adapter (NULL for a service principal), so the artifact row carries the exact
 * "NULL = system" attribution the platform expects.
 */
export function createDrizzlePlatformArtifactWriter(): PlatformArtifactWriter {
  return {
    async create(input: PlatformArtifactInsert): Promise<{ id: string }> {
      const { getDb } = await import("@thinkwork/database-pg");
      const schema = await import("@thinkwork/database-pg/schema");
      const { randomUUID } = await import("node:crypto");
      const db = getDb() as unknown as {
        insert: (t: unknown) => {
          values: (v: Record<string, unknown>) => {
            returning: () => Promise<Array<{ id: string }>>;
          };
        };
      };
      const artifacts = (schema as Record<string, unknown>).artifacts;
      const id = randomUUID();
      const [row] = await db
        .insert(artifacts)
        .values({
          id,
          tenant_id: input.tenantId,
          created_by_user_id: input.createdByUserId,
          title: input.title,
          type: input.type,
          status: "final",
          content: input.content,
          summary: input.summary,
          metadata: {
            source: "capability_broker",
            operation_ref: input.operationRef,
            broker_call_id: input.brokerCallId,
            routine_execution_id: input.routineExecutionId,
            thread_turn_id: input.threadTurnId,
          },
        })
        .returning();
      return { id: row?.id ?? id };
    },
  };
}
