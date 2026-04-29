import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbQueue, pushDbRows, resetDbQueue } = vi.hoisted(() => {
	const queue: unknown[][] = [];
	return {
		dbQueue: queue,
		pushDbRows: (rows: unknown[]) => queue.push(rows),
		resetDbQueue: () => {
			queue.length = 0;
		},
	};
});

vi.mock("../../../graphql/utils.js", () => {
	const tableCol = (label: string) => ({ __col: label });
	const chain = () => ({
		from: vi.fn().mockImplementation(() => ({
			where: vi.fn().mockImplementation(() => {
				const fn: any = () => Promise.resolve(dbQueue.shift() ?? []);
				fn.then = (
					onFulfilled: (value: unknown[]) => unknown,
					onRejected: (error: unknown) => unknown,
				) => Promise.resolve(dbQueue.shift() ?? []).then(onFulfilled, onRejected);
				return fn;
			}),
		})),
	});

	return {
		db: { select: vi.fn().mockImplementation(() => chain()) },
		agentTemplates: {
			id: tableCol("agent_templates.id"),
			slug: tableCol("agent_templates.slug"),
			tenant_id: tableCol("agent_templates.tenant_id"),
		},
		agents: {
			id: tableCol("agents.id"),
			slug: tableCol("agents.slug"),
			tenant_id: tableCol("agents.tenant_id"),
		},
		tenants: {
			id: tableCol("tenants.id"),
			slug: tableCol("tenants.slug"),
		},
	};
});

const s3Mock = mockClient(S3Client);

import { createWorkspaceFilesContextProvider } from "./workspace-files.js";

function s3Body(content: string) {
	return {
		Body: {
			transformToString: async () => content,
		},
	} as any;
}

describe("Workspace Files context provider", () => {
	beforeEach(() => {
		resetDbQueue();
		s3Mock.reset();
		process.env.WORKSPACE_BUCKET = "test-bucket";
	});

	it("searches the selected agent workspace and matches query terms in any order", async () => {
		pushDbRows([{ slug: "acme" }]);
		pushDbRows([{ slug: "fleet-caterpillar-456", tenantId: "tenant-1" }]);

		const prefix = "tenants/acme/agents/fleet-caterpillar-456/workspace/";
		s3Mock.on(ListObjectsV2Command, { Bucket: "test-bucket", Prefix: prefix }).resolves({
			Contents: [
				{ Key: `${prefix}USER.md`, Size: 128 },
				{ Key: `${prefix}manifest.json`, Size: 32 },
			],
		});
		s3Mock.on(GetObjectCommand, { Bucket: "test-bucket", Key: `${prefix}USER.md` }).resolves(
			s3Body("- Notes: Favorite restaurant in Paris is Chez Amil Louise"),
		);

		const result = await createWorkspaceFilesContextProvider().query({
			query: "favorite paris restaurant",
			mode: "results",
			scope: "auto",
			depth: "quick",
			limit: 5,
			caller: { tenantId: "tenant-1", agentId: "agent-1" },
		});

		expect(result.hits).toHaveLength(1);
		expect(result.hits[0]).toMatchObject({
			title: "USER.md",
			snippet: expect.stringContaining("Favorite restaurant in Paris"),
			provenance: {
				label: "agent workspace fleet-caterpillar-456",
				sourceId: `${prefix}USER.md`,
			},
		});
		expect(result.status?.reason).toBe(
			"searched 1/2 files in agent workspace fleet-caterpillar-456",
		);
	});
});
