import type { ContextHit } from "../context-engine/types.js";
import { shouldPromoteKbHit } from "./promotion-policy.js";

export interface KbPromotionWorkerInput {
	tenantId: string;
	kbHits: ContextHit[];
	entityRef?: {
		pageTable: "wiki_pages" | "tenant_entity_pages";
		pageId: string;
		subtype?: string;
	};
}

export interface KbPromotionWorkerResult {
	would_promote: number;
	would_skip: number;
}

export async function invokeKbPromotionWorker(
	input: KbPromotionWorkerInput,
): Promise<KbPromotionWorkerResult> {
	let would_promote = 0;
	let would_skip = 0;
	for (const hit of input.kbHits) {
		const decision = shouldPromoteKbHit(hit);
		if (decision.shouldPromote) would_promote += 1;
		else would_skip += 1;
		console.info("kb_promotion_inert_decision", {
			type: decision.shouldPromote ? "kb_would_promote" : "kb_would_skip",
			tenantId: input.tenantId,
			entityRef: input.entityRef ?? null,
			hitId: hit.id,
			score: decision.score,
			decision: decision.reason,
			source: hit.provenance,
		});
	}
	return { would_promote, would_skip };
}
