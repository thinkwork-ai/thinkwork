import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Extracted pure functions from graphql-resolver.ts for unit testing.
// These mirror the logic in the resolver — keep in sync.
// ---------------------------------------------------------------------------

const INBOX_ITEM_TRANSITIONS: Record<string, string[]> = {
	pending: ["approved", "rejected", "revision_requested", "cancelled"],
	revision_requested: ["pending", "cancelled"],
};

function assertInboxItemTransition(from: string, to: string): void {
	const allowed = INBOX_ITEM_TRANSITIONS[from];
	if (!allowed || !allowed.includes(to)) {
		throw new Error(`Invalid inbox item transition: ${from} → ${to}`);
	}
}

const ENUM_FIELDS = new Set(["status", "priority", "type"]);

function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
		if (value instanceof Date) {
			result[camelKey] = value.toISOString();
		} else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			result[camelKey] = JSON.stringify(value);
		} else {
			result[camelKey] = value;
		}
	}
	return result;
}

function inboxItemToCamel(obj: Record<string, unknown>): Record<string, unknown> {
	const result = snakeToCamel(obj);
	if (typeof result.status === "string") {
		result.status = (result.status as string).toUpperCase();
	}
	if (!result.comments) result.comments = [];
	if (!result.links) result.links = [];
	if (!result.linkedThreads) result.linkedThreads = [];
	return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assertInboxItemTransition", () => {
	it("allows approve from pending", () => {
		expect(() => assertInboxItemTransition("pending", "approved")).not.toThrow();
	});

	it("allows reject from pending", () => {
		expect(() => assertInboxItemTransition("pending", "rejected")).not.toThrow();
	});

	it("allows revision_requested from pending", () => {
		expect(() => assertInboxItemTransition("pending", "revision_requested")).not.toThrow();
	});

	it("allows cancel from pending", () => {
		expect(() => assertInboxItemTransition("pending", "cancelled")).not.toThrow();
	});

	it("allows resubmit (→ pending) from revision_requested", () => {
		expect(() => assertInboxItemTransition("revision_requested", "pending")).not.toThrow();
	});

	it("allows cancel from revision_requested", () => {
		expect(() => assertInboxItemTransition("revision_requested", "cancelled")).not.toThrow();
	});

	it("rejects transition from approved (terminal state)", () => {
		expect(() => assertInboxItemTransition("approved", "pending")).toThrow("Invalid inbox item transition");
		expect(() => assertInboxItemTransition("approved", "rejected")).toThrow("Invalid inbox item transition");
	});

	it("rejects transition from rejected (terminal state)", () => {
		expect(() => assertInboxItemTransition("rejected", "pending")).toThrow("Invalid inbox item transition");
		expect(() => assertInboxItemTransition("rejected", "approved")).toThrow("Invalid inbox item transition");
	});

	it("rejects transition from cancelled (terminal state)", () => {
		expect(() => assertInboxItemTransition("cancelled", "pending")).toThrow("Invalid inbox item transition");
	});

	it("rejects invalid target from pending", () => {
		expect(() => assertInboxItemTransition("pending", "pending")).toThrow("Invalid inbox item transition");
		expect(() => assertInboxItemTransition("pending", "expired")).toThrow("Invalid inbox item transition");
	});

	it("rejects approve/reject from revision_requested (must resubmit first)", () => {
		expect(() => assertInboxItemTransition("revision_requested", "approved")).toThrow("Invalid inbox item transition");
		expect(() => assertInboxItemTransition("revision_requested", "rejected")).toThrow("Invalid inbox item transition");
	});

	it("rejects unknown source status", () => {
		expect(() => assertInboxItemTransition("unknown", "approved")).toThrow("Invalid inbox item transition");
	});

	it("supports full lifecycle: pending → revision_requested → pending → approved", () => {
		expect(() => assertInboxItemTransition("pending", "revision_requested")).not.toThrow();
		expect(() => assertInboxItemTransition("revision_requested", "pending")).not.toThrow();
		expect(() => assertInboxItemTransition("pending", "approved")).not.toThrow();
	});
});

describe("inboxItemToCamel", () => {
	it("uppercases status enum", () => {
		const result = inboxItemToCamel({
			id: "abc",
			status: "pending",
			tenant_id: "t1",
			revision: 1,
		});
		expect(result.status).toBe("PENDING");
		expect(result.tenantId).toBe("t1");
		expect(result.revision).toBe(1);
	});

	it("uppercases revision_requested status", () => {
		const result = inboxItemToCamel({ status: "revision_requested" });
		expect(result.status).toBe("REVISION_REQUESTED");
	});

	it("initializes empty arrays for nested fields", () => {
		const result = inboxItemToCamel({ status: "pending" });
		expect(result.comments).toEqual([]);
		expect(result.links).toEqual([]);
		expect(result.linkedThreads).toEqual([]);
	});

	it("preserves existing nested arrays", () => {
		const result = inboxItemToCamel({
			status: "approved",
			comments: [{ id: "c1" }],
		});
		// comments is an array, not an object, so it passes through
		expect(result.comments).toEqual([{ id: "c1" }]);
	});

	it("converts snake_case keys to camelCase", () => {
		const result = inboxItemToCamel({
			status: "approved",
			decided_by: "user-1",
			decided_at: new Date("2026-03-16T12:00:00Z"),
			review_notes: "Looks good",
			requester_type: "agent",
			requester_id: "a1",
			entity_type: "hire_agent",
			entity_id: "e1",
		});
		expect(result.decidedBy).toBe("user-1");
		expect(result.decidedAt).toBe("2026-03-16T12:00:00.000Z");
		expect(result.reviewNotes).toBe("Looks good");
		expect(result.requesterType).toBe("agent");
		expect(result.requesterId).toBe("a1");
		expect(result.entityType).toBe("hire_agent");
		expect(result.entityId).toBe("e1");
	});

	it("stringifies config as AWSJSON", () => {
		const result = inboxItemToCamel({
			status: "pending",
			config: { name: "Sales Bot", role: "SDR" },
		});
		expect(result.config).toBe('{"name":"Sales Bot","role":"SDR"}');
	});
});
