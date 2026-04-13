/**
 * ThinkWork memory contract — adapter interface.
 *
 * One of these is implemented per long-term memory engine (Hindsight,
 * AgentCore Memory, future: graphiti/cognee). Exactly one adapter is active
 * per deployment, resolved from {@link MemoryConfig.engine}. The recall,
 * inspect, and export services sit above this boundary and never touch
 * backend-native shapes.
 *
 * Defined per `.prds/memory-implementation-plan.md` §8.
 */

import type {
	ExportRequest,
	InspectRequest,
	MemoryCapabilities,
	MemoryEngineType,
	MemoryExportBundle,
	RecallRequest,
	RecallResult,
	RetainRequest,
	RetainResult,
	RetainTurnRequest,
	ThinkWorkMemoryRecord,
} from "./types.js";

export interface MemoryAdapter {
	readonly kind: MemoryEngineType;

	capabilities(): Promise<MemoryCapabilities>;

	recall(request: RecallRequest): Promise<RecallResult[]>;

	retain(request: RetainRequest): Promise<RetainResult>;

	/**
	 * Ingest a conversational turn for background extraction. Engines
	 * decide their own extraction strategy: AgentCore feeds the
	 * background semantic/preferences/summaries/episodes pipelines via
	 * CreateEvent; Hindsight feeds the conversation to its own
	 * LLM-based fact extractor. Distinct from {@link retain}, which
	 * stores a single pre-extracted fact.
	 */
	retainTurn(request: RetainTurnRequest): Promise<void>;

	inspect(request: InspectRequest): Promise<ThinkWorkMemoryRecord[]>;

	export(request: ExportRequest): Promise<MemoryExportBundle>;

	forget?(recordId: string): Promise<void>;

	update?(recordId: string, content: string): Promise<void>;

	reflect?(request: RecallRequest): Promise<RecallResult[]>;

	compact?(request: InspectRequest): Promise<void>;
}
