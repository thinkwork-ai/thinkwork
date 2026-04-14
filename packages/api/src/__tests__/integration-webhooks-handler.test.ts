/**
 * End-to-end tests for the integration-webhooks Lambda handler.
 *
 * The handler is the public HTTP seam: these tests invoke `handler(event)`
 * with synthetic API Gateway events and assert the response shape + status
 * code for each branch. `ingestExternalTaskEvent` is mocked so we're only
 * testing the handler's routing, rate limiting, and status-code mapping.
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIngest } = vi.hoisted(() => ({ mockIngest: vi.fn() }));

vi.mock("../integrations/external-work-items/ingestEvent.js", () => ({
	ingestExternalTaskEvent: mockIngest,
}));

import { handler } from "../handlers/integration-webhooks.js";

function buildEvent(overrides?: Partial<APIGatewayProxyEventV2>): APIGatewayProxyEventV2 {
	return {
		version: "2.0",
		routeKey: "POST /integrations/lastmile/webhook",
		rawPath: "/integrations/lastmile/webhook",
		rawQueryString: "",
		headers: { "x-lastmile-signature": "sig" },
		requestContext: {
			accountId: "123",
			apiId: "api",
			domainName: "example.com",
			domainPrefix: "example",
			http: {
				method: "POST",
				path: "/integrations/lastmile/webhook",
				protocol: "HTTP/1.1",
				sourceIp: `10.0.0.${Math.floor(Math.random() * 250) + 1}`,
				userAgent: "test",
			},
			requestId: `req-${Math.random().toString(36).slice(2)}`,
			routeKey: "POST /integrations/lastmile/webhook",
			stage: "$default",
			time: "14/Apr/2026:10:00:00 +0000",
			timeEpoch: Date.now(),
		},
		body: JSON.stringify({ event: "assigned", data: { task: { id: "t1" } } }),
		isBase64Encoded: false,
		...overrides,
	} as APIGatewayProxyEventV2;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("integration-webhooks handler — routing", () => {
	it("rejects GET with 405", async () => {
		const ev = buildEvent();
		ev.requestContext.http.method = "GET";
		const res = await handler(ev);
		expect(res.statusCode).toBe(405);
		expect(mockIngest).not.toHaveBeenCalled();
	});

	it("returns 404 for a path that does not match the route", async () => {
		const ev = buildEvent({ rawPath: "/something/else" });
		const res = await handler(ev);
		expect(res.statusCode).toBe(404);
		expect(mockIngest).not.toHaveBeenCalled();
	});

	it("passes the provider slug from the path to the ingest pipeline", async () => {
		mockIngest.mockResolvedValueOnce({
			status: "ok",
			threadId: "th-1",
			created: true,
			event: { kind: "task.assigned" },
		});
		const ev = buildEvent({ rawPath: "/integrations/lastmile/webhook" });
		await handler(ev);
		expect(mockIngest).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "lastmile" }),
		);
	});
});

describe("integration-webhooks handler — status mapping", () => {
	it("returns 401 when ingest reports unverified", async () => {
		mockIngest.mockResolvedValueOnce({ status: "unverified" });
		const res = await handler(buildEvent());
		expect(res.statusCode).toBe(401);
	});

	it("returns 202 for ignored provider (with reason in body)", async () => {
		mockIngest.mockResolvedValueOnce({
			status: "ignored",
			reason: "unknown provider: asana",
		});
		const res = await handler(buildEvent());
		expect(res.statusCode).toBe(202);
		expect(JSON.parse(res.body ?? "{}")).toMatchObject({
			ok: false,
			reason: "unknown provider: asana",
		});
	});

	it("returns 202 for unresolved_connection (ingest succeeded but no matching user)", async () => {
		mockIngest.mockResolvedValueOnce({
			status: "unresolved_connection",
			providerUserId: "user_unknown",
		});
		const res = await handler(buildEvent());
		expect(res.statusCode).toBe(202);
		expect(JSON.parse(res.body ?? "{}")).toMatchObject({
			ok: false,
			reason: "unresolved_connection",
		});
	});

	it("returns 201 with threadId + eventKind on ok", async () => {
		mockIngest.mockResolvedValueOnce({
			status: "ok",
			threadId: "thread-42",
			created: true,
			event: { kind: "task.assigned" },
		});
		const res = await handler(buildEvent());
		expect(res.statusCode).toBe(201);
		expect(JSON.parse(res.body ?? "{}")).toMatchObject({
			ok: true,
			threadId: "thread-42",
			created: true,
			eventKind: "task.assigned",
		});
	});

	it("returns 500 when the pipeline throws", async () => {
		mockIngest.mockRejectedValueOnce(new Error("boom"));
		const res = await handler(buildEvent());
		expect(res.statusCode).toBe(500);
	});
});

describe("integration-webhooks handler — rate limiting", () => {
	it("returns 429 after the per-minute limit is exceeded from a single source IP", async () => {
		mockIngest.mockResolvedValue({
			status: "ok",
			threadId: "t",
			created: false,
			event: { kind: "task.updated" },
		});

		// Use one fixed source IP so all requests share a rate-limit bucket.
		const srcIp = "203.0.113.50";
		const LIMIT = 600;

		// First 600 should pass.
		for (let i = 0; i < LIMIT; i++) {
			const ev = buildEvent();
			ev.requestContext.http.sourceIp = srcIp;
			const res = await handler(ev);
			expect(res.statusCode).toBe(201);
		}

		// 601st should be rate-limited.
		const overflow = buildEvent();
		overflow.requestContext.http.sourceIp = srcIp;
		const res = await handler(overflow);
		expect(res.statusCode).toBe(429);
	});
});
