/**
 * PRD-09 Batch 2: Workflow config resolution with deep merge.
 *
 * Queries tenant default + hive override from workflow_configs table,
 * merges with hardcoded defaults.
 */

import { sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";

const db = getDb();

export interface OrchestrationConfig {
	allowSplit: boolean;
	maxSubTickets: number;
	maxDepth: number;
	allowDelegate: boolean;
}

export interface RetryConfig {
	maxAttempts: number;
	baseDelay: number;
	maxDelay: number;
}

export interface StallDetectionConfig {
	timeoutMinutes: number;
}

export interface TurnLoopConfig {
	enabled: boolean;
	maxTurns: number;
	continueOnToolUse: boolean;
}

export interface WorkspaceConfig {
	isolateByThread: boolean;
	prefixTemplate: string;
}

export interface SessionCompactionConfig {
	enabled: boolean;
	maxSessionRuns: number;
	maxRawInputTokens: number;
	maxSessionAgeHours: number;
}

export interface ResolvedWorkflowConfig {
	orchestration: OrchestrationConfig;
	retry: RetryConfig;
	stallDetection: StallDetectionConfig;
	turnLoop: TurnLoopConfig;
	workspace: WorkspaceConfig;
	sessionCompaction: SessionCompactionConfig;
	dispatch?: Record<string, unknown>;
	concurrency?: Record<string, unknown>;
	promptTemplate?: string;
}

const DEFAULTS: ResolvedWorkflowConfig = {
	orchestration: {
		allowSplit: true,
		maxSubTickets: 20,
		maxDepth: 3,
		allowDelegate: true,
	},
	retry: {
		maxAttempts: 5,
		baseDelay: 10,
		maxDelay: 300,
	},
	stallDetection: {
		timeoutMinutes: 5,
	},
	turnLoop: {
		enabled: false,
		maxTurns: 1,
		continueOnToolUse: false,
	},
	workspace: {
		isolateByThread: false,
		prefixTemplate: "tenants/{tenantSlug}/agents/{agentSlug}/workspace/",
	},
	sessionCompaction: {
		enabled: true,
		maxSessionRuns: 200,
		maxRawInputTokens: 2_000_000,
		maxSessionAgeHours: 72,
	},
};

function deepMerge<T>(
	base: T,
	override: Partial<T> | null | undefined,
): T {
	if (!override) return base;
	const result = { ...base };
	for (const key of Object.keys(override) as (keyof T)[]) {
		const val = override[key];
		if (
			val !== null &&
			val !== undefined &&
			typeof val === "object" &&
			!Array.isArray(val) &&
			typeof result[key] === "object" &&
			!Array.isArray(result[key])
		) {
			result[key] = deepMerge(
				result[key] as Record<string, unknown>,
				val as Record<string, unknown>,
			) as T[keyof T];
		} else if (val !== undefined) {
			result[key] = val as T[keyof T];
		}
	}
	return result;
}

export async function resolveWorkflowConfig(
	tenantId: string,
	teamId?: string,
): Promise<ResolvedWorkflowConfig> {
	try {
		// Query tenant default + optional hive override in one shot
		const result = await db.execute(sql`
			SELECT
				dispatch, concurrency, retry, turn_loop, workspace,
				stall_detection, orchestration, session_compaction,
				prompt_template, team_id
			FROM workflow_configs
			WHERE tenant_id = ${tenantId}::uuid
			  AND (team_id IS NULL ${teamId ? sql`OR team_id = ${teamId}::uuid` : sql``})
			ORDER BY team_id NULLS FIRST
		`);

		const rows = (result.rows || []) as Array<Record<string, unknown>>;

		let merged = { ...DEFAULTS };

		for (const row of rows) {
			// Apply each layer (tenant default first, then hive override)
			if (row.orchestration) {
				merged.orchestration = deepMerge(
					merged.orchestration,
					row.orchestration as Partial<OrchestrationConfig>,
				);
			}
			if (row.retry) {
				merged.retry = deepMerge(
					merged.retry,
					row.retry as Partial<RetryConfig>,
				);
			}
			if (row.stall_detection) {
				merged.stallDetection = deepMerge(
					merged.stallDetection,
					row.stall_detection as Partial<StallDetectionConfig>,
				);
			}
			if (row.dispatch) {
				merged.dispatch = deepMerge(
					(merged.dispatch || {}) as Record<string, unknown>,
					row.dispatch as Record<string, unknown>,
				);
			}
			if (row.concurrency) {
				merged.concurrency = deepMerge(
					(merged.concurrency || {}) as Record<string, unknown>,
					row.concurrency as Record<string, unknown>,
				);
			}
			if (row.turn_loop) {
				merged.turnLoop = deepMerge(
					merged.turnLoop,
					row.turn_loop as Partial<TurnLoopConfig>,
				);
			}
			if (row.workspace) {
				merged.workspace = deepMerge(
					merged.workspace,
					row.workspace as Partial<WorkspaceConfig>,
				);
			}
			if (row.session_compaction) {
				merged.sessionCompaction = deepMerge(
					merged.sessionCompaction,
					row.session_compaction as Partial<SessionCompactionConfig>,
				);
			}
			if (row.prompt_template) {
				merged.promptTemplate = row.prompt_template as string;
			}
		}

		return merged;
	} catch (err) {
		console.warn("[workflow-config] Failed to load config, using defaults:", err);
		return { ...DEFAULTS };
	}
}
