/**
 * Unit tests for the U11.U3 compliance-export-runner pure helpers.
 *
 * DB- and S3-backed integration coverage (CAS guard happy path + multi-row
 * stream → S3 fixture verification) lives in
 * `__tests__/integration/compliance-export-runner.integration.test.ts`
 * which skips when DATABASE_URL is unset (CI test job has no Aurora creds).
 *
 * This file exercises the in-process logic that doesn't need network:
 *   - CSV escape semantics (RFC 4180 quoting)
 *   - CSV row formatter (column ordering + payload JSON quoting)
 *   - NDJSON row formatter (one JSON object per line)
 *   - Events SQL filter builder (per-filter param shape, tenant scope,
 *     ALL_TENANTS_SENTINEL behavior, GraphQL→DB event-type codec)
 *   - S3 key generator (per-tenant prefix, multi-tenant prefix, file ext)
 *   - SQS body parser (uuid validation, bad JSON handling)
 */

import { describe, it, expect } from "vitest";
import { _internals } from "../compliance-export-runner.js";

const TENANT_A = "11111111-1111-7111-8111-aaaaaaaaaaaa";
const ALL_TENANTS = "00000000-0000-0000-0000-000000000000";
const ACTOR_ID = "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa";

const baseRow = {
	event_id: "11111111-1111-7111-8111-eeeeeeeeeeee",
	tenant_id: TENANT_A,
	occurred_at: "2026-05-08T00:00:00.000000+00:00",
	recorded_at: "2026-05-08T00:00:00.500000+00:00",
	actor: "alice@acme.example",
	actor_type: "user",
	source: "graphql",
	event_type: "agent.created",
	event_hash: "a".repeat(64),
	prev_hash: "b".repeat(64),
	payload: { foo: "bar" },
};

describe("csvEscape", () => {
	it("returns plain values unchanged", () => {
		expect(_internals.csvEscape("hello")).toBe("hello");
		expect(_internals.csvEscape(42)).toBe("42");
		expect(_internals.csvEscape(true)).toBe("true");
	});

	it("returns empty string for null/undefined", () => {
		expect(_internals.csvEscape(null)).toBe("");
		expect(_internals.csvEscape(undefined)).toBe("");
	});

	it("quotes values containing comma", () => {
		expect(_internals.csvEscape("a,b")).toBe('"a,b"');
	});

	it("quotes values containing double-quote and doubles internal quotes", () => {
		expect(_internals.csvEscape('say "hi"')).toBe('"say ""hi"""');
	});

	it("quotes values containing newline or carriage return", () => {
		expect(_internals.csvEscape("a\nb")).toBe('"a\nb"');
		expect(_internals.csvEscape("a\rb")).toBe('"a\rb"');
	});
});

describe("rowToCsv", () => {
	it("produces a comma-joined row terminated by \\n", () => {
		const csv = _internals.rowToCsv(baseRow);
		expect(csv.endsWith("\n")).toBe(true);
		const cells = csv.replace(/\n$/, "").split(",");
		expect(cells.length).toBe(_internals.CSV_HEADER.length);
		expect(cells[0]).toBe(baseRow.event_id);
		expect(cells[1]).toBe(baseRow.tenant_id);
		expect(cells[7]).toBe(baseRow.event_type);
	});

	it("renders payload as quoted JSON when it contains commas", () => {
		const csv = _internals.rowToCsv({
			...baseRow,
			payload: { a: 1, b: 2 },
		});
		// payload is the last column; should be quoted because JSON contains commas
		expect(csv).toMatch(/"\{""a"":1,""b"":2\}"/);
	});

	it("emits empty payload column for null payload", () => {
		const csv = _internals.rowToCsv({ ...baseRow, payload: null });
		const cells = csv.replace(/\n$/, "").split(",");
		expect(cells[cells.length - 1]).toBe("");
	});

	it("emits empty prev_hash column for null prev_hash (genesis row)", () => {
		const csv = _internals.rowToCsv({ ...baseRow, prev_hash: null });
		const cells = csv.replace(/\n$/, "").split(",");
		expect(cells[9]).toBe("");
	});
});

describe("rowToNdjson", () => {
	it("produces one valid JSON object per line", () => {
		const line = _internals.rowToNdjson(baseRow);
		expect(line.endsWith("\n")).toBe(true);
		const parsed = JSON.parse(line.replace(/\n$/, ""));
		expect(parsed.event_id).toBe(baseRow.event_id);
		expect(parsed.payload).toEqual(baseRow.payload);
		expect(parsed.prev_hash).toBe(baseRow.prev_hash);
	});

	it("preserves null payload + null prev_hash exactly", () => {
		const line = _internals.rowToNdjson({
			...baseRow,
			payload: null,
			prev_hash: null,
		});
		const parsed = JSON.parse(line.replace(/\n$/, ""));
		expect(parsed.payload).toBeNull();
		expect(parsed.prev_hash).toBeNull();
	});
});

