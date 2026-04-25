/**
 * Backfill legacy ROUTER.md `- skills:` directives into root AGENTS.md.
 *
 * Plan §008 U27 moved skill ownership to AGENTS.md routing rows. ROUTER.md
 * remains a channel-profile file selector only, so this one-shot preserves
 * previously-authored skill intent before the runtime stops reading it.
 *
 * Run:
 *   npx tsx packages/api/src/handlers/backfill-router-skills-to-agents-md.ts --stage=dev [--tenants=acme,globex] [--destructive]
 *
 * No `--destructive` means dry-run: report only, no S3 writes.
 */

import {
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { inArray } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agents, tenants } from "@thinkwork/database-pg/schema";

const REGION =
	process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });

export interface LegacyRouterSkillRow {
	profile: string;
	skills: string[];
}

export interface BackfillAgentResult {
	tenantSlug: string;
	agentSlug: string;
	legacyRows: LegacyRouterSkillRow[];
	changed: boolean;
	wrote: boolean;
	error?: string;
}

export interface BackfillOptions {
	tenantSlugs?: string[];
	destructive?: boolean;
}

export interface BackfillResult {
	mode: "dry-run" | "destructive";
	agents: BackfillAgentResult[];
	summary: {
		agentsSeen: number;
		agentsWithLegacySkills: number;
		agentsChanged: number;
		agentsWritten: number;
		errors: number;
	};
}

function bucket(): string {
	return process.env.WORKSPACE_BUCKET || "";
}

