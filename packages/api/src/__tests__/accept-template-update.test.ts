/**
 * Unit 9 tests — acceptTemplateUpdate + acceptTemplateUpdateBulk.
 *
 * The resolvers themselves need heavy DB mocking (5+ table touches each)
 * so these tests target the refactored core helper `applyPinAdvance`
 * and the resolvers via their auth gate / input validation paths.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";

// ─── Hoisted DB mock ─────────────────────────────────────────────────────────

const { dbQueue, pushDbRows, resetDbQueue, updateCaptured, insertCaptured } =
	vi.hoisted(() => {
		const queue: unknown[][] = [];
		const updateCaptured: Array<Record<string, unknown>> = [];
		const insertCaptured: Array<Record<string, unknown>> = [];
		return {
			dbQueue: queue,
			pushDbRows: (rows: unknown[]) => queue.push(rows),
			resetDbQueue: () => {
				queue.length = 0;
				updateCaptured.length = 0;
				insertCaptured.length = 0;
			},
			updateCaptured,
			insertCaptured,
		};
	});

vi.mock("../graphql/utils.js", () => {
	const tableCol = (label: string) => ({ __col: label });
	const selectChain = () => ({
		from: vi.fn().mockImplementation(() => ({
			where: vi.fn().mockImplementation(() => {
				const fn: any = () => Promise.resolve(dbQueue.shift() ?? []);
				fn.then = (o: any, r: any) =>
					Promise.resolve(dbQueue.shift() ?? []).then(o, r);
				fn.limit = vi.fn().mockImplementation(() =>
					Promise.resolve(dbQueue.shift() ?? []),
				);
				return fn;
			}),
		})),
	});
	const updateChain = () => ({
		set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
			updateCaptured.push(values);
			return {
				where: vi.fn().mockImplementation(() => ({
					returning: vi.fn().mockImplementation(() =>
						Promise.resolve(dbQueue.shift() ?? []),
					),
				})),
			};
		}),
	});
	return {
		db: {
			select: vi.fn().mockImplementation(() => selectChain()),
			update: vi.fn().mockImplementation(() => updateChain()),
		},
		eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
		and: (...args: unknown[]) => ({ __and: args }),
		agents: {
			id: tableCol("agents.id"),
			slug: tableCol("agents.slug"),
			name: tableCol("agents.name"),
			tenant_id: tableCol("agents.tenant_id"),
			template_id: tableCol("agents.template_id"),
			agent_pinned_versions: tableCol("agents.agent_pinned_versions"),
			$inferSelect: null as any,
		},
		agentTemplates: {
			id: tableCol("agent_templates.id"),
			slug: tableCol("agent_templates.slug"),
			tenant_id: tableCol("agent_templates.tenant_id"),
		},
		tenants: {
			id: tableCol("tenants.id"),
			slug: tableCol("tenants.slug"),
			name: tableCol("tenants.name"),
		},
		tenantMembers: {
			tenant_id: tableCol("tenant_members.tenant_id"),
			principal_id: tableCol("tenant_members.principal_id"),
			role: tableCol("tenant_members.role"),
		},
		users: {
			id: tableCol("users.id"),
			tenant_id: tableCol("users.tenant_id"),
		},
		agentToCamel: (row: unknown) => row,
	};
});

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
	resolveCallerTenantId: vi.fn().mockResolvedValue("tenant-a"),
	resolveCallerUserId: vi.fn().mockResolvedValue("user-caller"),
	resolveCallerFromAuth: vi.fn().mockResolvedValue({
		userId: "user-caller",
		tenantId: "tenant-a",
	}),
	resolveCaller: vi.fn().mockResolvedValue({
		userId: "user-caller",
		tenantId: "tenant-a",
	}),
}));

// ─── S3 mock ─────────────────────────────────────────────────────────────────

const s3Mock = mockClient(S3Client);
process.env.WORKSPACE_BUCKET = "test-bucket";

import {
	applyPinAdvance,
	acceptTemplateUpdate,
	isPinnedFile,
	normalizePins,
} from "../graphql/resolvers/agents/acceptTemplateUpdate.mutation.js";
import { acceptTemplateUpdateBulk } from "../graphql/resolvers/templates/acceptTemplateUpdateBulk.mutation.js";
import { clearComposerCacheForTests } from "../lib/workspace-overlay.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function body(content: string) {
	return {
		Body: {
			transformToString: async () => content,
		} as unknown as never,
	};
}

function noSuchKey() {
	const err = new Error("NoSuchKey");
	err.name = "NoSuchKey";
	return err;
}

function notFoundHead() {
	const err = new Error("NotFound");
	err.name = "NotFound";
	(err as { $metadata?: { httpStatusCode?: number } }).$metadata = {
		httpStatusCode: 404,
	};
	return err;
}

function sha(content: string) {
	return createHash("sha256").update(content).digest("hex");
}

function mockCtx() {
	return {
		auth: { authType: "cognito", principalId: "user-caller" },
	} as any;
}

beforeEach(() => {
	s3Mock.reset();
	resetDbQueue();
	clearComposerCacheForTests();
});

// ─── Input validation ────────────────────────────────────────────────────────

describe("isPinnedFile", () => {
	it("returns true for guardrail-class files", () => {
		expect(isPinnedFile("GUARDRAILS.md")).toBe(true);
		expect(isPinnedFile("PLATFORM.md")).toBe(true);
		expect(isPinnedFile("CAPABILITIES.md")).toBe(true);
	});

	it("returns false for live-class files", () => {
		expect(isPinnedFile("IDENTITY.md")).toBe(false);
		expect(isPinnedFile("USER.md")).toBe(false);
		expect(isPinnedFile("memory/lessons.md")).toBe(false);
		expect(isPinnedFile("../GUARDRAILS.md")).toBe(false);
	});
});

describe("normalizePins", () => {
	it("returns {} for null / non-object", () => {
		expect(normalizePins(null)).toEqual({});
		expect(normalizePins(undefined)).toEqual({});
		expect(normalizePins("string")).toEqual({});
	});

	it("drops non-string values", () => {
		expect(normalizePins({ a: "sha256:abc", b: 123, c: null, d: "" })).toEqual(
			{ a: "sha256:abc" },
		);
	});
});

// ─── applyPinAdvance (core) ──────────────────────────────────────────────────

describe("applyPinAdvance", () => {
	it("writes the version store, bumps the pin, deletes the override, returns the updated row", async () => {
		const NEW = "# new content";
		const hex = sha(NEW);
		// Version store is empty → HEAD 404, PUT succeeds.
		s3Mock.on(HeadObjectCommand).rejects(notFoundHead());
		s3Mock.on(PutObjectCommand).resolves({});
		s3Mock.on(DeleteObjectCommand).resolves({});
		// update returns the updated row.
		pushDbRows([{ id: "a1", agent_pinned_versions: { "GUARDRAILS.md": `sha256:${hex}` } }]);

		const out = await applyPinAdvance({
			agentId: "a1",
			agentSlug: "agent-a",
			tenantId: "t1",
			tenantSlug: "acme",
			templateSlug: "exec",
			filename: "GUARDRAILS.md",
			currentPins: { "GUARDRAILS.md": "sha256:old" },
			latestContent: NEW,
			latestHex: hex,
		});

		expect(out).not.toBeNull();
		// Version store PUT.
		const puts = s3Mock.commandCalls(PutObjectCommand);
		expect(puts.map((c) => c.args[0].input.Key)).toContain(
			`tenants/acme/agents/_catalog/exec/workspace-versions/GUARDRAILS.md@sha256:${hex}`,
		);
		// Override deleted.
		const dels = s3Mock.commandCalls(DeleteObjectCommand);
		expect(dels.map((c) => c.args[0].input.Key)).toContain(
			"tenants/acme/agents/agent-a/workspace/GUARDRAILS.md",
		);
		// update.set captured the new pin map.
		const captured = updateCaptured[0];
		expect(captured.agent_pinned_versions).toEqual({
			"GUARDRAILS.md": `sha256:${hex}`,
		});
	});

	it("is a no-op when pin is already on the latest hash", async () => {
		const NEW = "# unchanged";
		const hex = sha(NEW);
		s3Mock.on(HeadObjectCommand).resolves({}); // version already stored
		pushDbRows([{ id: "a1", agent_pinned_versions: { "GUARDRAILS.md": `sha256:${hex}` } }]);

		await applyPinAdvance({
			agentId: "a1",
			agentSlug: "agent-a",
			tenantId: "t1",
			tenantSlug: "acme",
			templateSlug: "exec",
			filename: "GUARDRAILS.md",
			currentPins: { "GUARDRAILS.md": `sha256:${hex}` },
			latestContent: NEW,
			latestHex: hex,
		});

		expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
		expect(s3Mock.commandCalls(DeleteObjectCommand).length).toBe(0);
		expect(updateCaptured.length).toBe(0);
	});

	it("swallows NoSuchKey on the override delete (no override ever existed)", async () => {
		const hex = sha("x");
		s3Mock.on(HeadObjectCommand).rejects(notFoundHead());
		s3Mock.on(PutObjectCommand).resolves({});
		s3Mock.on(DeleteObjectCommand).rejects(noSuchKey());
		pushDbRows([{ id: "a1", agent_pinned_versions: { "GUARDRAILS.md": `sha256:${hex}` } }]);

		await expect(
			applyPinAdvance({
				agentId: "a1",
				agentSlug: "agent-a",
				tenantId: "t1",
				tenantSlug: "acme",
				templateSlug: "exec",
				filename: "GUARDRAILS.md",
				currentPins: {},
				latestContent: "x",
				latestHex: hex,
			}),
		).resolves.toBeDefined();
	});
});

// ─── acceptTemplateUpdate (resolver) ─────────────────────────────────────────

describe("acceptTemplateUpdate", () => {
	it("rejects non-pinned filenames up front", async () => {
		await expect(
			acceptTemplateUpdate(null, { agentId: "a1", filename: "IDENTITY.md" }, mockCtx()),
		).rejects.toThrow(/not a pinned-class file/);
	});

	it("throws NOT_FOUND when the agent is missing", async () => {
		pushDbRows([]); // agent lookup
		await expect(
			acceptTemplateUpdate(null, { agentId: "a1", filename: "GUARDRAILS.md" }, mockCtx()),
		).rejects.toThrow(/Agent not found/);
	});

	it("requires tenant admin", async () => {
		pushDbRows([
			{
				id: "a1",
				slug: "agent-a",
				tenant_id: "t1",
				template_id: "tmpl-1",
				agent_pinned_versions: {},
			},
		]);
		// requireTenantAdmin → resolveCallerUserId returns "user-caller", then
		// queries tenant_members. If the queue returns no member row, it
		// throws FORBIDDEN.
		pushDbRows([]); // tenant_members empty → FORBIDDEN
		await expect(
			acceptTemplateUpdate(null, { agentId: "a1", filename: "GUARDRAILS.md" }, mockCtx()),
		).rejects.toThrow(/Tenant admin/);
	});
});

// ─── acceptTemplateUpdateBulk (resolver) ─────────────────────────────────────

describe("acceptTemplateUpdateBulk", () => {
	it("rejects non-pinned filenames up front", async () => {
		await expect(
			acceptTemplateUpdateBulk(
				null,
				{ templateId: "tmpl-1", filename: "IDENTITY.md", tenantId: "t1" },
				mockCtx(),
			),
		).rejects.toThrow(/not a pinned-class file/);
	});

	it("iterates agents and reports per-agent success / failure", async () => {
		// tenant admin check
		pushDbRows([{ role: "admin" }]);
		// template lookup
		pushDbRows([{ id: "tmpl-1", slug: "exec", tenant_id: "t1" }]);
		// tenant slug lookup
		pushDbRows([{ slug: "acme" }]);
		// readTemplateBaseWithFallback — template-level GET succeeds.
		const NEW = "# new bulk content";
		const hex = sha(NEW);
		s3Mock
			.on(GetObjectCommand, {
				Key: "tenants/acme/agents/_catalog/exec/workspace/GUARDRAILS.md",
			})
			.resolves(body(NEW));
		// agents-by-template query
		pushDbRows([
			{ id: "agent-1", slug: "a1", agent_pinned_versions: { "GUARDRAILS.md": "sha256:old1" } },
			{ id: "agent-2", slug: "a2", agent_pinned_versions: { "GUARDRAILS.md": "sha256:old2" } },
		]);
		// Each applyPinAdvance: HEAD version store → PUT content → UPDATE row returning row → DELETE override.
		s3Mock.on(HeadObjectCommand).rejects(notFoundHead());
		s3Mock.on(PutObjectCommand).resolves({});
		s3Mock.on(DeleteObjectCommand).resolves({});
		// Two update .returning() calls:
		pushDbRows([{ id: "agent-1" }]);
		pushDbRows([{ id: "agent-2" }]);

		const result = await acceptTemplateUpdateBulk(
			null,
			{ templateId: "tmpl-1", filename: "GUARDRAILS.md", tenantId: "t1" },
			mockCtx(),
		);

		expect(result.accepted).toBe(2);
		expect(result.failed).toBe(0);
		expect(result.results).toEqual([
			{ agentId: "agent-1", success: true },
			{ agentId: "agent-2", success: true },
		]);
		// Latest template content was read once, not per-agent.
		const gets = s3Mock.commandCalls(GetObjectCommand);
		expect(gets.length).toBe(1);
	});

	it("records partial failures without aborting the batch", async () => {
		pushDbRows([{ role: "admin" }]); // admin check
		pushDbRows([{ id: "tmpl-1", slug: "exec", tenant_id: "t1" }]);
		pushDbRows([{ slug: "acme" }]);
		const NEW = "# content";
		s3Mock
			.on(GetObjectCommand, {
				Key: "tenants/acme/agents/_catalog/exec/workspace/GUARDRAILS.md",
			})
			.resolves(body(NEW));
		// Two agents. First succeeds, second's UPDATE returns nothing
		// (simulating a disappeared-mid-flight row).
		pushDbRows([
			{ id: "agent-1", slug: "a1", agent_pinned_versions: {} },
			{ id: "agent-2", slug: "a2", agent_pinned_versions: {} },
		]);
		s3Mock.on(HeadObjectCommand).rejects(notFoundHead());
		s3Mock.on(PutObjectCommand).resolves({});
		s3Mock.on(DeleteObjectCommand).resolves({});
		pushDbRows([{ id: "agent-1" }]); // success
		pushDbRows([]); // agent-2 disappeared

		const result = await acceptTemplateUpdateBulk(
			null,
			{ templateId: "tmpl-1", filename: "GUARDRAILS.md", tenantId: "t1" },
			mockCtx(),
		);

		expect(result.accepted).toBe(1);
		expect(result.failed).toBe(1);
		expect(result.results[0].success).toBe(true);
		expect(result.results[1].success).toBe(false);
		expect(result.results[1].error).toMatch(/disappeared/);
	});

	it("rejects templates from the wrong tenant with NOT_FOUND (no leakage)", async () => {
		pushDbRows([{ role: "admin" }]); // admin check passes for t1
		// Template belongs to different tenant.
		pushDbRows([{ id: "tmpl-1", slug: "exec", tenant_id: "t-other" }]);

		await expect(
			acceptTemplateUpdateBulk(
				null,
				{ templateId: "tmpl-1", filename: "GUARDRAILS.md", tenantId: "t1" },
				mockCtx(),
			),
		).rejects.toThrow(/Template not found/);
	});
});
