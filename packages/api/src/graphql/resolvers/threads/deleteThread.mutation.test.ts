import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	db,
	tables,
	requireTenantMember,
	operations,
	setInitialThreadRows,
	setThreadMessageRows,
	eq,
	and,
	or,
	inArray,
} = vi.hoisted(() => {
	const operations: Array<{
		type: "delete" | "update";
		table: string;
		values?: Record<string, unknown>;
	}> = [];
	let initialThreadRows: Array<{ id: string; tenant_id: string }> = [];
	let threadMessageRows: Array<{ id: string }> = [];

	const tables = {
		artifacts: {
			name: "artifacts",
			thread_id: "artifacts.thread_id",
			source_message_id: "artifacts.source_message_id",
		},
		documents: { name: "documents", thread_id: "documents.thread_id" },
		messageArtifacts: {
			name: "message_artifacts",
			thread_id: "message_artifacts.thread_id",
			message_id: "message_artifacts.message_id",
		},
		messages: {
			name: "messages",
			id: "messages.id",
			thread_id: "messages.thread_id",
		},
		recipes: { name: "recipes", thread_id: "recipes.thread_id" },
		retryQueue: { name: "retry_queue", thread_id: "retry_queue.thread_id" },
		threadAttachments: {
			name: "thread_attachments",
			thread_id: "thread_attachments.thread_id",
		},
		threads: {
			name: "threads",
			id: "threads.id",
			tenant_id: "threads.tenant_id",
		},
	};

	const tableName = (table: { name?: string }) => table.name ?? "unknown";
	const eq = vi.fn((field: unknown, value: unknown) => ({ op: "eq", field, value }));
	const and = vi.fn((...conditions: unknown[]) => ({ op: "and", conditions }));
	const or = vi.fn((...conditions: unknown[]) => ({ op: "or", conditions }));
	const inArray = vi.fn((field: unknown, values: unknown[]) => ({
		op: "inArray",
		field,
		values,
	}));
	const requireTenantMember = vi.fn();

	function makeSelect(rowsForThreadLookup: boolean) {
		return {
			from: (table: { name?: string }) => ({
				where: vi.fn(async () => {
					if (rowsForThreadLookup && table === tables.threads) {
						return initialThreadRows;
					}
					if (!rowsForThreadLookup && table === tables.messages) {
						return threadMessageRows;
					}
					return [];
				}),
			}),
		};
	}

	function makeDelete(table: { name?: string }) {
		return {
			where: vi.fn(() => {
				operations.push({ type: "delete", table: tableName(table) });
				return {
					returning: vi.fn(async () =>
						table === tables.threads ? [{ id: "thread-1" }] : [],
					),
				};
			}),
		};
	}

	function makeUpdate(table: { name?: string }) {
		return {
			set: (values: Record<string, unknown>) => ({
				where: vi.fn(() => {
					operations.push({ type: "update", table: tableName(table), values });
				}),
			}),
		};
	}

	const tx = {
		select: vi.fn(() => makeSelect(false)),
		delete: vi.fn(makeDelete),
		update: vi.fn(makeUpdate),
	};

	const db = {
		select: vi.fn(() => makeSelect(true)),
		transaction: vi.fn(async (callback: (mockTx: typeof tx) => Promise<boolean>) =>
			callback(tx),
		),
	};

	return {
		db,
		tables,
		requireTenantMember,
		operations,
		setInitialThreadRows: (rows: Array<{ id: string; tenant_id: string }>) => {
			initialThreadRows = rows;
		},
		setThreadMessageRows: (rows: Array<{ id: string }>) => {
			threadMessageRows = rows;
		},
		eq,
		and,
		or,
		inArray,
	};
});

vi.mock("../../utils.js", () => ({
	db,
	eq,
	and,
	or,
	inArray,
	artifacts: tables.artifacts,
	messages: tables.messages,
	messageArtifacts: tables.messageArtifacts,
	threadAttachments: tables.threadAttachments,
	threads: tables.threads,
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
	documents: tables.documents,
	recipes: tables.recipes,
	retryQueue: tables.retryQueue,
}));

vi.mock("../core/authz.js", () => ({
	requireTenantMember,
}));

import { deleteThread } from "./deleteThread.mutation.js";

describe("deleteThread", () => {
	beforeEach(() => {
		operations.length = 0;
		vi.clearAllMocks();
		setInitialThreadRows([{ id: "thread-1", tenant_id: "tenant-1" }]);
		setThreadMessageRows([{ id: "message-1" }, { id: "message-2" }]);
	});

	it("detaches and deletes dependent rows before deleting the thread", async () => {
		const result = await deleteThread(
			null,
			{ id: "thread-1" },
			{ auth: { authType: "cognito" } } as any,
		);

		expect(result).toBe(true);
		expect(requireTenantMember).toHaveBeenCalledWith(
			{ auth: { authType: "cognito" } },
			"tenant-1",
		);
		expect(operations.map((op) => `${op.type}:${op.table}`)).toEqual([
			"delete:message_artifacts",
			"update:artifacts",
			"update:artifacts",
			"update:documents",
			"update:recipes",
			"update:retry_queue",
			"delete:thread_attachments",
			"delete:messages",
			"delete:threads",
		]);
		expect(operations.find((op) => op.table === "documents")?.values).toEqual({
			thread_id: null,
		});
	});

	it("returns false without mutating when the thread does not exist", async () => {
		setInitialThreadRows([]);

		const result = await deleteThread(
			null,
			{ id: "missing-thread" },
			{ auth: { authType: "cognito" } } as any,
		);

		expect(result).toBe(false);
		expect(requireTenantMember).not.toHaveBeenCalled();
		expect(db.transaction).not.toHaveBeenCalled();
	});

	it("allows apikey callers without tenant membership lookup", async () => {
		await deleteThread(
			null,
			{ id: "thread-1" },
			{ auth: { authType: "apikey" } } as any,
		);

		expect(requireTenantMember).not.toHaveBeenCalled();
	});
});
