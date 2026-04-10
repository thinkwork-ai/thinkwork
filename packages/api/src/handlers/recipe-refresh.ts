/**
 * Recipe Refresh — executes a saved recipe's MCP tool directly (no LLM).
 *
 * Supports two modes:
 *   1. { recipeId }                  → fetch recipe from DB, resolve templates, call MCP, update cached_result
 *   2. { server, tool, params }      → direct MCP call (for in-thread GenUI refresh without a saved recipe)
 *
 * POST /api/recipe-refresh
 * Auth: X-API-Key (Thinkwork API auth)
 */

import { getDb } from "@thinkwork/database-pg";
import { recipes } from "@thinkwork/database-pg/schema";
import { eq } from "drizzle-orm";
import { resolveTemplates } from "../lib/template-resolver.js";

const API_AUTH_SECRET = process.env.API_AUTH_SECRET || "";
const MCP_BASE_URL = process.env.LASTMILE_MCP_BASE_URL || "https://mcp-dev.lastmile-tei.com";
const MCP_SERVICE_KEY = process.env.LASTMILE_MCP_SERVICE_KEY || "";

interface LambdaEvent {
	headers?: Record<string, string | undefined>;
	body?: string | null;
	requestContext?: { http?: { method?: string } };
	httpMethod?: string;
}

function json(statusCode: number, body: unknown) {
	return {
		statusCode,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
		},
		body: JSON.stringify(body),
	};
}

async function callMcpTool(toolName: string, args: Record<string, unknown>, server: string): Promise<unknown> {
	const mcpUrl = `${MCP_BASE_URL}/${server}`;
	const rpcResponse = await fetch(mcpUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${MCP_SERVICE_KEY}`,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: toolName, arguments: args },
		}),
	});

	const rpc = await rpcResponse.json();
	if (rpc?.error) throw new Error(rpc.error.message || "MCP error");

	const content = rpc?.result?.content;
	if (Array.isArray(content)) {
		for (const item of content) {
			if (item?.type === "text" && item?.text) {
				try { return JSON.parse(item.text); } catch { return item.text; }
			}
		}
	}
	return null;
}

export async function handler(event: LambdaEvent) {
	const method = event.requestContext?.http?.method || event.httpMethod || "POST";
	if (method === "OPTIONS") return json(204, "");

	// Auth
	const apiKey = event.headers?.["x-api-key"] || event.headers?.["X-API-Key"];
	const authHeader = event.headers?.authorization || event.headers?.Authorization;
	const token = apiKey || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
	if (!API_AUTH_SECRET || !token || token !== API_AUTH_SECRET) {
		return json(401, { ok: false, error: "Unauthorized" });
	}
	if (!MCP_SERVICE_KEY) {
		return json(500, { ok: false, error: "MCP service key not configured" });
	}

	let body: Record<string, unknown>;
	try {
		body = event.body ? JSON.parse(event.body) : {};
	} catch {
		return json(400, { ok: false, error: "Invalid JSON" });
	}

	const recipeId = body.recipeId as string | undefined;

	try {
		// ── Mode 1: Recipe-based refresh (fetch from DB, resolve templates) ──
		if (recipeId) {
			const db = getDb();
			const [recipe] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
			if (!recipe) return json(404, { ok: false, error: "Recipe not found" });

			const resolvedParams = resolveTemplates(
				recipe.params as Record<string, unknown>,
				recipe.templates as Record<string, string> | null,
				{ tenantId: recipe.tenant_id },
			);

			const result = await callMcpTool(recipe.tool, resolvedParams, recipe.server);

			await db.update(recipes).set({
				cached_result: result as any,
				last_refreshed: new Date(),
				last_error: null,
				updated_at: new Date(),
			}).where(eq(recipes.id, recipeId));

			return json(200, { ok: true, result, genuiType: recipe.genui_type });
		}

		// ── Mode 2: Direct refresh (server + tool + params provided) ──
		const server = body.server as string;
		const tool = body.tool as string;
		const params = body.params as Record<string, unknown>;
		if (!server || !tool || !params) {
			return json(400, { ok: false, error: "Either recipeId or (server, tool, params) is required" });
		}

		const result = await callMcpTool(tool, params, server);
		return json(200, { ok: true, result });
	} catch (err) {
		// For recipe-based refresh, store error and return cached result if available
		if (recipeId) {
			const db = getDb();
			const errorMsg = `MCP call failed: ${err}`;
			await db.update(recipes).set({
				last_error: errorMsg,
				updated_at: new Date(),
			}).where(eq(recipes.id, recipeId));

			const [recipe] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
			if (recipe?.cached_result) {
				return json(200, {
					ok: true,
					result: recipe.cached_result,
					genuiType: recipe.genui_type,
					stale: true,
					error: errorMsg,
				});
			}
		}

		return json(502, { ok: false, error: `MCP call failed: ${err}` });
	}
}
