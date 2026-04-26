/**
 * Hindsight legacy bank merge helpers.
 *
 * This is intentionally conservative. Hindsight is the canonical memory store,
 * so the default path audits and reports. Apply mode refuses ambiguous
 * conflicts instead of inventing replacement ids that would sever graph links.
 */

import { sql } from "drizzle-orm";
import { getDb, type Database } from "@thinkwork/database-pg";

export type DbLike = Pick<Database, "execute" | "transaction">;

export interface AgentBankRow {
	tenant_id: string;
	user_id: string;
	agent_id: string;
	slug: string | null;
	name: string | null;
}

export interface AliasMapping {
	sourceBankId: string;
	userId: string;
	tenantId?: string;
}

export interface BankMergeMapping {
	tenantId: string;
	userId: string;
	destinationBankId: string;
	agentIds: string[];
	candidateLegacyBankIds: string[];
}

export interface BankTableCounts {
	bankId: string;
	tables: Record<string, number>;
	total: number;
}

export interface BankConflictReport {
	sourceBankId: string;
	destinationBankId: string;
	duplicateDocuments: number;
	blockingDocuments: number;
	duplicateMentalModels: number;
	blockingMentalModels: number;
	duplicateEntitiesByName: number;
}

export interface BankMergePairReport {
	sourceBankId: string;
	destinationBankId: string;
	before: {
		source: BankTableCounts;
		destination: BankTableCounts;
	};
	conflicts: BankConflictReport;
	apply?: {
		movedRows: Record<string, number>;
		mergedEntities: number;
		removedDuplicateDocuments: number;
		removedDuplicateMentalModels: number;
	};
	after?: {
		source: BankTableCounts;
		destination: BankTableCounts;
	};
}

export interface HindsightBankMergeReport {
	generatedAt: string;
	apply: boolean;
	mappings: BankMergeMapping[];
	pairs: BankMergePairReport[];
	unmapped: BankTableCounts[];
}

export interface RunHindsightBankMergeOptions {
	db?: DbLike;
	aliases?: AliasMapping[];
	apply?: boolean;
	tenantId?: string;
	userId?: string;
}

const BANK_ID_TABLES = [
	"async_operations",
	"audit_log",
	"chunks",
	"directives",
	"documents",
	"entities",
	"memory_links",
	"memory_units",
	"mental_models",
	"webhooks",
] as const;

type BankIdTable = (typeof BANK_ID_TABLES)[number];

