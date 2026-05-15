import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
	parseArgs,
	collectSkillFiles,
	installFinancePilot,
	PILOT_SKILL_SLUGS,
} from "../install-finance-pilot";

describe("parseArgs", () => {
	it("accepts --api-url + --token + --agent-id (cognito path)", () => {
		const args = parseArgs([
			"--api-url=https://api.example.com/",
			"--token=tok",
			"--agent-id=aaa",
		]);
		expect(args.apiUrl).toBe("https://api.example.com"); // trailing slash stripped
		expect(args.auth).toEqual({ kind: "cognito", token: "tok" });
		expect(args.target).toEqual({ agentId: "aaa" });
	});

	it("accepts --api-key + --tenant-id + --agent-id (apikey path)", () => {
		const args = parseArgs([
			"--api-url=https://api.example.com",
			"--api-key=secret",
			"--tenant-id=tenant-uuid",
			"--principal-id=user-uuid",
			"--agent-id=aaa",
		]);
		expect(args.auth).toEqual({
			kind: "apikey",
			apiKey: "secret",
			tenantId: "tenant-uuid",
			principalId: "user-uuid",
		});
		expect(args.target).toEqual({ agentId: "aaa" });
	});

	it("defaults --principal-id to a sentinel when omitted on apikey path", () => {
		const args = parseArgs([
			"--api-url=https://api.example.com",
			"--api-key=secret",
			"--tenant-id=tenant-uuid",
			"--agent-id=aaa",
		]);
		// Sentinel matters for audit-log correlation — apikey resolveAuditActor
		// still records `system / platform-credential` but x-principal-id is
		// forwarded for log search.
		expect(args.auth).toMatchObject({
			kind: "apikey",
			principalId: "operator-install-finance-pilot",
		});
	});

	it("rejects --api-key without --tenant-id", () => {
		expect(() =>
			parseArgs([
				"--api-url=x",
				"--api-key=secret",
				"--agent-id=a",
			]),
		).toThrow(/tenant-id/);
	});

	it("rejects passing neither --token nor --api-key", () => {
		expect(() =>
			parseArgs(["--api-url=x", "--agent-id=a"]),
		).toThrow(/token.*api-key|api-key.*token/);
	});

	it("accepts --template-id as an alternative", () => {
		const args = parseArgs([
			"--api-url=https://api.example.com",
			"--token=tok",
			"--template-id=tmpl",
		]);
		expect(args.target).toEqual({ templateId: "tmpl" });
	});

	it("rejects missing --api-url", () => {
		expect(() => parseArgs(["--token=t", "--agent-id=a"])).toThrow(/api-url/);
	});

	it("rejects passing neither --agent-id nor --template-id", () => {
		expect(() =>
			parseArgs(["--api-url=x", "--token=t"]),
		).toThrow(/agent-id or --template-id/);
	});

	it("rejects passing both --agent-id and --template-id", () => {
		expect(() =>
			parseArgs([
				"--api-url=x",
				"--token=t",
				"--agent-id=a",
				"--template-id=t",
			]),
		).toThrow(/not both/);
	});
});

describe("collectSkillFiles", () => {
	it("collects SKILL.md + README + LICENSE-NOTES for each pilot skill", async () => {
		for (const slug of PILOT_SKILL_SLUGS) {
			const records = await collectSkillFiles(slug);
			const paths = records.map((r) => r.relPath);
			expect(paths).toContain(`skills/${slug}/SKILL.md`);
			expect(paths.some((p) => p === `skills/${slug}/README.md`)).toBe(true);
		}
	});

	it("collects LICENSE-NOTES.md for the two lifted skills", async () => {
		for (const slug of [
			"finance-3-statement-model",
			"finance-audit-xls",
		]) {
			const records = await collectSkillFiles(slug);
			expect(
				records.some((r) => r.relPath === `skills/${slug}/LICENSE-NOTES.md`),
			).toBe(true);
		}
	});

	it("emits relPath under the conventional skills/<slug>/ prefix", async () => {
		const records = await collectSkillFiles("finance-statement-analysis");
		for (const r of records) {
			expect(r.relPath.startsWith("skills/finance-statement-analysis/")).toBe(
				true,
			);
		}
	});

	it("throws when the skill directory is missing", async () => {
		await expect(
			collectSkillFiles("does-not-exist"),
		).rejects.toThrow(/missing/);
	});
});

