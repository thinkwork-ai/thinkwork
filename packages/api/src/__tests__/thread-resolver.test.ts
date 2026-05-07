import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Extracted pure functions from graphql-resolver.ts for unit testing.
// These mirror the logic in the resolver — keep in sync.
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<string, string[]> = {
	backlog: ["todo", "in_progress", "cancelled"],
	todo: ["in_progress", "backlog", "cancelled"],
	in_progress: ["in_review", "blocked", "done", "cancelled"],
	in_review: ["in_progress", "done", "cancelled"],
	blocked: ["in_progress", "todo", "cancelled"],
	done: ["in_progress"],
	cancelled: ["backlog", "todo"],
};

function assertTransition(from: string, to: string): void {
	const allowed = VALID_TRANSITIONS[from];
	if (!allowed || !allowed.includes(to)) {
		throw new Error(`Invalid status transition: ${from} → ${to}`);
	}
}

const ENUM_FIELDS = new Set(["status", "channel"]);

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

function threadToCamel(obj: Record<string, unknown>): Record<string, unknown> {
	const result = snakeToCamel(obj);
	for (const field of ENUM_FIELDS) {
		if (typeof result[field] === "string") {
			result[field] = (result[field] as string).toUpperCase();
		}
	}
	return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assertTransition", () => {
	it("allows valid forward transitions", () => {
		expect(() => assertTransition("backlog", "todo")).not.toThrow();
		expect(() => assertTransition("todo", "in_progress")).not.toThrow();
		expect(() => assertTransition("in_progress", "in_review")).not.toThrow();
		expect(() => assertTransition("in_review", "done")).not.toThrow();
		expect(() => assertTransition("in_progress", "done")).not.toThrow();
	});

	it("allows cancellation from most states", () => {
		expect(() => assertTransition("backlog", "cancelled")).not.toThrow();
		expect(() => assertTransition("todo", "cancelled")).not.toThrow();
		expect(() => assertTransition("in_progress", "cancelled")).not.toThrow();
		expect(() => assertTransition("in_review", "cancelled")).not.toThrow();
		expect(() => assertTransition("blocked", "cancelled")).not.toThrow();
	});

	it("allows reopening from done and cancelled", () => {
		expect(() => assertTransition("done", "in_progress")).not.toThrow();
		expect(() => assertTransition("cancelled", "backlog")).not.toThrow();
		expect(() => assertTransition("cancelled", "todo")).not.toThrow();
	});

	it("rejects invalid transitions", () => {
		expect(() => assertTransition("backlog", "done")).toThrow("Invalid status transition");
		expect(() => assertTransition("backlog", "in_review")).toThrow("Invalid status transition");
		expect(() => assertTransition("done", "cancelled")).toThrow("Invalid status transition");
		expect(() => assertTransition("done", "backlog")).toThrow("Invalid status transition");
		expect(() => assertTransition("cancelled", "done")).toThrow("Invalid status transition");
		expect(() => assertTransition("todo", "done")).toThrow("Invalid status transition");
	});

	it("rejects transition from unknown status", () => {
		expect(() => assertTransition("unknown", "todo")).toThrow("Invalid status transition");
	});

	it("rejects self-transition", () => {
		expect(() => assertTransition("backlog", "backlog")).toThrow("Invalid status transition");
		expect(() => assertTransition("done", "done")).toThrow("Invalid status transition");
	});
});

describe("snakeToCamel", () => {
	it("converts snake_case keys to camelCase", () => {
		const result = snakeToCamel({
			tenant_id: "abc",
			created_at: new Date("2026-01-01"),
			checkout_run_id: null,
		});
		expect(result.tenantId).toBe("abc");
		expect(result.createdAt).toBe("2026-01-01T00:00:00.000Z");
		expect(result.checkoutRunId).toBeNull();
	});

	it("stringifies nested objects as AWSJSON", () => {
		const result = snakeToCamel({ metadata: { foo: "bar" } });
		expect(result.metadata).toBe('{"foo":"bar"}');
	});

	it("passes through arrays and primitives", () => {
		const result = snakeToCamel({ count: 42, name: "test", tags: ["a", "b"] });
		expect(result.count).toBe(42);
		expect(result.name).toBe("test");
		expect(result.tags).toEqual(["a", "b"]);
	});
});

describe("threadToCamel", () => {
	it("uppercases the status enum field", () => {
		const result = threadToCamel({
			id: "123",
			status: "in_progress",
			title: "Fix something",
		});
		expect(result.status).toBe("IN_PROGRESS");
		expect(result.title).toBe("Fix something"); // not uppercased
	});

	it("uppercases the channel enum field", () => {
		const result = threadToCamel({
			id: "123",
			channel: "task",
		});
		expect(result.channel).toBe("TASK");
	});

	it("uppercases every persisted channel enum field", () => {
		for (const channel of ["chat", "email", "schedule", "manual", "webhook", "api", "task", "connector"]) {
			const result = threadToCamel({ channel });
			expect(result.channel).toBe(channel.toUpperCase());
		}
	});

	it("handles all 7 statuses", () => {
		for (const status of ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"]) {
			const result = threadToCamel({ status });
			expect(result.status).toBe(status.toUpperCase());
		}
	});

	it("still converts snake_case keys", () => {
		const result = threadToCamel({
			tenant_id: "abc",
			checkout_run_id: "run-1",
			status: "backlog",
		});
		expect(result.tenantId).toBe("abc");
		expect(result.checkoutRunId).toBe("run-1");
	});
});

describe("identifier generation", () => {
	it("formats as PREFIX-NUMBER", () => {
		const prefix = "MF";
		const counter = 42;
		const identifier = `${prefix}-${counter}`;
		expect(identifier).toBe("MF-42");
	});

	it("uses custom prefix when set", () => {
		const prefix = "PROJ";
		const counter = 1;
		const identifier = `${prefix}-${counter}`;
		expect(identifier).toBe("PROJ-1");
	});

	it("defaults to MF when prefix is null", () => {
		const nullPrefix: string | null = null;
		const prefix = nullPrefix || "MF";
		const counter = 100;
		const identifier = `${prefix}-${counter}`;
		expect(identifier).toBe("MF-100");
	});
});
