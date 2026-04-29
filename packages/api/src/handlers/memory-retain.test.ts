import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.hoisted(() => vi.fn());

vi.mock("@thinkwork/database-pg", () => ({
	getDb: () => ({
		select: selectMock,
	}),
}));

const retainConversationMock = vi.hoisted(() => vi.fn());
const retainTurnMock = vi.hoisted(() => vi.fn());
const retainDailyMemoryMock = vi.hoisted(() => vi.fn());
const getMemoryServicesMock = vi.hoisted(() => vi.fn());
const maybeEnqueueMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/memory/index.js", () => ({
	getMemoryServices: getMemoryServicesMock,
}));

vi.mock("../lib/wiki/enqueue.js", () => ({
	maybeEnqueuePostTurnCompile: maybeEnqueueMock,
}));

import { handler, mergeTranscriptSuffix } from "./memory-retain.js";

const TENANT_A = "0015953e-aa13-4cab-8398-2e70f73dda63";
const TENANT_B = "11119999-aaaa-bbbb-cccc-222233334444";
const USER_ID = "4dee701a-c17b-46fe-9f38-a333d4c3fad0";
const THREAD_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function dbRow(role: string, content: string, ts: string, tenantId = TENANT_A) {
	return {
		role,
		content,
		created_at: new Date(ts),
		tenant_id: tenantId,
	};
}

function buildSelectChain(rows: ReturnType<typeof dbRow>[]) {
	// Drizzle chain: db.select({...}).from(...).where(...).orderBy(...)
	const orderBy = vi.fn().mockResolvedValue(rows);
	const where = vi.fn().mockReturnValue({ orderBy });
	const from = vi.fn().mockReturnValue({ where });
	selectMock.mockReturnValue({ from });
	return { from, where, orderBy };
}

function buildRetainConversationServices() {
	getMemoryServicesMock.mockReturnValue({
		adapter: {
			kind: "hindsight",
			retainConversation: retainConversationMock,
			retainTurn: retainTurnMock,
			retainDailyMemory: retainDailyMemoryMock,
		},
		config: { engine: "hindsight" },
	});
}

describe("mergeTranscriptSuffix", () => {
	const u = (content: string) => ({
		role: "user" as const,
		content,
		timestamp: "2026-04-28T00:00:00.000Z",
	});
	const a = (content: string) => ({
		role: "assistant" as const,
		content,
		timestamp: "2026-04-28T00:00:00.000Z",
	});

	it("appends event tail when there is no overlap (k=0)", () => {
		const merged = mergeTranscriptSuffix([], [u("hi"), a("hello")]);
		expect(merged).toHaveLength(2);
	});

	it("returns DB rows when event is empty", () => {
		const db = [u("a"), a("b")];
		const merged = mergeTranscriptSuffix(db, []);
		expect(merged).toEqual(db);
	});

	it("dedupes when event repeats the DB tail (k=event.length)", () => {
		const db = [u("hi"), a("hello"), u("ok"), a("done")];
		const event = [u("ok"), a("done")];
		const merged = mergeTranscriptSuffix(db, event);
		expect(merged).toHaveLength(4);
	});

	it("handles full-history overlap: event carries history+pair (k=db.length)", () => {
		// 30-row DB; event repeats all 30 + adds one new pair
		const db = Array.from({ length: 30 }, (_, i) =>
			i % 2 === 0 ? u(`u${i}`) : a(`a${i}`),
		);
		const eventHistory = [...db];
		const eventTail = [u("new-user"), a("new-assistant")];
		const merged = mergeTranscriptSuffix(db, [...eventHistory, ...eventTail]);
		expect(merged).toHaveLength(32);
		expect(merged[30].content).toBe("new-user");
		expect(merged[31].content).toBe("new-assistant");
	});

	it("handles partial overlap: event has last 5 DB messages + 2 new (k=5)", () => {
		const db = Array.from({ length: 30 }, (_, i) =>
			i % 2 === 0 ? u(`u${i}`) : a(`a${i}`),
		);
		const overlap = db.slice(-5);
		const event = [...overlap, u("new-user"), a("new-assistant")];
		const merged = mergeTranscriptSuffix(db, event);
		expect(merged).toHaveLength(32);
		expect(merged[30].content).toBe("new-user");
	});

	it("merge race: DB has 30 messages, event has just the latest pair", () => {
		const db = Array.from({ length: 30 }, (_, i) =>
			i % 2 === 0 ? u(`u${i}`) : a(`a${i}`),
		);
		const event = [u("turn-16-user"), a("turn-16-assistant")];
		const merged = mergeTranscriptSuffix(db, event);
		expect(merged).toHaveLength(32);
	});

	it("ignores timestamps when matching (timestamp skew regression)", () => {
		const db = [u("hi"), a("hello")];
		const eventCopy = [
			{ ...db[0], timestamp: "2026-04-28T00:00:01.050Z" }, // 50ms drift
			{ ...db[1], timestamp: "2026-04-28T00:00:02.200Z" },
		];
		const merged = mergeTranscriptSuffix(db, eventCopy);
		expect(merged).toEqual(db); // event entries collapsed via suffix match
	});

	it("preserves legitimate user repetition earlier in thread", () => {
		// user types 'ok' three times, with assistant responses between
		const db = [
			u("ok"),
			a("first response"),
			u("ok"),
			a("second response"),
			u("ok"),
			a("third response"),
		];
		const event = [u("ok"), a("third response")];
		const merged = mergeTranscriptSuffix(db, event);
		// suffix match: event matches the LAST (ok, third response) pair only;
		// earlier 'ok' entries are preserved
		expect(merged).toHaveLength(6);
		expect(merged.filter((m) => m.role === "user" && m.content === "ok")).toHaveLength(3);
	});

	it("100+ message merge has no silent capping", () => {
		const db = Array.from({ length: 120 }, (_, i) =>
			i % 2 === 0 ? u(`u${i}`) : a(`a${i}`),
		);
		const event = [u("new"), a("response")];
		const merged = mergeTranscriptSuffix(db, event);
		expect(merged).toHaveLength(122);
	});
});

