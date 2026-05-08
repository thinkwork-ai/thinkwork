import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	enumerateAnchors,
	getJsonBody,
	isUnrecoverableS3Error,
} from "../src/s3";

/**
 * Mock S3Client with a programmable `send` queue. Each `send` call
 * pops the next prepared response so we can simulate
 *   - single-page results
 *   - multi-page results (IsTruncated + NextContinuationToken)
 *   - empty buckets
 *   - GetObject body decoding
 */
function mockS3(responses: unknown[]) {
	const queue = [...responses];
	const send = vi.fn(async (_cmd: unknown) => {
		if (queue.length === 0) {
			throw new Error("mockS3: send called more times than responses queued");
		}
		const next = queue.shift();
		if (next instanceof Error) throw next;
		return next;
	});
	return { send } as unknown as Parameters<typeof enumerateAnchors>[0];
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const x of iter) out.push(x);
	return out;
}

describe("enumerateAnchors — pagination", () => {
	it("yields a single page when IsTruncated is false", async () => {
		const s3 = mockS3([
			{
				Contents: [
					{
						Key: "anchors/cadence-a.json",
						LastModified: new Date("2026-05-07T10:00:00.000Z"),
					},
					{
						Key: "anchors/cadence-b.json",
						LastModified: new Date("2026-05-07T10:15:00.000Z"),
					},
				],
				IsTruncated: false,
			},
		]);
		const results = await collect(enumerateAnchors(s3, { bucket: "test" }));
		expect(results).toHaveLength(2);
		expect(results[0].key).toBe("anchors/cadence-a.json");
		expect(results[1].key).toBe("anchors/cadence-b.json");
	});

	it("paginates across multiple ListObjectsV2 calls when IsTruncated is true", async () => {
		// **Critical test**: failure here means a 35k-anchor bucket is
		// silently truncated to its first 1000 entries.
		const s3 = mockS3([
			{
				Contents: [
					{
						Key: "anchors/cadence-page1.json",
						LastModified: new Date("2026-05-07T10:00:00.000Z"),
					},
				],
				IsTruncated: true,
				NextContinuationToken: "token-abc",
			},
			{
				Contents: [
					{
						Key: "anchors/cadence-page2.json",
						LastModified: new Date("2026-05-07T10:15:00.000Z"),
					},
				],
				IsTruncated: false,
			},
		]);
		const results = await collect(enumerateAnchors(s3, { bucket: "test" }));
		expect(results.map((r) => r.key)).toEqual([
			"anchors/cadence-page1.json",
			"anchors/cadence-page2.json",
		]);
		// Verify pagination call count.
		expect(
			(s3 as unknown as { send: { mock: { calls: unknown[][] } } }).send.mock
				.calls.length,
		).toBe(2);
		// Second call must carry the ContinuationToken.
		const secondCallInput = (
			s3 as unknown as { send: { mock: { calls: unknown[][] } } }
		).send.mock.calls[1][0] as { input: { ContinuationToken?: string } };
		expect(secondCallInput.input.ContinuationToken).toBe("token-abc");
	});

	it("paginates across THREE pages without losing anchors", async () => {
		const s3 = mockS3([
			{
				Contents: [
					{
						Key: "anchors/p1.json",
						LastModified: new Date("2026-01-01T00:00:00.000Z"),
					},
				],
				IsTruncated: true,
				NextContinuationToken: "t1",
			},
			{
				Contents: [
					{
						Key: "anchors/p2.json",
						LastModified: new Date("2026-02-01T00:00:00.000Z"),
					},
				],
				IsTruncated: true,
				NextContinuationToken: "t2",
			},
			{
				Contents: [
					{
						Key: "anchors/p3.json",
						LastModified: new Date("2026-03-01T00:00:00.000Z"),
					},
				],
				IsTruncated: false,
			},
		]);
		const results = await collect(enumerateAnchors(s3, { bucket: "test" }));
		expect(results.map((r) => r.key)).toEqual([
			"anchors/p1.json",
			"anchors/p2.json",
			"anchors/p3.json",
		]);
	});

	it("returns nothing when the bucket has no anchor objects", async () => {
		const s3 = mockS3([{ Contents: [], IsTruncated: false }]);
		const results = await collect(enumerateAnchors(s3, { bucket: "test" }));
		expect(results).toEqual([]);
	});

	it("handles undefined Contents on empty bucket (SDK quirk)", async () => {
		const s3 = mockS3([{ IsTruncated: false }]);
		const results = await collect(enumerateAnchors(s3, { bucket: "test" }));
		expect(results).toEqual([]);
	});
});

