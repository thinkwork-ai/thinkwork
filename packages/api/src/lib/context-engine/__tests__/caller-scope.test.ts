import { describe, expect, it } from "vitest";
import type { ContextEngineCaller } from "../types.js";

describe("Context Engine caller scope", () => {
	it("carries explicit tenant and optional user/agent identity", () => {
		const caller: ContextEngineCaller = {
			tenantId: "tenant-1",
			userId: "user-1",
			agentId: "agent-1",
			traceId: "trace-1",
		};

		expect(caller).toMatchObject({
			tenantId: "tenant-1",
			userId: "user-1",
			agentId: "agent-1",
			traceId: "trace-1",
		});
	});
});
