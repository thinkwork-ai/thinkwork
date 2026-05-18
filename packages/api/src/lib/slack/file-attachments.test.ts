import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
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

	it("materializes PDF Slack files instead of dropping them as unsupported", async () => {
		const insertedRows: unknown[] = [];
		const tx: any = {
			insert: () => ({
				values: vi.fn(async (rows: unknown[]) => {
					insertedRows.push(...rows);
				}),
			}),
			select: () => ({
				from: () => ({
					where: () => ({
						limit: vi.fn(async () => [{ metadata: {} }]),
					}),
				}),
			}),
			update: () => ({
				set: () => ({ where: vi.fn(async () => undefined) }),
			}),
		};
		const dbClient: any = {
			transaction: vi.fn(async (cb: (tx: any) => unknown) => cb(tx)),
		};
		const s3Client = { send: vi.fn(async () => ({})) };

		const result = await materializeSlackFilesAsThreadAttachments(
			{
				tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
				threadId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
				messageId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
				uploadedBy: "dddddddd-dddd-dddd-dddd-dddddddddddd",
				botToken: "xoxb-token",
				fileRefs: [
					{
						id: "F-PDF",
						name: "board-statement.pdf",
						mimetype: "application/pdf",
						urlPrivate: "https://files.slack.com/F-PDF",
						urlPrivateDownload: null,
						permalink: null,
						sizeBytes: 16,
					},
				],
			},
			{
				bucket: "workspace-bucket",
				dbClient,
				s3Client: s3Client as any,
				createAttachmentId: () => "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
				fetchFile: vi.fn(async () => ({
					buffer: Buffer.from("%PDF-1.4\n"),
					contentType: "application/pdf",
					sizeBytes: 9,
				})),
				emitAudit: vi.fn(async () => ({
					eventId: "audit-1",
					outboxId: "outbox-1",
					redactedFields: [],
				})) as any,
			},
		);

		expect(result).toEqual([
			expect.objectContaining({
				name: "board-statement.pdf",
				mimeType: "application/pdf",
			}),
		]);
		expect(insertedRows).toEqual([
			expect.objectContaining({
				name: "board-statement.pdf",
				s3_key:
					"tenants/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/attachments/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee/board-statement.pdf",
			}),
		]);
		expect(s3Client.send).toHaveBeenCalledTimes(1);
	});

	it("materializes xlsx Slack files so downstream attachment extraction can read them", async () => {
		const insertedRows: unknown[] = [];
		const tx: any = {
			insert: () => ({
				values: vi.fn(async (rows: unknown[]) => {
					insertedRows.push(...rows);
				}),
			}),
			select: () => ({
				from: () => ({
					where: () => ({
						limit: vi.fn(async () => [{ metadata: {} }]),
					}),
				}),
			}),
			update: () => ({
				set: () => ({ where: vi.fn(async () => undefined) }),
			}),
		};
		const dbClient: any = {
			transaction: vi.fn(async (cb: (tx: any) => unknown) => cb(tx)),
		};
		const s3Client = { send: vi.fn(async () => ({})) };
		const workbook = await buildXlsxBuffer();

		const result = await materializeSlackFilesAsThreadAttachments(
			{
				tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
				threadId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
				messageId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
				uploadedBy: "dddddddd-dddd-dddd-dddd-dddddddddddd",
				botToken: "xoxb-token",
				fileRefs: [
					{
						id: "F-XLSX",
						name: "financials.xlsx",
						mimetype:
							"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
						urlPrivate: "https://files.slack.com/F-XLSX",
						urlPrivateDownload: "https://files.slack.com/F-XLSX/download",
						permalink: null,
						sizeBytes: workbook.length,
					},
				],
			},
			{
				bucket: "workspace-bucket",
				dbClient,
				s3Client: s3Client as any,
				createAttachmentId: () => "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
				fetchFile: vi.fn(async () => ({
					buffer: workbook,
					contentType:
						"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
					sizeBytes: workbook.length,
				})),
				emitAudit: vi.fn(async () => ({
					eventId: "audit-1",
					outboxId: "outbox-1",
					redactedFields: [],
				})) as any,
			},
		);

		expect(result).toEqual([
			expect.objectContaining({
				name: "financials.xlsx",
				mimeType:
					"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			}),
		]);
		expect(insertedRows).toEqual([
			expect.objectContaining({
				name: "financials.xlsx",
				mime_type:
					"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			}),
		]);
		expect(s3Client.send).toHaveBeenCalledTimes(1);
	});
});

async function buildXlsxBuffer(): Promise<Buffer> {
	const zip = new JSZip();
	zip.file(
		"[Content_Types].xml",
		`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
	);
	zip.file(
		"xl/workbook.xml",
		`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Financials" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
	);
	zip.file(
		"xl/_rels/workbook.xml.rels",
		`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
	);
	zip.file(
		"xl/worksheets/sheet1.xml",
		`<?xml version="1.0" encoding="UTF-8"?>
<worksheet><sheetData><row r="1"><c r="A1"><v>42</v></c></row></sheetData></worksheet>`,
	);
	return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}