describe("installFinancePilot — happy path with mocked fetch", () => {
	let originalFetch: typeof fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("PUTs every collected file via /api/workspaces/files with action=put and content (not body)", async () => {
		const calls: Array<{ url: string; body: any; headers: Headers }> = [];
		globalThis.fetch = vi.fn(async (url: any, init: any) => {
			calls.push({
				url: typeof url === "string" ? url : url.toString(),
				body: JSON.parse(init.body),
				headers: new Headers(init.headers ?? {}),
			});
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}) as unknown as typeof fetch;

		const result = await installFinancePilot({
			apiUrl: "https://api.example.com",
			auth: { kind: "cognito", token: "tok" },
			target: { agentId: "agent-1" },
		});

		expect(result.installed).toBeGreaterThan(0);
		// Every call hits the workspaces/files endpoint with action=put.
		for (const call of calls) {
			expect(call.url).toBe("https://api.example.com/api/workspaces/files");
			expect(call.body.action).toBe("put");
			expect(call.body.agentId).toBe("agent-1");
			expect(call.body.path).toMatch(/^skills\/finance-/);
			// Handler field is `content` not `body`. Earlier draft sent `body`
			// which 400'd every PUT — regression guard for that bug.
			expect(call.body.content).toBeTypeOf("string");
			expect(call.body.body).toBeUndefined();
			expect(call.headers.get("authorization")).toBe("Bearer tok");
		}
	});

	it("uses apikey headers when --api-key auth is selected", async () => {
		const headers: Array<Headers> = [];
		globalThis.fetch = vi.fn(async (_url: any, init: any) => {
			headers.push(new Headers(init.headers ?? {}));
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;

		await installFinancePilot({
			apiUrl: "https://api.example.com",
			auth: {
				kind: "apikey",
				apiKey: "secret",
				tenantId: "tenant-uuid",
				principalId: "user-uuid",
			},
			target: { agentId: "agent-1" },
		});

		expect(headers.length).toBeGreaterThan(0);
		for (const h of headers) {
			expect(h.get("x-api-key")).toBe("secret");
			expect(h.get("x-tenant-id")).toBe("tenant-uuid");
			expect(h.get("x-principal-id")).toBe("user-uuid");
			// x-agent-id must mirror the target agent — workspace-files'
			// service-auth guard at line 1196 demands it for identity-field
			// writes; generic skill PUTs don't need it, but sending it is
			// harmless and consistent.
			expect(h.get("x-agent-id")).toBe("agent-1");
			// authorization header is NOT set on the apikey path.
			expect(h.get("authorization")).toBeNull();
		}
	});

	it("forwards templateId when --template-id is the target", async () => {
		const targets: Set<string> = new Set();
		globalThis.fetch = vi.fn(async (_url: any, init: any) => {
			const body = JSON.parse(init.body);
			if (body.templateId) targets.add(body.templateId);
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;

		await installFinancePilot({
			apiUrl: "https://api.example.com",
			auth: { kind: "cognito", token: "tok" },
			target: { templateId: "tmpl-1" },
		});
		expect(targets).toEqual(new Set(["tmpl-1"]));
	});

	it("omits x-agent-id when targeting a template (apikey path)", async () => {
		const headers: Array<Headers> = [];
		globalThis.fetch = vi.fn(async (_url: any, init: any) => {
			headers.push(new Headers(init.headers ?? {}));
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;

		await installFinancePilot({
			apiUrl: "https://api.example.com",
			auth: {
				kind: "apikey",
				apiKey: "secret",
				tenantId: "tenant-uuid",
				principalId: "user-uuid",
			},
			target: { templateId: "tmpl-1" },
		});
		for (const h of headers) {
			expect(h.get("x-agent-id")).toBeNull();
		}
	});

	it("throws + halts on the first PUT failure", async () => {
		let calls = 0;
		globalThis.fetch = vi.fn(async () => {
			calls += 1;
			if (calls > 2) {
				return new Response("forbidden", { status: 403 });
			}
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;

		await expect(
			installFinancePilot({
				apiUrl: "https://api.example.com",
				auth: { kind: "cognito", token: "tok" },
				target: { agentId: "agent-1" },
			}),
		).rejects.toThrow(/403|forbidden/);
		// We stopped at the third call rather than continuing.
		expect(calls).toBeLessThan(50);
	});
});
