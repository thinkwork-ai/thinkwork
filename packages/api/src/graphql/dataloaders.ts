/**
 * DataLoader factory — merges per-entity loaders into a single interface.
 *
 * Each entity domain defines its own loaders in resolvers/{entity}/loaders.ts.
 * This barrel creates all of them per-request.
 */

import { createAgentLoaders } from "./resolvers/agents/loaders.js";
import { createCoreLoaders } from "./resolvers/core/loaders.js";
import { createThreadLoaders } from "./resolvers/threads/loaders.js";
import { createCostLoaders } from "./resolvers/costs/loaders.js";
import { createKnowledgeLoaders } from "./resolvers/knowledge/loaders.js";

export type DataLoaders = ReturnType<typeof createLoaders>;

export function createLoaders() {
	return {
		...createAgentLoaders(),
		...createCoreLoaders(),
		...createThreadLoaders(),
		...createCostLoaders(),
		...createKnowledgeLoaders(),
	};
}
