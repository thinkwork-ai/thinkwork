import type { AdminOpsClient } from "./client.js";

export interface TenantSummary {
	id: string;
	name: string;
	slug: string;
	plan: string;
	createdAt: string | null;
}

export interface Tenant {
	id: string;
	name: string;
	slug: string;
	plan: string;
	issue_prefix: string | null;
	created_at: string | null;
	updated_at: string | null;
}

export async function listTenants(client: AdminOpsClient): Promise<TenantSummary[]> {
	return client.fetch<TenantSummary[]>("/api/tenants");
}

export async function getTenant(client: AdminOpsClient, id: string): Promise<Tenant> {
	return client.fetch<Tenant>(`/api/tenants/${encodeURIComponent(id)}`);
}

export async function getTenantBySlug(
	client: AdminOpsClient,
	slug: string,
): Promise<Tenant> {
	return client.fetch<Tenant>(`/api/tenants/by-slug/${encodeURIComponent(slug)}`);
}

export interface UpdateTenantInput {
	name?: string;
	plan?: string;
	issue_prefix?: string;
}

export async function updateTenant(
	client: AdminOpsClient,
	id: string,
	input: UpdateTenantInput,
): Promise<Tenant> {
	return client.fetch<Tenant>(`/api/tenants/${encodeURIComponent(id)}`, {
		method: "PUT",
		body: JSON.stringify(input),
	});
}
