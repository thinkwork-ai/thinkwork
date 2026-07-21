#!/usr/bin/env npx tsx
/**
 * One-off: turn opportunity products into a catalog + line-item model, and drop
 * the legacy opportunity fields the first import left behind.
 *
 * Before: each line carried a free-text `product` holding one of 19 spellings
 * of TEI's seven product lines ("MOBIL", "Mobil", "MOBIL - CVL", "GWO - PVL").
 * The opportunity itself also carried leftover `product` and `quantity` fields
 * that nothing writes any more.
 *
 * After: a `Product` catalog object holds exactly the seven lines LastMile
 * offers (Ancillary, DEF, Fuel, Golden West, Hotsy, Mighty, Mobil), and each
 * opportunity product line points at one. The Opportunity detail shows a
 * Products section whose rows read Product / Quantity / Amount.
 *
 * Phases, in order, because each depends on the last:
 *   1. DROP     legacy `opportunity.product` and `opportunity.quantity`
 *   2. DROP     the free-text `opportunityProduct.product` (a RELATION cannot
 *               be created while a field of that name exists)
 *   3. CREATE   the `product` object, its sourceId, and seed the seven records
 *   4. RELATE   `opportunityProduct.product` -> `product` (MANY_TO_ONE)
 *   5. VERIFY   the relation is queryable before anything writes to it
 *
 * Then run `migrate-lastmile.ts --apply`: it rewrites every line with its
 * catalog product, quantity, and amount from LastMile. Nothing is derived from
 * the fields this script drops.
 *
 * Usage:
 *   npx tsx scripts/restructure-products.ts          # dry-run: show the plan
 *   npx tsx scripts/restructure-products.ts --apply
 */

import process from "node:process";

import {
  emptyCounters,
  upsertRecords,
  type EntityShape,
} from "./lib/load-records";
import { mapProduct, PRODUCT_CATALOG } from "./lib/mappers";
import {
  fetchObjectMetadata,
  LEGACY_OPPORTUNITY_FIELDS,
  PRODUCT_OBJECT,
} from "./lib/schema-ensure";
import { TwentyClient, normalizeBaseUrl } from "./lib/twenty-client";

