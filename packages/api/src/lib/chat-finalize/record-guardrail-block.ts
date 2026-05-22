/**
 * Record a guardrail-block detection into `guardrail_blocks`. Lifted from
 * chat-agent-invoke.ts (plan 2026-05-22-006 U1) — behavior identical.
 */

import { getDb } from "@thinkwork/database-pg";
import { guardrailBlocks } from "@thinkwork/database-pg/schema";
import type { GuardrailBlockPayload } from "./types.js";

const db = getDb();

export async function recordGuardrailBlock(input: {
  tenantId: string;
  agentId: string;
  guardrailId?: string | null;
  threadId?: string;
  block: GuardrailBlockPayload;
  userMessage?: string;
}): Promise<void> {
  if (!input.guardrailId) return;
  try {
    await db.insert(guardrailBlocks).values({
      tenant_id: input.tenantId,
      agent_id: input.agentId,
      guardrail_id: input.guardrailId,
      thread_id: input.threadId || undefined,
      block_type: input.block.type || "INPUT",
      action: input.block.action || "BLOCKED",
      blocked_topics: input.block.topics || [],
      content_filters: input.block.filters || {},
      raw_response: input.block.raw || {},
      user_message: (input.userMessage ?? "").slice(0, 1000),
    });
    console.log(`[chat-finalize] Guardrail block recorded to DB`);
  } catch (blockErr) {
    console.error(
      `[chat-finalize] Failed to record guardrail block:`,
      blockErr,
    );
  }
}
