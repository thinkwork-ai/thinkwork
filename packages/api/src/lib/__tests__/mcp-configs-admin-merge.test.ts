/**
 * buildMcpConfigs — admin-MCP registry merge (plan §U2).
 *
 * Verifies the runtime resolver pulls from BOTH `tenant_mcp_servers` and
 * `admin_mcp_servers` and tags admin entries with `is_admin: true`.
 * Migration-window dedup: when an `admin-ops`-slugged row resolves on
 * both sides for the same agent, the admin row wins and a deprecation
 * warning fires.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockWhereSelector,
	mockTenantRowsForJoin,
	mockAdminRowsForJoin,
	mockRowsForUserToken,
	mockSecretString,
	mockAdminQueryThrows,
} = vi.hoisted(() => ({
	mockWhereSelector: vi.fn(),
	mockTenantRowsForJoin: vi.fn(),
	mockAdminRowsForJoin: vi.fn(),
	mockRowsForUserToken: vi.fn(),
	mockSecretString: vi.fn(),
	mockAdminQueryThrows: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
	getDb: () => ({
		select: () => ({
			from: (table: { __source?: string }) => ({
				innerJoin: () => ({
					where: (pred: unknown) => {
						mockWhereSelector(pred);
						if (table?.__source === "agentAdminMcpServers") {
							const err = mockAdminQueryThrows();
							if (err) return Promise.reject(err);
							return Promise.resolve(mockAdminRowsForJoin());
						}
						return Promise.resolve(mockTenantRowsForJoin());
					},
				}),
				where: (pred: unknown) => {
					mockWhereSelector(pred);
					return {
						limit: () => Promise.resolve(mockRowsForUserToken()),
					};
				},
			}),
		}),
		update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
	}),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
	tenantMcpServers: {
		__source: "tenantMcpServers",
		id: "tenantMcpServers.id",
		name: "tenantMcpServers.name",
		slug: "tenantMcpServers.slug",
		url: "tenantMcpServers.url",
		transport: "tenantMcpServers.transport",
		auth_type: "tenantMcpServers.auth_type",
		auth_config: "tenantMcpServers.auth_config",
		enabled: "tenantMcpServers.enabled",
		status: "tenantMcpServers.status",
		url_hash: "tenantMcpServers.url_hash",
	},
	agentMcpServers: {
		__source: "agentMcpServers",
		mcp_server_id: "agentMcpServers.mcp_server_id",
		agent_id: "agentMcpServers.agent_id",
		enabled: "agentMcpServers.enabled",
		config: "agentMcpServers.config",
	},
	adminMcpServers: {
		__source: "adminMcpServers",
		id: "adminMcpServers.id",
		name: "adminMcpServers.name",
		slug: "adminMcpServers.slug",
		url: "adminMcpServers.url",
		transport: "adminMcpServers.transport",
		auth_type: "adminMcpServers.auth_type",
		auth_config: "adminMcpServers.auth_config",
		enabled: "adminMcpServers.enabled",
		status: "adminMcpServers.status",
		url_hash: "adminMcpServers.url_hash",
	},
	agentAdminMcpServers: {
		__source: "agentAdminMcpServers",
		mcp_server_id: "agentAdminMcpServers.mcp_server_id",
		agent_id: "agentAdminMcpServers.agent_id",
		enabled: "agentAdminMcpServers.enabled",
		config: "agentAdminMcpServers.config",
	},
	userMcpTokens: {
		__source: "userMcpTokens",
		user_id: "userMcpTokens.user_id",
		mcp_server_id: "userMcpTokens.mcp_server_id",
		status: "userMcpTokens.status",
		id: "userMcpTokens.id",
		secret_ref: "userMcpTokens.secret_ref",
		expires_at: "userMcpTokens.expires_at",
	},
}));

vi.mock("drizzle-orm", () => ({
	and: (...args: unknown[]) => ({ _and: args }),
	eq: (col: unknown, val: unknown) => ({ _eq: [col, val] }),
}));

vi.mock("@aws-sdk/client-secrets-manager", () => {
	class Stub {
		async send() {
			return { SecretString: mockSecretString() };
		}
	}
	return {
		SecretsManagerClient: Stub,
		GetSecretValueCommand: class {},
		UpdateSecretCommand: class {},
	};
});

// eslint-disable-next-line import/first
import { buildMcpConfigs } from "../mcp-configs.js";

function tenantRow(over: Record<string, unknown> = {}) {
	return {
		mcp_server_id: "tenant-srv-1",
		name: "Tenant Server",
		slug: "tenant-server",
		url: "https://mcp.example/tenant",
		transport: "streamable-http",
		auth_type: "none",
		auth_config: null,
		server_enabled: true,
		server_status: "approved",
		server_url_hash: null,
		assignment_enabled: true,
		assignment_config: null,
		...over,
	};
}

function adminRow(over: Record<string, unknown> = {}) {
	return {
		mcp_server_id: "admin-srv-1",
		name: "Admin Server",
		slug: "admin-ops",
		url: "https://mcp.example/admin-new",
		transport: "streamable-http",
		auth_type: "none",
		auth_config: null,
		server_enabled: true,
		server_status: "approved",
		server_url_hash: null,
		assignment_enabled: true,
		assignment_config: null,
		...over,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockTenantRowsForJoin.mockReturnValue([]);
	mockAdminRowsForJoin.mockReturnValue([]);
	mockRowsForUserToken.mockReturnValue([]);
	mockSecretString.mockReturnValue("");
	mockAdminQueryThrows.mockReturnValue(null);
});

describe("buildMcpConfigs — admin registry merge", () => {
	it("returns admin entries with is_admin=true alongside tenant entries", async () => {
		mockTenantRowsForJoin.mockReturnValue([
			tenantRow({ slug: "lastmile-tasks", url: "https://mcp.example/tasks" }),
			tenantRow({ slug: "lastmile-crm", url: "https://mcp.example/crm" }),
		]);
		mockAdminRowsForJoin.mockReturnValue([
			adminRow({ slug: "admin-ops" }),
		]);

		const configs = await buildMcpConfigs("agent-1", null);

		expect(configs).toHaveLength(3);
		const adminEntry = configs.find((c) => c.name === "admin-ops");
		expect(adminEntry?.is_admin).toBe(true);
		const tenantEntries = configs.filter((c) => c.name !== "admin-ops");
		for (const entry of tenantEntries) {
			expect(entry.is_admin).toBeUndefined();
		}
	});

	it("returns tenant-only payload identical to today when admin query is empty", async () => {
		mockTenantRowsForJoin.mockReturnValue([
			tenantRow({ slug: "lastmile-tasks" }),
		]);

		const configs = await buildMcpConfigs("agent-1", null);

		expect(configs).toHaveLength(1);
		expect(configs[0]!.name).toBe("lastmile-tasks");
		expect(configs[0]!.is_admin).toBeUndefined();
	});

	it("dedups admin-ops slug collision: admin wins, deprecation warning fires with legacy row mcp_server_id", async () => {
		// Migration window: legacy tenant row + new admin row for same slug.
		mockTenantRowsForJoin.mockReturnValue([
			tenantRow({
				mcp_server_id: "legacy-tenant-admin-ops",
				slug: "admin-ops",
				url: "https://mcp.example/admin-legacy",
				// Distinct fields so we can prove admin's payload is used.
				assignment_config: { toolAllowlist: ["legacy-tenant-tool"] },
			}),
		]);
		mockAdminRowsForJoin.mockReturnValue([
			adminRow({
				mcp_server_id: "admin-srv-new",
				slug: "admin-ops",
				url: "https://mcp.example/admin-new",
				assignment_config: { toolAllowlist: ["admin-tool"] },
			}),
		]);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const configs = await buildMcpConfigs("agent-1", null);

		expect(configs).toHaveLength(1);
		expect(configs[0]!.is_admin).toBe(true);
		// Admin entry's url AND tools win — none of the tenant row's fields
		// leak through into the surviving entry.
		expect(configs[0]!.url).toBe("https://mcp.example/admin-new");
		expect(configs[0]!.tools).toEqual(["admin-tool"]);

		const warnings = warn.mock.calls.map((c) => String(c[0]));
		const dedupWarn = warnings.find((m) => m.includes("legacy tenant_mcp_servers"));
		expect(dedupWarn).toBeDefined();
		// Pin the slug so a regression that named the wrong slug would fail.
		expect(dedupWarn).toMatch(/slug=admin-ops/);
		// Pin the legacy mcp_server_id so operators see a directly-actionable id.
		expect(dedupWarn).toContain("legacy-tenant-admin-ops");

		warn.mockRestore();
	});

	it("logs an error and keeps the tenant entry when a non-admin-ops slug collides between registries", async () => {
		// Defensive: should never happen post-U6, but a corrupt admin row
		// with a tenant slug should not silently take over.
		mockTenantRowsForJoin.mockReturnValue([
			tenantRow({
				mcp_server_id: "tenant-srv-tasks",
				slug: "lastmile-tasks",
				url: "https://mcp.example/legitimate-tasks",
			}),
		]);
		mockAdminRowsForJoin.mockReturnValue([
			adminRow({
				mcp_server_id: "admin-srv-impostor",
				slug: "lastmile-tasks",
				url: "https://attacker.example/spoof",
			}),
		]);
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		const configs = await buildMcpConfigs("agent-1", null);

		// Tenant entry survives; admin entry is dropped.
		expect(configs).toHaveLength(1);
		expect(configs[0]!.is_admin).toBeUndefined();
		expect(configs[0]!.url).toBe("https://mcp.example/legitimate-tasks");

		const errors = error.mock.calls.map((c) => String(c[0]));
		const collisionError = errors.find((m) =>
			m.includes("unexpected cross-registry slug collision"),
		);
		expect(collisionError).toBeDefined();
		expect(collisionError).toContain("lastmile-tasks");

		error.mockRestore();
	});

	it("surfaces tenant configs even when the admin query throws", async () => {
		mockTenantRowsForJoin.mockReturnValue([
			tenantRow({ slug: "lastmile-tasks" }),
		]);
		mockAdminQueryThrows.mockReturnValue(
			new Error("admin_mcp_servers table missing — partial deploy"),
		);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const configs = await buildMcpConfigs("agent-1", null);

		expect(configs).toHaveLength(1);
		expect(configs[0]!.name).toBe("lastmile-tasks");
		const warnings = warn.mock.calls.map((c) => String(c[0]));
		expect(warnings.some((m) => m.includes("admin MCP query failed"))).toBe(true);

		warn.mockRestore();
	});

	it("skips an admin-MCP per_user_oauth row when the user has no token", async () => {
		mockAdminRowsForJoin.mockReturnValue([
			adminRow({
				slug: "admin-tools",
				auth_type: "per_user_oauth",
			}),
		]);
		mockRowsForUserToken.mockReturnValue([]);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const configs = await buildMcpConfigs("agent-1", "user-1");

		expect(configs).toHaveLength(0);
		const warnings = warn.mock.calls.map((c) => String(c[0]));
		expect(
			warnings.some((m) => m.includes("user has not completed OAuth")),
		).toBe(true);

		warn.mockRestore();
	});
});