const PRODUCT: EntityShape = {
  singular: "product",
  plural: "products",
  capSingular: "Product",
  capPlural: "Products",
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function deleteField(
  client: TwentyClient,
  fieldId: string,
): Promise<void> {
  // Twenty requires a field be deactivated before it can be deleted.
  await client.requestOnce(
    "/metadata",
    `mutation RestructureDeactivate($input: UpdateOneFieldMetadataInput!) {
      updateOneField(input: $input) { id }
    }`,
    { input: { id: fieldId, update: { isActive: false } } },
  );
  await client.requestOnce(
    "/metadata",
    `mutation RestructureDeleteField($input: DeleteOneFieldInput!) {
      deleteOneField(input: $input) { id }
    }`,
    { input: { id: fieldId } },
  );
}

/**
 * A newly created object or field is not usable the instant metadata accepts
 * it — the same lag that silently coerced 1,510 stage values, and that made the
 * first run of this script fail all 7 catalog inserts. Probe until it answers.
 */
async function waitForQuery(
  client: TwentyClient,
  query: string,
  what: string,
  attempts = 15,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await client.requestOnce("/graphql", query);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  throw new Error(`${what} never became queryable; refusing to continue.`);
}

/** A relation is not usable the instant metadata accepts it. Probe until it answers. */
async function waitForRelation(
  client: TwentyClient,
  attempts = 15,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await client.requestWithRetry(
        "/graphql",
        `query RestructureProbe {
          opportunityProducts(first: 1) { edges { node { id product { id } } } }
        }`,
      );
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  throw new Error(
    "opportunityProduct.product relation never became queryable; refusing to continue.",
  );
}

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes("--apply");
  const client = new TwentyClient({
    baseUrl: normalizeBaseUrl(requireEnv("TWENTY_PUBLIC_URL")),
    authToken: requireEnv("TWENTY_API_KEY"),
  });

  let objects = await fetchObjectMetadata(client);
  const report: Record<string, unknown> = { mode: apply ? "apply" : "dry-run" };

  // --- 1 + 2: drop legacy and free-text fields ----------------------------
  const opportunity = objects.get("opportunity");
  const line = objects.get("opportunityProduct");
  if (!opportunity) throw new Error('Twenty object "opportunity" not found.');

  const toDrop: Array<{ label: string; id: string }> = [];
  for (const name of LEGACY_OPPORTUNITY_FIELDS) {
    const field = opportunity.fields.get(name);
    if (field) toDrop.push({ label: `opportunity.${name}`, id: field.id });
  }
  const existingLineProduct = line?.fields.get("product");
  if (existingLineProduct && existingLineProduct.type !== "RELATION") {
    toDrop.push({
      label: "opportunityProduct.product (TEXT)",
      id: existingLineProduct.id,
    });
  }
  report.dropFields = toDrop.map((field) => field.label);

  if (apply) {
    for (const field of toDrop) {
      log(`dropping ${field.label}...`);
      await deleteField(client, field.id);
    }
    if (toDrop.length > 0) objects = await fetchObjectMetadata(client);
  }

  // --- 3: create the catalog object and seed it ---------------------------
  const productExists = objects.has(PRODUCT_OBJECT.nameSingular);
  report.createProductObject = !productExists;
  report.catalog = [...PRODUCT_CATALOG];

  if (apply && !productExists) {
    log("creating the Product catalog object...");
    await client.requestOnce(
      "/metadata",
      `mutation RestructureCreateObject($input: CreateOneObjectInput!) {
        createOneObject(input: $input) { id }
      }`,
      {
        input: {
          object: {
            nameSingular: PRODUCT_OBJECT.nameSingular,
            namePlural: PRODUCT_OBJECT.namePlural,
            labelSingular: PRODUCT_OBJECT.labelSingular,
            labelPlural: PRODUCT_OBJECT.labelPlural,
            icon: PRODUCT_OBJECT.icon,
          },
        },
      },
    );
    objects = await fetchObjectMetadata(client);
  }

  if (apply) {
    const product = objects.get(PRODUCT_OBJECT.nameSingular);
    if (!product) throw new Error("product object missing after creation.");
    // Both fields: the upsert writes sourceId to find the record and sourceHash
    // to decide whether it changed.
    const productFields: Array<{
      name: string;
      label: string;
      unique: boolean;
    }> = [
      { name: "sourceId", label: "Source ID", unique: true },
      { name: "sourceHash", label: "Source Hash", unique: false },
    ];
    let createdAny = false;
    for (const field of productFields) {
      if (product.fields.has(field.name)) continue;
      log(`creating product.${field.name}...`);
      await client.requestOnce(
        "/metadata",
        `mutation RestructureCreateField($input: CreateOneFieldMetadataInput!) {
          createOneField(input: $input) { id }
        }`,
        {
          input: {
            field: {
              objectMetadataId: product.id,
              name: field.name,
              label: field.label,
              type: "TEXT",
              ...(field.unique ? { isUnique: true } : {}),
            },
          },
        },
      );
      createdAny = true;
    }
    if (createdAny) objects = await fetchObjectMetadata(client);

    log("waiting for the product object and sourceId to go live...");
    await waitForQuery(
      client,
      `query RestructureProductProbe {
        products(filter: { sourceId: { is: "NOT_NULL" } }, first: 1) {
          edges { node { id sourceHash } }
        }
      }`,
      "product.sourceId / product.sourceHash",
    );

    log(`seeding ${PRODUCT_CATALOG.length} catalog products...`);
    const counters = emptyCounters();
    await upsertRecords({
      client,
      entity: PRODUCT,
      mapped: PRODUCT_CATALOG.map(mapProduct),
      dryRun: false,
      counters,
    });
    report.catalogSeed = {
      created: counters.created,
      skipped: counters.skipped,
      failed: counters.failed,
      gaps: counters.gaps.slice(0, 5),
    };
    if (counters.failed > 0) {
      throw new Error(
        `Catalog seed failed for ${counters.failed} product(s): ${counters.gaps[0] ?? "unknown"}`,
      );
    }
  }

  // --- 4 + 5: relate the line to the catalog, then verify ------------------
  const lineAfter = objects.get("opportunityProduct");
  const hasRelation = lineAfter?.fields.get("product")?.type === "RELATION";
  report.createRelation = !hasRelation;

  if (apply && !hasRelation) {
    const product = objects.get(PRODUCT_OBJECT.nameSingular);
    if (!product || !lineAfter)
      throw new Error("objects missing for relation.");
    log("relating opportunityProduct.product -> product...");
    await client.requestOnce(
      "/metadata",
      `mutation RestructureRelate($input: CreateOneFieldMetadataInput!) {
        createOneField(input: $input) { id }
      }`,
      {
        input: {
          field: {
            objectMetadataId: lineAfter.id,
            name: "product",
            label: "Product",
            type: "RELATION",
            relationCreationPayload: {
              targetObjectMetadataId: product.id,
              targetFieldLabel: PRODUCT_OBJECT.targetFieldLabel,
              targetFieldIcon: PRODUCT_OBJECT.icon,
              type: "MANY_TO_ONE",
            },
          },
        },
      },
    );
    log("waiting for the relation to go live...");
    await waitForRelation(client);
  }

  report.next =
    "run migrate-lastmile.ts --apply to point every line at its catalog product";
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
