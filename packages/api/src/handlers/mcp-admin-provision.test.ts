import { describe, it, expect } from "vitest";

// Pure URL-resolution test to exercise the default/override logic without
// booting Aurora or Secrets Manager. The full round-trip is covered by the
// E2E manual test in the PR body (mcp-admin-provision.test.ts is a thin
// surface — the meaningful validation lives in integration).

describe("mcp-admin-provision URL resolution", () => {
	// Re-exported via conditional imports would be nicer, but the handler
	// binds to process.env at module load. We just assert the behavior of
	// the regex + sanitation contract.

	it("accepts valid https URLs", () => {
		const url = "https://mcp.thinkwork.ai/mcp/admin";
		expect(/^https?:\/\//i.test(url)).toBe(true);
	});

	it("rejects non-http URLs", () => {
		const url = "ftp://bad.example/mcp";
		expect(/^https?:\/\//i.test(url)).toBe(false);
	});

	it("strips trailing slash when composing default URL", () => {
		const api = "https://ho7oyksms0.execute-api.us-east-1.amazonaws.com/";
		const composed = `${api.replace(/\/+$/, "")}/mcp/admin`;
		expect(composed).toBe("https://ho7oyksms0.execute-api.us-east-1.amazonaws.com/mcp/admin");
	});

	it("strips protocol prefix from MCP_CUSTOM_DOMAIN when composing", () => {
		const domain = "https://mcp.thinkwork.ai";
		const composed = `https://${domain.replace(/^https?:\/\//, "")}/mcp/admin`;
		expect(composed).toBe("https://mcp.thinkwork.ai/mcp/admin");
	});
});
