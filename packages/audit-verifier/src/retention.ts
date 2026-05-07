/**
 * S3 Object Lock retention check (--check-retention).
 *
 * For each anchor object, verifies:
 *   - the object has retention configured at all (Mode + RetainUntilDate);
 *   - the mode is GOVERNANCE or COMPLIANCE (not bogus);
 *   - the retain_until_date hasn't already passed (would mean an
 *     auditor running too late, but a structural fact worth surfacing).
 *
 * Read-only — never calls PutObjectRetention. Auditors observe; they
 * don't remediate.
 */

import {
	GetObjectRetentionCommand,
	type S3Client,
} from "@aws-sdk/client-s3";

export interface RetentionFailure {
	key: string;
	reason: "missing" | "expired" | "invalid_mode" | "fetch_error";
	mode?: string;
	retain_until_date?: string;
}

export type RetentionResult =
	| { ok: true; mode: string; retain_until_date: string }
	| {
			ok: false;
			reason: RetentionFailure["reason"];
			mode?: string;
			retain_until_date?: string;
	  };

const VALID_MODES = new Set(["GOVERNANCE", "COMPLIANCE"]);

export async function checkRetention(
	s3: S3Client,
	bucket: string,
	key: string,
): Promise<RetentionResult> {
	let out;
	try {
		out = await s3.send(
			new GetObjectRetentionCommand({ Bucket: bucket, Key: key }),
		);
	} catch (err) {
		// `ObjectLockConfigurationNotFoundError` means no retention
		// config — that IS the failure mode we want to surface.
		const name = (err as { name?: string } | undefined)?.name;
		if (name === "NoSuchObjectLockConfiguration") {
			return { ok: false, reason: "missing" };
		}
		// Other errors: classify as fetch_error so the run continues.
		return {
			ok: false,
			reason: "fetch_error",
		};
	}

	const retention = out.Retention;
	if (!retention || !retention.Mode || !retention.RetainUntilDate) {
		return { ok: false, reason: "missing" };
	}

	const mode = retention.Mode;
	if (!VALID_MODES.has(mode)) {
		return {
			ok: false,
			reason: "invalid_mode",
			mode,
			retain_until_date: retention.RetainUntilDate.toISOString(),
		};
	}

	if (retention.RetainUntilDate.getTime() <= Date.now()) {
		return {
			ok: false,
			reason: "expired",
			mode,
			retain_until_date: retention.RetainUntilDate.toISOString(),
		};
	}

	return {
		ok: true,
		mode,
		retain_until_date: retention.RetainUntilDate.toISOString(),
	};
}