describe("enumerateAnchors — time-range scoping (R5: [since, until))", () => {
	const sample = [
		{
			Key: "anchors/april.json",
			LastModified: new Date("2026-04-15T12:00:00.000Z"),
		},
		{
			Key: "anchors/may1.json",
			LastModified: new Date("2026-05-01T00:00:00.000Z"),
		},
		{
			Key: "anchors/may15.json",
			LastModified: new Date("2026-05-15T12:00:00.000Z"),
		},
		{
			Key: "anchors/may31.json",
			LastModified: new Date("2026-05-31T23:59:59.000Z"),
		},
		{
			Key: "anchors/june1.json",
			LastModified: new Date("2026-06-01T00:00:00.000Z"),
		},
	];

	it("--since 2026-05-01 --until 2026-06-01 yields May only (inclusive start, exclusive end)", async () => {
		const s3 = mockS3([{ Contents: sample, IsTruncated: false }]);
		const results = await collect(
			enumerateAnchors(s3, {
				bucket: "test",
				since: new Date("2026-05-01T00:00:00.000Z"),
				until: new Date("2026-06-01T00:00:00.000Z"),
			}),
		);
		expect(results.map((r) => r.key)).toEqual([
			"anchors/may1.json", // exactly at since boundary — INCLUDED
			"anchors/may15.json",
			"anchors/may31.json",
			// "anchors/june1.json" is at the until boundary — EXCLUDED
		]);
	});

	it("--since only includes everything from the boundary forward", async () => {
		const s3 = mockS3([{ Contents: sample, IsTruncated: false }]);
		const results = await collect(
			enumerateAnchors(s3, {
				bucket: "test",
				since: new Date("2026-05-15T00:00:00.000Z"),
			}),
		);
		expect(results.map((r) => r.key)).toEqual([
			"anchors/may15.json",
			"anchors/may31.json",
			"anchors/june1.json",
		]);
	});

	it("--until only includes everything before the boundary", async () => {
		const s3 = mockS3([{ Contents: sample, IsTruncated: false }]);
		const results = await collect(
			enumerateAnchors(s3, {
				bucket: "test",
				until: new Date("2026-05-01T00:00:00.000Z"),
			}),
		);
		expect(results.map((r) => r.key)).toEqual(["anchors/april.json"]);
	});
});

describe("getJsonBody", () => {
	it("decodes a UTF-8 JSON body", async () => {
		const body = {
			transformToString: async (encoding: string) => {
				expect(encoding).toBe("utf-8");
				return JSON.stringify({ schema_version: 1, hello: "world" });
			},
		};
		const s3 = mockS3([{ Body: body }]);
		const result = await getJsonBody(
			s3 as unknown as Parameters<typeof getJsonBody>[0],
			"bucket",
			"key",
		);
		expect(result).toEqual({ schema_version: 1, hello: "world" });
	});

	it("throws on empty body with the offending key in the message", async () => {
		const s3 = mockS3([{}]);
		await expect(
			getJsonBody(
				s3 as unknown as Parameters<typeof getJsonBody>[0],
				"bucket",
				"anchors/cadence-x.json",
			),
		).rejects.toThrow(/anchors\/cadence-x\.json/);
	});

	it("throws on non-JSON body with the offending key in the message", async () => {
		const body = {
			transformToString: async () => "this is not JSON",
		};
		const s3 = mockS3([{ Body: body }]);
		await expect(
			getJsonBody(
				s3 as unknown as Parameters<typeof getJsonBody>[0],
				"bucket",
				"anchors/cadence-y.json",
			),
		).rejects.toThrow(/anchors\/cadence-y\.json/);
	});
});

describe("isUnrecoverableS3Error", () => {
	it("identifies AccessDenied as unrecoverable", () => {
		const err = Object.assign(new Error("denied"), { name: "AccessDenied" });
		expect(isUnrecoverableS3Error(err)).toBe(true);
	});

	it("identifies NoSuchBucket as unrecoverable", () => {
		const err = Object.assign(new Error("missing"), { name: "NoSuchBucket" });
		expect(isUnrecoverableS3Error(err)).toBe(true);
	});

	it("does NOT classify a generic network error as unrecoverable", () => {
		const err = Object.assign(new Error("ETIMEDOUT"), { name: "TimeoutError" });
		expect(isUnrecoverableS3Error(err)).toBe(false);
	});

	it("handles non-error inputs gracefully", () => {
		expect(isUnrecoverableS3Error(undefined)).toBe(false);
		expect(isUnrecoverableS3Error(null)).toBe(false);
		expect(isUnrecoverableS3Error("string")).toBe(false);
	});
});
