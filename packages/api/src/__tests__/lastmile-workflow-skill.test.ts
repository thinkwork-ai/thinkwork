/**
 * `validateWorkflowSkill` — pure-function coverage for the workflow-skill
 * dispatcher used by `syncExternalTaskOnCreate` and
 * `fetchWorkflowSkillForAgent`. This is the decision point that picks
 * between the dynamic (workflow-specific) task-create path and the
 * legacy fallback, so the branches are load-bearing.
 *
 * Schema-version mismatch is the main forward-compat guardrail — when
 * LastMile bumps `schemaVersion` without coordinating a release, we
 * want to cleanly degrade to the legacy form rather than ship a
 * malformed payload.
 */

import { describe, expect, it } from "vitest";
import {
	SUPPORTED_WORKFLOW_SKILL_SCHEMA_VERSION,
	validateWorkflowSkill,
} from "../integrations/external-work-items/providers/lastmile/restClient.js";

const WELL_FORMED_FORM = {
	id: "eng_task_intake",
	title: "Engineering task",
	fields: [
		{ id: "description", label: "Description", type: "textarea" },
		{
			id: "severity",
			label: "Severity",
			type: "select",
			options: [
				{ value: "sev1", label: "SEV 1" },
				{ value: "sev2", label: "SEV 2" },
			],
		},
	],
};

describe("validateWorkflowSkill", () => {
	it("treats missing skill as absent (fallback)", () => {
		expect(validateWorkflowSkill(null)).toEqual({ ok: false, reason: "absent" });
		expect(validateWorkflowSkill(undefined)).toEqual({
			ok: false,
			reason: "absent",
		});
	});

	it("rejects non-object skill", () => {
		expect(validateWorkflowSkill("nope")).toEqual({
			ok: false,
			reason: "not_object",
		});
	});

	it("rejects a schemaVersion this client doesn't understand", () => {
		const result = validateWorkflowSkill({
			schemaVersion: SUPPORTED_WORKFLOW_SKILL_SCHEMA_VERSION + 1,
			form: WELL_FORMED_FORM,
		});
		expect(result).toEqual({ ok: false, reason: "unknown_schema_version" });
	});

	it("accepts a skill with instructions and no form (agent asks conversationally)", () => {
		const result = validateWorkflowSkill({
			schemaVersion: SUPPORTED_WORKFLOW_SKILL_SCHEMA_VERSION,
			instructions: "Be concise.",
		});
		expect(result.ok).toBe(true);
	});

	it("accepts a skill with a well-formed form", () => {
		const result = validateWorkflowSkill({
			schemaVersion: SUPPORTED_WORKFLOW_SKILL_SCHEMA_VERSION,
			form: WELL_FORMED_FORM,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.skill.form?.id).toBe("eng_task_intake");
			expect(result.skill.form?.fields).toHaveLength(2);
		}
	});

	it("rejects a form missing an id", () => {
		const result = validateWorkflowSkill({
			schemaVersion: SUPPORTED_WORKFLOW_SKILL_SCHEMA_VERSION,
			form: { ...WELL_FORMED_FORM, id: undefined },
		});
		expect(result).toEqual({ ok: false, reason: "invalid_form" });
	});

	it("rejects a form with an empty fields array", () => {
		const result = validateWorkflowSkill({
			schemaVersion: SUPPORTED_WORKFLOW_SKILL_SCHEMA_VERSION,
			form: { ...WELL_FORMED_FORM, fields: [] },
		});
		expect(result).toEqual({ ok: false, reason: "invalid_form" });
	});

	it("accepts a skill with both instructions and form", () => {
		const result = validateWorkflowSkill({
			schemaVersion: SUPPORTED_WORKFLOW_SKILL_SCHEMA_VERSION,
			instructions: "Echo key fields.",
			form: WELL_FORMED_FORM,
		});
		expect(result.ok).toBe(true);
	});
});
