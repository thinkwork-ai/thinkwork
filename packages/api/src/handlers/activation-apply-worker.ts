import type { ScheduledEvent } from "aws-lambda";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { activationApplyOutbox } from "@thinkwork/database-pg/schema";
import { writeUserMdForAssignment } from "../lib/user-md-writer.js";
import {
  writeUserMemorySeed,
  writeUserWikiSeed,
  type ActivationSeed,
} from "../lib/user-storage.js";

const db = getDb();

export async function handler(_event: ScheduledEvent) {
  const rows = await db
    .select()
    .from(activationApplyOutbox)
    .where(eq(activationApplyOutbox.status, "pending"))
    .orderBy(asc(activationApplyOutbox.created_at))
    .limit(25);

  for (const row of rows) {
    const claimed = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(activationApplyOutbox)
        .where(
          and(
            eq(activationApplyOutbox.id, row.id),
            eq(activationApplyOutbox.status, "pending"),
          ),
        )
        .for("update");
      if (!locked) return null;
      const [updated] = await tx
        .update(activationApplyOutbox)
        .set({
          status: "processing",
          attempts: locked.attempts + 1,
          updated_at: new Date(),
        })
        .where(eq(activationApplyOutbox.id, locked.id))
        .returning();
      return updated;
    });
    if (!claimed) continue;

    try {
      await processItem(claimed);
      await db
        .update(activationApplyOutbox)
        .set({
          status: "completed",
          completed_at: new Date(),
          updated_at: new Date(),
          last_error: null,
        })
        .where(eq(activationApplyOutbox.id, claimed.id));
    } catch (err) {
      const attempts = claimed.attempts;
      await db
        .update(activationApplyOutbox)
        .set({
          status: attempts >= 5 ? "failed" : "pending",
          last_error: (err as Error)?.message ?? String(err),
          updated_at: new Date(),
        })
        .where(eq(activationApplyOutbox.id, claimed.id));
    }
  }

  return { processed: rows.length };
}

async function processItem(row: typeof activationApplyOutbox.$inferSelect) {
  const payload = row.payload as Record<string, any>;
  if (row.item_type === "user_md") {
    await writeUserMdForAssignment(
      db,
      String(payload.agentId),
      String(payload.userId),
    );
    return;
  }
  const seedPayload = (payload.payload ?? {}) as Record<string, unknown>;
  const seed: ActivationSeed = {
    tenantId: String(payload.tenantId ?? seedPayload.tenantId ?? ""),
    userId: String(payload.userId ?? seedPayload.userId ?? ""),
    layer: String(payload.layer ?? seedPayload.layer ?? ""),
    title:
      typeof seedPayload.title === "string" ? seedPayload.title : undefined,
    summary:
      typeof seedPayload.summary === "string" ? seedPayload.summary : undefined,
    content:
      typeof seedPayload.content === "string" ? seedPayload.content : undefined,
    metadata: { itemId: seedPayload.itemId, source: "activation" },
  };
  if (row.item_type === "memory_seed") {
    await writeUserMemorySeed(seed);
    return;
  }
  if (row.item_type === "wiki_seed") {
    await writeUserWikiSeed(seed);
    return;
  }
  throw new Error(`Unsupported activation outbox item_type: ${row.item_type}`);
}
