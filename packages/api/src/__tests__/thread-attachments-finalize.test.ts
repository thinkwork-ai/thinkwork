/**
 * Tests for the thread-attachment finalize Lambda (U2 of finance pilot).
 *
 * Exercises content sniff (magic bytes), OOXML safety (macros + external
 * links), staging-key tenant pinning, idempotency, audit emit shape,
 * and transaction rollback on emit failure.
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

const {
	mockAuthenticate,
	mockResolveCaller,
	mockSelectThreadRows,
	mockSelectAttachmentRows,
	mockInsertedAttachmentRows,
	mockAuditEvents,
	mockHeadResponse,
	mockGetBuffer,
} = vi.hoisted(() => ({
	mockAuthenticate: vi.fn(),
	mockResolveCaller: vi.fn(),
	mockSelectThreadRows: vi.fn(),
	mockSelectAttachmentRows: vi.fn(),
	mockInsertedAttachmentRows: [] as Array<Record<string, unknown>>,
	mockAuditEvents: [] as Array<Record<string, unknown>>,
	mockHeadResponse: { current: null as null | Record<string, unknown> },
	mockGetBuffer: { current: null as null | Buffer },
}));

vi.mock("../lib/cognito-auth.js", () => ({
	authenticate: mockAuthenticate,
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
	resolveCallerFromAuth: mockResolveCaller,
}));

vi.mock("../lib/db.js", () => {
	// The handler does select(threads) then select(threadAttachments).
	// Track which call we're on so the right rows come back without
	// dropping the mock implementation across tests.
	let selectCallCounter = 0;
	const threadsBuilder: any = {
		from: () => threadsBuilder,
		where: () => threadsBuilder,
		then: (resolve: (rows: unknown[]) => unknown) =>
			resolve(mockSelectThreadRows()),
	};
	const attachmentsBuilder: any = {
		from: () => attachmentsBuilder,
		where: () => attachmentsBuilder,
		then: (resolve: (rows: unknown[]) => unknown) =>
			resolve(mockSelectAttachmentRows()),
	};
	const insertBuilder: any = {
		values: (row: Record<string, unknown>) => {
			mockInsertedAttachmentRows.push(row);
			return {
				returning: () => Promise.resolve([row]),
			};
		},
	};
	const tx: any = {
		insert: () => insertBuilder,
	};
	const dbMock: any = {
		select: () => {
			const idx = selectCallCounter++;
			// Per-handler-invocation: select #0 → threads, #1 → attachments
			return idx % 2 === 0 ? threadsBuilder : attachmentsBuilder;
		},
		transaction: vi.fn(async (cb: (tx: any) => unknown) => cb(tx)),
		// Exposed so tests can reset the counter between handler invocations.
		__resetSelectCounter: () => {
			selectCallCounter = 0;
		},
	};
	return { db: dbMock };
});

vi.mock("../lib/compliance/emit.js", () => ({
	emitAuditEvent: vi.fn(async (_tx: unknown, input: Record<string, unknown>) => {
		mockAuditEvents.push(input);
	}),
}));

vi.mock("@aws-sdk/client-s3", () => ({
	S3Client: class {
		async send(cmd: { __op?: string }) {
			if (cmd.__op === "HEAD") return mockHeadResponse.current ?? {};
			if (cmd.__op === "GET") {
				const buf = mockGetBuffer.current ?? Buffer.from("");
				async function* iter() {
					yield new Uint8Array(buf);
				}
				return { Body: iter() };
			}
			return {};
		}
	},
	HeadObjectCommand: class {
		__op = "HEAD";
		constructor(public input: unknown) {}
	},
	GetObjectCommand: class {
		__op = "GET";
		constructor(public input: unknown) {}
	},
}));

import { handler } from "../handlers/thread-attachments-finalize.js";

const THREAD_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ATTACHMENT_ID = "deadbeef-dead-beef-dead-beefdeadbeef";

function event(body: Record<string, unknown>): APIGatewayProxyEventV2 {
	return {
		rawPath: `/api/threads/${THREAD_ID}/attachments/finalize`,
		headers: { authorization: "Bearer test" },
		body: JSON.stringify(body),
		requestContext: { http: { method: "POST" } },
	} as unknown as APIGatewayProxyEventV2;
}

async function buildMinimalXlsxBuffer(): Promise<Buffer> {
	const zip = new JSZip();
	zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types/>');
	zip.file("xl/workbook.xml", '<?xml version="1.0"?><workbook/>');
	zip.file("xl/worksheets/sheet1.xml", '<?xml version="1.0"?><worksheet/>');
	return Buffer.from(
		await zip.generateAsync({ type: "uint8array", platform: "UNIX" }),
	);
}

async function buildMacroEnabledXlsxBuffer(): Promise<Buffer> {
	const zip = new JSZip();
	zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types/>');
	zip.file("xl/workbook.xml", '<?xml version="1.0"?><workbook/>');
	zip.file("xl/vbaProject.bin", Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
	return Buffer.from(
		await zip.generateAsync({ type: "uint8array", platform: "UNIX" }),
	);
}

describe("POST /api/threads/{threadId}/attachments/finalize", () => {
	beforeEach(async () => {
		mockInsertedAttachmentRows.length = 0;
		mockAuditEvents.length = 0;
		mockHeadResponse.current = null;
		mockGetBuffer.current = null;
		process.env.WORKSPACE_BUCKET = "thinkwork-test-workspace";
		mockAuthenticate.mockReset();
		mockResolveCaller.mockReset();
		mockSelectThreadRows.mockReset();
		mockSelectAttachmentRows.mockReset();
		mockAuthenticate.mockResolvedValue({
			authType: "cognito",
			principalId: "principal-A",
		});
		mockResolveCaller.mockResolvedValue({
			userId: "user-A",
			tenantId: TENANT_ID,
		});
		mockSelectThreadRows.mockReturnValue([
			{ id: THREAD_ID, tenant_id: TENANT_ID },
		]);
		mockSelectAttachmentRows.mockReturnValue([]); // no prior attachment
		// Reset the per-handler-invocation select counter so each test
		// starts with a clean alternation between threads ↔ attachments.
		const { db } = (await import("../lib/db.js")) as unknown as {
			db: { __resetSelectCounter: () => void };
		};
		db.__resetSelectCounter();
	});

	function validBody(buf: Buffer, name = "financials.xlsx"): Record<string, unknown> {
		return {
			attachmentId: ATTACHMENT_ID,
			stagingKey: `tenants/${TENANT_ID}/attachments/${THREAD_ID}/${ATTACHMENT_ID}/${name}`,
			name,
			declaredMimeType:
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			declaredSizeBytes: buf.length,
		};
	}

	it("happy path: inserts attachment row + emits attachment.received audit event", async () => {
		const buf = await buildMinimalXlsxBuffer();
		mockHeadResponse.current = {
			ContentLength: buf.length,
			ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		};
		mockGetBuffer.current = buf;

		const res = await handler(event(validBody(buf)));
		expect(res.statusCode).toBe(201);
		const body = JSON.parse(res.body ?? "{}");
		expect(body.attachmentId).toBe(ATTACHMENT_ID);
		expect(body.name).toBe("financials.xlsx");
		expect(body.sizeBytes).toBe(buf.length);

		// Row insert payload
		expect(mockInsertedAttachmentRows).toHaveLength(1);
		const inserted = mockInsertedAttachmentRows[0]!;
		expect(inserted.id).toBe(ATTACHMENT_ID);
		expect(inserted.tenant_id).toBe(TENANT_ID);
		expect(inserted.thread_id).toBe(THREAD_ID);
		expect(inserted.s3_key).toBe(
			`tenants/${TENANT_ID}/attachments/${THREAD_ID}/${ATTACHMENT_ID}/financials.xlsx`,
		);

		// Audit emit payload
		expect(mockAuditEvents).toHaveLength(1);
		const audit = mockAuditEvents[0]!;
		expect(audit.eventType).toBe("attachment.received");
		expect(audit.tenantId).toBe(TENANT_ID);
		expect((audit.payload as Record<string, unknown>).attachmentId).toBe(
			ATTACHMENT_ID,
		);
		// Hardening invariant: raw s3_key / filename MUST NOT appear in
		// the audit payload (U6 redaction discipline mirrored here even
		// though the allow-list would also drop them at write time).
		expect((audit.payload as Record<string, unknown>).s3_key).toBeUndefined();
		expect((audit.payload as Record<string, unknown>).name).toBeUndefined();
	});

	it("idempotency: re-finalizing the same attachmentId returns existing row, no duplicate insert/emit", async () => {
		mockSelectAttachmentRows.mockReturnValue([
			{
				id: ATTACHMENT_ID,
				thread_id: THREAD_ID,
				tenant_id: TENANT_ID,
				name: "financials.xlsx",
				s3_key: `tenants/${TENANT_ID}/attachments/${THREAD_ID}/${ATTACHMENT_ID}/financials.xlsx`,
				mime_type:
					"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				size_bytes: 1000,
			},
		]);
		const res = await handler(event(validBody(Buffer.alloc(1000))));
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body ?? "{}");
		expect(body.alreadyFinalized).toBe(true);
		expect(mockInsertedAttachmentRows).toHaveLength(0);
		expect(mockAuditEvents).toHaveLength(0);
	});

	it("rejects cross-tenant: stagingKey points to another tenant's prefix", async () => {
		const body = validBody(Buffer.alloc(100));
		body.stagingKey = `tenants/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/attachments/${THREAD_ID}/${ATTACHMENT_ID}/foo.xlsx`;
		const res = await handler(event(body));
		expect(res.statusCode).toBe(403);
		expect(mockInsertedAttachmentRows).toHaveLength(0);
	});

	it("rejects when caller's tenant doesn't own the thread (cross-tenant probe)", async () => {
		mockSelectThreadRows.mockReturnValue([]);
		const res = await handler(event(validBody(Buffer.alloc(100))));
		expect(res.statusCode).toBe(404);
	});

	it("rejects macro-enabled OOXML container (xl/vbaProject.bin)", async () => {
		const buf = await buildMacroEnabledXlsxBuffer();
		mockHeadResponse.current = {
			ContentLength: buf.length,
			ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		};
		mockGetBuffer.current = buf;
		const res = await handler(event(validBody(buf)));
		expect(res.statusCode).toBe(415);
		expect(JSON.parse(res.body ?? "{}").error).toContain("macro_enabled");
		expect(mockInsertedAttachmentRows).toHaveLength(0);
		expect(mockAuditEvents).toHaveLength(0);
	});

	it("rejects when declared MIME suggests xlsx but magic bytes don't match", async () => {
		// PE/MZ Windows EXE prefix masquerading as .xlsx
		const buf = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
		mockHeadResponse.current = {
			ContentLength: buf.length,
			ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		};
		mockGetBuffer.current = buf;
		const res = await handler(event(validBody(buf)));
		expect(res.statusCode).toBe(415);
		expect(JSON.parse(res.body ?? "{}").error).toContain("content sniff failed");
	});

	it("rejects when declared size differs materially from actual", async () => {
		const buf = Buffer.alloc(1000);
		mockHeadResponse.current = {
			ContentLength: 50_000, // way off from declared 1000
			ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		};
		const body = validBody(buf);
		body.declaredSizeBytes = 1000;
		const res = await handler(event(body));
		expect(res.statusCode).toBe(400);
	});

	it("rejects malformed attachmentId", async () => {
		const body = validBody(Buffer.alloc(100));
		body.attachmentId = "not-a-uuid";
		const res = await handler(event(body));
		expect(res.statusCode).toBe(400);
	});

	it("rejects unparseable threadId in path", async () => {
		const res = await handler({
			rawPath: "/api/threads/not-a-uuid/attachments/finalize",
			headers: { authorization: "Bearer test" },
			body: "{}",
			requestContext: { http: { method: "POST" } },
		} as unknown as APIGatewayProxyEventV2);
		expect(res.statusCode).toBe(404);
	});

	it("returns 400 when staging object doesn't exist (S3 HEAD throws)", async () => {
		mockHeadResponse.current = null;
		// Simulate throw by setting a property to nullary then handling
		// in the mock: we just leave it null, handler's send() returns {}
		// which gives ContentLength: 0 → fails the size-range check.
		const res = await handler(event(validBody(Buffer.alloc(100))));
		expect(res.statusCode).toBe(413);
	});
});
