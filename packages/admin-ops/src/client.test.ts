import { describe, it, expect, vi } from "vitest";
import { createClient, AdminOpsError } from "./client.js";

describe("createClient", () => {
	it("sends Bearer auth + principal/tenant headers", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		const client = createClient({
			apiUrl: "https://api.example.com",
			authSecret: "s3cret",
			principalId: "user-123",
			principalEmail: "eric@example.com",
			tenantId: "tenant-abc",
			agentId: "agent-xyz",
			fetchImpl,
		});

		await client.fetch<{ ok: boolean }>("/api/ping");

		expect(fetchImpl).toHaveBeenCalledWith("https://api.example.com/api/ping", {
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer s3cret",
				"x-api-key": "s3cret",
				"x-principal-id": "user-123",
				"x-principal-email": "eric@example.com",
				"x-tenant-id": "tenant-abc",
				"x-agent-id": "agent-xyz",
			},
		});
	});

	it("sends x-api-key even when no principal/tenant is set — GraphQL apikey branch needs it", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response("{}", {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		const client = createClient({
			apiUrl: "https://api.example.com",
			authSecret: "s3cret",
			fetchImpl,
		});
		await client.fetch("/graphql", { method: "POST", body: "{}" });
		const headers = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
		expect(headers["x-api-key"]).toBe("s3cret");
		expect(headers.Authorization).toBe("Bearer s3cret");
	});

	it("omits optional headers when not provided", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
		);
		const client = createClient({
			apiUrl: "https://api.example.com/",
			authSecret: "s3cret",
			fetchImpl,
		});

		await client.fetch("/api/tenants");

		const call = fetchImpl.mock.calls[0]!;
		const headers = call[1]!.headers as Record<string, string>;
		expect(headers["x-principal-id"]).toBeUndefined();
		expect(headers["x-tenant-id"]).toBeUndefined();
		expect(headers["x-agent-id"]).toBeUndefined();
	});

	it("throws AdminOpsError on non-2xx with server error message", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: "nope" }), {
				status: 403,
				headers: { "Content-Type": "application/json" },
			}),
		);
		const client = createClient({
			apiUrl: "https://api.example.com",
			authSecret: "s3cret",
			fetchImpl,
		});

		await expect(client.fetch("/api/tenants")).rejects.toMatchObject({
			name: "AdminOpsError",
			status: 403,
			message: "nope",
		});
	});

	it("strips trailing slash from apiUrl", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
		const client = createClient({
			apiUrl: "https://api.example.com///",
			authSecret: "s3cret",
			fetchImpl,
		});
		await client.fetch("/api/tenants");
		expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.example.com/api/tenants");
	});

	it("withTenant returns a client scoped to a different tenant", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
		const client = createClient({
			apiUrl: "https://api.example.com",
			authSecret: "s3cret",
			tenantId: "original",
			fetchImpl,
		});
		const scoped = client.withTenant("new-tenant");
		expect(scoped.tenantId).toBe("new-tenant");

		await scoped.fetch("/api/ping");
		const headers = fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>;
		expect(headers["x-tenant-id"]).toBe("new-tenant");
	});

	it("AdminOpsError carries a non-json body verbatim", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response("Internal Server Error", {
				status: 500,
				headers: { "Content-Type": "text/plain" },
			}),
		);
		const client = createClient({
			apiUrl: "https://api.example.com",
			authSecret: "s3cret",
			fetchImpl,
		});
		try {
			await client.fetch("/api/ping");
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(AdminOpsError);
			expect((err as AdminOpsError).status).toBe(500);
			expect((err as AdminOpsError).message).toBe("HTTP 500");
		}
	});
});