export function slugifyLegacyBankName(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function destinationBankId(userId: string): string {
	return `user_${userId}`;
}

export function candidateLegacyBankIds(agent: Pick<AgentBankRow, "agent_id" | "slug" | "name">): string[] {
	return uniqueStrings([
		agent.slug || "",
		agent.name ? slugifyLegacyBankName(agent.name) : "",
		agent.agent_id,
		`user_${agent.agent_id}`,
	]);
}

export function parseAliasMappings(values: string[]): AliasMapping[] {
	return values.map((value) => {
		const [left, right] = value.split("=");
		if (!left || !right) {
			throw new Error(`Invalid alias mapping "${value}". Expected sourceBank=userId or sourceBank=tenantId:userId.`);
		}
		const [maybeTenant, maybeUser] = right.split(":");
		if (maybeUser) {
			return { sourceBankId: left, tenantId: maybeTenant, userId: maybeUser };
		}
		return { sourceBankId: left, userId: right };
	});
}

export async function runHindsightBankMerge(
	options: RunHindsightBankMergeOptions = {},
): Promise<HindsightBankMergeReport> {
	const db = options.db ?? getDb();
	const mappings = await loadMappings(db, options);
	const candidateBanks = uniqueStrings(mappings.flatMap((m) => [
		m.destinationBankId,
		...m.candidateLegacyBankIds,
	]));
	const allNonEmpty = await countNonEmptyBanks(db);
	const candidateSet = new Set(candidateBanks);
	const pairs: BankMergePairReport[] = [];

	for (const mapping of mappings) {
		const destination = mapping.destinationBankId;
		for (const source of mapping.candidateLegacyBankIds) {
			if (source === destination) continue;
			const sourceCounts = await countBankTables(db, source);
			if (sourceCounts.total === 0) continue;
			const destinationCounts = await countBankTables(db, destination);
			const conflicts = await detectConflicts(db, source, destination);
			const pair: BankMergePairReport = {
				sourceBankId: source,
				destinationBankId: destination,
				before: {
					source: sourceCounts,
					destination: destinationCounts,
				},
				conflicts,
			};

			if (options.apply) {
				if (conflicts.blockingDocuments > 0 || conflicts.blockingMentalModels > 0) {
					throw new Error(
						`Blocking Hindsight conflicts for ${source} -> ${destination}: documents=${conflicts.blockingDocuments} mentalModels=${conflicts.blockingMentalModels}`,
					);
				}
				pair.apply = await applyMergePair(db, source, destination);
				pair.after = {
					source: await countBankTables(db, source),
					destination: await countBankTables(db, destination),
				};
			}

			pairs.push(pair);
		}
	}

	const unmapped = allNonEmpty
		.filter((counts) => !candidateSet.has(counts.bankId))
		.sort((a, b) => b.total - a.total);

	return {
		generatedAt: new Date().toISOString(),
		apply: Boolean(options.apply),
		mappings,
		pairs,
		unmapped,
	};
}

async function loadMappings(db: DbLike, options: RunHindsightBankMergeOptions): Promise<BankMergeMapping[]> {
	const filters = [];
	if (options.tenantId) filters.push(sql`AND tenant_id = ${options.tenantId}`);
	if (options.userId) filters.push(sql`AND human_pair_id = ${options.userId}`);
	const result = await db.execute(sql`
		SELECT tenant_id, human_pair_id AS user_id, id AS agent_id, slug, name
		FROM agents
		WHERE source = 'user'
		  AND human_pair_id IS NOT NULL
		  ${sql.join(filters, sql` `)}
		ORDER BY tenant_id, human_pair_id, created_at, id
	`);
	const grouped = new Map<string, BankMergeMapping>();
	for (const row of ((result.rows || []) as unknown as AgentBankRow[])) {
		const key = `${row.tenant_id}:${row.user_id}`;
		const existing = grouped.get(key) ?? {
			tenantId: row.tenant_id,
			userId: row.user_id,
			destinationBankId: destinationBankId(row.user_id),
			agentIds: [],
			candidateLegacyBankIds: [],
		};
		existing.agentIds.push(row.agent_id);
		existing.candidateLegacyBankIds.push(...candidateLegacyBankIds(row));
		grouped.set(key, existing);
	}

	for (const alias of options.aliases ?? []) {
		for (const mapping of grouped.values()) {
			if (mapping.userId !== alias.userId) continue;
			if (alias.tenantId && mapping.tenantId !== alias.tenantId) continue;
			mapping.candidateLegacyBankIds.push(alias.sourceBankId);
		}
	}

	return [...grouped.values()].map((mapping) => ({
		...mapping,
		agentIds: uniqueStrings(mapping.agentIds),
		candidateLegacyBankIds: uniqueStrings(
			mapping.candidateLegacyBankIds.filter((bankId) => bankId !== mapping.destinationBankId),
		),
	}));
}

async function countNonEmptyBanks(db: DbLike): Promise<BankTableCounts[]> {
	// Use memory_units as the discovery table for unmapped canonical data.
	// Counting every bank-keyed support table can be slow on the Hindsight
	// schema and does not change the migration target: empty memory banks are
	// not automatically merged by this tool.
	const result = await db.execute(sql`
		SELECT bank_id, COUNT(*)::int AS count
		FROM hindsight.memory_units
		WHERE bank_id IS NOT NULL
		GROUP BY bank_id
	`);
	return ((result.rows || []) as Array<{ bank_id: string; count: number }>)
		.filter((row) => Boolean(row.bank_id) && Number(row.count) > 0)
		.map((row) => ({
			bankId: row.bank_id,
			tables: { memory_units: Number(row.count) },
			total: Number(row.count),
		}));
}

export async function countBankTables(db: DbLike, bankId: string): Promise<BankTableCounts> {
	const tables: Record<string, number> = {};
	for (const table of BANK_ID_TABLES) {
		const result = await db.execute(sql.raw(`
			SELECT COUNT(*)::int AS count
			FROM hindsight.${table}
			WHERE bank_id = ${literal(bankId)}
		`));
		tables[table] = Number((result.rows?.[0] as any)?.count ?? 0);
	}
	const total = Object.values(tables).reduce((sum, value) => sum + value, 0);
	return { bankId, tables, total };
}

async function detectConflicts(
	db: DbLike,
	sourceBankId: string,
	destinationBankIdValue: string,
): Promise<BankConflictReport> {
	const [
		duplicateDocuments,
		blockingDocuments,
		duplicateMentalModels,
		blockingMentalModels,
		duplicateEntitiesByName,
	] = await Promise.all([
		scalarCount(db, sql`
			SELECT COUNT(*)::int AS count
			FROM hindsight.documents s
			JOIN hindsight.documents d ON d.id = s.id AND d.bank_id = ${destinationBankIdValue}
			WHERE s.bank_id = ${sourceBankId}
		`),
		scalarCount(db, sql`
			SELECT COUNT(*)::int AS count
			FROM hindsight.documents s
			JOIN hindsight.documents d ON d.id = s.id AND d.bank_id = ${destinationBankIdValue}
			WHERE s.bank_id = ${sourceBankId}
			  AND (
				s.content_hash IS DISTINCT FROM d.content_hash
				OR s.original_text IS DISTINCT FROM d.original_text
			  )
		`),
		scalarCount(db, sql`
			SELECT COUNT(*)::int AS count
			FROM hindsight.mental_models s
			JOIN hindsight.mental_models d ON d.id = s.id AND d.bank_id = ${destinationBankIdValue}
			WHERE s.bank_id = ${sourceBankId}
		`),
		scalarCount(db, sql`
			SELECT COUNT(*)::int AS count
			FROM hindsight.mental_models s
			JOIN hindsight.mental_models d ON d.id = s.id AND d.bank_id = ${destinationBankIdValue}
			WHERE s.bank_id = ${sourceBankId}
			  AND (
				s.content IS DISTINCT FROM d.content
				OR s.name IS DISTINCT FROM d.name
			  )
		`),
		scalarCount(db, sql`
			SELECT COUNT(*)::int AS count
			FROM hindsight.entities s
			JOIN hindsight.entities d
			  ON d.bank_id = ${destinationBankIdValue}
			 AND lower(d.canonical_name) = lower(s.canonical_name)
			WHERE s.bank_id = ${sourceBankId}
		`),
	]);

	return {
		sourceBankId,
		destinationBankId: destinationBankIdValue,
		duplicateDocuments,
		blockingDocuments,
		duplicateMentalModels,
		blockingMentalModels,
		duplicateEntitiesByName,
	};
}

async function applyMergePair(
	db: DbLike,
	sourceBankId: string,
	destinationBankIdValue: string,
): Promise<BankMergePairReport["apply"]> {
	const run = async (tx: DbLike) => {
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`hindsight-bank-merge:${sourceBankId}:${destinationBankIdValue}`}))`);
		await ensureDestinationBank(tx, sourceBankId, destinationBankIdValue);
		const removedDuplicateMentalModels = await deleteIdenticalDuplicateMentalModels(tx, sourceBankId, destinationBankIdValue);
		const mergedEntities = await mergeDuplicateEntities(tx, sourceBankId, destinationBankIdValue);
		const movedRows: Record<string, number> = {};
		movedRows.documents = await copyDocumentsToDestination(tx, sourceBankId, destinationBankIdValue);

		for (const table of [
			"chunks",
			"memory_units",
			"entities",
			"memory_links",
			"directives",
			"mental_models",
			"webhooks",
			"async_operations",
			"audit_log",
		] satisfies BankIdTable[]) {
			movedRows[table] = await updateBankId(tx, table, sourceBankId, destinationBankIdValue);
		}
		const removedSourceDocuments = await deleteSourceDocuments(tx, sourceBankId);

		return {
			movedRows,
			mergedEntities,
			removedDuplicateDocuments: removedSourceDocuments,
			removedDuplicateMentalModels,
		};
	};

	if (typeof db.transaction === "function") {
		return db.transaction((tx) => run(tx as unknown as DbLike));
	}
	return run(db);
}

async function ensureDestinationBank(
	db: DbLike,
	sourceBankId: string,
	destinationBankIdValue: string,
): Promise<void> {
	await db.execute(sql`
		INSERT INTO hindsight.banks (
			bank_id,
			name,
			disposition,
			created_at,
			updated_at,
			mission,
			config
		)
		SELECT
			${destinationBankIdValue},
			COALESCE(dest.name, src.name, ${destinationBankIdValue}),
			COALESCE(dest.disposition, src.disposition, '{}'::jsonb),
			COALESCE(dest.created_at, src.created_at, NOW()),
			NOW(),
			COALESCE(dest.mission, src.mission),
			COALESCE(dest.config, src.config, '{}'::jsonb)
		FROM (SELECT 1) seed
		LEFT JOIN hindsight.banks src ON src.bank_id = ${sourceBankId}
		LEFT JOIN hindsight.banks dest ON dest.bank_id = ${destinationBankIdValue}
		ON CONFLICT (bank_id) DO NOTHING
	`);
}

async function copyDocumentsToDestination(
	db: DbLike,
	sourceBankId: string,
	destinationBankIdValue: string,
): Promise<number> {
	return executeRowCount(db, sql`
		INSERT INTO hindsight.documents (
			id,
			bank_id,
			original_text,
			content_hash,
			created_at,
			updated_at,
			retain_params,
			tags,
			file_storage_key,
			file_original_name,
			file_content_type
		)
		SELECT
			s.id,
			${destinationBankIdValue},
			s.original_text,
			s.content_hash,
			s.created_at,
			s.updated_at,
			s.retain_params,
			s.tags,
			s.file_storage_key,
			s.file_original_name,
			s.file_content_type
		FROM hindsight.documents s
		WHERE s.bank_id = ${sourceBankId}
		  AND NOT EXISTS (
			SELECT 1
			FROM hindsight.documents d
			WHERE d.bank_id = ${destinationBankIdValue}
			  AND d.id = s.id
		  )
	`);
}

async function deleteSourceDocuments(
	db: DbLike,
	sourceBankId: string,
): Promise<number> {
	return executeRowCount(db, sql`
		DELETE FROM hindsight.documents
		WHERE bank_id = ${sourceBankId}
	`);
}

async function deleteIdenticalDuplicateMentalModels(
	db: DbLike,
	sourceBankId: string,
	destinationBankIdValue: string,
): Promise<number> {
	return executeRowCount(db, sql`
		DELETE FROM hindsight.mental_models s
		USING hindsight.mental_models d
		WHERE s.bank_id = ${sourceBankId}
		  AND d.bank_id = ${destinationBankIdValue}
		  AND d.id = s.id
		  AND s.content IS NOT DISTINCT FROM d.content
		  AND s.name IS NOT DISTINCT FROM d.name
	`);
}

async function mergeDuplicateEntities(
	db: DbLike,
	sourceBankId: string,
	destinationBankIdValue: string,
): Promise<number> {
	const result = await db.execute(sql`
		SELECT s.id AS source_id, d.id AS destination_id
		FROM hindsight.entities s
		JOIN hindsight.entities d
		  ON d.bank_id = ${destinationBankIdValue}
		 AND lower(d.canonical_name) = lower(s.canonical_name)
		WHERE s.bank_id = ${sourceBankId}
		ORDER BY s.canonical_name
	`);
	const pairs = (result.rows || []) as Array<{ source_id: string; destination_id: string }>;
	for (const pair of pairs) {
		await mergeEntityPair(db, pair.source_id, pair.destination_id);
	}
	return pairs.length;
}

async function mergeEntityPair(db: DbLike, sourceEntityId: string, destinationEntityIdValue: string): Promise<void> {
	await db.execute(sql`
		DELETE FROM hindsight.unit_entities s
		USING hindsight.unit_entities d
		WHERE s.entity_id = ${sourceEntityId}::uuid
		  AND d.entity_id = ${destinationEntityIdValue}::uuid
		  AND d.unit_id = s.unit_id
	`);
	await db.execute(sql`
		UPDATE hindsight.unit_entities
		SET entity_id = ${destinationEntityIdValue}::uuid
		WHERE entity_id = ${sourceEntityId}::uuid
	`);
	await db.execute(sql`
		DELETE FROM hindsight.memory_links s
		USING hindsight.memory_links d
		WHERE s.entity_id = ${sourceEntityId}::uuid
		  AND d.entity_id = ${destinationEntityIdValue}::uuid
		  AND d.from_unit_id = s.from_unit_id
		  AND d.to_unit_id = s.to_unit_id
		  AND d.link_type = s.link_type
	`);
	await db.execute(sql`
		UPDATE hindsight.memory_links
		SET entity_id = ${destinationEntityIdValue}::uuid
		WHERE entity_id = ${sourceEntityId}::uuid
	`);
	await mergeCooccurrences(db, sourceEntityId, destinationEntityIdValue);
	await db.execute(sql`
		UPDATE hindsight.entities d
		SET
			mention_count = COALESCE(d.mention_count, 0) + COALESCE(s.mention_count, 0),
			first_seen = LEAST(d.first_seen, s.first_seen),
			last_seen = GREATEST(d.last_seen, s.last_seen),
			metadata = COALESCE(d.metadata, '{}'::jsonb) || COALESCE(s.metadata, '{}'::jsonb)
		FROM hindsight.entities s
		WHERE d.id = ${destinationEntityIdValue}::uuid
		  AND s.id = ${sourceEntityId}::uuid
	`);
	await db.execute(sql`DELETE FROM hindsight.entities WHERE id = ${sourceEntityId}::uuid`);
}

async function mergeCooccurrences(
	db: DbLike,
	sourceEntityId: string,
	destinationEntityIdValue: string,
): Promise<void> {
	await db.execute(sql`
		INSERT INTO hindsight.entity_cooccurrences (
			entity_id_1,
			entity_id_2,
			cooccurrence_count,
			last_cooccurred
		)
		WITH source_edges AS (
			SELECT entity_id_2 AS other_entity_id, cooccurrence_count, last_cooccurred
			FROM hindsight.entity_cooccurrences
			WHERE entity_id_1 = ${sourceEntityId}::uuid
			  AND entity_id_2 <> ${destinationEntityIdValue}::uuid
			UNION ALL
			SELECT entity_id_1 AS other_entity_id, cooccurrence_count, last_cooccurred
			FROM hindsight.entity_cooccurrences
			WHERE entity_id_2 = ${sourceEntityId}::uuid
			  AND entity_id_1 <> ${destinationEntityIdValue}::uuid
		),
		normalized_edges AS (
			SELECT
				LEAST(${destinationEntityIdValue}::uuid, other_entity_id) AS entity_id_1,
				GREATEST(${destinationEntityIdValue}::uuid, other_entity_id) AS entity_id_2,
				cooccurrence_count,
				last_cooccurred
			FROM source_edges
		)
		SELECT
			entity_id_1,
			entity_id_2,
			SUM(cooccurrence_count)::int,
			MAX(last_cooccurred)
		FROM normalized_edges
		GROUP BY entity_id_1, entity_id_2
		ON CONFLICT (entity_id_1, entity_id_2) DO UPDATE
		SET
			cooccurrence_count = hindsight.entity_cooccurrences.cooccurrence_count + EXCLUDED.cooccurrence_count,
			last_cooccurred = GREATEST(
				hindsight.entity_cooccurrences.last_cooccurred,
				EXCLUDED.last_cooccurred
			)
	`);
	await db.execute(sql`
		DELETE FROM hindsight.entity_cooccurrences
		WHERE entity_id_1 = ${sourceEntityId}::uuid
		   OR entity_id_2 = ${sourceEntityId}::uuid
	`);
}

async function updateBankId(
	db: DbLike,
	table: BankIdTable,
	sourceBankId: string,
	destinationBankIdValue: string,
): Promise<number> {
	return executeRowCount(db, sql.raw(`
		UPDATE hindsight.${table}
		SET bank_id = ${literal(destinationBankIdValue)}
		WHERE bank_id = ${literal(sourceBankId)}
	`));
}

async function scalarCount(db: DbLike, query: ReturnType<typeof sql>): Promise<number> {
	const result = await db.execute(query);
	return Number((result.rows?.[0] as any)?.count ?? 0);
}

async function executeRowCount(db: DbLike, query: ReturnType<typeof sql>): Promise<number> {
	const result = await db.execute(query);
	return Number((result as any).rowCount ?? (result.rows?.[0] as any)?.rowCount ?? 0);
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

function literal(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}
