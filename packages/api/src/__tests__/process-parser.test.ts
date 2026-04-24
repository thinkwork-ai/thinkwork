/**
 * PRD-22: Process template parser unit tests.
 *
 * Tests PROCESS.md parsing, validation, and error handling.
 * Pure function — no DB deps needed.
 */

import { describe, it, expect } from "vitest";
import { parseProcessTemplate } from "../lib/orchestration/process-parser.js";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Helper: load the real example template ───────────────────────────────────

import { existsSync } from "fs";

const PROCESS_PATH = resolve(process.cwd(), "packages/skill-catalog/customer-onboarding/PROCESS.md");
const EXAMPLE_TEMPLATE = existsSync(PROCESS_PATH)
	? readFileSync(PROCESS_PATH, "utf-8")
	: null;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("parseProcessTemplate", () => {
	describe.skipIf(!EXAMPLE_TEMPLATE)("valid templates", () => {
		it("parses the customer-onboarding example template", () => {
			const result = parseProcessTemplate(EXAMPLE_TEMPLATE!);

			expect(result.title).toBe("Customer Onboarding Process");
			expect(result.config.triggerChannel).toBe("onboarding");
			expect(result.config.maxConcurrentSteps).toBe(3);
			expect(result.steps).toHaveLength(5);
		});

		it("extracts step IDs and titles", () => {
			const result = parseProcessTemplate(EXAMPLE_TEMPLATE!);

			expect(result.steps[0].id).toBe("step-1");
			expect(result.steps[0].title).toBe("Send Welcome Email");
			expect(result.steps[4].id).toBe("step-5");
			expect(result.steps[4].title).toBe("Schedule Kickoff Call");
		});

		it("parses step dependencies", () => {
			const result = parseProcessTemplate(EXAMPLE_TEMPLATE!);

			expect(result.steps[0].dependsOn).toEqual([]);
			expect(result.steps[1].dependsOn).toEqual([]);
			expect(result.steps[2].dependsOn).toEqual(["step-1"]);
			expect(result.steps[3].dependsOn).toEqual(["step-3"]);
			expect(result.steps[4].dependsOn).toEqual(["step-2", "step-3"]);
		});

		it("parses gate types", () => {
			const result = parseProcessTemplate(EXAMPLE_TEMPLATE!);

			expect(result.steps[0].gate).toBe("none");
			expect(result.steps[2].gate).toBe("human");
			expect(result.steps[2].gatePollInterval).toBe("24h");
		});

		it("parses assignee template variables", () => {
			const result = parseProcessTemplate(EXAMPLE_TEMPLATE!);

			expect(result.steps[0].assignee).toBe("{{current_agent}}");
		});

		it("parses multi-line instructions", () => {
			const result = parseProcessTemplate(EXAMPLE_TEMPLATE!);

			expect(result.steps[0].instructions).toContain("Draft and send a personalized welcome email");
			expect(result.steps[0].instructions).toContain("Mark this thread DONE");
		});

		it("dedents instructions consistently", () => {
			const result = parseProcessTemplate(EXAMPLE_TEMPLATE!);

			// Instructions should not have leading whitespace from the markdown indentation
			const firstLine = result.steps[0].instructions.split("\n")[0];
			expect(firstLine).not.toMatch(/^\s/);
		});
	});

	describe("minimal templates", () => {
		it("handles empty Steps section", () => {
			const md = "# My Process\n\n## Config\n\n## Steps\n";
			const result = parseProcessTemplate(md);

			expect(result.title).toBe("My Process");
			expect(result.steps).toEqual([]);
		});

		it("handles missing Config section", () => {
			const md = `# My Process

## Steps

### step-1: Do Thing
- assignee: {{current_agent}}
- instructions: |
    Do the thing.
`;
			const result = parseProcessTemplate(md);

			expect(result.config).toEqual({});
			expect(result.steps).toHaveLength(1);
		});

		it("handles missing Steps section", () => {
			const md = "# My Process\n\n## Config\n- trigger_channel: test\n";
			const result = parseProcessTemplate(md);

			expect(result.config.triggerChannel).toBe("test");
			expect(result.steps).toEqual([]);
		});

		it("defaults missing optional fields", () => {
			const md = `# Test

## Steps

### step-1: Minimal Step
- instructions: |
    Just do it.
`;
			const result = parseProcessTemplate(md);
			const step = result.steps[0];

			expect(step.assignee).toBe("{{current_agent}}");
			expect(step.gate).toBe("none");
			expect(step.dependsOn).toEqual([]);
			expect(step.gatePollInterval).toBeUndefined();
		});

		it("handles title without H1", () => {
			const md = "## Steps\n\n### step-1: Thing\n- instructions: |\n    Do it.\n";
			const result = parseProcessTemplate(md);

			expect(result.title).toBe("Untitled Process");
		});
	});

	describe("validation errors", () => {
		it("throws on duplicate step IDs", () => {
			const md = `# Test

## Steps

### step-1: First
- instructions: |
    Do first.

### step-1: Duplicate
- instructions: |
    Do second.
`;
			expect(() => parseProcessTemplate(md)).toThrow('Duplicate step ID: "step-1"');
		});

		it("throws on dependency referencing non-existent step", () => {
			const md = `# Test

## Steps

### step-1: First
- depends_on: [step-99]
- instructions: |
    Do it.
`;
			expect(() => parseProcessTemplate(md)).toThrow(
				'Step "step-1" depends on "step-99" which does not exist',
			);
		});

		it("throws on circular dependency (direct)", () => {
			const md = `# Test

## Steps

### step-a: A
- depends_on: [step-b]
- instructions: |
    A.

### step-b: B
- depends_on: [step-a]
- instructions: |
    B.
`;
			expect(() => parseProcessTemplate(md)).toThrow("Circular dependency detected");
		});

		it("throws on circular dependency (indirect)", () => {
			const md = `# Test

## Steps

### step-a: A
- depends_on: [step-c]
- instructions: |
    A.

### step-b: B
- depends_on: [step-a]
- instructions: |
    B.

### step-c: C
- depends_on: [step-b]
- instructions: |
    C.
`;
			expect(() => parseProcessTemplate(md)).toThrow("Circular dependency detected");
		});
	});

	describe("edge cases", () => {
		it("preserves template variables in assignee", () => {
			const md = `# Test

## Steps

### step-1: Thing
- assignee: sales-agent
- instructions: |
    Do it.
`;
			const result = parseProcessTemplate(md);
			expect(result.steps[0].assignee).toBe("sales-agent");
		});

		it("handles step with no instructions", () => {
			const md = `# Test

## Steps

### step-1: Thing
- assignee: {{current_agent}}
- priority: high
`;
			const result = parseProcessTemplate(md);
			expect(result.steps[0].instructions).toBe("");
		});

		it("stops parsing at next H2 after Steps", () => {
			const md = `# Test

## Steps

### step-1: Real Step
- instructions: |
    Do it.

## Some Other Section

### not-a-step: Should Be Ignored
- instructions: |
    This is not a step.
`;
			const result = parseProcessTemplate(md);
			expect(result.steps).toHaveLength(1);
			expect(result.steps[0].id).toBe("step-1");
		});
	});
});
