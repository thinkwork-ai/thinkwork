/**
 * Unit coverage for the threadsPaged resolver's filter assembly.
 *
 * Particularly the `computerId` filter added by plan 2026-05-13-005 U1 —
 * verify it appears in the WHERE conditions array when provided and is
 * absent when omitted, without leaking tenant scoping when set.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { capturedConditions, mockDb, mockEq, mockAnd, mockSql, threadsTable } =
	vi.hoisted(() => {
		const captured: unknown[][] = [];

		const eq = vi.fn((field: unknown, value: unknown) => ({
			__eq: { field, value },
		}));
		const and = vi.fn((...conditions: unknown[]) => {
			captured.push(conditions);
			return { __and: conditions };
		});
		const sql = Object.assign(
			(_strings: TemplateStringsArray, ..._values: unknown[]) => ({
				__sql: true,
			}),
			{},
		);
		const asc = vi.fn();
		const desc = vi.fn();

		const tableCol = (label: string) => ({ __col: label });
		const threads = {
			tenant_id: tableCol("threads.tenant_id"),
			computer_id: tableCol("threads.computer_id"),
			status: tableCol("threads.status"),
			title: tableCol("threads.title"),
			created_at: tableCol("threads.created_at"),
			updated_at: tableCol("threads.updated_at"),
			archived_at: tableCol("threads.archived_at"),
		};

		// db.select().from(threads).where(...).orderBy(...).limit(...).offset(...)
		// db.select({count}).from(threads).where(...)
		// Both branches resolve to []; the resolver just returns empty rows.
		const chainTerminal = () =>
			Object.assign(Promise.resolve([]), {
				limit: vi.fn().mockReturnThis(),
				offset: vi.fn(() => Promise.resolve([])),
			});
		const db = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						orderBy: vi.fn(() => chainTerminal()),
						// count query path
						then: (
							res: (v: unknown[]) => unknown,
							rej: (e: unknown) => unknown,
						) => Promise.resolve([{ count: 0 }]).then(res, rej),
					})),
				})),
			})),
		};

		return {
			capturedConditions: captured,
			mockDb: db,
			mockEq: eq,
			mockAnd: and,
			mockSql: sql,
			mockAsc: asc,
			mockDesc: desc,
			threadsTable: threads,
		};
	});

vi.mock("../../utils.js", () => ({
	db: mockDb,
	eq: mockEq,
	and: mockAnd,
	desc: vi.fn(),
	asc: vi.fn(),
	sql: mockSql,
	threads: threadsTable,
	threadToCamel: (row: unknown) => row,
}));

import { threadsPaged_query } from "./threadsPaged.query.js";

const TENANT = "tenant-a";
const COMPUTER = "computer-marco";

beforeEach(() => {
	capturedConditions.length = 0;
});

describe("threadsPaged filter assembly", () => {
	it("adds tenant_id condition without computer_id when computerId is omitted", async () => {
		await threadsPaged_query({}, { tenantId: TENANT }, {} as any);
		const allConditions = capturedConditions.flat();
		const hasTenant = allConditions.some(
			(c: any) =>
				c?.__eq?.field === threadsTable.tenant_id && c?.__eq?.value === TENANT,
		);
		const hasComputer = allConditions.some(
			(c: any) => c?.__eq?.field === threadsTable.computer_id,
		);
		expect(hasTenant).toBe(true);
		expect(hasComputer).toBe(false);
	});

	it("adds both tenant_id and computer_id conditions when computerId is set", async () => {
		await threadsPaged_query(
			{},
			{ tenantId: TENANT, computerId: COMPUTER },
			{} as any,
		);
		const allConditions = capturedConditions.flat();
		const hasTenant = allConditions.some(
			(c: any) =>
				c?.__eq?.field === threadsTable.tenant_id && c?.__eq?.value === TENANT,
		);
		const hasComputer = allConditions.some(
			(c: any) =>
				c?.__eq?.field === threadsTable.computer_id &&
				c?.__eq?.value === COMPUTER,
		);
		expect(hasTenant).toBe(true);
		expect(hasComputer).toBe(true);
	});

	it("does not add computer_id when computerId is an empty string", async () => {
		await threadsPaged_query(
			{},
			{ tenantId: TENANT, computerId: "" },
			{} as any,
		);
		const allConditions = capturedConditions.flat();
		const hasComputer = allConditions.some(
			(c: any) => c?.__eq?.field === threadsTable.computer_id,
		);
		expect(hasComputer).toBe(false);
	});
});
