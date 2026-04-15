/**
 * Unit tests for the shared MCP JSON-RPC client.
 *
 * Focus: tool-level errors. LastMile signals "the tool ran and failed"
 * by returning `result.isError: true` with the failure message inside
 * `result.content[0].text`, not via the top-level JSON-RPC `error` field.
 * PR F probed this live on mcp-dev.lastmile-tei.com — calling `tasks_get`
 * with a stale id returns:
 *
 *   { jsonrpc: "2.0", id: 1, result: { content: [{type:"text",text:"Error: Task not found."}], isError: true } }
 *
 * Before PR F, the client ignored `isError` and silently returned the
 * error string as a payload, producing confusing "non-object payload"
 * errors downstream. The tests below lock the new contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callMcpTool } from "../integrations/external-work-items/mcpClient.js";

const originalFetch = globalThis.fetch;

function mockFetchOnce(response: unknown, init: { status?: number } = {}) {
	globalThis.fetch = vi.fn(async () =>
		new Response(JSON.stringify(response), {
			status: init.status ?? 200,
			headers: { "Content-Type": "application/json" },
		}),
	) as unknown as typeof fetch;
}

beforeEach(() => {
	// Ensure predictable env for the MCP_BASE_URL fallback.
	process.env.LASTMILE_MCP_BASE_URL = "https://mcp-test.invalid";
	process.env.LASTMILE_MCP_SERVICE_KEY = "test-service-key";
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("callMcpTool — tool-level errors via result.isError", () => {
	it("throws with the first text content when isError=true", async () => {
		mockFetchOnce({
			jsonrpc: "2.0",
			id: 1,
			result: {
				content: [{ type: "text", text: "Error: Task not found." }],
				isError: true,
			},
		});

		await expect(
			callMcpTool({
				server: "tasks",
				tool: "tasks_get",
				args: { task_id: "task_missing" },
			}),
		).rejects.toThrow("[mcp tasks_get] Error: Task not found.");
	});

	it("uses a generic message when isError=true but no content text is present", async () => {
		mockFetchOnce({
			jsonrpc: "2.0",
			id: 1,
			result: { content: [], isError: true },
		});

		await expect(
			callMcpTool({
				server: "tasks",
				tool: "tasks_get",
				args: { task_id: "task_missing" },
			}),
		).rejects.toThrow("[mcp tasks_get] tool error");
	});

	it("prefers the isError path over silently returning a string payload", async () => {
		// Before PR F this would JSON.parse("Error: ...") and fall through
		// to return the string, so a .then() chain downstream would see an
		// unexpected non-object. Now it throws.
		mockFetchOnce({
			jsonrpc: "2.0",
			id: 1,
			result: {
				content: [{ type: "text", text: "some-unparseable-text" }],
				isError: true,
			},
		});

		await expect(
			callMcpTool({
				server: "tasks",
				tool: "task_update",
				args: { task_id: "task_1" },
			}),
		).rejects.toThrow("[mcp task_update] some-unparseable-text");
	});
});

describe("callMcpTool — successful responses", () => {
	it("parses JSON text content and returns the object", async () => {
		mockFetchOnce({
			jsonrpc: "2.0",
			id: 1,
			result: {
				content: [
					{
						type: "text",
						text: JSON.stringify({ id: "task_ok", title: "OK task" }),
					},
				],
			},
		});

		const result = await callMcpTool({
			server: "tasks",
			tool: "tasks_get",
			args: { task_id: "task_ok" },
		});

		expect(result).toEqual({ id: "task_ok", title: "OK task" });
	});

	it("returns the raw text when the content isn't valid JSON (legacy fallback)", async () => {
		mockFetchOnce({
			jsonrpc: "2.0",
			id: 1,
			result: {
				content: [{ type: "text", text: "plain string response" }],
			},
		});

		const result = await callMcpTool({
			server: "tasks",
			tool: "tasks_schema",
			args: {},
		});

		expect(result).toBe("plain string response");
	});

	it("returns null when the response has no content array", async () => {
		mockFetchOnce({ jsonrpc: "2.0", id: 1, result: {} });

		const result = await callMcpTool({
			server: "tasks",
			tool: "tasks_schema",
			args: {},
		});

		expect(result).toBeNull();
	});
});

describe("callMcpTool — transport-level errors", () => {
	it("throws when the JSON-RPC response carries a top-level error", async () => {
		mockFetchOnce({
			jsonrpc: "2.0",
			id: 1,
			error: { message: "parse error" },
		});

		await expect(
			callMcpTool({ server: "tasks", tool: "tasks_get", args: {} }),
		).rejects.toThrow("parse error");
	});

	it("throws a generic 'MCP error' when top-level error has no message", async () => {
		mockFetchOnce({ jsonrpc: "2.0", id: 1, error: {} });

		await expect(
			callMcpTool({ server: "tasks", tool: "tasks_get", args: {} }),
		).rejects.toThrow("MCP error");
	});
});
