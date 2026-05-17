import { describe, expect, it, vi } from "vitest";
import { materializeSlackFilesAsThreadAttachments } from "./file-attachments.js";

describe("materializeSlackFilesAsThreadAttachments", () => {
	it("downloads Slack files, stores them as thread attachments, and links message metadata", async () => {
		const insertedRows: unknown[] = [];
		let updatedMetadata: unknown;
		const tx: any = {
			insert: () => ({
				values: vi.fn(async (rows: unknown[]) => {
					insertedRows.push(...rows);
				}),
			}),
			select: () => ({
				from: () => ({
					where: () => ({
						limit: vi.fn(async () => [
							{
								metadata: {
									source: "slack",
									slack: { fileRefs: [{ id: "F123" }] },
								},
							},
						]),
					}),
				}),
			}),
			update: () => ({
				set: (row: { metadata: unknown }) => {
					updatedMetadata = row.metadata;
					return { where: vi.fn(async () => undefined) };
				},
			}),
		};
		const dbClient: any = {
			transaction: vi.fn(async (cb: (tx: any) => unknown) => cb(tx)),
		};
		const s3Client = { send: vi.fn(async () => ({})) };
		const emitAudit = vi.fn(async () => ({
			eventId: "audit-1",
			outboxId: "outbox-1",
			redactedFields: [],
		}));

		const result = await materializeSlackFilesAsThreadAttachments(
			{
				tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
				threadId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
				messageId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
				uploadedBy: "dddddddd-dddd-dddd-dddd-dddddddddddd",
				botToken: "xoxb-token",
				fileRefs: [
					{
						id: "F123",
						name: "agentic-etl-architecture-v5.md",
						mimetype: "text/markdown",
						urlPrivate: "https://files.slack.com/F123",
						urlPrivateDownload: null,
						permalink: null,
						sizeBytes: 24,
					},
				],
			},
			{
				bucket: "workspace-bucket",
				dbClient,
				s3Client: s3Client as any,
				createAttachmentId: () => "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
				fetchFile: vi.fn(async () => ({
					buffer: Buffer.from("# Architecture\n\nShip it.\n", "utf-8"),
					contentType: "text/markdown",
					sizeBytes: 24,
				})),
				emitAudit: emitAudit as any,
			},
		);

		expect(result).toEqual([
			expect.objectContaining({
				attachmentId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
				name: "agentic-etl-architecture-v5.md",
				mimeType: "text/markdown",
			}),
		]);
		expect(s3Client.send).toHaveBeenCalledTimes(1);
		expect(insertedRows).toEqual([
			expect.objectContaining({
				id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
				name: "agentic-etl-architecture-v5.md",
				s3_key:
					"tenants/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/attachments/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee/agentic-etl-architecture-v5.md",
			}),
		]);
		expect(updatedMetadata).toMatchObject({
			source: "slack",
			attachments: [{ attachmentId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" }],
		});
		expect(emitAudit).toHaveBeenCalledWith(
			tx,
			expect.objectContaining({
				eventType: "attachment.received",
				payload: expect.objectContaining({ source: "slack" }),
			}),
		);
	});
});
