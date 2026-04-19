import { describe, it, expect } from "vitest";
import { Command } from "commander";

import { registerWikiCommand } from "../src/commands/wiki.js";
import { classifyMutationError } from "../src/commands/wiki/helpers.js";

describe("wiki command registration", () => {
	it("registers `wiki` with compile, rebuild, and status subcommands", () => {
		const program = new Command();
		registerWikiCommand(program);

		const wiki = program.commands.find((c) => c.name() === "wiki");
		expect(wiki, "wiki domain is registered").toBeTruthy();
		expect(wiki!.description()).toMatch(/Compounding Memory/i);
		expect(wiki!.description()).toMatch(/Admin-only/i);

		const subNames = wiki!.commands.map((c) => c.name());
		expect(subNames).toEqual(
			expect.arrayContaining(["compile", "rebuild", "status"]),
		);
	});

	it("each wiki subcommand has a non-empty description", () => {
		const program = new Command();
		registerWikiCommand(program);
		const wiki = program.commands.find((c) => c.name() === "wiki")!;

		for (const name of ["compile", "rebuild", "status"]) {
			const cmd = wiki.commands.find((c) => c.name() === name);
			expect(cmd, `"${name}" subcommand exists`).toBeTruthy();
			expect(cmd!.description()).toBeTruthy();
		}
	});

	it("compile subcommand carries --tenant, --agent, --all, --model, and --watch flags", () => {
		const program = new Command();
		registerWikiCommand(program);
		const compile = program.commands
			.find((c) => c.name() === "wiki")!
			.commands.find((c) => c.name() === "compile")!;
		const help = compile.helpInformation();
		expect(help).toMatch(/--tenant/);
		expect(help).toMatch(/--agent/);
		expect(help).toMatch(/--all/);
		expect(help).toMatch(/--model/);
		expect(help).toMatch(/--watch/);
	});

	it("rebuild subcommand does NOT carry --all (single-agent only)", () => {
		const program = new Command();
		registerWikiCommand(program);
		const rebuild = program.commands
			.find((c) => c.name() === "wiki")!
			.commands.find((c) => c.name() === "rebuild")!;
		const help = rebuild.helpInformation();
		expect(help).not.toMatch(/--all\b/);
		expect(help).toMatch(/--yes/);
	});
});

describe("classifyMutationError", () => {
	it("flags Admin-only errors as forbidden", () => {
		const r = classifyMutationError(
			new Error("Admin-only: requires internal API key credential"),
		);
		expect(r.forbidden).toBe(true);
	});

	it("flags tenant mismatch as forbidden", () => {
		const r = classifyMutationError(
			new Error("Access denied: tenant mismatch"),
		);
		expect(r.forbidden).toBe(true);
	});

	it("does not flag an arbitrary server error as forbidden", () => {
		const r = classifyMutationError(
			new Error("GraphQL request returned no data."),
		);
		expect(r.forbidden).toBe(false);
	});

	it("handles non-Error values", () => {
		const r = classifyMutationError("boom");
		expect(r.forbidden).toBe(false);
		expect(r.message).toContain("boom");
	});
});
