import type {
	ContextEngineAnswer,
	ContextEngineProviderRequest,
	ContextHit,
} from "./types.js";

export async function synthesizeContextAnswer(
	_request: ContextEngineProviderRequest,
	hits: ContextHit[],
): Promise<ContextEngineAnswer | undefined> {
	const citedHits = hits.slice(0, 5);
	if (citedHits.length === 0) return undefined;
	const text = citedHits
		.map((hit, index) => `[${index + 1}] ${hit.title}: ${hit.snippet}`)
		.join("\n");
	return {
		text,
		hitIds: citedHits.map((hit) => hit.id),
	};
}
