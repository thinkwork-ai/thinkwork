/**
 * Contract tests for the `apikey` vs `service` classification in
 * `cognito-auth.ts`. Both branches share the shared-service-secret
 * acceptance path; what distinguishes them is whether the caller
 * declared an identity (`x-principal-id` and/or `x-agent-id`).
 *
 * The classification feeds `requireAdminOrServiceCaller`: bare-bearer
 * (service) callers may transit admin gates on the strength of the
 * secret alone, while declared-identity (apikey) callers must pass the
 * tenant-role + agent-allowlist cross-checks defined in `authz.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { authenticate } from "../lib/cognito-auth.js";

const ORIGINAL_AUTH_SECRET = process.env.API_AUTH_SECRET;

describe("authenticate — apikey vs service classification", () => {
	const SECRET = "test-service-secret-only-for-classification";

	beforeEach(() => {
		process.env.API_AUTH_SECRET = SECRET;
	});

	afterEach(() => {
		if (ORIGINAL_AUTH_SECRET === undefined) {
			delete process.env.API_AUTH_SECRET;
		} else {
			process.env.API_AUTH_SECRET = ORIGINAL_AUTH_SECRET;
		}
	});

	it("classifies as `service` when bearer-only — no x-principal-id, no x-agent-id", async () => {
		const result = await authenticate({
			authorization: `Bearer ${SECRET}`,
			"x-tenant-id": "tenant-A",
		});
		expect(result).toEqual({
			principalId: null,
			tenantId: "tenant-A",
			email: null,
			authType: "service",
			agentId: null,
		});
	});

	it("classifies as `service` when x-api-key carries the bearer with no identity headers", async () => {
		const result = await authenticate({
			"x-api-key": SECRET,
		});
		expect(result?.authType).toBe("service");
		expect(result?.principalId).toBeNull();
		expect(result?.agentId).toBeNull();
	});

	it("classifies as `apikey` when x-principal-id is declared", async () => {
		const result = await authenticate({
			authorization: `Bearer ${SECRET}`,
			"x-tenant-id": "tenant-A",
			"x-principal-id": "user-1",
		});
		expect(result?.authType).toBe("apikey");
		expect(result?.principalId).toBe("user-1");
	});

	it("classifies as `apikey` when x-agent-id is declared (no principal)", async () => {
		const result = await authenticate({
			"x-api-key": SECRET,
			"x-tenant-id": "tenant-A",
			"x-agent-id": "agent-1",
		});
		expect(result?.authType).toBe("apikey");
		expect(result?.agentId).toBe("agent-1");
	});

	it("classifies as `apikey` when both identity headers are present", async () => {
		const result = await authenticate({
			"x-api-key": SECRET,
			"x-tenant-id": "tenant-A",
			"x-principal-id": "user-1",
			"x-agent-id": "agent-1",
		});
		expect(result?.authType).toBe("apikey");
		expect(result?.principalId).toBe("user-1");
		expect(result?.agentId).toBe("agent-1");
	});

	it("returns null (unauthenticated) when no secret and no JWT", async () => {
		const result = await authenticate({});
		expect(result).toBeNull();
	});

	it("returns null when bearer value does not match accepted secrets", async () => {
		const result = await authenticate({
			authorization: "Bearer wrong-secret",
		});
		expect(result).toBeNull();
	});
});
