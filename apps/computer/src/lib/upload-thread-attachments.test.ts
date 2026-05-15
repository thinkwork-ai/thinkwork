import { describe, expect, it, vi } from "vitest";
import { uploadThreadAttachments } from "./upload-thread-attachments";

const THREAD_ID = "11111111-1111-1111-1111-111111111111";
const API_URL = "https://api.example.com";

function file(name: string, body = "x", type = "text/csv"): File {
	return new File([body], name, { type });
}

function presignBody(attachmentId: string, name: string) {
	return {
		signedPutUrl: `${API_URL}/s3/${attachmentId}`,
		stagingKey: `tenants/t/attachments/th/${attachmentId}/${name}`,
		attachmentId,
		name,
		expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
	};
}

function finalizeBody(
	attachmentId: string,
	name: string,
	mimeType: string,
	sizeBytes: number,
) {
	return { attachmentId, name, mimeType, sizeBytes };
}

describe("uploadThreadAttachments", () => {
	it("returns empty uploaded + failures for empty input", async () => {
		const fetchImpl = vi.fn();
		const r = await uploadThreadAttachments({
			endpoints: { apiUrl: API_URL, token: "tok" },
			threadId: THREAD_ID,
			files: [],
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(r.uploaded).toEqual([]);
		expect(r.failures).toEqual([]);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("happy path: presign → PUT → finalize for a single file", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify(presignBody("att-1", "data.csv")), {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(new Response(null, { status: 200 }))
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify(finalizeBody("att-1", "data.csv", "text/csv", 1)),
					{ status: 200 },
				),
			);
		const r = await uploadThreadAttachments({
			endpoints: { apiUrl: API_URL, token: "tok" },
			threadId: THREAD_ID,
			files: [file("data.csv")],
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(r.failures).toEqual([]);
		expect(r.uploaded).toHaveLength(1);
		expect(r.uploaded[0]!.attachmentId).toBe("att-1");
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		// Presign hits the right path with the right auth + body.
		const [presignUrl, presignInit] = fetchImpl.mock.calls[0]!;
		expect(presignUrl).toBe(
			`${API_URL}/api/threads/${THREAD_ID}/attachments/presign`,
		);
		expect(
			(presignInit as RequestInit).headers as Record<string, string>,
		).toMatchObject({
			authorization: "Bearer tok",
		});
		const body = JSON.parse((presignInit as RequestInit).body as string);
		expect(body).toMatchObject({
			name: "data.csv",
			mimeType: "text/csv",
			sizeBytes: 1,
		});
	});

	it("captures presign failure without trying PUT/finalize", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response("forbidden", { status: 403 }),
			);
		const r = await uploadThreadAttachments({
			endpoints: { apiUrl: API_URL, token: "tok" },
			threadId: THREAD_ID,
			files: [file("data.csv")],
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(r.uploaded).toHaveLength(0);
		expect(r.failures).toHaveLength(1);
		expect(r.failures[0]!.stage).toBe("presign");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("captures S3 PUT failure separately from finalize", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify(presignBody("att-1", "data.csv")), {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(new Response("expired", { status: 403 }));
		const r = await uploadThreadAttachments({
			endpoints: { apiUrl: API_URL, token: "tok" },
			threadId: THREAD_ID,
			files: [file("data.csv")],
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(r.uploaded).toHaveLength(0);
		expect(r.failures[0]!.stage).toBe("put");
	});

	it("captures finalize failure", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify(presignBody("att-1", "data.csv")), {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(new Response(null, { status: 200 }))
			.mockResolvedValueOnce(
				new Response("macro_enabled", { status: 415 }),
			);
		const r = await uploadThreadAttachments({
			endpoints: { apiUrl: API_URL, token: "tok" },
			threadId: THREAD_ID,
			files: [file("data.csv")],
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(r.uploaded).toHaveLength(0);
		expect(r.failures[0]!.stage).toBe("finalize");
		expect(r.failures[0]!.message).toContain("415");
	});

	it("partial success: one file uploads, another fails", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			// File 1: presign + PUT + finalize succeed
			.mockResolvedValueOnce(
				new Response(JSON.stringify(presignBody("att-1", "ok.csv")), {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(new Response(null, { status: 200 }))
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify(finalizeBody("att-1", "ok.csv", "text/csv", 1)),
					{ status: 200 },
				),
			)
			// File 2: presign fails (e.g., disallowed MIME)
			.mockResolvedValueOnce(
				new Response("415 unsupported", { status: 415 }),
			);
		const r = await uploadThreadAttachments({
			endpoints: { apiUrl: API_URL, token: "tok" },
			threadId: THREAD_ID,
			files: [file("ok.csv"), file("bad.exe", "x", "application/x-exec")],
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(r.uploaded).toHaveLength(1);
		expect(r.uploaded[0]!.attachmentId).toBe("att-1");
		expect(r.failures).toHaveLength(1);
		expect(r.failures[0]!.stage).toBe("presign");
	});
});
