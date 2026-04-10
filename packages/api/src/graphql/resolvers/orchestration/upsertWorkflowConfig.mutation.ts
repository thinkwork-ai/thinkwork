import type { GraphQLContext } from "../../context.js";
import {
	db, sql,
	workflowConfigToCamel,
} from "../../utils.js";

export const upsertWorkflowConfig = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const i = args.input;
	const values: Record<string, unknown> = {
		tenant_id: args.tenantId,
		team_id: i.teamId || null,
		updated_at: new Date(),
	};
	const parseJsonField = (v: unknown) => {
		if (v === null || v === undefined) return null;
		if (typeof v === "object") return v;
		if (typeof v === "string") return JSON.parse(v);
		return v;
	};
	if (i.dispatch !== undefined) values.dispatch = parseJsonField(i.dispatch);
	if (i.concurrency !== undefined) values.concurrency = parseJsonField(i.concurrency);
	if (i.retry !== undefined) values.retry = parseJsonField(i.retry);
	if (i.turnLoop !== undefined) values.turn_loop = parseJsonField(i.turnLoop);
	if (i.workspace !== undefined) values.workspace = parseJsonField(i.workspace);
	if (i.stallDetection !== undefined) values.stall_detection = parseJsonField(i.stallDetection);
	if (i.orchestration !== undefined) values.orchestration = parseJsonField(i.orchestration);
	if (i.sessionCompaction !== undefined) values.session_compaction = parseJsonField(i.sessionCompaction);
	if (i.promptTemplate !== undefined) values.prompt_template = i.promptTemplate;
	if (i.source !== undefined) values.source = i.source;
	if (i.sourceRef !== undefined) values.source_ref = i.sourceRef;

	const teamId = i.teamId || null;
	const onConflict = teamId
		? sql`(tenant_id, team_id) WHERE team_id IS NOT NULL`
		: sql`(tenant_id) WHERE team_id IS NULL`;
	const result = await db.execute(sql`
		INSERT INTO workflow_configs (tenant_id, team_id, dispatch, concurrency, retry, turn_loop, workspace, stall_detection, orchestration, session_compaction, prompt_template, source, source_ref)
		VALUES (
			${args.tenantId}::uuid,
			${teamId}::uuid,
			${values.dispatch ? JSON.stringify(values.dispatch) : null}::jsonb,
			${values.concurrency ? JSON.stringify(values.concurrency) : null}::jsonb,
			${values.retry ? JSON.stringify(values.retry) : null}::jsonb,
			${values.turn_loop ? JSON.stringify(values.turn_loop) : null}::jsonb,
			${values.workspace ? JSON.stringify(values.workspace) : null}::jsonb,
			${values.stall_detection ? JSON.stringify(values.stall_detection) : null}::jsonb,
			${values.orchestration ? JSON.stringify(values.orchestration) : null}::jsonb,
			${values.session_compaction ? JSON.stringify(values.session_compaction) : null}::jsonb,
			${values.prompt_template ?? null},
			${values.source ?? null},
			${values.source_ref ?? null}
		)
		ON CONFLICT ${onConflict}
		DO UPDATE SET
			dispatch = COALESCE(EXCLUDED.dispatch, workflow_configs.dispatch),
			concurrency = COALESCE(EXCLUDED.concurrency, workflow_configs.concurrency),
			retry = COALESCE(EXCLUDED.retry, workflow_configs.retry),
			turn_loop = COALESCE(EXCLUDED.turn_loop, workflow_configs.turn_loop),
			workspace = COALESCE(EXCLUDED.workspace, workflow_configs.workspace),
			stall_detection = COALESCE(EXCLUDED.stall_detection, workflow_configs.stall_detection),
			orchestration = COALESCE(EXCLUDED.orchestration, workflow_configs.orchestration),
			session_compaction = COALESCE(EXCLUDED.session_compaction, workflow_configs.session_compaction),
			prompt_template = COALESCE(EXCLUDED.prompt_template, workflow_configs.prompt_template),
			source = COALESCE(EXCLUDED.source, workflow_configs.source),
			source_ref = COALESCE(EXCLUDED.source_ref, workflow_configs.source_ref),
			version = workflow_configs.version + 1,
			updated_at = now()
		RETURNING *
	`);
	const row = (result.rows || [])[0] as Record<string, unknown>;
	if (!row) throw new Error("Failed to upsert workflow config");
	return workflowConfigToCamel(row);
};
