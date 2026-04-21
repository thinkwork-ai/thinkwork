/**
 * Pinned-version initialization for guardrail-class workspace files.
 *
 * Called by createAgentFromTemplate (Unit 8) when a new agent is created,
 * and by the migration handler (Unit 10) when backfilling existing agents.
 *
 * For each pinned-class path (GUARDRAILS.md / PLATFORM.md / CAPABILITIES.md):
 *
 *   1. Resolve the current template-base bytes by walking
 *      `_catalog/{template}/workspace/` → `_catalog/defaults/workspace/`
 *      (first hit wins). Guardrail files are never read-time substituted,
 *      so this is a raw-bytes read.
 *   2. Compute `sha256(bytes)`.
 *   3. Persist the bytes to the content-addressable version store at
 *      `_catalog/{template}/workspace-versions/{path}@sha256:{hex}` so the
 *      composer can resolve this hash forever, even after the template base
 *      moves on.
 *   4. Record `agent_pinned_versions[path] = "sha256:{hex}"`.
 *
 * The version store is the invariant that makes pinned-file resolution
 * stable: once a hash is written there, the composer can always serve that
 * exact content, independent of subsequent template edits.
 */

import { createHash } from "node:crypto";
import {
	GetObjectCommand,
	HeadObjectCommand,
	NoSuchKey,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { PINNED_FILES } from "@thinkwork/workspace-defaults";

const REGION =
	process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });

function bucket(): string {
	return process.env.WORKSPACE_BUCKET || "";
}

function templateKey(
	tenantSlug: string,
	templateSlug: string,
	path: string,
): string {
	return `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/${path}`;
}

function defaultsKey(tenantSlug: string, path: string): string {
	return `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/${path}`;
}

function versionKey(
	tenantSlug: string,
	templateSlug: string,
	path: string,
	sha256: string,
): string {
	return `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace-versions/${path}@sha256:${sha256}`;
}

function isNotFound(err: unknown): boolean {
	if (err instanceof NoSuchKey) return true;
	const name = (err as { name?: string } | null)?.name;
	if (name === "NoSuchKey" || name === "NotFound") return true;
	const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
		?.$metadata?.httpStatusCode;
	return status === 404;
}

async function readWithFallback(
	bkt: string,
	tenantSlug: string,
	templateSlug: string,
	path: string,
): Promise<string | null> {
	try {
		const resp = await s3.send(
			new GetObjectCommand({
				Bucket: bkt,
				Key: templateKey(tenantSlug, templateSlug, path),
			}),
		);
		return (await resp.Body?.transformToString("utf-8")) ?? "";
	} catch (err) {
		if (!isNotFound(err)) throw err;
	}
	try {
		const resp = await s3.send(
			new GetObjectCommand({
				Bucket: bkt,
				Key: defaultsKey(tenantSlug, path),
			}),
		);
		return (await resp.Body?.transformToString("utf-8")) ?? "";
	} catch (err) {
		if (!isNotFound(err)) throw err;
	}
	return null;
}

async function ensureVersionStored(
	bkt: string,
	key: string,
	content: string,
): Promise<void> {
	// Idempotent write — HEAD first so we don't pay PUT costs on re-init
	// (Unit 10's migration may re-invoke initializePinnedVersions for
	// existing agents). On HEAD miss we PUT.
	try {
		await s3.send(new HeadObjectCommand({ Bucket: bkt, Key: key }));
		return;
	} catch (err) {
		if (!isNotFound(err)) throw err;
	}
	await s3.send(
		new PutObjectCommand({
			Bucket: bkt,
			Key: key,
			Body: content,
			ContentType: "text/markdown",
		}),
	);
}

function sha256Hex(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

export interface InitializePinnedVersionsInput {
	tenantSlug: string;
	templateSlug: string;
}

/**
 * Compute and persist the content-addressable version of each pinned-class
 * file for the given template. Returns the map suitable for writing to
 * `agents.agent_pinned_versions`. Values are `sha256:<64-hex>` strings.
 *
 * Files missing from both template and defaults layers are omitted from the
 * returned map — the composer's live-class fallback will serve them and the
 * admin UI will show the pin as "not yet recorded" (Unit 9 will surface
 * this).
 */
export async function initializePinnedVersions(
	opts: InitializePinnedVersionsInput,
): Promise<Record<string, string>> {
	const bkt = bucket();
	if (!bkt) {
		throw new Error("WORKSPACE_BUCKET not configured");
	}

	const out: Record<string, string> = {};
	for (const path of PINNED_FILES) {
		const content = await readWithFallback(
			bkt,
			opts.tenantSlug,
			opts.templateSlug,
			path,
		);
		if (content === null) continue;

		const hex = sha256Hex(content);
		await ensureVersionStored(
			bkt,
			versionKey(opts.tenantSlug, opts.templateSlug, path, hex),
			content,
		);
		out[path] = `sha256:${hex}`;
	}
	return out;
}