describe("memory-retain handler", () => {
	beforeEach(() => {
		selectMock.mockReset();
		retainConversationMock.mockReset();
		retainTurnMock.mockReset();
		retainDailyMemoryMock.mockReset();
		getMemoryServicesMock.mockReset();
		maybeEnqueueMock.mockReset();
		maybeEnqueueMock.mockResolvedValue({ status: "skipped" });
	});

	it("rejects events without a tenantId", async () => {
		const result = await handler({ threadId: THREAD_ID });
		expect(result).toEqual({ ok: false, error: "MISSING_USER_CONTEXT" });
		expect(selectMock).not.toHaveBeenCalled();
	});

	it("returns MISSING_DOCUMENT_ID when threadId is absent for non-daily payloads", async () => {
		buildRetainConversationServices();
		const result = await handler({
			tenantId: TENANT_A,
			userId: USER_ID,
			transcript: [{ role: "user", content: "hi" }],
		});
		expect(result).toEqual({ ok: false, error: "MISSING_DOCUMENT_ID" });
	});

	it("happy path: 32 DB rows + matching event tail → adapter receives 32 messages", async () => {
		buildRetainConversationServices();
		const dbRows = Array.from({ length: 32 }, (_, i) =>
			dbRow(
				i % 2 === 0 ? "user" : "assistant",
				`msg-${i}`,
				new Date(Date.UTC(2026, 3, 28, 0, 0, i)).toISOString(),
			),
		);
		buildSelectChain(dbRows);

		const result = await handler({
			tenantId: TENANT_A,
			userId: USER_ID,
			threadId: THREAD_ID,
			transcript: [{ role: "user", content: "msg-30" }, { role: "assistant", content: "msg-31" }],
		});

		expect(result.ok).toBe(true);
		expect(retainConversationMock).toHaveBeenCalledTimes(1);
		const call = retainConversationMock.mock.calls[0][0];
		expect(call.threadId).toBe(THREAD_ID);
		expect(call.messages).toHaveLength(32);
		expect(call.tenantId).toBe(TENANT_A);
		expect(call.ownerId).toBe(USER_ID);
	});

	it("merge race: DB has 30 msgs, event has new pair → merged is 32", async () => {
		buildRetainConversationServices();
		const dbRows = Array.from({ length: 30 }, (_, i) =>
			dbRow(
				i % 2 === 0 ? "user" : "assistant",
				`msg-${i}`,
				new Date(Date.UTC(2026, 3, 28, 0, 0, i)).toISOString(),
			),
		);
		buildSelectChain(dbRows);

		await handler({
			tenantId: TENANT_A,
			userId: USER_ID,
			threadId: THREAD_ID,
			transcript: [
				{ role: "user", content: "new-user" },
				{ role: "assistant", content: "new-assistant" },
			],
		});

		expect(retainConversationMock.mock.calls[0][0].messages).toHaveLength(32);
	});

	it("dedup: DB includes the latest pair, event repeats it → merged stays 32", async () => {
		buildRetainConversationServices();
		const dbRows = Array.from({ length: 32 }, (_, i) =>
			dbRow(
				i % 2 === 0 ? "user" : "assistant",
				`msg-${i}`,
				new Date(Date.UTC(2026, 3, 28, 0, 0, i)).toISOString(),
			),
		);
		buildSelectChain(dbRows);

		await handler({
			tenantId: TENANT_A,
			userId: USER_ID,
			threadId: THREAD_ID,
			transcript: [
				{ role: "user", content: "msg-30", timestamp: "2026-04-28T01:00:00.000Z" }, // diff ts
				{ role: "assistant", content: "msg-31", timestamp: "2026-04-28T01:00:01.000Z" },
			],
		});

		expect(retainConversationMock.mock.calls[0][0].messages).toHaveLength(32);
	});

	it("new thread: 0 DB rows + non-empty event → adapter gets event tail", async () => {
		buildRetainConversationServices();
		buildSelectChain([]);

		await handler({
			tenantId: TENANT_A,
			userId: USER_ID,
			threadId: THREAD_ID,
			transcript: [
				{ role: "user", content: "first message" },
				{ role: "assistant", content: "first reply" },
			],
		});

		expect(retainConversationMock.mock.calls[0][0].messages).toHaveLength(2);
	});

	it("tenant-scope rejection: forged threadId returns zero rows, falls through to event", async () => {
		buildRetainConversationServices();
		// Event claims tenant A but threadId belongs to tenant B; the WHERE
		// filter excludes B's rows so DB returns empty.
		buildSelectChain([]);

		await handler({
			tenantId: TENANT_A,
			userId: USER_ID,
			threadId: THREAD_ID,
			transcript: [{ role: "user", content: "forged" }],
		});

		expect(retainConversationMock.mock.calls[0][0].messages).toHaveLength(1);
		expect(retainConversationMock.mock.calls[0][0].tenantId).toBe(TENANT_A);
	});

	it("tenant anomaly defense-in-depth: mismatched tenant_id rows trigger error log + fallback", async () => {
		buildRetainConversationServices();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		// Row passes the WHERE filter conceptually but its in-memory tenant_id
		// disagrees — defensive guard.
		buildSelectChain([dbRow("user", "leaked", "2026-04-28T00:00:00.000Z", TENANT_B)]);

		await handler({
			tenantId: TENANT_A,
			userId: USER_ID,
			threadId: THREAD_ID,
			transcript: [{ role: "user", content: "expected" }],
		});

		expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/tenant_anomaly/));
		// Falls through to event-only transcript; never propagates the error.
		expect(retainConversationMock.mock.calls[0][0].messages).toEqual([
			expect.objectContaining({ content: "expected" }),
		]);

		errorSpy.mockRestore();
		warnSpy.mockRestore();
	});

	it("daily routing: kind=daily bypasses fetch and calls retainDailyMemory", async () => {
		buildRetainConversationServices();

		const result = await handler({
			tenantId: TENANT_A,
			userId: USER_ID,
			kind: "daily",
			date: "2026-04-27",
			content: "- learning bullet",
		});

		expect(result.ok).toBe(true);
		expect(retainDailyMemoryMock).toHaveBeenCalledTimes(1);
		expect(selectMock).not.toHaveBeenCalled();
		expect(retainConversationMock).not.toHaveBeenCalled();
	});

	it("agentcore engine fallback: adapter without retainConversation falls back to retainTurn", async () => {
		getMemoryServicesMock.mockReturnValue({
			adapter: {
				kind: "agentcore",
				retainTurn: retainTurnMock,
			},
			config: { engine: "agentcore" },
		});

		await handler({
			tenantId: TENANT_A,
			userId: USER_ID,
			threadId: THREAD_ID,
			transcript: [{ role: "user", content: "hi" }],
		});

		expect(retainTurnMock).toHaveBeenCalledTimes(1);
		expect(selectMock).not.toHaveBeenCalled();
	});

	it("empty event AND zero DB rows → no_content", async () => {
		buildRetainConversationServices();
		buildSelectChain([]);

		const result = await handler({
			tenantId: TENANT_A,
			userId: USER_ID,
			threadId: THREAD_ID,
			transcript: [],
		});

		expect(result).toEqual({ ok: false, error: "no_content" });
		expect(retainConversationMock).not.toHaveBeenCalled();
	});

	it("error path: DB throws → catch + warning + fallback to event tail", async () => {
		buildRetainConversationServices();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		selectMock.mockReturnValue({
			from: () => ({
				where: () => ({
					orderBy: () => Promise.reject(new Error("connection refused")),
				}),
			}),
		});

		const result = await handler({
			tenantId: TENANT_A,
			userId: USER_ID,
			threadId: THREAD_ID,
			transcript: [{ role: "user", content: "after-db-fail" }],
		});

		expect(result.ok).toBe(true);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/fetchThreadTranscript failed/));
		expect(retainConversationMock).toHaveBeenCalledTimes(1);
		expect(retainConversationMock.mock.calls[0][0].messages).toHaveLength(1);
		warnSpy.mockRestore();
	});

	it("error path: adapter throws on retainConversation → handler returns error", async () => {
		buildRetainConversationServices();
		buildSelectChain([]);
		retainConversationMock.mockRejectedValueOnce(new Error("hindsight 503"));

		const result = await handler({
			tenantId: TENANT_A,
			userId: USER_ID,
			threadId: THREAD_ID,
			transcript: [{ role: "user", content: "boom" }],
		});

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/hindsight 503/);
	});

	it("100+ message merge does not silently cap", async () => {
		buildRetainConversationServices();
		const dbRows = Array.from({ length: 120 }, (_, i) =>
			dbRow(
				i % 2 === 0 ? "user" : "assistant",
				`msg-${i}`,
				new Date(Date.UTC(2026, 3, 28, 0, 0, i)).toISOString(),
			),
		);
		buildSelectChain(dbRows);

		await handler({
			tenantId: TENANT_A,
			userId: USER_ID,
			threadId: THREAD_ID,
			transcript: [
				{ role: "user", content: "new-user" },
				{ role: "assistant", content: "new-assistant" },
			],
		});

		expect(retainConversationMock.mock.calls[0][0].messages).toHaveLength(122);
	});
});
