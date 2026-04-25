import { describe, expect, it } from "vitest";
import {
	classifyFatMigrationAction,
	missingTenantSlugs,
	parseFatMigrationArgs,
	summarizeFatMigration,
	validateFatMigrationOptions,
} from "../handlers/migrate-agents-to-fat.js";

describe("fat-folder migration helpers", () => {
	it("maps comparator classifications to operator-facing actions", () => {
		expect(classifyFatMigrationAction("fork", "GUARDRAILS.md")).toBe(
			"revert-to-inherited",
		);
		expect(classifyFatMigrationAction("override", "GUARDRAILS.md")).toBe(
			"keep-as-override",
		);
		expect(classifyFatMigrationAction("review-required", "USER.md")).toBe(
			"keep-as-override",
		);
		expect(classifyFatMigrationAction("no-template", "expenses/CONTEXT.md")).toBe(
			"materialize-sub-agent",
		);
	});

	it("refuses destructive mode without an explicit tenant filter", () => {
		expect(() => validateFatMigrationOptions({ destructive: true })).toThrow(
			/destructive migration requires explicit tenant scope/,
		);
		expect(() =>
			validateFatMigrationOptions({
				destructive: true,
				tenants: ["acme"],
			}),
		).not.toThrow();
	});

	it("refuses invalid batch sizes", () => {
		expect(() => validateFatMigrationOptions({ batchSize: 0 })).toThrow(
			/batch-size must be at least 1/,
		);
	});

	it("detects unknown tenant filters before migration queries become unscoped", () => {
		expect(missingTenantSlugs(["acme", "acme", "globex"], ["acme"])).toEqual([
			"globex",
		]);
		expect(missingTenantSlugs(["acme"], ["acme"])).toEqual([]);
	});

	it("parses CLI flags", () => {
		expect(
			parseFatMigrationArgs([
				"--stage=dev",
				"--tenants=acme,globex",
				"--batch-size=20",
				"--destructive",
				"--run-id=test-run",
			]),
		).toEqual({
			stage: "dev",
			tenants: ["acme", "globex"],
			batchSize: 20,
			destructive: true,
			runId: "test-run",
		});
	});

	it("summarizes per-agent report actions", () => {
		const summary = summarizeFatMigration([
			{
				tenant: "acme",
				agent: "marco",
				agentId: "agent-1",
				template: "exec",
				files: [
					{ path: "GUARDRAILS.md", action: "revert-to-inherited", reason: "same", deleted: true },
					{ path: "expenses/CONTEXT.md", action: "materialize-sub-agent", reason: "agent-only" },
				],
			},
			{
				tenant: "acme",
				agent: "fin",
				agentId: "agent-2",
				template: "exec",
				files: [],
				error: "boom",
			},
		]);

		expect(summary).toEqual({
			agents: 2,
			agentsWithErrors: 1,
			actions: {
				"revert-to-inherited": 1,
				"keep-as-override": 0,
				"materialize-sub-agent": 1,
			},
			deleted: 1,
		});
	});
});
