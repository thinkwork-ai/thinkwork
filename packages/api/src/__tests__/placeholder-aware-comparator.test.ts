/**
 * Tests for Unit 10 — the placeholder-aware comparator.
 *
 * This is the single most bug-prone piece of the migration. A
 * false-positive `fork` classification deletes an operator's real
 * customization; a false-negative leaves forked copies in S3 forever
 * and the overlay model never holds.
 */

import { describe, it, expect } from "vitest";
import {
	AMBIGUOUS_AGENT_NAMES,
	classifyAgentFile,
	isAmbiguousAgentName,
} from "../lib/placeholder-aware-comparator.js";

const MARCO_VALUES = {
	AGENT_NAME: "Marco",
	TENANT_NAME: "Acme",
	HUMAN_NAME: "Eric Odom",
	HUMAN_EMAIL: "eric@acme.com",
	HUMAN_TITLE: null,
	HUMAN_TIMEZONE: null,
	HUMAN_PRONOUNS: null,
};

describe("isAmbiguousAgentName", () => {
	it("flags the shortlist regardless of casing", () => {
		for (const name of AMBIGUOUS_AGENT_NAMES) {
			expect(isAmbiguousAgentName(name)).toBe(true);
			expect(isAmbiguousAgentName(name.toUpperCase())).toBe(true);
		}
	});

	it("returns false for distinctive names", () => {
		expect(isAmbiguousAgentName("Marco")).toBe(false);
		expect(isAmbiguousAgentName("Exec-Helper-3")).toBe(false);
		expect(isAmbiguousAgentName("Finny")).toBe(false);
	});

	it("handles null / empty", () => {
		expect(isAmbiguousAgentName(null)).toBe(false);
		expect(isAmbiguousAgentName(undefined)).toBe(false);
		expect(isAmbiguousAgentName("")).toBe(false);
	});
});

describe("classifyAgentFile", () => {
	it("classifies a bootstrap fork as 'fork' when the rendered template matches the agent content", () => {
		const template = "# Identity\nYour name is {{AGENT_NAME}}.";
		const agentContent = "# Identity\nYour name is Marco.";
		const result = classifyAgentFile({
			agentContent,
			templateContent: template,
			values: MARCO_VALUES,
			agentName: "Marco",
		});
		expect(result.kind).toBe("fork");
		expect(result.byteDelta).toBe(0);
	});

	it("classifies meaningful differences as 'override'", () => {
		const template = "# Identity\nYour name is {{AGENT_NAME}}.";
		const agentContent =
			"# Identity\nYour name is Marco and your job is to sell cars.";
		const result = classifyAgentFile({
			agentContent,
			templateContent: template,
			values: MARCO_VALUES,
			agentName: "Marco",
		});
		expect(result.kind).toBe("override");
		expect(result.byteDelta).toBeGreaterThan(0);
	});

	it("flags ambiguous-name agents even on exact match", () => {
		const template = "# Identity\nYour name is {{AGENT_NAME}}.";
		// The bootstrap would have rendered to "Your name is Assistant."
		// but an operator could plausibly have hand-written that same
		// sentence. Don't auto-delete.
		const agentContent = "# Identity\nYour name is Assistant.";
		const result = classifyAgentFile({
			agentContent,
			templateContent: template,
			values: { ...MARCO_VALUES, AGENT_NAME: "Assistant" },
			agentName: "Assistant",
		});
		expect(result.kind).toBe("review-required");
		expect(result.byteDelta).toBe(0);
	});

	it("treats files missing from the template as 'no-template' (agent-only override)", () => {
		const result = classifyAgentFile({
			agentContent: "# Ad-hoc notes\nDraft.",
			templateContent: null,
			values: MARCO_VALUES,
			agentName: "Marco",
		});
		expect(result.kind).toBe("no-template");
	});

	it("tolerates trailing-whitespace churn between template render and agent S3 bytes", () => {
		const template = "# Identity\nYour name is {{AGENT_NAME}}.\n";
		// Agent S3 got the file with some editors' trailing newlines
		// trimmed / added — same content otherwise.
		const agentContent = "# Identity\nYour name is Marco.\n\n\n";
		const result = classifyAgentFile({
			agentContent,
			templateContent: template,
			values: MARCO_VALUES,
			agentName: "Marco",
		});
		expect(result.kind).toBe("fork");
	});

	it("substitutes all provided values, not just AGENT_NAME", () => {
		const template =
			"Human: {{HUMAN_NAME}} at {{HUMAN_EMAIL}} — agent {{AGENT_NAME}}";
		const agentContent = "Human: Eric Odom at eric@acme.com — agent Marco";
		const result = classifyAgentFile({
			agentContent,
			templateContent: template,
			values: MARCO_VALUES,
			agentName: "Marco",
		});
		expect(result.kind).toBe("fork");
	});

	it("classifies a null agent content as 'fork' against empty template", () => {
		const result = classifyAgentFile({
			agentContent: null,
			templateContent: "",
			values: MARCO_VALUES,
			agentName: "Marco",
		});
		expect(result.kind).toBe("fork");
		expect(result.byteDelta).toBe(0);
	});

	it("does not confuse a substituted-byte-match with a random match — partial differences still mark override", () => {
		const template = "Hello {{AGENT_NAME}}, your human is {{HUMAN_NAME}}.";
		// Agent content has Marco + Eric substituted BUT with extra prose
		// tacked on. Should classify as override even though the prefix
		// matches the rendered template.
		const agentContent =
			"Hello Marco, your human is Eric Odom.\n\nExtra operator notes here.";
		const result = classifyAgentFile({
			agentContent,
			templateContent: template,
			values: MARCO_VALUES,
			agentName: "Marco",
		});
		expect(result.kind).toBe("override");
	});

	it("reports a byteDelta for overrides that the report can surface", () => {
		const template = "a";
		const agentContent = "abc";
		const result = classifyAgentFile({
			agentContent,
			templateContent: template,
			values: MARCO_VALUES,
			agentName: "Marco",
		});
		expect(result.kind).toBe("override");
		expect(result.byteDelta).toBe(2);
	});
});
