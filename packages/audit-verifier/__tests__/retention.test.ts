import { describe, expect, it, vi } from "vitest";
import { checkRetention } from "../src/retention";

function mockS3(send: (cmd: unknown) => unknown) {
	return { send: vi.fn(send) } as unknown as Parameters<typeof checkRetention>[0];
}

describe("checkRetention", () => {
	it("ok: GOVERNANCE mode + future RetainUntilDate", async () => {
		const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
		const s3 = mockS3(async () => ({
			Retention: { Mode: "GOVERNANCE", RetainUntilDate: future },
		}));
		const result = await checkRetention(s3, "bucket", "key");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.mode).toBe("GOVERNANCE");
		}
	});

	it("ok: COMPLIANCE mode + future RetainUntilDate", async () => {
		const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
		const s3 = mockS3(async () => ({
			Retention: { Mode: "COMPLIANCE", RetainUntilDate: future },
		}));
		const result = await checkRetention(s3, "bucket", "key");
		expect(result.ok).toBe(true);
	});

	it("missing: no Retention object on response", async () => {
		const s3 = mockS3(async () => ({}));
		const result = await checkRetention(s3, "bucket", "key");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("missing");
	});

	it("missing: NoSuchObjectLockConfiguration error", async () => {
		const s3 = mockS3(async () => {
			throw Object.assign(new Error("not configured"), {
				name: "NoSuchObjectLockConfiguration",
			});
		});
		const result = await checkRetention(s3, "bucket", "key");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("missing");
	});

	it("expired: RetainUntilDate already passed", async () => {
		const past = new Date(Date.now() - 1000);
		const s3 = mockS3(async () => ({
			Retention: { Mode: "GOVERNANCE", RetainUntilDate: past },
		}));
		const result = await checkRetention(s3, "bucket", "key");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("expired");
			expect(result.mode).toBe("GOVERNANCE");
			expect(typeof result.retain_until_date).toBe("string");
		}
	});

	it("invalid_mode: rejects unrecognized mode strings", async () => {
		const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
		const s3 = mockS3(async () => ({
			Retention: { Mode: "BOGUS", RetainUntilDate: future },
		}));
		const result = await checkRetention(s3, "bucket", "key");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("invalid_mode");
			expect(result.mode).toBe("BOGUS");
		}
	});

	it("fetch_error: classifies unexpected errors as fetch_error (run continues)", async () => {
		const s3 = mockS3(async () => {
			throw Object.assign(new Error("network blip"), {
				name: "TimeoutError",
			});
		});
		const result = await checkRetention(s3, "bucket", "key");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("fetch_error");
	});
});