describe("buildEventsQuery", () => {
	it("scopes to job tenant_id when not the all-tenants sentinel", () => {
		const { sql, params } = _internals.buildEventsQuery({
			job_id: "j1",
			tenant_id: TENANT_A,
			requested_by_actor_id: ACTOR_ID,
			filter: {},
			format: "csv",
			status: "running",
		});
		expect(sql).toMatch(/WHERE tenant_id = \$1::uuid/);
		expect(params).toEqual([TENANT_A]);
	});

	it("emits no tenant filter on the ALL_TENANTS sentinel with no filter override", () => {
		const { sql, params } = _internals.buildEventsQuery({
			job_id: "j1",
			tenant_id: ALL_TENANTS,
			requested_by_actor_id: ACTOR_ID,
			filter: {},
			format: "csv",
			status: "running",
		});
		expect(sql).not.toMatch(/WHERE/);
		expect(params).toEqual([]);
	});

	it("honors filter.tenantId override when job tenant is the sentinel", () => {
		const { sql, params } = _internals.buildEventsQuery({
			job_id: "j1",
			tenant_id: ALL_TENANTS,
			requested_by_actor_id: ACTOR_ID,
			filter: { tenantId: TENANT_A },
			format: "csv",
			status: "running",
		});
		expect(sql).toMatch(/tenant_id = \$1::uuid/);
		expect(params).toEqual([TENANT_A]);
	});

	it("translates GraphQL eventType (UPPER_UNDERSCORE) to DB form (lower.dotted)", () => {
		const { sql, params } = _internals.buildEventsQuery({
			job_id: "j1",
			tenant_id: TENANT_A,
			requested_by_actor_id: ACTOR_ID,
			filter: { eventType: "AGENT_CREATED" },
			format: "csv",
			status: "running",
		});
		expect(sql).toMatch(/event_type = \$2/);
		expect(params).toEqual([TENANT_A, "agent.created"]);
	});

	it("lower-cases actor_type to match DB enum form", () => {
		const { sql, params } = _internals.buildEventsQuery({
			job_id: "j1",
			tenant_id: TENANT_A,
			requested_by_actor_id: ACTOR_ID,
			filter: { actorType: "USER" },
			format: "csv",
			status: "running",
		});
		expect(sql).toMatch(/actor_type = \$2/);
		expect(params).toEqual([TENANT_A, "user"]);
	});

	it("renders since/until as half-open [since, until) bounds", () => {
		const { sql, params } = _internals.buildEventsQuery({
			job_id: "j1",
			tenant_id: TENANT_A,
			requested_by_actor_id: ACTOR_ID,
			filter: {
				since: "2026-05-01T00:00:00Z",
				until: "2026-05-08T00:00:00Z",
			},
			format: "csv",
			status: "running",
		});
		expect(sql).toMatch(/occurred_at >= \$2::timestamptz/);
		expect(sql).toMatch(/occurred_at < \$3::timestamptz/);
		expect(params).toEqual([
			TENANT_A,
			"2026-05-01T00:00:00Z",
			"2026-05-08T00:00:00Z",
		]);
	});
});

describe("objectKeyForJob", () => {
	it("uses tenantId/jobId.csv for tenant-scoped CSV jobs", () => {
		expect(
			_internals.objectKeyForJob({
				job_id: "JOB1",
				tenant_id: TENANT_A,
				requested_by_actor_id: ACTOR_ID,
				filter: {},
				format: "csv",
				status: "running",
			}),
		).toBe(`${TENANT_A}/JOB1.csv`);
	});

	it("uses multi-tenant/jobId.ndjson for sentinel + JSON jobs", () => {
		expect(
			_internals.objectKeyForJob({
				job_id: "JOB2",
				tenant_id: ALL_TENANTS,
				requested_by_actor_id: ACTOR_ID,
				filter: {},
				format: "json",
				status: "running",
			}),
		).toBe("multi-tenant/JOB2.ndjson");
	});
});

describe("parseMessageBody", () => {
	const validJobId = "11111111-1111-7111-8111-aaaaaaaaaaaa";

	it("accepts a well-formed body", () => {
		expect(
			_internals.parseMessageBody({
				messageId: "m1",
				receiptHandle: "r1",
				body: JSON.stringify({ jobId: validJobId }),
			}),
		).toEqual({ jobId: validJobId });
	});

	it("rejects non-JSON body", () => {
		expect(() =>
			_internals.parseMessageBody({
				messageId: "m1",
				receiptHandle: "r1",
				body: "not json",
			}),
		).toThrow(/malformed SQS body — not JSON/);
	});

	it("rejects body missing jobId", () => {
		expect(() =>
			_internals.parseMessageBody({
				messageId: "m1",
				receiptHandle: "r1",
				body: JSON.stringify({ id: validJobId }),
			}),
		).toThrow(/expected \{jobId: <uuid>\}/);
	});

	it("rejects body with non-uuid jobId", () => {
		expect(() =>
			_internals.parseMessageBody({
				messageId: "m1",
				receiptHandle: "r1",
				body: JSON.stringify({ jobId: "not-a-uuid" }),
			}),
		).toThrow(/expected \{jobId: <uuid>\}/);
	});

	it("rejects null body", () => {
		expect(() =>
			_internals.parseMessageBody({
				messageId: "m1",
				receiptHandle: "r1",
				body: "null",
			}),
		).toThrow(/expected \{jobId: <uuid>\}/);
	});
});
