import { describe, it, expect, vi } from "vitest";
import { createClient } from "./client.js";
import { listTenants, getTenant, getTenantBySlug, updateTenant } from "./tenants.js";

function mockFetch(
	response: unknown,
	init: { status?: number } = {},
): ReturnType<typeof vi.fn> {
	return vi.fn().mockResolvedValue(
		new Response(JSON.stringify(response), {
			status: init.status ?? 200,
			headers: { "Content-Type": "application/json" },
		}),
	);
}

describe("tenants", () => {
	it("listTenants GETs /api/tenants", async () => {
		const fetchImpl = mockFetch([
			{ id: "t1", name: "Acme", slug: "acme", plan: "team", createdAt: "2026-04-01T00:00:00Z" },
		]);
		const client = createClient({
			apiUrl: "https://api.example.com",
			authSecret: "s3cret",
			fetchImpl,
		});

		const out = await listTenants(client);

		expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.example.com/api/tenants");
		expect(fetchImpl.mock.calls[0]![1]!.method).toBeUndefined();
		expect(out).toEqual([
			{ id: "t1", name: "Acme", slug: "acme", plan: "team", createdAt: "2026-04-01T00:00:00Z" },
		]);
	});

	it("getTenant GETs /api/tenants/:id with URL-encoded id", async () => {
		const fetchImpl = mockFetch({ id: "t with space", name: "Weird", slug: "weird" });
		const client = createClient({
			apiUrl: "https://api.example.com",
			authSecret: "s3cret",
			fetchImpl,
		});

		await getTenant(client, "t with space");

		expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.example.com/api/tenants/t%20with%20space");
	});

	it("getTenantBySlug GETs /api/tenants/by-slug/:slug", async () => {
		const fetchImpl = mockFetch({ id: "t1", slug: "acme" });
		const client = createClient({
			apiUrl: "https://api.example.com",
			authSecret: "s3cret",
			fetchImpl,
		});

		await getTenantBySlug(client, "acme");

		expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.example.com/api/tenants/by-slug/acme");
	});

	it("updateTenant PUTs /api/tenants/:id with JSON body", async () => {
		const fetchImpl = mockFetch({ id: "t1", name: "Renamed", slug: "acme", plan: "team" });
		const client = createClient({
			apiUrl: "https://api.example.com",
			authSecret: "s3cret",
			fetchImpl,
		});

		await updateTenant(client, "t1", { name: "Renamed" });

		const [, init] = fetchImpl.mock.calls[0]!;
		expect(init!.method).toBe("PUT");
		expect(init!.body).toBe(JSON.stringify({ name: "Renamed" }));
	});

	it("getTenant throws AdminOpsError on 404", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: "Tenant not found" }), {
				status: 404,
				headers: { "Content-Type": "application/json" },
			}),
		);
		const client = createClient({
			apiUrl: "https://api.example.com",
			authSecret: "s3cret",
			fetchImpl,
		});

		await expect(getTenant(client, "missing")).rejects.toMatchObject({
			status: 404,
			message: "Tenant not found",
		});
	});
});
