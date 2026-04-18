/**
 * Unit tests for the post-turn wiki-compile enqueue helper.
 *
 * Covers the decision matrix in lib/wiki/enqueue.ts:
 * - skipped when flag off
 * - skipped when adapter isn't Hindsight
 * - deduped when a bucket already has a job
 * - successful enqueue path (invoke success + invoke failure)
 * - error swallowed when repository blows up
 *
 * Also covers the pure helpers in lib/wiki/repository.ts that don't need a
 * live DB: normalizeAlias, buildCompileDedupeKey, renderBodyMarkdown.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock state so vi.mock factories can see the handles ─────────────

const { mockTenantRows, mockEnqueue, mockInvoke } = vi.hoisted(() => {
	return {
		mockTenantRows: vi.fn<() => Promise<Array<{ enabled: boolean }>>>(),
		mockEnqueue: vi.fn(),
		mockInvoke: vi.fn(),
	};
});

// Minimal drizzle query-builder stub — the chain `db.select({}).from(...).where(...).limit(n)`
// resolves to whatever mockTenantRows returns.
vi.mock("../lib/db.js", () => {
	const select = vi.fn(() => ({
		from: vi.fn(() => ({
			where: vi.fn(() => ({
				limit: vi.fn(() => mockTenantRows()),
			})),
		})),
	}));
	return { db: { select } };
});

vi.mock("@thinkwork/database-pg/schema", () => ({
	tenants: {
		id: "tenants.id",
		wiki_compile_enabled: "tenants.wiki_compile_enabled",
	},
}));

vi.mock("drizzle-orm", () => ({
	eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
}));

vi.mock("../lib/wiki/repository.js", async (importOriginal) => {
	const actual =
		(await importOriginal()) as typeof import("../lib/wiki/repository.js");
	return {
		...actual,
		// Only swap the DB-touching helper — keep the pure functions real.
		enqueueCompileJob: mockEnqueue,
	};
});

// @aws-sdk/client-lambda is imported dynamically inside invokeWikiCompile; we
// mock the module so the Lambda invoke is inspectable.
vi.mock("@aws-sdk/client-lambda", () => ({
	LambdaClient: vi.fn().mockImplementation(() => ({
		send: mockInvoke,
	})),
	InvokeCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
}));

import { maybeEnqueuePostTurnCompile } from "../lib/wiki/enqueue.js";
import {
	buildCompileDedupeKey,
	normalizeAlias,
	renderBodyMarkdown,
} from "../lib/wiki/repository.js";

// ─── Reset + env between tests ───────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	delete process.env.STAGE;
	delete process.env.WIKI_COMPILE_FN;
});

// ─── Pure helpers (no mocks needed) ──────────────────────────────────────────

describe("normalizeAlias", () => {
	it("lowercases, strips punctuation, collapses whitespace", () => {
		expect(normalizeAlias("Café  Mocha!")).toBe("café mocha");
	});

	it("preserves internal hyphens and apostrophes", () => {
		expect(normalizeAlias("O'Hara's Pub-House")).toBe("o'hara's pub-house");
	});

	it("returns empty for punctuation-only input", () => {
		expect(normalizeAlias("!!! ... ???")).toBe("");
	});
});

describe("buildCompileDedupeKey", () => {
	it("uses tenant, owner, and 5-min bucket", () => {
		const key = buildCompileDedupeKey({
			tenantId: "t1",
			ownerId: "a1",
			nowEpochSeconds: 600, // bucket 2
		});
		expect(key).toBe("t1:a1:2");
	});

	it("same bucket for two timestamps within 5 minutes", () => {
		const a = buildCompileDedupeKey({
			tenantId: "t",
			ownerId: "o",
			nowEpochSeconds: 1000,
		});
		const b = buildCompileDedupeKey({
			tenantId: "t",
			ownerId: "o",
			nowEpochSeconds: 1000 + 60, // +60s still inside 300s bucket
		});
		expect(a).toBe(b);
	});

	it("different buckets across a 5-min boundary", () => {
		const a = buildCompileDedupeKey({
			tenantId: "t",
			ownerId: "o",
			nowEpochSeconds: 299,
		});
		const b = buildCompileDedupeKey({
			tenantId: "t",
			ownerId: "o",
			nowEpochSeconds: 300,
		});
		expect(a).not.toBe(b);
	});
});

describe("renderBodyMarkdown", () => {
	it("renders sections ordered by position with H2 headings", () => {
		const out = renderBodyMarkdown([
			{ heading: "Second", body_md: "b2", position: 2 },
			{ heading: "First", body_md: "b1", position: 1 },
		]);
		expect(out).toBe("## First\n\nb1\n\n## Second\n\nb2");
	});

	it("is deterministic (same input → same output)", () => {
		const input = [
			{ heading: "One", body_md: "a", position: 1 },
			{ heading: "Two", body_md: "b", position: 2 },
		];
		expect(renderBodyMarkdown(input)).toBe(renderBodyMarkdown(input));
	});
});

// ─── maybeEnqueuePostTurnCompile branches ────────────────────────────────────

describe("maybeEnqueuePostTurnCompile", () => {
	it("returns skipped_missing_inputs when tenant or owner absent", async () => {
		const r = await maybeEnqueuePostTurnCompile({
			tenantId: "",
			ownerId: "a",
			adapterKind: "hindsight",
		});
		expect(r.status).toBe("skipped_missing_inputs");
		expect(mockTenantRows).not.toHaveBeenCalled();
	});

	it("returns skipped_adapter when adapter isn't hindsight", async () => {
		const r = await maybeEnqueuePostTurnCompile({
			tenantId: "t",
			ownerId: "a",
			adapterKind: "agentcore",
		});
		expect(r.status).toBe("skipped_adapter");
		expect(mockTenantRows).not.toHaveBeenCalled();
		expect(mockEnqueue).not.toHaveBeenCalled();
	});

	it("returns skipped_tenant_not_found when tenant row is missing", async () => {
		mockTenantRows.mockResolvedValueOnce([]);
		const r = await maybeEnqueuePostTurnCompile({
			tenantId: "t",
			ownerId: "a",
			adapterKind: "hindsight",
		});
		expect(r.status).toBe("skipped_tenant_not_found");
		expect(mockEnqueue).not.toHaveBeenCalled();
	});

	it("returns skipped_flag_off when wiki_compile_enabled=false", async () => {
		mockTenantRows.mockResolvedValueOnce([{ enabled: false }]);
		const r = await maybeEnqueuePostTurnCompile({
			tenantId: "t",
			ownerId: "a",
			adapterKind: "hindsight",
		});
		expect(r.status).toBe("skipped_flag_off");
		expect(mockEnqueue).not.toHaveBeenCalled();
	});

	it("returns deduped when enqueueCompileJob reports existing job", async () => {
		mockTenantRows.mockResolvedValueOnce([{ enabled: true }]);
		mockEnqueue.mockResolvedValueOnce({
			inserted: false,
			job: { id: "job-existing" },
		});
		const r = await maybeEnqueuePostTurnCompile({
			tenantId: "t",
			ownerId: "a",
			adapterKind: "hindsight",
		});
		expect(r.status).toBe("deduped");
		expect(r.jobId).toBe("job-existing");
		expect(mockInvoke).not.toHaveBeenCalled();
	});

	it("returns enqueued and invokes wiki-compile when job is inserted (STAGE resolves fn name)", async () => {
		process.env.STAGE = "dev";
		mockTenantRows.mockResolvedValueOnce([{ enabled: true }]);
		mockEnqueue.mockResolvedValueOnce({
			inserted: true,
			job: { id: "job-new" },
		});
		mockInvoke.mockResolvedValueOnce({ StatusCode: 202 });

		const r = await maybeEnqueuePostTurnCompile({
			tenantId: "t",
			ownerId: "a",
			adapterKind: "hindsight",
		});

		expect(r.status).toBe("enqueued");
		expect(r.jobId).toBe("job-new");
		expect(mockInvoke).toHaveBeenCalledTimes(1);
		const invokeArg = mockInvoke.mock.calls[0][0] as { input: any };
		expect(invokeArg.input.FunctionName).toBe("thinkwork-dev-api-wiki-compile");
		expect(invokeArg.input.InvocationType).toBe("Event");
	});

	it("prefers WIKI_COMPILE_FN env override when set", async () => {
		process.env.WIKI_COMPILE_FN = "override-fn-arn";
		process.env.STAGE = "dev";
		mockTenantRows.mockResolvedValueOnce([{ enabled: true }]);
		mockEnqueue.mockResolvedValueOnce({
			inserted: true,
			job: { id: "job-new" },
		});
		mockInvoke.mockResolvedValueOnce({ StatusCode: 202 });

		await maybeEnqueuePostTurnCompile({
			tenantId: "t",
			ownerId: "a",
			adapterKind: "hindsight",
		});
		const invokeArg = mockInvoke.mock.calls[0][0] as { input: any };
		expect(invokeArg.input.FunctionName).toBe("override-fn-arn");
	});

	it("skips invoke (without failing) when no STAGE / no WIKI_COMPILE_FN", async () => {
		mockTenantRows.mockResolvedValueOnce([{ enabled: true }]);
		mockEnqueue.mockResolvedValueOnce({
			inserted: true,
			job: { id: "job-new" },
		});

		const r = await maybeEnqueuePostTurnCompile({
			tenantId: "t",
			ownerId: "a",
			adapterKind: "hindsight",
		});

		// The helper logs a warning and returns enqueued (no invoke error captured).
		expect(r.status).toBe("enqueued");
		expect(mockInvoke).not.toHaveBeenCalled();
	});

	it("returns enqueued_invoke_failed when Lambda invoke throws", async () => {
		process.env.STAGE = "dev";
		mockTenantRows.mockResolvedValueOnce([{ enabled: true }]);
		mockEnqueue.mockResolvedValueOnce({
			inserted: true,
			job: { id: "job-new" },
		});
		mockInvoke.mockRejectedValueOnce(new Error("ResourceNotFoundException"));

		const r = await maybeEnqueuePostTurnCompile({
			tenantId: "t",
			ownerId: "a",
			adapterKind: "hindsight",
		});

		expect(r.status).toBe("enqueued_invoke_failed");
		expect(r.jobId).toBe("job-new");
		expect(r.error).toContain("ResourceNotFoundException");
	});

	it("returns error (not throw) when repository blows up", async () => {
		mockTenantRows.mockRejectedValueOnce(new Error("DB down"));
		const r = await maybeEnqueuePostTurnCompile({
			tenantId: "t",
			ownerId: "a",
			adapterKind: "hindsight",
		});
		expect(r.status).toBe("error");
		expect(r.error).toBe("DB down");
	});
});
