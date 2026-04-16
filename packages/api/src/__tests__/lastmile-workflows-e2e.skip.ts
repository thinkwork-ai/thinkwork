/**
 * End-to-end integration test: OAuth token → LastMile REST `/workflows`.
 *
 * This test is OPT-IN — skipped unless TEST_LASTMILE_ACCESS_TOKEN is set.
 * It makes a real HTTP call to LastMile's dev API. CI runs do not set the
 * env var, so this won't slow down or flake normal runs.
 *
 * Rename to .test.ts locally to enable vitest discovery, or run directly:
 *
 *   TEST_LASTMILE_ACCESS_TOKEN="eyJ..." \
 *   TEST_LASTMILE_API_URL="https://api-dev.lastmile-tei.com" \
 *   pnpm --filter @thinkwork/api exec vitest run \
 *     src/__tests__/lastmile-workflows-e2e.skip.ts
 *
 * The token must be a valid WorkOS access_token issued to the LastMile
 * Tasks MCP resource via the existing mobile OAuth flow. Grab one from
 * Secrets Manager at `thinkwork/{stage}/mcp-tokens/{userId}/{mcpServerId}`.
 *
 * What this verifies (per the actual LastMile handler we traced in
 * /projects/lastmile/web-apps/apps/lmi/aws/src/api/workflow/fetch-workflows.ts):
 *
 *   1. Our `Authorization: Bearer {token}` header is accepted
 *   2. LastMile's `authenticateRequest` → `authenticateWorkosToken` passes
 *      - WorkOS JWKS signature check succeeds
 *      - Clerk user lookup by JWT `sub` succeeds
 *      - User has `publicMetadata.company_id`
 *   3. `/workflows` returns 200 with a (possibly empty) array
 *
 * On failure, the assertion message includes the full LastmileRestError
 * (status, code, message, responseBody, requestId) + the JWT claims we
 * sent, so the operator can diagnose within one run.
 */

import { describe, expect, it } from "vitest";

import {
	listWorkflows,
	LastmileRestError,
} from "../integrations/external-work-items/providers/lastmile/restClient.js";

const ACCESS_TOKEN = process.env.TEST_LASTMILE_ACCESS_TOKEN || "";
const API_URL = process.env.TEST_LASTMILE_API_URL || "https://api-dev.lastmile-tei.com";

// Fail loudly if the caller set TEST_LASTMILE_ACCESS_TOKEN but not the URL —
// the module-under-test reads LASTMILE_TASKS_API_URL at import time, so we
// must prime it before anything else.
if (ACCESS_TOKEN) {
	process.env.LASTMILE_TASKS_API_URL = API_URL;
}

function describeIfToken(name: string, fn: () => void) {
	return ACCESS_TOKEN ? describe(name, fn) : describe.skip(name, fn);
}

function peekJwt(token: string): Record<string, unknown> | null {
	try {
		const [, payload] = token.split(".");
		if (!payload) return null;
		const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
		const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
		return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
	} catch {
		return null;
	}
}

describeIfToken("E2E: LastMile /workflows with real OAuth token", () => {
	it("returns a valid workflows array from LastMile's REST API", async () => {
		const claims = peekJwt(ACCESS_TOKEN);
		console.log(
			"[e2e] calling",
			API_URL + "/workflows",
			"with token claims:",
			{
				iss: claims?.iss,
				sub: claims?.sub,
				aud: claims?.aud,
				scope: claims?.scope,
				exp: claims?.exp,
				expiresInSec:
					typeof claims?.exp === "number"
						? claims.exp - Math.floor(Date.now() / 1000)
						: undefined,
			},
		);

		try {
			const workflows = await listWorkflows({
				ctx: { authToken: ACCESS_TOKEN },
			});

			// Success path: assert shape. LastMile's GET /workflows returns
			// bare array or {data: [...]} — the client unwraps both.
			expect(Array.isArray(workflows)).toBe(true);
			console.log(
				`[e2e] SUCCESS — received ${workflows.length} workflow(s) from LastMile`,
				workflows.slice(0, 3),
			);

			for (const wf of workflows) {
				expect(wf).toHaveProperty("id");
				expect(wf).toHaveProperty("name");
				expect(wf).toHaveProperty("team_id");
			}
		} catch (err) {
			if (err instanceof LastmileRestError) {
				const detail = {
					status: err.status,
					code: err.code,
					message: err.message,
					requestId: err.requestId,
					responseBody: err.responseBody,
					tokenIssuer: claims?.iss,
					tokenSub: claims?.sub,
					tokenAudience: claims?.aud,
				};
				throw new Error(
					"LastMile REST call failed: " + JSON.stringify(detail, null, 2),
				);
			}
			throw err;
		}
	}, 30_000);

	it("401 retry is a no-op when initial call succeeds", async () => {
		let refreshCallCount = 0;
		const refreshToken = async () => {
			refreshCallCount++;
			return null; // force refresh path to be exercised defensively
		};

		await listWorkflows({
			ctx: { authToken: ACCESS_TOKEN, refreshToken },
		});

		expect(
			refreshCallCount,
			"refreshToken should not have been invoked on a 200 response",
		).toBe(0);
	}, 30_000);
});
