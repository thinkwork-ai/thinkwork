/**
 * Unit tests for `lastmile-pat.ts` — the WorkOS JWT → PAT exchange
 * + per-user SSM cache.
 *
 * Contract:
 *   - `getOrMintLastmilePat` returns a cached PAT without calling the
 *     exchange endpoint when SSM has a usable secret.
 *   - When SSM is empty, it calls `getFreshWorkosJwt()`, POSTs to
 *     `/api-tokens`, stores the result, and returns the plaintext token.
 *   - A nearly-expired PAT (<= 1 day left) triggers re-exchange.
 *   - `forceRefreshLastmilePat` always POSTs /api-tokens, regardless of
 *     cache state (used by the REST adapter on 401 retry).
 *   - Null WorkOS JWT from the callback → null return (caller surfaces
 *     reconnect_needed).
 *   - Non-2xx from /api-tokens → null return + error log.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
	process.env.LASTMILE_TASKS_API_URL = "https://dev-api.lastmile-tei.com";
	process.env.STAGE = "dev";
});

const { mockSmSend } = vi.hoisted(() => ({ mockSmSend: vi.fn() }));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
	SecretsManagerClient: vi.fn(() => ({ send: mockSmSend })),
	GetSecretValueCommand: vi.fn((args) => ({ __command: "Get", ...args })),
	CreateSecretCommand: vi.fn((args) => ({ __command: "Create", ...args })),
	UpdateSecretCommand: vi.fn((args) => ({ __command: "Update", ...args })),
	ResourceNotFoundException: class ResourceNotFoundException extends Error {
		name = "ResourceNotFoundException";
	},
}));

import {
	getOrMintLastmilePat,
	forceRefreshLastmilePat,
	exchangeWorkosJwtForPat,
} from "../lib/lastmile-pat.js";

const originalFetch = globalThis.fetch;

function mockFetchOnce(body: unknown, status = 201) {
	globalThis.fetch = vi.fn(async () =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json" },
		}),
	) as unknown as typeof fetch;
}

function mockFetchError(status: number, text: string) {
	globalThis.fetch = vi.fn(async () =>
		new Response(text, { status, headers: { "Content-Type": "text/plain" } }),
	) as unknown as typeof fetch;
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

// ── exchangeWorkosJwtForPat — low-level POST ─────────────────────────────

describe("exchangeWorkosJwtForPat", () => {
	it("POSTs Bearer <jwt> with {name, expiresInDays} and returns parsed body", async () => {
		mockFetchOnce({
			id: "apikey_abc",
			name: "thinkwork-agent",
			token: "lmi_dev_ABCDEF",
			tokenPrefix: "lmi_dev_ABC",
			expiresAt: "2026-07-15T00:00:00.000Z",
			createdAt: "2026-04-16T00:00:00.000Z",
		});

		const result = await exchangeWorkosJwtForPat({
			workosJwt: "workos-jwt-payload",
			name: "thinkwork-agent",
			expiresInDays: 90,
		});

		expect(result.token).toBe("lmi_dev_ABCDEF");
		const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, RequestInit];
		expect(url).toBe("https://dev-api.lastmile-tei.com/api-tokens");
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer workos-jwt-payload",
		);
		expect(JSON.parse(init.body as string)).toEqual({
			name: "thinkwork-agent",
			expiresInDays: 90,
		});
	});

	it("defaults expiresInDays=90 when omitted", async () => {
		mockFetchOnce({
			id: "i",
			name: "n",
			token: "lmi_x",
			createdAt: "2026-04-16T00:00:00.000Z",
		});
		await exchangeWorkosJwtForPat({
			workosJwt: "j",
			name: "svc",
		});
		const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
			string,
			RequestInit,
		];
		expect(JSON.parse(init.body as string).expiresInDays).toBe(90);
	});

	it("throws with upstream status + body on non-2xx", async () => {
		mockFetchError(401, '{"error":"Token issuer is not a recognized WorkOS issuer."}');
		await expect(
			exchangeWorkosJwtForPat({ workosJwt: "j", name: "n" }),
		).rejects.toThrow(/401.*Token issuer/);
	});

	it("throws when response has no token field", async () => {
		mockFetchOnce({ id: "i", name: "n" });
		await expect(
			exchangeWorkosJwtForPat({ workosJwt: "j", name: "n" }),
		).rejects.toThrow(/no token/);
	});
});

// ── getOrMintLastmilePat — caching + lazy exchange ───────────────────────

describe("getOrMintLastmilePat — cached path", () => {
	it("returns cached PAT without calling /api-tokens when SSM has a fresh one", async () => {
		mockSmSend.mockResolvedValueOnce({
			SecretString: JSON.stringify({
				id: "apikey_cached",
				token: "lmi_dev_CACHED",
				name: "thinkwork-agent",
				expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
				createdAt: new Date().toISOString(),
			}),
		});
		const getJwt = vi.fn();
		const fetchSpy = vi.fn();
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		const token = await getOrMintLastmilePat({
			userId: "user-1",
			getFreshWorkosJwt: getJwt,
		});

		expect(token).toBe("lmi_dev_CACHED");
		expect(getJwt).not.toHaveBeenCalled();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("returns cached PAT with no expiry (null expiresAt)", async () => {
		mockSmSend.mockResolvedValueOnce({
			SecretString: JSON.stringify({
				id: "i",
				token: "lmi_dev_NOEXPIRY",
				name: "n",
				expiresAt: null,
				createdAt: new Date().toISOString(),
			}),
		});
		const token = await getOrMintLastmilePat({
			userId: "user-1",
			getFreshWorkosJwt: async () => null, // should not be called
		});
		expect(token).toBe("lmi_dev_NOEXPIRY");
	});

	it("re-exchanges when cached PAT is within the expiry buffer (1 day)", async () => {
		// expires in 12h — within the 24h buffer
		mockSmSend.mockResolvedValueOnce({
			SecretString: JSON.stringify({
				id: "old",
				token: "lmi_dev_STALE",
				name: "n",
				expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
				createdAt: new Date().toISOString(),
			}),
		});
		// then the UpdateSecretCommand call on write-back
		mockSmSend.mockResolvedValueOnce({});
		mockFetchOnce({
			id: "new",
			name: "thinkwork-agent",
			token: "lmi_dev_FRESH",
			expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
			createdAt: new Date().toISOString(),
		});
		const getJwt = vi.fn().mockResolvedValue("workos-jwt");

		const token = await getOrMintLastmilePat({
			userId: "user-1",
			getFreshWorkosJwt: getJwt,
		});

		expect(token).toBe("lmi_dev_FRESH");
		expect(getJwt).toHaveBeenCalledTimes(1);
	});
});

describe("getOrMintLastmilePat — lazy exchange path", () => {
	it("exchanges when SSM has no secret (ResourceNotFoundException)", async () => {
		const { ResourceNotFoundException } = await import("@aws-sdk/client-secrets-manager");
		mockSmSend.mockRejectedValueOnce(new ResourceNotFoundException({ message: "nope" } as never));
		// CreateSecret succeeds
		mockSmSend.mockResolvedValueOnce({});
		mockFetchOnce({
			id: "new",
			name: "thinkwork-agent",
			token: "lmi_dev_NEW",
			expiresAt: null,
			createdAt: new Date().toISOString(),
		});

		const token = await getOrMintLastmilePat({
			userId: "user-1",
			getFreshWorkosJwt: async () => "workos-jwt",
			tokenName: "thinkwork-agent",
		});

		expect(token).toBe("lmi_dev_NEW");
		// First call was Get (miss), then POST /api-tokens, then Update (or Create).
		expect(mockSmSend).toHaveBeenCalledTimes(2);
	});

	it("returns null when getFreshWorkosJwt returns null (no connection)", async () => {
		const { ResourceNotFoundException } = await import("@aws-sdk/client-secrets-manager");
		mockSmSend.mockRejectedValueOnce(new ResourceNotFoundException({ message: "nope" } as never));
		const fetchSpy = vi.fn();
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		const token = await getOrMintLastmilePat({
			userId: "user-1",
			getFreshWorkosJwt: async () => null,
		});

		expect(token).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("returns null when /api-tokens rejects (e.g. 401 stale WorkOS JWT)", async () => {
		const { ResourceNotFoundException } = await import("@aws-sdk/client-secrets-manager");
		mockSmSend.mockRejectedValueOnce(new ResourceNotFoundException({ message: "nope" } as never));
		mockFetchError(401, "Token issuer not recognized");
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

		const token = await getOrMintLastmilePat({
			userId: "user-1",
			getFreshWorkosJwt: async () => "expired-jwt",
		});

		expect(token).toBeNull();
		expect(errSpy).toHaveBeenCalled();
	});

	it("falls back to CreateSecret when UpdateSecret returns ResourceNotFoundException", async () => {
		const { ResourceNotFoundException } = await import("@aws-sdk/client-secrets-manager");
		mockSmSend.mockRejectedValueOnce(new ResourceNotFoundException({ message: "nope" } as never));
		mockFetchOnce({
			id: "new",
			name: "n",
			token: "lmi_dev_CREATED",
			expiresAt: null,
			createdAt: new Date().toISOString(),
		});
		// UpdateSecret fails with ResourceNotFoundException
		mockSmSend.mockRejectedValueOnce(new ResourceNotFoundException({ message: "no secret" } as never));
		// CreateSecret succeeds
		mockSmSend.mockResolvedValueOnce({});

		const token = await getOrMintLastmilePat({
			userId: "user-1",
			getFreshWorkosJwt: async () => "workos-jwt",
		});

		expect(token).toBe("lmi_dev_CREATED");
		const commandKinds = (mockSmSend.mock.calls as unknown as [{ __command: string }][]).map(
			(c) => c[0].__command,
		);
		expect(commandKinds).toEqual(["Get", "Update", "Create"]);
	});
});

// ── forceRefreshLastmilePat — always exchanges ───────────────────────────

describe("forceRefreshLastmilePat", () => {
	it("POSTs /api-tokens regardless of cache state", async () => {
		mockFetchOnce({
			id: "refreshed",
			name: "thinkwork-agent",
			token: "lmi_dev_REFRESHED",
			expiresAt: null,
			createdAt: new Date().toISOString(),
		});
		// UpdateSecret succeeds
		mockSmSend.mockResolvedValueOnce({});
		const getJwt = vi.fn().mockResolvedValue("fresh-jwt");

		const token = await forceRefreshLastmilePat({
			userId: "user-1",
			getFreshWorkosJwt: getJwt,
		});

		expect(token).toBe("lmi_dev_REFRESHED");
		expect(getJwt).toHaveBeenCalledTimes(1);
		// No SM read — we overwrite unconditionally.
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("returns null if the fresh WorkOS JWT is unavailable", async () => {
		const token = await forceRefreshLastmilePat({
			userId: "user-1",
			getFreshWorkosJwt: async () => null,
		});
		expect(token).toBeNull();
	});
});
