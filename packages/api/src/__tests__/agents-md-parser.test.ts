/**
 * Tests for the AGENTS.md routing-table parser (Plan §008 U6).
 *
 * The TS parser at `packages/api/src/lib/agents-md-parser.ts` and the
 * Python mirror at `packages/agentcore/agent-container/agents_md_parser.py`
 * (U7) share a fixture under `packages/agentcore/agent-container/fixtures/
 * agents-md-sample.md` so a shape-parity test on each side catches drift —
 * see PINNED_SHAPE_CONTRACT in either file.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAgentsMd } from "../lib/agents-md-parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("parseAgentsMd — happy path", () => {
	it("extracts a 4-column routing table with three rows", () => {
		const md = `# AGENTS.md

## Routing

| Task             | Go to       | Read                  | Skills                       |
| ---------------- | ----------- | --------------------- | ---------------------------- |
| Expense receipts | expenses/   | expenses/CONTEXT.md   | approve-receipt,tag-vendor   |
| Recruiting       | recruiting/ | recruiting/CONTEXT.md | score-candidate              |
| Legal review     | legal/      | legal/CONTEXT.md      | review-contract              |
`;
		const result = parseAgentsMd(md);
		expect(result.routing).toHaveLength(3);
		expect(result.routing[0]).toEqual({
			task: "Expense receipts",
			goTo: "expenses/",
			reads: ["expenses/CONTEXT.md"],
			skills: ["approve-receipt", "tag-vendor"],
		});
		expect(result.routing[1].goTo).toBe("recruiting/");
		expect(result.routing[2].skills).toEqual(["review-contract"]);
		expect(result.rawMarkdown).toBe(md);
	});

	it("tolerates column reordering — detects columns by header name", () => {
		const md = `## Routing

| Skills | Task | Go to | Read |
| --- | --- | --- | --- |
| approve-receipt,tag-vendor | Expense receipts | expenses/ | expenses/CONTEXT.md |
`;
		const result = parseAgentsMd(md);
		expect(result.routing).toHaveLength(1);
		expect(result.routing[0]).toEqual({
			task: "Expense receipts",
			goTo: "expenses/",
			reads: ["expenses/CONTEXT.md"],
			skills: ["approve-receipt", "tag-vendor"],
		});
	});

	it("treats header aliases case-insensitively (Reads = Read; Skill = Skills)", () => {
		const md = `## Routing

| TASK | GO TO | READS | SKILL |
| --- | --- | --- | --- |
| Expense receipts | expenses/ | expenses/CONTEXT.md | approve-receipt |
`;
		const result = parseAgentsMd(md);
		expect(result.routing).toHaveLength(1);
		expect(result.routing[0].goTo).toBe("expenses/");
	});

	it("returns empty Skills array when the cell is empty", () => {
		const md = `## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Bare | bare/ | bare/CONTEXT.md | |
`;
		const result = parseAgentsMd(md);
		expect(result.routing).toHaveLength(1);
		expect(result.routing[0].skills).toEqual([]);
	});

	it("falls back to the only table when there is no '## Routing' heading", () => {
		const md = `# AGENTS.md

Some prose, no Routing heading.

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Specialist | spec/ | spec/CONTEXT.md | one |
`;
		const result = parseAgentsMd(md);
		expect(result.routing).toHaveLength(1);
		expect(result.routing[0].goTo).toBe("spec/");
	});
});

describe("parseAgentsMd — tolerance and skipping", () => {
	it("skips rows with invalid goTo paths and logs a warning", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const md = `## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| _add a row when you create a sub-agent_ | _e.g. \`expenses/\`_ | _e.g. \`expenses/CONTEXT.md\`_ | _comma-separated slugs_ |
| Real specialist | expenses/ | expenses/CONTEXT.md | approve-receipt |
`;
		const result = parseAgentsMd(md);
		expect(result.routing).toHaveLength(1);
		expect(result.routing[0].goTo).toBe("expenses/");
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("rejects 'memory' and 'skills' as goTo values (reserved folder names)", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const md = `## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Hidden mem | memory | memory/CONTEXT.md | x |
| Hidden skill | skills/ | skills/CONTEXT.md | x |
| Real | expenses/ | expenses/CONTEXT.md | x |
`;
		const result = parseAgentsMd(md);
		expect(result.routing).toHaveLength(1);
		expect(result.routing[0].goTo).toBe("expenses/");
		expect(warn).toHaveBeenCalledTimes(2);
		warn.mockRestore();
	});

	it("ignores trailing empty rows", () => {
		const md = `## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Real | expenses/ | expenses/CONTEXT.md | a |
| | | | |
`;
		const result = parseAgentsMd(md);
		expect(result.routing).toHaveLength(1);
	});

	it("strips italics, bold, and backticks from cell content before validation", () => {
		const md = `## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| **Expense receipts** | \`expenses/\` | \`expenses/CONTEXT.md\` | \`approve-receipt\` |
`;
		const result = parseAgentsMd(md);
		expect(result.routing[0]).toEqual({
			task: "Expense receipts",
			goTo: "expenses/",
			reads: ["expenses/CONTEXT.md"],
			skills: ["approve-receipt"],
		});
	});

	it("returns empty routing when there's no table at all", () => {
		const result = parseAgentsMd("# Just prose, no table.");
		expect(result.routing).toEqual([]);
	});
});

describe("parseAgentsMd — error paths", () => {
	it("throws when the routing table is missing the 'Go to' column", () => {
		const md = `## Routing

| Task | Read | Skills |
| --- | --- | --- |
| Recruiting | recruiting/CONTEXT.md | score |
`;
		expect(() => parseAgentsMd(md)).toThrow(/Go to/i);
	});

	it("throws when 'Go to' column is missing in a fallback (single-table) parse", () => {
		const md = `# AGENTS.md

| Task | Read | Skills |
| --- | --- | --- |
| Recruiting | recruiting/CONTEXT.md | score |
`;
		expect(() => parseAgentsMd(md)).toThrow(/Go to/i);
	});

	it("throws on multiple top-level tables when no '## Routing' heading is present", () => {
		const md = `# AGENTS.md

| A | B |
| - | - |
| 1 | 2 |

| C | D |
| - | - |
| 3 | 4 |
`;
		// Multiple top-level tables → ambiguous, parser refuses. Operator
		// must put the routing under '## Routing'.
		expect(() => parseAgentsMd(md)).toThrow(/multiple tables/i);
	});
});

describe("parseAgentsMd — fixture parity", () => {
	it("parses the seeded packages/workspace-defaults/files/AGENTS.md fixture without errors", () => {
		// The seeded AGENTS.md (U3) has only the placeholder row; expect
		// zero parsed rows after skip.
		const fixture = resolve(
			__dirname,
			"..",
			"..",
			"..",
			"workspace-defaults",
			"files",
			"AGENTS.md",
		);
		const md = readFileSync(fixture, "utf8");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = parseAgentsMd(md);
		expect(result.routing).toEqual([]);
		warn.mockRestore();
	});

	it("parses the shared U6/U7 fixture and produces the expected shape", () => {
		const fixture = resolve(
			__dirname,
			"..",
			"..",
			"..",
			"agentcore",
			"agent-container",
			"fixtures",
			"agents-md-sample.md",
		);
		const md = readFileSync(fixture, "utf8");
		const result = parseAgentsMd(md);
		// The shared fixture is the source of truth for the U6/U7 shape
		// contract. Three rows: expenses, recruiting, legal.
		expect(result.routing.map((r) => r.goTo)).toEqual([
			"expenses/",
			"recruiting/",
			"legal/",
		]);
		expect(result.routing[0].skills).toEqual([
			"approve-receipt",
			"tag-vendor",
		]);
	});
});
