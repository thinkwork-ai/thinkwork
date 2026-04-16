/**
 * Unit tests for `mintLastmileM2MToken` — the WorkOS client_credentials
 * minter + cache used by the connections handler to get a long-lived
 * LastMile API bearer token.
 *
 * Locked contracts:
 *   - POST shape to WorkOS (/user_management/authenticate with
 *     grant_type=client_credentials)
 *   - In-process cache keyed by client_id; cache hit avoids a second POST
 *   - `forceRefresh: true` bypasses the cache
 *   - null return when no credentials are configured (so the handler can
 *     fall back to the user-JWT path)
 *   - Throws on WorkOS errors (so the 502 is visible in CloudWatch)
 *   - Credential precedence: per-tenant SSM > default SSM > env vars
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── SM + env mocks — declared before module-under-test is imported ───────

const { mockSmSend } = vi.hoisted(() => ({
	mockSmSend: vi.fn(),
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
	SecretsManagerClient: vi.fn(() => ({ send: mockSmSend })),
	GetSecretValueCommand: vi.fn((args) => ({ __command: "Get", ...args })),
	ResourceNotFoundException: class ResourceNotFoundException extends Error {
		name = "ResourceNotFoundException";
	},
}));

import {
	mintLastmileM2MToken,
	isLastmileM2MConfigured,
	__resetM2MCacheForTests,
} from "../lib/lastmile-m2m.js";

// ── Fetch + env plumbing ─────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
const ORIGINAL_ENV = { ...process.env };

function mockWorkosSuccess(accessToken = "m2m-NEW-access", expiresInSec = 86400) {
	globalThis.fetch = vi.fn(async () =>
		new Response(
			JSON.stringify({
				access_token: accessToken,
				token_type: "Bearer",
				expires_in: expiresInSec,
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		),
	) as unknown as typeof fetch;
}

function mockWorkosFailure(status: number, body: string) {
	globalThis.fetch = vi.fn(async () =>
		new Response(body, {
			status,
			headers: { "Content-Type": "application/json" },
		}),
	) as unknown as typeof fetch;
}

beforeEach(() => {
	vi.clearAllMocks();
	__resetM2MCacheForTests();
	// Default: SM returns ResourceNotFoundException unless the specific test
	// queues a success. This makes env-fallback tests trivial to express.
	const { ResourceNotFoundException } = require("@aws-sdk/client-secrets-manager") as {
		ResourceNotFoundException: new (msg: string) => Error;
	};
	mockSmSend.mockRejectedValue(new ResourceNotFoundException("not found"));
	// Clean env so each test sets exactly what it needs.
	delete process.env.LASTMILE_M2M_CLIENT_ID;
	delete process.env.LASTMILE_M2M_CLIENT_SECRET;
	process.env.STAGE = "dev";
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	process.env = { ...ORIGINAL_ENV };
});

// ── Tests ────────────────────────────────────────────────────────────────

describe("mintLastmileM2MToken — credential loading", () => {
	it("returns null when no credentials are configured", async () => {
		const result = await mintLastmileM2MToken("tenant-1");
		expect(result).toBeNull();
	});

	it("uses env vars when SSM has no matching secret", async () => {
		process.env.LASTMILE_M2M_CLIENT_ID = "env-client-id";
		process.env.LASTMILE_M2M_CLIENT_SECRET = "env-client-secret";
		mockWorkosSuccess("token-from-env");

		const result = await mintLastmileM2MToken("tenant-1");

		expect(result).toBe("token-from-env");
		const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body).toEqual({
			client_id: "env-client-id",
			client_secret: "env-client-secret",
			grant_type: "client_credentials",
		});
	});

	it("prefers per-tenant SSM over default SSM over env", async () => {
		process.env.LASTMILE_M2M_CLIENT_ID = "env-id";
		process.env.LASTMILE_M2M_CLIENT_SECRET = "env-secret";
		// Queue SM responses in the order loadM2MCredentials reads them:
		// 1. per-tenant → succeeds, should short-circuit.
		mockSmSend.mockReset();
		mockSmSend.mockResolvedValueOnce({
			SecretString: JSON.stringify({
				client_id: "tenant-id",
				client_secret: "tenant-secret",
			}),
		});
		mockWorkosSuccess("token-from-tenant");

		const result = await mintLastmileM2MToken("tenant-1");

		expect(result).toBe("token-from-tenant");
		expect(mockSmSend).toHaveBeenCalledTimes(1);
		const smCall = mockSmSend.mock.calls[0][0] as { SecretId: string };
		expect(smCall.SecretId).toBe("thinkwork/dev/lastmile-m2m/tenant-1");
		const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, RequestInit];
		expect(JSON.parse(init.body as string).client_id).toBe("tenant-id");
	});

	it("falls through to default SSM when per-tenant is missing", async () => {
		const { ResourceNotFoundException } = await import("@aws-sdk/client-secrets-manager");
		mockSmSend.mockReset();
		// per-tenant: miss
		mockSmSend.mockRejectedValueOnce(new ResourceNotFoundException({ message: "x" } as never));
		// default: hit
		mockSmSend.mockResolvedValueOnce({
			SecretString: JSON.stringify({
				client_id: "default-id",
				client_secret: "default-secret",
			}),
		});
		mockWorkosSuccess("token-from-default");

		const result = await mintLastmileM2MToken("tenant-1");

		expect(result).toBe("token-from-default");
		const callIds = (mockSmSend.mock.calls as unknown as [{ SecretId: string }][])
			.map((c) => c[0].SecretId);
		expect(callIds).toEqual([
			"thinkwork/dev/lastmile-m2m/tenant-1",
			"thinkwork/dev/lastmile-m2m/default",
		]);
	});
});

describe("mintLastmileM2MToken — caching", () => {
	beforeEach(() => {
		process.env.LASTMILE_M2M_CLIENT_ID = "cache-client";
		process.env.LASTMILE_M2M_CLIENT_SECRET = "cache-secret";
	});

	it("returns the cached token without calling WorkOS twice", async () => {
		mockWorkosSuccess("token-1", 86400);
		const a = await mintLastmileM2MToken("tenant-A");
		const b = await mintLastmileM2MToken("tenant-A");
		expect(a).toBe("token-1");
		expect(b).toBe("token-1");
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("shares the cache across tenants when client_id is the same (env-fallback case)", async () => {
		mockWorkosSuccess("token-shared", 86400);
		const a = await mintLastmileM2MToken("tenant-A");
		const b = await mintLastmileM2MToken("tenant-B");
		expect(a).toBe("token-shared");
		expect(b).toBe("token-shared");
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("bypasses cache when forceRefresh: true", async () => {
		mockWorkosSuccess("token-1", 86400);
		const first = await mintLastmileM2MToken("tenant-A");
		expect(first).toBe("token-1");

		mockWorkosSuccess("token-2", 86400);
		const second = await mintLastmileM2MToken("tenant-A", { forceRefresh: true });
		expect(second).toBe("token-2");
		expect(globalThis.fetch).toHaveBeenCalledTimes(1); // second mock replaces the first fn
	});

	it("re-mints when the cached token is within the expiry buffer", async () => {
		// Mint a token that "expires" in 4 minutes (< 5-min buffer).
		mockWorkosSuccess("about-to-expire", 240);
		const first = await mintLastmileM2MToken("tenant-A");
		expect(first).toBe("about-to-expire");

		mockWorkosSuccess("fresh", 86400);
		const second = await mintLastmileM2MToken("tenant-A");
		expect(second).toBe("fresh");
	});
});

describe("mintLastmileM2MToken — WorkOS failures", () => {
	beforeEach(() => {
		process.env.LASTMILE_M2M_CLIENT_ID = "id";
		process.env.LASTMILE_M2M_CLIENT_SECRET = "secret";
	});

	it("throws with the WorkOS status + body when client_credentials is rejected", async () => {
		mockWorkosFailure(
			400,
			JSON.stringify({ error: "invalid_client", error_description: "Invalid client id." }),
		);

		await expect(mintLastmileM2MToken("tenant-A")).rejects.toThrow(
			/invalid_client/,
		);
	});

	it("throws when WorkOS returns 200 but no access_token", async () => {
		globalThis.fetch = vi.fn(async () =>
			new Response(JSON.stringify({ token_type: "Bearer" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		) as unknown as typeof fetch;

		await expect(mintLastmileM2MToken("tenant-A")).rejects.toThrow(
			/no access_token/,
		);
	});

	it("does NOT cache a failed mint", async () => {
		mockWorkosFailure(400, "{}");
		await expect(mintLastmileM2MToken("tenant-A")).rejects.toBeDefined();

		mockWorkosSuccess("recovered");
		const ok = await mintLastmileM2MToken("tenant-A");
		expect(ok).toBe("recovered");
	});
});

describe("isLastmileM2MConfigured", () => {
	it("returns false when nothing is configured", async () => {
		expect(await isLastmileM2MConfigured("tenant-X")).toBe(false);
	});

	it("returns true when env vars are set", async () => {
		process.env.LASTMILE_M2M_CLIENT_ID = "id";
		process.env.LASTMILE_M2M_CLIENT_SECRET = "s";
		expect(await isLastmileM2MConfigured("tenant-X")).toBe(true);
	});
});
