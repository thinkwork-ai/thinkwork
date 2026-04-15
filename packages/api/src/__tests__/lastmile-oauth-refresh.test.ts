/**
 * Unit tests for PR H — LastMile MCP token auto-refresh.
 *
 * `refreshLastmileMcpToken` is the net-new code path added by PR H: it
 * POSTs `grant_type=refresh_token` to the WorkOS `/oauth2/token` endpoint
 * using the rotated refresh_token, persists the new pair back to Secrets
 * Manager, and updates `user_mcp_tokens.expires_at` in the DB.
 *
 * These tests mock `fetch` (the WorkOS POST), `@aws-sdk/client-secrets-manager`
 * (the SM PUT), and the drizzle `db.update` chain. They lock the contract
 * for every branch of the refresh path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks — must be declared BEFORE the module under test is imported ────

const { mockUpdateWhere, mockUpdateSet, mockUpdate, mockDb } = vi.hoisted(() => {
	const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
	const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
	const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));
	const mockDb = {
		update: mockUpdate,
		// resolveLastmileUserToken also calls db.select; the refresh helper
		// itself only uses db.update so stub select with a no-op chain.
		select: vi.fn(() => ({
			from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
		})),
	};
	return { mockUpdateWhere, mockUpdateSet, mockUpdate, mockDb };
});

vi.mock("@thinkwork/database-pg", () => ({
	getDb: () => mockDb,
	schema: {
		connections: { id: "id", tenant_id: "tenant_id", user_id: "user_id" },
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
		},
	},
}));

vi.mock("drizzle-orm", () => ({
	eq: (...args: unknown[]) => args,
	and: (...args: unknown[]) => args,
}));

const { mockSmSend } = vi.hoisted(() => ({
	mockSmSend: vi.fn(),
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
	SecretsManagerClient: vi.fn(() => ({ send: mockSmSend })),
	GetSecretValueCommand: vi.fn((args) => ({ __command: "Get", ...args })),
	UpdateSecretCommand: vi.fn((args) => ({ __command: "Update", ...args })),
	ResourceNotFoundException: class ResourceNotFoundException extends Error {},
}));

// ── Import after mocks ───────────────────────────────────────────────────

import { refreshLastmileMcpToken } from "../lib/oauth-token.js";

// ── Fetch mock helper ────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

function mockFetchOnce(body: unknown, init: { status?: number; ok?: boolean } = {}) {
	const status = init.status ?? 200;
	globalThis.fetch = vi.fn(async () =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json" },
		}),
	) as unknown as typeof fetch;
}

function mockFetchErrorOnce(status: number, text: string) {
	globalThis.fetch = vi.fn(async () =>
		new Response(text, {
			status,
			headers: { "Content-Type": "text/plain" },
		}),
	) as unknown as typeof fetch;
}

// ── Reset ────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	mockSmSend.mockResolvedValue({});
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

// ── Fixtures ─────────────────────────────────────────────────────────────

const BASE_ARGS = {
	secretRef:
		"thinkwork/dev/mcp-tokens/4dee701a-c17b-46fe-9f38-a333d4c3fad0/8d8c46ab-1d6c-463f-9c63-dcf6475bdab4",
	storedToken: {
		access_token: "old-access-token-value",
		refresh_token: "old-refresh-token-value",
		token_type: "bearer",
		obtained_at: "2026-04-15T12:57:06.607Z",
	},
	userMcpTokenId: "user-mcp-token-uuid",
	tokenEndpoint: "https://straightforward-dragon-14-staging.authkit.app/oauth2/token",
	clientId: "client_01KP8M0RS4HEX39XFHP1A046RW",
};

// ── Tests ────────────────────────────────────────────────────────────────

describe("refreshLastmileMcpToken — happy path", () => {
	it("POSTs grant_type=refresh_token with the stored refresh_token", async () => {
		mockFetchOnce({
			access_token: "NEW-access-token",
			refresh_token: "NEW-refresh-token",
			token_type: "bearer",
			expires_in: 900,
		});

		await refreshLastmileMcpToken(BASE_ARGS);

		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, RequestInit];
		expect(url).toBe(BASE_ARGS.tokenEndpoint);
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
			"application/x-www-form-urlencoded",
		);
		const body = new URLSearchParams(init.body as string);
		expect(body.get("grant_type")).toBe("refresh_token");
		expect(body.get("refresh_token")).toBe("old-refresh-token-value");
		expect(body.get("client_id")).toBe(BASE_ARGS.clientId);
		// Public client (PKCE DCR flow) — no client_secret.
		expect(body.get("client_secret")).toBeNull();
	});

	it("returns the new access_token on success", async () => {
		mockFetchOnce({
			access_token: "NEW-access-token",
			refresh_token: "NEW-refresh-token",
			expires_in: 900,
		});

		const result = await refreshLastmileMcpToken(BASE_ARGS);
		expect(result).toBe("NEW-access-token");
	});

	it("persists the rotated pair back to Secrets Manager BEFORE returning", async () => {
		mockFetchOnce({
			access_token: "NEW-access-token",
			refresh_token: "NEW-refresh-token",
			token_type: "bearer",
			expires_in: 900,
		});

		await refreshLastmileMcpToken(BASE_ARGS);

		// Two SM calls shouldn't happen — only one UpdateSecretCommand.
		expect(mockSmSend).toHaveBeenCalledTimes(1);
		const updateCommand = mockSmSend.mock.calls[0][0] as {
			__command: string;
			SecretId: string;
			SecretString: string;
		};
		expect(updateCommand.__command).toBe("Update");
		expect(updateCommand.SecretId).toBe(BASE_ARGS.secretRef);
		const persisted = JSON.parse(updateCommand.SecretString);
		expect(persisted.access_token).toBe("NEW-access-token");
		expect(persisted.refresh_token).toBe("NEW-refresh-token");
		expect(persisted.token_type).toBe("bearer");
		// obtained_at is stamped with `new Date().toISOString()` — just
		// assert it's a valid ISO string, not a specific value.
		expect(typeof persisted.obtained_at).toBe("string");
		expect(() => new Date(persisted.obtained_at).toISOString()).not.toThrow();
	});

	it("updates user_mcp_tokens.expires_at using the new expires_in", async () => {
		mockFetchOnce({
			access_token: "NEW",
			refresh_token: "NEW",
			expires_in: 1200,
		});

		const beforeMs = Date.now();
		await refreshLastmileMcpToken(BASE_ARGS);
		const afterMs = Date.now();

		expect(mockUpdate).toHaveBeenCalled();
		expect(mockUpdateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				expires_at: expect.any(Date),
				updated_at: expect.any(Date),
			}),
		);
		const setArgs = mockUpdateSet.mock.calls[0][0] as {
			expires_at: Date;
			updated_at: Date;
		};
		const expiresAtMs = setArgs.expires_at.getTime();
		expect(expiresAtMs).toBeGreaterThanOrEqual(beforeMs + 1200 * 1000);
		expect(expiresAtMs).toBeLessThanOrEqual(afterMs + 1200 * 1000);
	});

	it("falls back to the old refresh_token if WorkOS doesn't rotate it", async () => {
		// Edge case: some identity providers don't rotate refresh_token on
		// every refresh. If WorkOS returns no refresh_token, we MUST keep
		// the old one — nulling it out would cause the next refresh attempt
		// to fail with "no refresh_token" and mark the row expired.
		mockFetchOnce({
			access_token: "NEW-access-token",
			expires_in: 900,
			// No refresh_token
		});

		await refreshLastmileMcpToken(BASE_ARGS);

		const updateCommand = mockSmSend.mock.calls[0][0] as {
			SecretString: string;
		};
		const persisted = JSON.parse(updateCommand.SecretString);
		expect(persisted.refresh_token).toBe("old-refresh-token-value");
	});
});

describe("refreshLastmileMcpToken — failures", () => {
	it("marks the user_mcp_tokens row expired when WorkOS returns 401", async () => {
		mockFetchErrorOnce(401, "invalid_grant");

		const result = await refreshLastmileMcpToken(BASE_ARGS);

		expect(result).toBeNull();
		expect(mockUpdate).toHaveBeenCalled();
		expect(mockUpdateSet).toHaveBeenCalledWith(
			expect.objectContaining({ status: "expired" }),
		);
		// Critical: MUST NOT call UpdateSecretCommand on a failed refresh
		// — otherwise we'd overwrite the SM secret with stale data.
		expect(mockSmSend).not.toHaveBeenCalled();
	});

	it("marks the row expired when WorkOS returns an unparseable body", async () => {
		mockFetchErrorOnce(500, "internal server error");

		const result = await refreshLastmileMcpToken(BASE_ARGS);

		expect(result).toBeNull();
		expect(mockUpdateSet).toHaveBeenCalledWith(
			expect.objectContaining({ status: "expired" }),
		);
	});

	it("marks expired when storedToken has no refresh_token", async () => {
		// Install a fetch spy so we can assert it was never called.
		const fetchSpy = vi.fn();
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		const result = await refreshLastmileMcpToken({
			...BASE_ARGS,
			storedToken: { ...BASE_ARGS.storedToken, refresh_token: null },
		});

		expect(result).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(mockUpdateSet).toHaveBeenCalledWith(
			expect.objectContaining({ status: "expired" }),
		);
	});

	it("returns null if fetch itself throws (network error)", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch;

		const result = await refreshLastmileMcpToken(BASE_ARGS);

		expect(result).toBeNull();
		// Network errors shouldn't flip the row to expired — a transient
		// failure can self-heal on the next invocation.
		expect(mockUpdateSet).not.toHaveBeenCalled();
		expect(mockSmSend).not.toHaveBeenCalled();
	});

	it("returns null if the SM persist call fails", async () => {
		mockFetchOnce({
			access_token: "NEW",
			refresh_token: "NEW",
			expires_in: 900,
		});
		mockSmSend.mockRejectedValueOnce(new Error("AccessDenied"));

		const result = await refreshLastmileMcpToken(BASE_ARGS);

		expect(result).toBeNull();
		// Expires_at update should NOT happen either — we don't want to
		// record a new expiry for a token we failed to persist.
		expect(mockUpdateSet).not.toHaveBeenCalled();
	});
});
