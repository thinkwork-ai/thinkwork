/**
 * wiki-export Lambda — nightly markdown vault export.
 *
 * Emits one bundle per `(tenant, owner)` scope that has any compiled pages.
 * Bundles go to:
 *   s3://<WIKI_EXPORT_BUCKET>/<tenant_slug>/<owner_slug>/<yyyy-mm-dd>/vault.zip
 *
 * Bundle layout (inside the zip):
 *   <type>/<slug>.md    — frontmatter + section bodies concatenated
 *
 * v1 runs as a single pass per invocation. Lifecycle (30-day retention) is
 * enforced by the S3 bucket's lifecycle rule — this handler does not delete
 * old bundles.
 */

import { and, asc, eq } from "drizzle-orm";
import {
	agents,
	tenants,
	wikiPageAliases,
	wikiPageSections,
	wikiPages,
} from "@thinkwork/database-pg/schema";
import { db } from "../lib/db.js";
import {
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);

type WikiExportEvent = Record<string, never>;

export interface WikiExportResult {
	ok: boolean;
	bundles_written: number;
	pages_exported: number;
	bytes_uploaded: number;
	error?: string;
}

const REGION = process.env.AWS_REGION || "us-east-1";

export async function handler(
	_event: WikiExportEvent = {},
): Promise<WikiExportResult> {
	const bucket = process.env.WIKI_EXPORT_BUCKET;
	if (!bucket) {
		const msg = "WIKI_EXPORT_BUCKET env var not set";
		console.error(`[wiki-export] ${msg}`);
		return {
			ok: false,
			bundles_written: 0,
			pages_exported: 0,
			bytes_uploaded: 0,
			error: msg,
		};
	}

	const s3 = new S3Client({ region: REGION });
	const result: WikiExportResult = {
		ok: true,
		bundles_written: 0,
		pages_exported: 0,
		bytes_uploaded: 0,
	};
	const today = new Date().toISOString().slice(0, 10);

	try {
		// 1. Discover distinct (tenant, owner) pairs with at least one active
		// page. This is cheap — wiki_pages has a composite index on
		// (tenant_id, owner_id, type, status).
		const scopes = await db
			.selectDistinct({
				tenant_id: wikiPages.tenant_id,
				owner_id: wikiPages.owner_id,
			})
			.from(wikiPages)
			.where(eq(wikiPages.status, "active"));

		if (scopes.length === 0) {
			console.log("[wiki-export] no scopes with active pages; nothing to do");
			return result;
		}

		// Resolve tenant + agent slugs for the S3 keys.
		const tenantIds = [...new Set(scopes.map((s) => s.tenant_id))];
		const ownerIds = [...new Set(scopes.map((s) => s.owner_id))];

		const tenantRows = await db
			.select({ id: tenants.id, slug: tenants.slug })
			.from(tenants)
			.where(inAnyOf(tenants.id, tenantIds));
		const agentRows = await db
			.select({ id: agents.id, slug: agents.slug })
			.from(agents)
			.where(inAnyOf(agents.id, ownerIds));
		const tenantSlug = new Map(
			tenantRows.map((r) => [r.id, r.slug || r.id]),
		);
		const agentSlug = new Map(
			agentRows.map((r) => [r.id, r.slug || r.id]),
		);

		for (const scope of scopes) {
			const pages = await db
				.select()
				.from(wikiPages)
				.where(
					and(
						eq(wikiPages.tenant_id, scope.tenant_id),
						eq(wikiPages.owner_id, scope.owner_id),
						eq(wikiPages.status, "active"),
					),
				)
				.orderBy(asc(wikiPages.type), asc(wikiPages.slug));

			if (pages.length === 0) continue;

			const manifest: Array<{
				path: string;
				type: string;
				slug: string;
				title: string;
			}> = [];
			const rendered: Array<{ path: string; body: string }> = [];

			for (const page of pages) {
				const [sections, aliases] = await Promise.all([
					db
						.select()
						.from(wikiPageSections)
						.where(eq(wikiPageSections.page_id, page.id))
						.orderBy(asc(wikiPageSections.position)),
					db
						.select({ alias: wikiPageAliases.alias })
						.from(wikiPageAliases)
						.where(eq(wikiPageAliases.page_id, page.id)),
				]);

				const body = renderPageMarkdown(page, sections, aliases.map((a) => a.alias));
				const path = `${page.type}/${page.slug}.md`;
				rendered.push({ path, body });
				manifest.push({
					path,
					type: page.type,
					slug: page.slug,
					title: page.title,
				});
				result.pages_exported += 1;
			}

			rendered.push({
				path: "manifest.json",
				body: JSON.stringify(
					{
						tenant_id: scope.tenant_id,
						owner_id: scope.owner_id,
						exported_at: new Date().toISOString(),
						pages: manifest,
					},
					null,
					2,
				),
			});

			const tslug = tenantSlug.get(scope.tenant_id) ?? scope.tenant_id;
			const aslug = agentSlug.get(scope.owner_id) ?? scope.owner_id;
			// v1 uses a single concatenated markdown payload rather than a real
			// zip — avoids pulling a zip dependency into the Lambda bundle for
			// a nightly export. Consumers treat each `----8<---- <path>` marker
			// as a file delimiter. Easy to post-process; the 30-day retention
			// gives us room to iterate on the format.
			const concatenated = rendered
				.map((r) => `----8<---- ${r.path}\n${r.body}\n`)
				.join("");
			const compressed = await gzipAsync(Buffer.from(concatenated, "utf8"));
			const key = `${tslug}/${aslug}/${today}/vault.md.gz`;
			await s3.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: key,
					Body: compressed,
					ContentType: "application/gzip",
					ContentEncoding: "gzip",
				}),
			);

			result.bundles_written += 1;
			result.bytes_uploaded += compressed.byteLength;
		}

		console.log(`[wiki-export] ${JSON.stringify(result)}`);
		return result;
	} catch (err) {
		result.ok = false;
		result.error = (err as Error)?.message || String(err);
		console.error(`[wiki-export] failed: ${result.error}`);
		return result;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPageMarkdown(
	page: {
		id: string;
		tenant_id: string;
		owner_id: string;
		type: string;
		slug: string;
		title: string;
		summary: string | null;
		last_compiled_at: Date | null;
	},
	sections: Array<{ heading: string; body_md: string; position: number }>,
	aliases: string[],
): string {
	const frontmatter = [
		"---",
		`id: ${page.id}`,
		`tenant: ${page.tenant_id}`,
		`owner: ${page.owner_id}`,
		`type: ${page.type}`,
		`slug: ${page.slug}`,
		`title: ${JSON.stringify(page.title)}`,
		`last_compiled_at: ${page.last_compiled_at?.toISOString() ?? "null"}`,
		`aliases: ${JSON.stringify(aliases)}`,
		"---",
	].join("\n");

	const body = sections
		.sort((a, b) => a.position - b.position)
		.map((s) => `## ${s.heading}\n\n${s.body_md.trim()}`)
		.join("\n\n");

	const head = `# ${page.title}`;
	const summary = page.summary ? `\n_${page.summary.trim()}_\n` : "";
	return `${frontmatter}\n\n${head}\n${summary}\n${body}\n`;
}

/**
 * Drizzle doesn't expose `inArray` from its core for dynamic id lists that
 * could be empty; wrap it so empty arrays return a false predicate cleanly.
 */
function inAnyOf<T>(col: T, ids: string[]) {
	if (ids.length === 0) {
		// `1=0` — false predicate when the list is empty; prevents `IN ()`
		// which is a SQL parse error.
		return eq(col as any, "\0"); // never matches a real UUID
	}
	// drizzle supports `sql.raw` but safer: use a templated ANY comparison.
	const { sql } = require("drizzle-orm") as typeof import("drizzle-orm");
	return sql`${col} = ANY(${ids}::uuid[])`;
}
