/**
 * Integration: admin catalog "Run now" hits the startSkillRun mutation with
 * invocationSource="catalog". Production path lands via GraphQL; the harness
 * exercises the shape through startRun() with invocationSource="catalog".
 */

import { describe, it, expect } from "vitest";
import { createHarness } from "./_harness";

describe("integration: admin catalog Run-now", () => {
	it("records invocation_source=catalog and lets the admin see the run row", async () => {
		const h = createHarness({ invokerUserId: "admin-1" });
		h.agentcore.setScript(async () => ({
			ok: true,
			deliverable: { format: "sales_brief" },
		}));

		const result = await h.startRun({
			skillId: "sales-prep",
			invocationSource: "catalog",
			agentId: "agent-xyz",
			inputs: { customer: "XYZ Corp", meeting_date: "2026-05-20" },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const row = h.runs.byId(result.runId);
		expect(row).toBeDefined();
		expect(row?.invocation_source).toBe("catalog");
		expect(row?.invoker_user_id).toBe("admin-1");
		expect(row?.status).toBe("complete");
	});
});
