import { readFileSync } from "node:fs";
import { findOrCreateTenantEntityPage } from "../src/lib/brain/repository.js";

type SeedRow = {
	type?: "entity" | "topic" | "decision";
	subtype: string;
	slug: string;
	title: string;
	summary?: string | null;
	aliases?: string[];
};

const tenantId = process.env.TENANT_ID;
const file = process.argv[2];
if (!tenantId || !file) {
	console.error("Usage: TENANT_ID=<tenant uuid> tsx seed-tenant-entities-for-dogfood.ts rows.json");
	process.exit(1);
}

const rows = JSON.parse(readFileSync(file, "utf8")) as SeedRow[];
for (const row of rows) {
	const page = await findOrCreateTenantEntityPage({
		tenantId,
		type: row.type ?? "entity",
		subtype: row.subtype,
		slug: row.slug,
		title: row.title,
		summary: row.summary ?? null,
		aliases: row.aliases ?? [],
	});
	console.log(`${page.id},${page.entity_subtype},${page.slug},${page.title}`);
}
