import { describe, expect, it } from "vitest";
import {
	mergeLegacyRouterSkillsIntoAgentsMd,
	parseLegacyRouterSkillRows,
} from "../handlers/backfill-router-skills-to-agents-md.js";

describe("parseLegacyRouterSkillRows", () => {
	it("extracts concrete legacy skills and ignores all/per-job sentinels", () => {
		const rows = parseLegacyRouterSkillRows(`# Router

## default
- load: SOUL.md
- skills: all

## email
- load: docs/email.md
- skills: agent-email-send, google-email

## scheduled
- load: docs/jobs.md
- skills: per-job
`);

		expect(rows).toEqual([
			{ profile: "email", skills: ["agent-email-send", "google-email"] },
		]);
	});
});

describe("mergeLegacyRouterSkillsIntoAgentsMd", () => {
	it("adds a General row when AGENTS.md has no routing table", () => {
		const merged = mergeLegacyRouterSkillsIntoAgentsMd("# AGENTS.md\n", [
			{ profile: "default", skills: ["triage", "tag"] },
			{ profile: "email", skills: ["agent-email-send", "tag"] },
		]);

		expect(merged.changed).toBe(true);
		expect(merged.content).toContain("| General | ./ | CONTEXT.md | tag,triage |");
		expect(merged.content).toContain("| email | ./ | CONTEXT.md | agent-email-send,tag |");
	});

	it("merges legacy skills into an existing profile row", () => {
		const existing = `# AGENTS.md

## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| General | ./ | CONTEXT.md | existing |
`;
		const merged = mergeLegacyRouterSkillsIntoAgentsMd(existing, [
			{ profile: "default", skills: ["triage", "existing"] },
		]);

		expect(merged.changed).toBe(true);
		expect(merged.content).toContain("| General | ./ | CONTEXT.md | existing,triage |");
	});

	it("is idempotent for rows it already inserted", () => {
		const first = mergeLegacyRouterSkillsIntoAgentsMd("# AGENTS.md\n", [
			{ profile: "email", skills: ["agent-email-send"] },
		]);
		const second = mergeLegacyRouterSkillsIntoAgentsMd(first.content, [
			{ profile: "email", skills: ["agent-email-send"] },
		]);

		expect(first.changed).toBe(true);
		expect(second.changed).toBe(false);
	});
});
