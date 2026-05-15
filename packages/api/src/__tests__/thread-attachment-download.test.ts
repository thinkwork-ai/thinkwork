/**
 * Tests for the thread-attachment download Lambda (U9 of finance pilot).
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockAuthenticate,
	mockResolveCaller,
	mockThreadRows,
	mockAttachmentRows,
	mockGetSignedUrl,
} = vi.hoisted(() => ({
	mockAuthenticate: vi.fn(),
	mockResolveCaller: vi.fn(),
	mockThreadRows: vi.fn(),
	mockAttachmentRows: vi.fn(),
	mockGetSignedUrl: vi.fn(),
}));

vi.mock("../lib/cognito-auth.js", () => ({
	authenticate: mockAuthenticate,
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
	resolveCallerFromAuth: mockResolveCaller,
}));

vi.mock("../lib/db.js", () => {
	let callIdx = 0;
	const threadsBuilder: any = {
		from: () => threadsBuilder,
		where: () => threadsBuilder,
		then: (resolve: (rows: unknown[]) => unknown) =>
			resolve(mockThreadRows()),
	};
	const attachmentsBuilder: any = {
		from: () => attachmentsBuilder,
		where: () => attachmentsBuilder,
		then: (resolve: (rows: unknown[]) => unknown) =>
			resolve(mockAttachmentRows()),
	};
	return {
		db: {
			select: () => {
				const i = callIdx++;
				return i % 2 === 0 ? threadsBuilder : attachmentsBuilder;
			},
			__resetCallIdx: () => {
				callIdx = 0;
			},
		} as any,
	};
});

vi.mock("@aws-sdk/client-s3", () => ({
	S3Client: class {},
	GetObjectCommand: class {
		constructor(public input: unknown) {}
	},
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
	getSignedUrl: mockGetSignedUrl,
}));

import { handler } from "../handlers/thread-attachment-download.js";

const THREAD = "11111111-1111-1111-1111-111111111111";
const ATTACHMENT = "22222222-2222-2222-2222-222222222222";
const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function event(path?: string): APIGatewayProxyEventV2 {
	return {
		rawPath:
			path ?? `/api/threads/${THREAD}/attachments/${ATTACHMENT}/download`,
		headers: { authorization: "Bearer test" },
		requestContext: { http: { method: "GET" } },
	} as unknown as APIGatewayProxyEventV2;
}

describe("GET /api/threads/{tid}/attachments/{aid}/download", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		process.env.WORKSPACE_BUCKET = "thinkwork-test-workspace";
		mockAuthenticate.mockResolvedValue({
			authType: "cognito",
			principalId: "principal-A",
		});
		mockResolveCaller.mockResolvedValue({
			userId: "user-A",
			tenantId: TENANT_A,
		});
		mockThreadRows.mockReturnValue([{ id: THREAD }]);
		mockAttachmentRows.mockReturnValue([
			{
				s3_key: `tenants/${TENANT_A}/attachments/${THREAD}/${ATTACHMENT}/financials.xlsx`,
				name: "financials.xlsx",
				mime_type:
					"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			},
		]);
		mockGetSignedUrl.mockResolvedValue(
			"https://s3.amazonaws.com/signed-get-url",
		);
		const dbMod = await import("../lib/db.js");
		(dbMod.db as unknown as { __resetCallIdx: () => void }).__resetCallIdx();
	});

	it("happy path: returns 302 with the presigned S3 URL in Location", async () => {
		const res = await handler(event());
		expect(res.statusCode).toBe(302);
		expect((res.headers as Record<string, string>).location).toBe(
			"https://s3.amazonaws.com/signed-get-url",
		);
	});

	it("issues the presigned URL with ResponseContentDisposition: attachment", async () => {
		await handler(event());
		// First arg is the S3 client, second is the GetObjectCommand
		// constructed with the staging Key + content-disposition.
		const cmdArg = mockGetSignedUrl.mock.calls[0]![1] as { input: any };
		expect(cmdArg.input.ResponseContentDisposition).toBe(
			'attachment; filename="financials.xlsx"',
		);
		expect(cmdArg.input.Key).toContain(
			`tenants/${TENANT_A}/attachments/${THREAD}/${ATTACHMENT}/`,
		);
	});

	it("returns 404 (identical) when caller's tenant doesn't own the thread", async () => {
		mockThreadRows.mockReturnValue([]);
		const res = await handler(event());
		expect(res.statusCode).toBe(404);
		expect(mockGetSignedUrl).not.toHaveBeenCalled();
	});

	it("returns 404 when the attachment exists but belongs to a different thread", async () => {
		// The (id, thread_id, tenant_id) WHERE filters all three; mock
		// returns no rows when any of the three doesn't match.
		mockAttachmentRows.mockReturnValue([]);
		const res = await handler(event());
		expect(res.statusCode).toBe(404);
	});

	it("returns 404 when the attachment row has no s3_key (defensive)", async () => {
		mockAttachmentRows.mockReturnValue([
			{ s3_key: null, name: "x", mime_type: "text/csv" },
		]);
		const res = await handler(event());
		expect(res.statusCode).toBe(404);
	});

	it("returns 404 for unparseable threadId/attachmentId in path", async () => {
		const res = await handler(event("/api/threads/not-uuid/attachments/not-uuid/download"));
		expect(res.statusCode).toBe(404);
	});

	it("returns 401 when authentication has no tenant_id", async () => {
		mockResolveCaller.mockResolvedValue({ userId: null, tenantId: null });
		const res = await handler(event());
		expect(res.statusCode).toBe(401);
	});

	it("escapes backslash + double-quote in the content-disposition filename", async () => {
		mockAttachmentRows.mockReturnValue([
			{
				s3_key: `tenants/${TENANT_A}/attachments/${THREAD}/${ATTACHMENT}/foo.csv`,
				name: 'has "quote" and \\back.csv',
				mime_type: "text/csv",
			},
		]);
		await handler(event());
		const cmdArg = mockGetSignedUrl.mock.calls[0]![1] as { input: any };
		expect(cmdArg.input.ResponseContentDisposition).toBe(
			'attachment; filename="has \\"quote\\" and \\\\back.csv"',
		);
	});

	it("does NOT signed the URL when tenant resolution + DB lookup short-circuit", async () => {
		mockResolveCaller.mockResolvedValue({ userId: null, tenantId: null });
		await handler(event());
		expect(mockGetSignedUrl).not.toHaveBeenCalled();
	});
});
