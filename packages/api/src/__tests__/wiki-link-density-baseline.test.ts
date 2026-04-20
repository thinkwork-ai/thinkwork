import { describe, expect, it } from "vitest";
import {
	formatDensityReport,
	type LinkDensityRow,
} from "../lib/wiki/link-density-reporter.js";

function row(over: Partial<LinkDensityRow>): LinkDensityRow {
	return {
		agent_id: "a0",
		agent_name: "Agent",
		pages: 0,
		linked_pages: 0,
		percent_linked: 0,
		reference_links: 0,
		parent_of_links: 0,
		child_of_links: 0,
		duplicate_candidates: 0,
		...over,
	};
}

describe("formatDensityReport", () => {
	it("renders the empty case explicitly", () => {
		expect(formatDensityReport([])).toBe("(no agents in scope)");
	});

	it("matches the measurement table from the plan for the 3 demo agents", () => {
		const report = formatDensityReport([
			row({
				agent_id: "gigi",
				agent_name: "GiGi",
				pages: 849,
				linked_pages: 392,
				percent_linked: 46.2,
				reference_links: 1225,
				parent_of_links: 0,
				child_of_links: 0,
			}),
			row({
				agent_id: "marco",
				agent_name: "Marco",
				pages: 261,
				linked_pages: 183,
				percent_linked: 70.1,
				reference_links: 800,
				parent_of_links: 3,
				child_of_links: 3,
			}),
			row({
				agent_id: "cruz",
				agent_name: "Cruz",
				pages: 10,
				linked_pages: 9,
				percent_linked: 90,
				reference_links: 15,
				parent_of_links: 0,
				child_of_links: 0,
			}),
		]);
		// Formatter preserves caller order; sorting is a queryLinkDensity
		// concern so callers can choose a different order (e.g. by density).
		const lines = report.split("\n");
		expect(lines[0]).toMatch(/agent/);
		expect(lines[2]).toMatch(/GiGi\s+849\s+392\s+46\.2%/);
		expect(lines[3]).toMatch(/Marco\s+261\s+183\s+70\.1%/);
		expect(lines[4]).toMatch(/Cruz\s+10\s+9\s+90\.0%/);
	});

	it("renders zero-page agents cleanly (no divide-by-zero)", () => {
		const report = formatDensityReport([
			row({ agent_name: "EmptyAgent", pages: 0, linked_pages: 0 }),
		]);
		expect(report).toMatch(/EmptyAgent\s+0\s+0\s+0\.0%/);
	});

	it("renders a fully-linked agent as 100.0%", () => {
		const report = formatDensityReport([
			row({
				agent_name: "FullAgent",
				pages: 5,
				linked_pages: 5,
				percent_linked: 100,
			}),
		]);
		expect(report).toMatch(/FullAgent\s+5\s+5\s+100\.0%/);
	});

	it("surfaces duplicate-title candidates (R5 canary)", () => {
		const report = formatDensityReport([
			row({
				agent_name: "DupHeavy",
				pages: 100,
				linked_pages: 40,
				percent_linked: 40,
				duplicate_candidates: 7,
			}),
		]);
		expect(report).toMatch(/DupHeavy.*\s+7$/);
	});

	it("truncates over-long agent names so columns stay aligned", () => {
		const report = formatDensityReport([
			row({
				agent_name: "A".repeat(100),
				pages: 1,
				linked_pages: 1,
				percent_linked: 100,
			}),
		]);
		const dataLine = report.split("\n")[2]!;
		// 24 chars of name column + two spaces + "1" — first 25 chars must be
		// agent name padded, never the full 100-char name.
		expect(dataLine.slice(0, 24).trim().length).toBeLessThanOrEqual(24);
		expect(dataLine).toContain("…");
	});
});
