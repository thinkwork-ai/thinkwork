/**
 * Unit tests for the shared MCP JSON-RPC client.
 *
 * Contract locked by these tests:
 *   - `url` + `authToken` are required (no env-var defaults, no service-key
 *     fallback). Callers must resolve from `tenant_mcp_servers`.
 *   - Tool-level errors surface via `result.isError`, not top-level JSON-RPC
 *     `error`. The client throws with the first text-content message.
 *   - On 401 / WorkOS-rejection body signature, the client invokes
 *     `refreshToken` exactly once and retries with the rotated bearer.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { callMcpTool } from "../integrations/external-work-items/mcpClient.js";

const TEST_URL = "https://mcp-test.invalid/tasks";
const TEST_AUTH = "test-bearer-token";

const originalFetch = globalThis.fetch;

function mockFetchOnce(response: unknown, init: { status?: number } = {}) {
	globalThis.fetch = vi.fn(async () =>
		new Response(JSON.stringify(response), {
			status: init.status ?? 200,
			headers: { "Content-Type": "application/json" },
		}),
	) as unknown as typeof fetch;
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("callMcpTool — required args", () => {
	it("throws if url is missing", async () => {
		await expect(
			// @ts-expect-error — intentionally exercising runtime guard
			callMcpTool({ tool: "tasks_get", args: {}, authToken: TEST_AUTH }),
		).rejects.toThrow(/url is required/);
	});

	it("throws if authToken is missing", async () => {
		await expect(
			// @ts-expect-error — intentionally exercising runtime guard
			callMcpTool({ url: TEST_URL, tool: "tasks_get", args: {} }),
		).rejects.toThrow(/authToken is required/);
	});
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
				url: TEST_URL,
				tool: "tasks_get",
				args: { task_id: "task_missing" },
				authToken: TEST_AUTH,
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
				url: TEST_URL,
				tool: "tasks_get",
				args: { task_id: "task_missing" },
				authToken: TEST_AUTH,
			}),
		).rejects.toThrow("[mcp tasks_get] tool error");
	});

	it("prefers the isError path over silently returning a string payload", async () => {
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
				url: TEST_URL,
				tool: "task_update",
				args: { task_id: "task_1" },
				authToken: TEST_AUTH,
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
			url: TEST_URL,
			tool: "tasks_get",
			args: { task_id: "task_ok" },
			authToken: TEST_AUTH,
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
			url: TEST_URL,
			tool: "tasks_schema",
			args: {},
			authToken: TEST_AUTH,
		});

		expect(result).toBe("plain string response");
	});

	it("returns null when the response has no content array", async () => {
		mockFetchOnce({ jsonrpc: "2.0", id: 1, result: {} });

		const result = await callMcpTool({
			url: TEST_URL,
			tool: "tasks_schema",
			args: {},
			authToken: TEST_AUTH,
		});

		expect(result).toBeNull();
	});
});

describe("callMcpTool — 401 refresh-and-retry", () => {
	function mockFetchSequence(
		responses: Array<{ status?: number; body: unknown; isJson?: boolean }>,
	) {
		let i = 0;
		globalThis.fetch = vi.fn(async () => {
			const r = responses[i++];
			const bodyText =
				r.isJson === false ? String(r.body) : JSON.stringify(r.body);
			return new Response(bodyText, {
				status: r.status ?? 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as unknown as typeof fetch;
	}

	it("retries once with a refreshed bearer on HTTP 401 and returns the second response", async () => {
		mockFetchSequence([
			{ status: 401, body: { error: "Failed to validate WorkOS user." } },
			{
				status: 200,
				body: {
					jsonrpc: "2.0",
					id: 1,
					result: {
						content: [{ type: "text", text: JSON.stringify({ id: "task_ok" }) }],
					},
				},
			},
		]);

		const refreshToken = vi.fn(async () => "new-bearer-token");
		const result = await callMcpTool({
			url: TEST_URL,
			tool: "tasks_get",
			args: { task_id: "task_ok" },
			authToken: "stale-bearer-token",
			refreshToken,
		});

		expect(result).toEqual({ id: "task_ok" });
		expect(refreshToken).toHaveBeenCalledTimes(1);
	});

	it("propagates the original 401 when the refresh callback returns null", async () => {
		mockFetchSequence([
			{ status: 401, body: { error: "Failed to validate WorkOS user." } },
		]);

		const refreshToken = vi.fn(async () => null);
		await expect(
			callMcpTool({
				url: TEST_URL,
				tool: "tasks_get",
				args: { task_id: "task_ok" },
				authToken: "stale-bearer-token",
				refreshToken,
			}),
		).rejects.toThrow(/auth rejected/);
		expect(refreshToken).toHaveBeenCalledTimes(1);
	});

	it("propagates the original 401 with no retry when no refreshToken callback is provided", async () => {
		const fetchMock = vi.fn(async () =>
			new Response(
				JSON.stringify({ error: "Failed to validate WorkOS user." }),
				{
					status: 401,
					headers: { "Content-Type": "application/json" },
				},
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		await expect(
			callMcpTool({
				url: TEST_URL,
				tool: "tasks_get",
				args: { task_id: "task_ok" },
				authToken: "stale-bearer-token",
			}),
		).rejects.toThrow(/auth rejected/);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("retries when a 200 body matches the WorkOS-rejection signature (belt-and-suspenders)", async () => {
		mockFetchSequence([
			{ status: 200, body: { error: "Failed to validate WorkOS user." } },
			{
				status: 200,
				body: {
					jsonrpc: "2.0",
					id: 1,
					result: {
						content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
					},
				},
			},
		]);

		const refreshToken = vi.fn(async () => "new-bearer-token");
		const result = await callMcpTool({
			url: TEST_URL,
			tool: "tasks_get",
			args: { task_id: "task_ok" },
			authToken: "stale-bearer-token",
			refreshToken,
		});
		expect(result).toEqual({ ok: true });
		expect(refreshToken).toHaveBeenCalledTimes(1);
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
			callMcpTool({
				url: TEST_URL,
				tool: "tasks_get",
				args: {},
				authToken: TEST_AUTH,
			}),
		).rejects.toThrow("parse error");
	});

	it("throws a generic 'MCP error' when top-level error has no message", async () => {
		mockFetchOnce({ jsonrpc: "2.0", id: 1, error: {} });

		await expect(
			callMcpTool({
				url: TEST_URL,
				tool: "tasks_get",
				args: {},
				authToken: TEST_AUTH,
			}),
		).rejects.toThrow("MCP error");
	});
});
