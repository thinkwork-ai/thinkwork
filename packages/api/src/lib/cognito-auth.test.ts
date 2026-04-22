import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { authenticate } from "./cognito-auth.js";

describe("authenticate — apikey path", () => {
	const prev = process.env.API_AUTH_SECRET;

	beforeEach(() => {
		process.env.API_AUTH_SECRET = "tw-test-secret";
	});

	afterEach(() => {
		process.env.API_AUTH_SECRET = prev;
	});

	it("returns null when no credential is present", async () => {
		expect(await authenticate({})).toBeNull();
	});

	it("rejects a wrong api key", async () => {
		expect(await authenticate({ "x-api-key": "nope" })).toBeNull();
	});

	it("accepts a matching api key and hydrates principal headers", async () => {
		const auth = await authenticate({
			"x-api-key": "tw-test-secret",
			"x-principal-id": "user-123",
			"x-tenant-id": "tenant-abc",
			"x-principal-email": "operator@example.com",
			"x-agent-id": "agent-42",
		});
		expect(auth).toEqual({
			principalId: "user-123",
			tenantId: "tenant-abc",
			email: "operator@example.com",
			authType: "apikey",
			agentId: "agent-42",
		});
	});

	it("returns email=null when x-principal-email is absent", async () => {
		const auth = await authenticate({ "x-api-key": "tw-test-secret" });
		expect(auth).not.toBeNull();
		expect(auth!.email).toBeNull();
	});
});
