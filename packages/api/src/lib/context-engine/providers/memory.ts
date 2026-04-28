import { getMemoryServices } from "../../memory/index.js";
import type {
	ContextHit,
	ContextProviderDescriptor,
	ContextProviderResult,
} from "../types.js";

const MEMORY_LIMIT = 20;

export function createMemoryContextProvider(): ContextProviderDescriptor {
	return {
		id: "memory",
		family: "memory",
		displayName: "Hindsight Memory",
		defaultEnabled: true,
		supportedScopes: ["personal", "auto"],
		async query(request): Promise<ContextProviderResult> {
			if (!request.caller.userId) {
				return {
					hits: [],
					status: {
						state: "skipped",
						reason: "user scope is required for memory recall",
					},
				};
			}

			const { recall } = getMemoryServices();
			const hits = await recall.recall({
				tenantId: request.caller.tenantId,
				ownerType: "user",
				ownerId: request.caller.userId,
				query: request.query,
				limit: Math.min(request.limit, MEMORY_LIMIT),
			});

			return {
				hits: hits.map((hit, index): ContextHit => {
					const text = hit.record.content.summary || hit.record.content.text;
					return {
						id: `memory:${hit.record.id}`,
						providerId: "memory",
						family: "memory",
						title: hit.record.content.summary || "Memory",
						snippet: text,
						score: hit.score ?? 1 / (index + 1),
						scope: request.scope,
						provenance: {
							label: "Memory",
							sourceId: hit.record.id,
							metadata: {
								backend: hit.backend,
								whyRecalled: hit.whyRecalled,
								createdAt: hit.record.createdAt,
							},
						},
						metadata: {
							ownerType: hit.record.ownerType,
							ownerId: hit.record.ownerId,
							recordMetadata: hit.record.metadata,
						},
					};
				}),
			};
		},
	};
}
