/**
 * Paginated S3 enumeration + JSON body fetch.
 *
 * Two responsibilities:
 *
 *   1. `enumerateAnchors` — yield every anchor key under `anchors/`,
 *      paginating via ContinuationToken until S3 says we're done.
 *      MUST NOT silently truncate at 1000 keys: at 365-day retention,
 *      the bucket carries ~35k anchor objects in steady state.
 *
 *   2. `getJsonBody` — fetch a single object body, decode UTF-8, and
 *      JSON.parse. The body is opaque-typed (`unknown`) — caller's job
 *      to validate via the zod schemas in src/schema.ts.
 *
 * Both helpers take an injected `S3Client` so tests can pass a mock
 * (see `__tests__/s3.test.ts`) without spinning up real AWS.
 *
 * Time-range scoping per R5: `--since` is inclusive, `--until` is
 * exclusive. The half-open interval [since, until) makes sequential
 * audit runs free of overlap and free of gaps.
 */

import {
	GetObjectCommand,
	ListObjectsV2Command,
	type ListObjectsV2CommandOutput,
	type S3Client,
} from "@aws-sdk/client-s3";

export interface AnchorKey {
	key: string;
	lastModified: Date;
}

export interface EnumerateOptions {
	bucket: string;
	since?: Date;
	until?: Date;
	prefix?: string; // override "anchors/" only in tests
}

/**
 * Async iterable yielding every anchor object that falls in the
 * `[since, until)` window. Caller can sort by `lastModified` if it
 * cares about chronological order.
 *
 * Implementation note: `Contents` may be `undefined` on an empty bucket
 * (S3 SDK quirk). We coerce to `[]` so the for-loop short-circuits.
 */
export async function* enumerateAnchors(
	s3: S3Client,
	opts: EnumerateOptions,
): AsyncIterable<AnchorKey> {
	const prefix = opts.prefix ?? "anchors/";
	let continuationToken: string | undefined = undefined;
	do {
		const out: ListObjectsV2CommandOutput = await s3.send(
			new ListObjectsV2Command({
				Bucket: opts.bucket,
				Prefix: prefix,
				ContinuationToken: continuationToken,
			}),
		);
		const contents = out.Contents ?? [];
		for (const item of contents) {
			if (typeof item.Key !== "string") continue;
			if (!(item.LastModified instanceof Date)) continue;
			if (opts.since && item.LastModified < opts.since) continue;
			if (opts.until && item.LastModified >= opts.until) continue;
			yield { key: item.Key, lastModified: item.LastModified };
		}
		continuationToken =
			out.IsTruncated === true ? out.NextContinuationToken : undefined;
	} while (continuationToken);
}

/**
 * Fetch a single object body, decode UTF-8, JSON.parse. Returns
 * `unknown` — caller MUST validate via parseAnchor / parseSlice.
 *
 * Throws if S3 returns no body, the body isn't UTF-8, or the body
 * isn't well-formed JSON. The error message includes the offending
 * key so the orchestrator can surface it in `parse_failures[]`.
 */
export async function getJsonBody(
	s3: S3Client,
	bucket: string,
	key: string,
): Promise<unknown> {
	const out = await s3.send(
		new GetObjectCommand({ Bucket: bucket, Key: key }),
	);
	if (!out.Body) {
		throw new Error(
			`audit-verifier/s3: GetObject returned empty body for key ${key}`,
		);
	}
	// transformToString is the AWS SDK v3 helper for decoding the
	// streaming body. It handles the under-the-hood Readable / Web
	// Streams difference between Node 18 and Node 20+.
	const text = await out.Body.transformToString("utf-8");
	try {
		return JSON.parse(text);
	} catch (err) {
		throw new Error(
			`audit-verifier/s3: object body is not JSON for key ${key}: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
}

/**
 * Class of errors that mean "S3 said no, retry won't help" — bucket
 * doesn't exist, access denied, etc. The orchestrator catches these
 * and exits 2 (unrecoverable) rather than 1 (mismatch found).
 */
export function isUnrecoverableS3Error(err: unknown): boolean {
	if (typeof err !== "object" || err === null) return false;
	const name = (err as { name?: unknown }).name;
	if (typeof name !== "string") return false;
	return (
		name === "NoSuchBucket" ||
		name === "AccessDenied" ||
		name === "InvalidAccessKeyId" ||
		name === "SignatureDoesNotMatch" ||
		name === "ExpiredToken"
	);
}
