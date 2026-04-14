/**
 * Legacy GenUI refresh map (CRM + places).
 *
 * These static mappings live here so refreshGenUI.mutation.ts can focus on
 * the routing logic: external_task envelopes route through the adapter
 * registry; legacy genui types fall back to this map (or to the `_source`
 * embedded by AgentCore when present).
 */

export type LegacyRefreshConfig = {
	server: string;
	tool: string;
	buildParams: (data: any) => Record<string, unknown>;
};

export const GENUI_REFRESH_MAP: Record<string, LegacyRefreshConfig> = {
	opportunity_list: {
		server: "crm",
		tool: "crm_graphql",
		buildParams: (data) => ({ entity: "opportunity", first: data.items?.length || 5 }),
	},
	opportunity: {
		server: "crm",
		tool: "crm_graphql",
		buildParams: (data) => ({ entity: "opportunity", id: data.id }),
	},
	lead_list: {
		server: "crm",
		tool: "crm_graphql",
		buildParams: (data) => ({ entity: "lead", first: data.items?.length || 5 }),
	},
	lead: {
		server: "crm",
		tool: "crm_graphql",
		buildParams: (data) => ({ entity: "lead", id: data.id }),
	},
	task_list: {
		server: "crm",
		tool: "crm_graphql",
		buildParams: (data) => ({ entity: "task", first: data.items?.length || 5 }),
	},
	task: {
		server: "crm",
		tool: "crm_graphql",
		buildParams: (data) => ({ entity: "task", id: data.id }),
	},
	account_list: {
		server: "crm",
		tool: "crm_graphql",
		buildParams: (data) => ({ entity: "account", first: data.items?.length || 5 }),
	},
	account: {
		server: "crm",
		tool: "crm_graphql",
		buildParams: (data) => ({ entity: "account", id: data.id }),
	},
	place_search_results: {
		server: "places",
		tool: "places_search",
		buildParams: (data) => ({
			query: data.query || "",
			...(data.location ? { location: data.location } : {}),
		}),
	},
	place: {
		server: "places",
		tool: "place_detail",
		buildParams: (data) => ({ place_id: data.place_id || data.id }),
	},
};

/** Resolve the server name from a tool name prefix (crm_* → crm, places_* → places). */
export function inferServerFromTool(tool: string): string {
	if (tool.startsWith("crm_")) return "crm";
	if (tool.startsWith("places_") || tool === "place_detail") return "places";
	return "crm";
}