function workspacePrefix(tenantSlug: string, agentSlug: string): string {
	return `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
}

async function readS3Text(bkt: string, key: string): Promise<string | null> {
	try {
		const resp = await s3.send(new GetObjectCommand({ Bucket: bkt, Key: key }));
		return (await resp.Body?.transformToString("utf-8")) ?? "";
	} catch (err) {
		const name = (err as { name?: string } | null)?.name;
		const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
			?.$metadata?.httpStatusCode;
		if (name === "NoSuchKey" || name === "NotFound" || status === 404) {
			return null;
		}
		throw err;
	}
}

async function writeS3Text(
	bkt: string,
	key: string,
	content: string,
): Promise<void> {
	await s3.send(
		new PutObjectCommand({
			Bucket: bkt,
			Key: key,
			Body: content,
			ContentType: "text/markdown; charset=utf-8",
		}),
	);
}

export function parseLegacyRouterSkillRows(
	routerMarkdown: string,
): LegacyRouterSkillRow[] {
	const rows: LegacyRouterSkillRow[] = [];
	let currentProfile = "";
	for (const line of routerMarkdown.split("\n")) {
		const heading = line.trim().match(/^##\s+(.+)$/);
		if (heading) {
			currentProfile = heading[1].trim();
			continue;
		}
		const directive = line.trim().match(/^- skills:\s*(.+)$/);
		if (!directive) continue;
		const skills = directive[1]
			.split(",")
			.map((value) => value.trim())
			.filter((value) => value.length > 0 && value !== "all" && value !== "per-job");
		if (skills.length === 0) continue;
		rows.push({ profile: currentProfile || "General", skills });
	}
	return rows;
}

export function mergeLegacyRouterSkillsIntoAgentsMd(
	agentsMarkdown: string,
	legacyRows: LegacyRouterSkillRow[],
): { content: string; changed: boolean } {
	let next = agentsMarkdown;
	for (const row of legacyRows) {
		const label = row.profile === "default" ? "General" : row.profile;
		next = upsertRootRoutingRow(next, {
			task: label,
			goTo: "./",
			read: "CONTEXT.md",
			skills: row.skills,
		});
	}
	return { content: next, changed: next !== agentsMarkdown };
}

function upsertRootRoutingRow(
	markdown: string,
	row: { task: string; goTo: string; read: string; skills: string[] },
): string {
	if (routingRowTaskExists(markdown, row.task)) {
		return updateRoutingRowSkills(markdown, row);
	}
	return appendRoutingRowWithoutGoToDedup(markdown, row);
}

function splitMarkdownRow(line: string): string[] {
	const trimmed = line.trim();
	if (!trimmed.startsWith("|")) return [];
	let body = trimmed.slice(1);
	if (body.endsWith("|")) body = body.slice(0, -1);
	return body.split("|").map((cell) => cell.trim());
}

function renderMarkdownRow(cells: string[]): string {
	return `| ${cells.join(" | ")} |`;
}

function mergeSkillLists(existing: string, incoming: string[]): string {
	const skills = [
		...new Set([
			...existing
				.split(",")
				.map((skill) => skill.trim())
				.filter(Boolean),
			...incoming,
		]),
	].sort();
	return skills.join(",");
}

function updateRoutingRowSkills(
	markdown: string,
	row: { task: string; skills: string[] },
): string {
	const lines = markdown.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const cells = splitMarkdownRow(lines[i]);
		if (cells.length < 4) continue;
		if (cells[0].toLowerCase() !== row.task.toLowerCase()) continue;
		const mergedSkills = mergeSkillLists(cells[3], row.skills);
		if (mergedSkills === cells[3]) return markdown;
		const nextCells = [...cells];
		nextCells[3] = mergedSkills;
		lines[i] = renderMarkdownRow(nextCells);
		return lines.join("\n");
	}
	return markdown;
}

function routingRowTaskExists(markdown: string, task: string): boolean {
	return markdown.split("\n").some((line) => {
		const cells = splitMarkdownRow(line);
		return cells.length >= 4 && cells[0].toLowerCase() === task.toLowerCase();
	});
}

function appendRoutingRowWithoutGoToDedup(
	markdown: string,
	row: { task: string; goTo: string; read: string; skills: string[] },
): string {
	const renderedRow = renderMarkdownRow([
		row.task,
		row.goTo,
		row.read,
		[...new Set(row.skills)].sort().join(","),
	]);
	const lines = markdown.split("\n");
	const routingHeadingIndex = lines.findIndex((line) =>
		/^##\s+Routing(\s+Table)?\s*$/i.test(line.trim()),
	);
	const tableStart =
		routingHeadingIndex === -1
			? lines.findIndex((line) => line.trim().startsWith("|"))
			: lines.findIndex(
					(line, index) =>
						index > routingHeadingIndex && line.trim().startsWith("|"),
				);
	if (tableStart === -1 || tableStart + 1 >= lines.length) {
		const suffix = markdown.endsWith("\n") ? "" : "\n";
		return `${markdown}${suffix}
## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
${renderedRow}
`;
	}

	let insertAt = tableStart + 2;
	while (insertAt < lines.length && lines[insertAt]?.trim().startsWith("|")) {
		insertAt++;
	}
	lines.splice(insertAt, 0, renderedRow);
	return lines.join("\n");
}

async function listAllAgents() {
	const db = getDb();
	const tenantRows = await db
		.select({ id: tenants.id, slug: tenants.slug })
		.from(tenants);
	const tenantById = new Map(tenantRows.map((row) => [row.id, row.slug]));
	const agentRows = await db
		.select({
			slug: agents.slug,
			tenantId: agents.tenant_id,
		})
		.from(agents)
		.where(
			tenantRows.length > 0
				? inArray(
						agents.tenant_id,
						tenantRows.map((row) => row.id),
					)
				: undefined,
		);
	return agentRows
		.map((agent) => ({
			agentSlug: agent.slug,
			tenantSlug: tenantById.get(agent.tenantId) ?? "",
		}))
		.filter((row) => row.agentSlug && row.tenantSlug);
}

export async function runBackfill(
	options: BackfillOptions = {},
): Promise<BackfillResult> {
	const bkt = bucket();
	if (!bkt) throw new Error("WORKSPACE_BUCKET not configured");

	const candidates = (await listAllAgents()).filter(
		(row) =>
			!options.tenantSlugs ||
			options.tenantSlugs.length === 0 ||
			options.tenantSlugs.includes(row.tenantSlug),
	);
	const agentsOut: BackfillAgentResult[] = [];

	for (const candidate of candidates) {
		const prefix = workspacePrefix(candidate.tenantSlug, candidate.agentSlug!);
		try {
			const router = await readS3Text(bkt, `${prefix}ROUTER.md`);
			if (!router) {
				agentsOut.push({
					tenantSlug: candidate.tenantSlug,
					agentSlug: candidate.agentSlug!,
					legacyRows: [],
					changed: false,
					wrote: false,
				});
				continue;
			}
			const legacyRows = parseLegacyRouterSkillRows(router);
			const agentsMd =
				(await readS3Text(bkt, `${prefix}AGENTS.md`)) ??
				"# AGENTS.md\n\n## Routing\n\n| Task | Go to | Read | Skills |\n| --- | --- | --- | --- |\n";
			const merged = mergeLegacyRouterSkillsIntoAgentsMd(agentsMd, legacyRows);
			if (options.destructive && merged.changed) {
				await writeS3Text(bkt, `${prefix}AGENTS.md`, merged.content);
			}
			agentsOut.push({
				tenantSlug: candidate.tenantSlug,
				agentSlug: candidate.agentSlug!,
				legacyRows,
				changed: merged.changed,
				wrote: Boolean(options.destructive && merged.changed),
			});
		} catch (err) {
			agentsOut.push({
				tenantSlug: candidate.tenantSlug,
				agentSlug: candidate.agentSlug!,
				legacyRows: [],
				changed: false,
				wrote: false,
				error: (err as { message?: string } | null)?.message || String(err),
			});
		}
	}

	return {
		mode: options.destructive ? "destructive" : "dry-run",
		agents: agentsOut,
		summary: {
			agentsSeen: agentsOut.length,
			agentsWithLegacySkills: agentsOut.filter((row) => row.legacyRows.length > 0)
				.length,
			agentsChanged: agentsOut.filter((row) => row.changed).length,
			agentsWritten: agentsOut.filter((row) => row.wrote).length,
			errors: agentsOut.filter((row) => row.error).length,
		},
	};
}

function parseArgs(argv = process.argv.slice(2)): BackfillOptions {
	return {
		destructive: argv.includes("--destructive"),
		tenantSlugs: argv
			.find((arg) => arg.startsWith("--tenants="))
			?.slice("--tenants=".length)
			.split(",")
			.map((slug) => slug.trim())
			.filter(Boolean),
	};
}

if (
	import.meta.url === `file://${process.argv[1]}` ||
	process.argv[1]?.endsWith("backfill-router-skills-to-agents-md.ts")
) {
	(async () => {
		const result = await runBackfill(parseArgs());
		console.log(JSON.stringify(result, null, 2));
		if (result.summary.errors > 0) process.exitCode = 1;
	})();
}
