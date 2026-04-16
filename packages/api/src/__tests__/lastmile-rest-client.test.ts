/**
 * Unit tests for the LastMile REST client — specifically the refresh-on-401
 * retry path added alongside the "Failed to validate WorkOS user" fix.
 *
 * LastMile's REST API validates WorkOS JWTs server-side and can reject
 * them out-of-band (session rotated, Clerk lookup failed, clock skew).
 * The adapter now retries once with a force-refreshed token so transient
 * rejections self-heal without requiring the user to reconnect.
 *
 * Tests lock the contract for:
 *   1. 200 happy path (no refresh invoked)
 *   2. 401 → refresh → retry succeeds
 *   3. 401 → refresh returns null → throw unauthorized_after_refresh
 *   4. 401 → refresh returns same token → throw (no infinite loop)
 *   5. 401 → refresh throws → still throw, don't infinite-retry
 *   6. 401 diagnostic log includes decoded JWT claims
 *   7. No refreshToken callback → 401 throws immediately (back-compat)
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted` runs before ESM import hoisting, so the env var is set
// before restClient.ts evaluates `const BASE_URL = process.env.LASTMILE_TASKS_API_URL`.
vi.hoisted(() => {
	process.env.LASTMILE_TASKS_API_URL = "https://api-dev.lastmile-tei.com";
});

import {
	listWorkflows,
	LastmileRestError,
} from "../integrations/external-work-items/providers/lastmile/restClient.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

// Valid-shape JWT with payload {aud,iss,sub,exp,scope}. Signature is
// irrelevant — peekJwtClaims doesn't verify, it just base64-decodes.
function makeJwt(claims: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
	return `${header}.${payload}.sig-ignored`;
}

const OLD_TOKEN = makeJwt({
	iss: "https://straightforward-dragon-14-staging.authkit.app",
	sub: "user_OLD",
	aud: "https://mcp-dev.lastmile-tei.com/tasks",
	exp: Math.floor(Date.now() / 1000) + 3600,
	scope: "openid profile email",
	jti: "old-jti",
});
const NEW_TOKEN = makeJwt({
	iss: "https://straightforward-dragon-14-staging.authkit.app",
	sub: "user_OLD",
	aud: "https://mcp-dev.lastmile-tei.com/tasks",
	exp: Math.floor(Date.now() / 1000) + 3600,
	scope: "openid profile email",
	jti: "new-jti",
});

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("listWorkflows — happy path", () => {
	it("returns workflows without invoking refreshToken when request succeeds", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse([{ id: "wf_1", name: "Intake", team_id: "t1" }]));
		globalThis.fetch = fetchSpy as unknown as typeof fetch;
		const refreshToken = vi.fn();

		const result = await listWorkflows({ ctx: { authToken: OLD_TOKEN, refreshToken } });

		expect(result).toEqual([{ id: "wf_1", name: "Intake", team_id: "t1" }]);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(refreshToken).not.toHaveBeenCalled();

		const [, init] = fetchSpy.mock.calls[0];
		expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${OLD_TOKEN}`);
	});

	it("unwraps {data: [...]} paginated envelope into a bare array", async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ data: [{ id: "wf_1", name: "X", team_id: "t1" }] })) as unknown as typeof fetch;

		const result = await listWorkflows({ ctx: { authToken: OLD_TOKEN } });
		expect(result).toEqual([{ id: "wf_1", name: "X", team_id: "t1" }]);
	});
});

describe("listWorkflows — 401 refresh-retry path", () => {
	it("invokes refreshToken and retries with the new token when server returns 401", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({ error: "Failed to validate WorkOS user." }, 401),
			)
			.mockResolvedValueOnce(
				jsonResponse([{ id: "wf_1", name: "Intake", team_id: "t1" }]),
			);
		globalThis.fetch = fetchSpy as unknown as typeof fetch;
		const refreshToken = vi.fn().mockResolvedValue(NEW_TOKEN);

		const result = await listWorkflows({ ctx: { authToken: OLD_TOKEN, refreshToken } });

		expect(result).toEqual([{ id: "wf_1", name: "Intake", team_id: "t1" }]);
		expect(refreshToken).toHaveBeenCalledTimes(1);
		expect(fetchSpy).toHaveBeenCalledTimes(2);

		// First attempt used OLD, second used NEW.
		const firstAuth = (fetchSpy.mock.calls[0][1].headers as Record<string, string>).Authorization;
		const secondAuth = (fetchSpy.mock.calls[1][1].headers as Record<string, string>).Authorization;
		expect(firstAuth).toBe(`Bearer ${OLD_TOKEN}`);
		expect(secondAuth).toBe(`Bearer ${NEW_TOKEN}`);
	});

	it("logs decoded JWT claims on 401 for diagnostics", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({ error: "Failed to validate WorkOS user." }, 401),
			);
		globalThis.fetch = fetchSpy as unknown as typeof fetch;
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(
			listWorkflows({ ctx: { authToken: OLD_TOKEN } }),
		).rejects.toBeInstanceOf(LastmileRestError);

		// Find the [lastmile-rest] 401 log entry.
		const logCall = errorSpy.mock.calls.find(
			(args) => typeof args[0] === "string" && args[0].startsWith("[lastmile-rest] 401"),
		);
		expect(logCall, "expected a [lastmile-rest] 401 log line").toBeDefined();
		const details = logCall![1] as Record<string, unknown>;
		expect(details.status).toBe(401);
		expect(details.tokenIssuer).toBe(
			"https://straightforward-dragon-14-staging.authkit.app",
		);
		expect(details.tokenAudience).toBe("https://mcp-dev.lastmile-tei.com/tasks");
		expect(details.tokenSub).toBe("user_OLD");
		expect(typeof details.tokenExp).toBe("number");
		expect(typeof details.tokenExpiresInSec).toBe("number");
	});

	it("throws unauthorized_after_refresh when refresh returns null", async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({ error: "Failed to validate WorkOS user." }, 401),
			) as unknown as typeof fetch;
		const refreshToken = vi.fn().mockResolvedValue(null);

		let thrown: unknown;
		try {
			await listWorkflows({ ctx: { authToken: OLD_TOKEN, refreshToken } });
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(LastmileRestError);
		expect((thrown as LastmileRestError).status).toBe(401);
		expect((thrown as LastmileRestError).code).toBe("unauthorized_after_refresh");
		expect(refreshToken).toHaveBeenCalledTimes(1);
	});

	it("throws unauthorized_after_refresh when refresh returns the same token (no infinite loop)", async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({ error: "Failed to validate WorkOS user." }, 401),
			) as unknown as typeof fetch;
		const refreshToken = vi.fn().mockResolvedValue(OLD_TOKEN);

		await expect(
			listWorkflows({ ctx: { authToken: OLD_TOKEN, refreshToken } }),
		).rejects.toMatchObject({
			status: 401,
			code: "unauthorized_after_refresh",
		});
		expect(refreshToken).toHaveBeenCalledTimes(1);
	});

	it("does not infinite-loop when retry also returns 401", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValue(jsonResponse({ error: "Still invalid" }, 401));
		globalThis.fetch = fetchSpy as unknown as typeof fetch;
		const refreshToken = vi.fn().mockResolvedValue(NEW_TOKEN);

		await expect(
			listWorkflows({ ctx: { authToken: OLD_TOKEN, refreshToken } }),
		).rejects.toMatchObject({
			status: 401,
			code: "unauthorized_after_refresh",
		});
		// Called exactly twice: original + one retry after refresh.
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(refreshToken).toHaveBeenCalledTimes(1);
	});

	it("swallows thrown refresh callback errors and surfaces the 401", async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({}, 401)) as unknown as typeof fetch;
		const refreshToken = vi
			.fn()
			.mockRejectedValue(new Error("WorkOS token endpoint timed out"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(
			listWorkflows({ ctx: { authToken: OLD_TOKEN, refreshToken } }),
		).rejects.toMatchObject({
			status: 401,
			code: "unauthorized_after_refresh",
		});
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("[lastmile-rest] refresh callback threw"),
			expect.any(Error),
		);
	});

	it("throws immediately on 401 when no refreshToken callback is provided (back-compat)", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({ error: "Failed to validate WorkOS user." }, 401),
			);
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		await expect(
			listWorkflows({ ctx: { authToken: OLD_TOKEN } }),
		).rejects.toMatchObject({
			status: 401,
			// Without a refresh callback, `code` comes from LastMile's body
			// or falls back to "unauthorized" — NOT "unauthorized_after_refresh".
			code: expect.not.stringMatching("unauthorized_after_refresh"),
		});
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});

describe("listWorkflows — baseUrl override (per-tenant config)", () => {
	it("uses ctx.baseUrl when provided, ignoring the env var default", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ data: [] }));
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		await listWorkflows({
			ctx: {
				authToken: OLD_TOKEN,
				baseUrl: "https://tenant-specific.example.com",
			},
		});

		const [url] = fetchSpy.mock.calls[0] as [string];
		expect(url.startsWith("https://tenant-specific.example.com/workflows")).toBe(
			true,
		);
	});

	it("falls back to env var when ctx.baseUrl is null", async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ data: [] })) as unknown as typeof fetch;
		await listWorkflows({ ctx: { authToken: OLD_TOKEN, baseUrl: null } });
		const [url] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string];
		expect(url.startsWith("https://api-dev.lastmile-tei.com/workflows")).toBe(
			true,
		);
	});
});

describe("listWorkflows — misc error paths", () => {
	it("does not invoke refreshToken on 500 (only 401 triggers refresh)", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValue(jsonResponse({ error: "boom" }, 500));
		globalThis.fetch = fetchSpy as unknown as typeof fetch;
		const refreshToken = vi.fn();

		await expect(
			listWorkflows({ ctx: { authToken: OLD_TOKEN, refreshToken } }),
		).rejects.toBeInstanceOf(LastmileRestError);
		expect(refreshToken).not.toHaveBeenCalled();
	});

	it("throws missing_token when ctx.authToken is empty", async () => {
		await expect(
			listWorkflows({ ctx: { authToken: "" } }),
		).rejects.toMatchObject({ code: "missing_token" });
	});
});
