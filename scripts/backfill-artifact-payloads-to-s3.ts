#!/usr/bin/env tsx

import { and, eq, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@thinkwork/database-pg";
import {
	artifacts,
	messageArtifacts,
} from "@thinkwork/database-pg/schema";
import {
	appletStatePayloadKey,
	artifactContentKey,
	messageArtifactContentKey,
	writeArtifactJsonPayloadToS3,
	writeArtifactPayloadToS3,
} from "../packages/api/src/lib/artifacts/payload-storage.js";

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const limit = Number(
	process.argv
		.slice(2)
		.find((arg) => arg.startsWith("--limit="))
		?.split("=")[1] ?? 500,
);

const db = getDb();

async function main() {
	const counters = {
		artifactContent: 0,
		appletState: 0,
		messageArtifactContent: 0,
	};

	counters.artifactContent = await backfillArtifactContent();
	counters.appletState = await backfillAppletStatePayloads();
	counters.messageArtifactContent = await backfillMessageArtifactContent();

	console.log(
		JSON.stringify(
			{
				mode: write ? "write" : "dry-run",
				limit,
				...counters,
			},
			null,
			2,
		),
	);
}

async function backfillArtifactContent() {
	const rows = await db
		.select()
		.from(artifacts)
		.where(
			and(
				isNotNull(artifacts.content),
				isNull(artifacts.s3_key),
				notInArray(artifacts.type, ["applet", "applet_state"]),
			),
		)
		.limit(limit);

	for (const row of rows) {
		const key = artifactContentKey({
			tenantId: row.tenant_id,
			artifactId: row.id,
			revision: randomUUID(),
		});
		if (!write) continue;
		await writeArtifactPayloadToS3({
			tenantId: row.tenant_id,
			key,
			body: row.content ?? "",
			contentType: "text/markdown; charset=utf-8",
		});
		await db
			.update(artifacts)
			.set({ content: null, s3_key: key, updated_at: new Date() })
			.where(
				and(
					eq(artifacts.id, row.id),
					isNull(artifacts.s3_key),
					eq(artifacts.updated_at, row.updated_at),
				),
			);
	}

	return rows.length;
}

async function backfillAppletStatePayloads() {
	const rows = await db
		.select()
		.from(artifacts)
		.where(
			and(
				eq(artifacts.type, "applet_state"),
				isNull(artifacts.s3_key),
				sql`${artifacts.metadata} ? 'value'`,
			),
		)
		.limit(limit);

	for (const row of rows) {
		const metadata = parseMetadata(row.metadata);
		if (!metadata) continue;
		const key = appletStatePayloadKey({
			tenantId: row.tenant_id,
			appId: metadata.appId,
			instanceId: metadata.instanceId,
			stateKey: metadata.key,
			revision: randomUUID(),
		});
		if (!write) continue;
		await writeArtifactJsonPayloadToS3({
			tenantId: row.tenant_id,
			key,
			value: metadata.value,
		});
		const { value: _value, ...metadataWithoutValue } = metadata;
		await db
			.update(artifacts)
			.set({
				s3_key: key,
				metadata: metadataWithoutValue,
				updated_at: new Date(),
			})
			.where(
				and(
					eq(artifacts.id, row.id),
					isNull(artifacts.s3_key),
					eq(artifacts.updated_at, row.updated_at),
				),
			);
	}

	return rows.length;
}

async function backfillMessageArtifactContent() {
	const rows = await db
		.select()
		.from(messageArtifacts)
		.where(
			and(
				isNotNull(messageArtifacts.content),
				isNull(messageArtifacts.s3_key),
			),
		)
		.limit(limit);

	for (const row of rows) {
		const key = messageArtifactContentKey({
			tenantId: row.tenant_id,
			messageArtifactId: row.id,
			revision: randomUUID(),
		});
		if (!write) continue;
		await writeArtifactPayloadToS3({
			tenantId: row.tenant_id,
			key,
			body: row.content ?? "",
			contentType: row.mime_type ?? "text/plain; charset=utf-8",
		});
		await db
			.update(messageArtifacts)
			.set({
				content: null,
				s3_key: key,
				size_bytes: row.size_bytes ?? Buffer.byteLength(row.content ?? "", "utf8"),
			})
			.where(
				and(
					eq(messageArtifacts.id, row.id),
					isNull(messageArtifacts.s3_key),
					eq(messageArtifacts.content, row.content),
				),
			);
	}

	return rows.length;
}

function parseMetadata(input: unknown) {
	if (!input || typeof input !== "object" || Array.isArray(input)) return null;
	const metadata = input as Record<string, unknown>;
	if (metadata.kind !== "computer_applet_state") return null;
	if (metadata.schemaVersion !== 1) return null;
	if (typeof metadata.appId !== "string") return null;
	if (typeof metadata.instanceId !== "string") return null;
	if (typeof metadata.key !== "string") return null;
	return metadata as {
		schemaVersion: 1;
		kind: "computer_applet_state";
		appId: string;
		instanceId: string;
		key: string;
		value: unknown;
	};
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
