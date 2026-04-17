/**
 * Unit tests for `forceRefreshLastmileUserToken` — the adapter-level
 * force-refresh helper called from the REST client's 401-retry path.
 *
 * The core token POST logic lives in `refreshLastmileMcpToken` and is
 * covered by lastmile-oauth-refresh.test.ts. These tests verify the
 * wrapper behavior:
 *
 *   - When all context loads cleanly AND auth_config has endpoint+client_id,
 *     the wrapper POSTs to WorkOS regardless of how fresh expires_at is
 *     (the "bypass needsRefresh" contract).
 *   - Returns null when any lookup fails (no conn, no MCP, no token, no
 *     auth_config), so the REST client can surface 401 to the user.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── DB / SM mocks — declared before module-under-test is imported ────────

type SelectChain = { from: (_t: unknown) => { where: (..._args: unknown[]) => Promise<unknown[]> | { where: (..._a: unknown[]) => Promise<unknown[]> } } };

const { mockSelect, mockUpdate, mockDb, mockSmSend, selectResults } = vi.hoisted(() => {
	const selectResults: unknown[][] = [];
	const mockSelect = vi.fn((): SelectChain => {
		return {
			from: (_t: unknown) => ({
				where: (..._args: unknown[]) => {
					const next = selectResults.shift() ?? [];
					return Promise.resolve(next);
				},
			}),
		};
	});
	const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
	const mockUpdateSet = vi.fn((_a: unknown) => ({ where: mockUpdateWhere }));
	const mockUpdate = vi.fn((_t: unknown) => ({ set: mockUpdateSet }));
	const mockDb = { select: mockSelect, update: mockUpdate };
	const mockSmSend = vi.fn();
	return { mockSelect, mockUpdate, mockDb, mockSmSend, selectResults };
});

vi.mock("@thinkwork/database-pg", () => ({
	getDb: () => mockDb,
	schema: {
		connections: {
			id: "id",
			tenant_id: "tenant_id",
			user_id: "user_id",
			provider_id: "provider_id",
			status: "status",
			metadata: "metadata",
		},
		connectProviders: { id: "id", name: "name", config: "config" },
		credentials: {
			id: "id",
			tenant_id: "tenant_id",
			connection_id: "connection_id",
			expires_at: "expires_at",
		},
		userMcpTokens: {
			id: "id",
			user_id: "user_id",
			mcp_server_id: "mcp_server_id",
			secret_ref: "secret_ref",
			status: "status",
			expires_at: "expires_at",
			updated_at: "updated_at",
		},
		tenantMcpServers: {
			id: "id",
			tenant_id: "tenant_id",
			url: "url",
			enabled: "enabled",
			auth_config: "auth_config",
			updated_at: "updated_at",
		},
	},
}));

vi.mock("drizzle-orm", () => ({
	eq: (...args: unknown[]) => args,
	and: (...args: unknown[]) => args,
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
	SecretsManagerClient: vi.fn(() => ({ send: mockSmSend })),
	GetSecretValueCommand: vi.fn((args) => ({ __command: "Get", ...args })),
	UpdateSecretCommand: vi.fn((args) => ({ __command: "Update", ...args })),
	ResourceNotFoundException: class ResourceNotFoundException extends Error {},
}));

// ── Module under test ────────────────────────────────────────────────────

import { forceRefreshLastmileUserToken } from "../lib/oauth-token.js";

// ── Fetch mock ────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

beforeEach(() => {
	vi.clearAllMocks();
	selectResults.length = 0;
	// Default SM: returns a well-formed stored token blob.
	mockSmSend.mockImplementation(async (cmd: { __command: string }) => {
		if (cmd.__command === "Get") {
			return {
				SecretString: JSON.stringify({
					access_token: "stored-access-token",
					refresh_token: "stored-refresh-token",
					token_type: "bearer",
					obtained_at: new Date().toISOString(),
				}),
			};
		}
		return {};
	});
});

function mockWorkosRefresh(body: unknown, status = 200) {
	globalThis.fetch = vi.fn(async () =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json" },
		}),
	) as unknown as typeof fetch;
}

// ── Fixtures ──────────────────────────────────────────────────────────────

const CONN_ID = "conn-uuid";
const TENANT_ID = "tenant-uuid";
const USER_ID = "user-uuid";
const MCP_ID = "mcp-uuid";
const TOK_ID = "tok-uuid";
const SECRET_REF = `thinkwork/dev/mcp-tokens/${USER_ID}/${MCP_ID}`;

function queueHappyPathSelects(
	opts: { authConfig?: unknown; expiresAt?: Date | null } = {},
) {
	const authConfig = opts.authConfig ?? {
		token_endpoint: "https://straightforward-dragon-14-staging.authkit.app/oauth2/token",
		client_id: "client_01TEST",
	};
	const expiresAt = opts.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000); // future

	// 1. SELECT connections → [{ user_id }]
	selectResults.push([{ user_id: USER_ID }]);
	// 2. SELECT tenantMcpServers → [ { Tasks MCP } ]
	selectResults.push([
		{
			id: MCP_ID,
			url: "https://dev-mcp.lastmile-tei.com/tasks",
			enabled: true,
			auth_config: authConfig,
		},
	]);
	// 3. SELECT userMcpTokens → [ { active, with secret_ref } ]
	selectResults.push([
		{
			id: TOK_ID,
			secret_ref: SECRET_REF,
			status: "active",
			expires_at: expiresAt,
		},
	]);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("forceRefreshLastmileUserToken — happy path", () => {
	it("POSTs to WorkOS refresh endpoint even when expires_at is far in the future", async () => {
		queueHappyPathSelects({ expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
		mockWorkosRefresh({
			access_token: "NEW-access-token",
			refresh_token: "NEW-refresh-token",
			expires_in: 900,
		});

		const result = await forceRefreshLastmileUserToken(CONN_ID, TENANT_ID);

		expect(result).toBe("NEW-access-token");
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, RequestInit];
		expect(url).toContain("/oauth2/token");
		expect(init.method).toBe("POST");
		const body = new URLSearchParams(init.body as string);
		expect(body.get("grant_type")).toBe("refresh_token");
		expect(body.get("refresh_token")).toBe("stored-refresh-token");
		expect(body.get("client_id")).toBe("client_01TEST");
	});
});

describe("forceRefreshLastmileUserToken — load failures return null", () => {
	it("returns null when the connection row is missing", async () => {
		selectResults.push([]); // connections SELECT returns empty
		const result = await forceRefreshLastmileUserToken(CONN_ID, TENANT_ID);
		expect(result).toBeNull();
	});

	it("returns null when no enabled LastMile Tasks MCP server exists", async () => {
		selectResults.push([{ user_id: USER_ID }]);
		selectResults.push([
			{
				id: "other-mcp",
				url: "https://dev-mcp.lastmile-tei.com/crm", // wrong path
				enabled: true,
				auth_config: {},
			},
		]);
		const result = await forceRefreshLastmileUserToken(CONN_ID, TENANT_ID);
		expect(result).toBeNull();
	});

	it("returns null when no active user_mcp_tokens row exists", async () => {
		selectResults.push([{ user_id: USER_ID }]);
		selectResults.push([
			{
				id: MCP_ID,
				url: "https://dev-mcp.lastmile-tei.com/tasks",
				enabled: true,
				auth_config: {
					token_endpoint: "https://example/oauth2/token",
					client_id: "client_x",
				},
			},
		]);
		selectResults.push([]); // no token row
		const result = await forceRefreshLastmileUserToken(CONN_ID, TENANT_ID);
		expect(result).toBeNull();
	});
});

describe("forceRefreshLastmileUserToken — auth_config gaps", () => {
	it("returns null when auth_config has no client_id (unrecoverable)", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		queueHappyPathSelects({
			authConfig: {
				token_endpoint: "https://example/oauth2/token",
				// no client_id
			},
		});
		const result = await forceRefreshLastmileUserToken(CONN_ID, TENANT_ID);
		expect(result).toBeNull();
		// Should log an error explaining the situation for CloudWatch.
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("no client_id"),
		);
	});
});

describe("forceRefreshLastmileUserToken — refresh failure", () => {
	it("returns null when WorkOS rejects the refresh_token", async () => {
		queueHappyPathSelects();
		globalThis.fetch = vi.fn(async () =>
			new Response("invalid_grant", {
				status: 401,
				headers: { "Content-Type": "text/plain" },
			}),
		) as unknown as typeof fetch;
		const result = await forceRefreshLastmileUserToken(CONN_ID, TENANT_ID);
		expect(result).toBeNull();
		// The row should be marked expired (bookkeeping).
		expect(mockUpdate).toHaveBeenCalled();
	});
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});
