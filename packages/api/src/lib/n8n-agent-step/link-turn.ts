import { and, eq, inArray } from "drizzle-orm";
import { n8nAgentStepRuns } from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";

type DbLike = typeof defaultDb;

export async function linkN8nAgentStepRunTurn(
  input: {
    tenantId: string;
    runId: string;
    threadTurnId: string;
    now?: Date;
  },
  deps: { db?: DbLike } = {},
): Promise<void> {
  const db = deps.db ?? defaultDb;
  await db
    .update(n8nAgentStepRuns)
    .set({
      thread_turn_id: input.threadTurnId,
      updated_at: input.now ?? new Date(),
    })
    .where(
      and(
        eq(n8nAgentStepRuns.tenant_id, input.tenantId),
        eq(n8nAgentStepRuns.id, input.runId),
        inArray(n8nAgentStepRuns.status, [
          "accepted",
          "waiting",
          "awaiting_human",
        ]),
      ),
    );
}
