import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
	parseArgs,
	collectSkillFiles,
	installFinancePilot,
	PILOT_SKILL_SLUGS,
} from "../install-finance-pilot";

describe("parseArgs", () => {
	it("accepts --api-url + --token + --agent-id", () => {
		const args = parseArgs([
			"--api-url=https://api.example.com/",
			"--token=tok",
			"--agent-id=aaa",
		]);
		expect(args.apiUrl).toBe("https://api.example.com"); // trailing slash stripped
		expect(args.token).toBe("tok");
		expect(args.target).toEqual({ agentId: "aaa" });
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

	it("rejects missing --token", () => {
		expect(() => parseArgs(["--api-url=x", "--agent-id=a"])).toThrow(/token/);
	});

	it("rejects passing neither --agent-id nor --template-id", () => {
		expect(() => parseArgs(["--api-url=x", "--token=t"])).toThrow(
			/agent-id or --template-id/,
		);
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

	it("PUTs every collected file via /api/workspaces/files", async () => {
		const calls: Array<{ url: string; body: any }> = [];
		globalThis.fetch = vi.fn(async (url: any, init: any) => {
			calls.push({
				url: typeof url === "string" ? url : url.toString(),
				body: JSON.parse(init.body),
			});
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}) as unknown as typeof fetch;

		const result = await installFinancePilot({
			apiUrl: "https://api.example.com",
			token: "tok",
			target: { agentId: "agent-1" },
		});

		expect(result.installed).toBeGreaterThan(0);
		// Every call hits the workspaces/files endpoint with action=put.
		for (const call of calls) {
			expect(call.url).toBe(
				"https://api.example.com/api/workspaces/files",
			);
			expect(call.body.action).toBe("put");
			expect(call.body.agentId).toBe("agent-1");
			expect(call.body.path).toMatch(/^skills\/finance-/);
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
			token: "tok",
			target: { templateId: "tmpl-1" },
		});
		expect(targets).toEqual(new Set(["tmpl-1"]));
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
				token: "tok",
				target: { agentId: "agent-1" },
			}),
		).rejects.toThrow(/403|forbidden/);
		// We stopped at the third call rather than continuing.
		expect(calls).toBeLessThan(50);
	});
});
