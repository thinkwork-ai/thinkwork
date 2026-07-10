#!/usr/bin/env npx tsx
/**
 * One-off: make the Opportunity's Products table show Product, Quantity, and
 * Amount.
 *
 * Twenty gives a new custom object a default TABLE view whose columns are
 * `name` plus the audit fields (createdAt, createdBy, updatedAt, updatedBy).
 * So the Products section rendered a row per line with no product, no quantity,
 * and no amount — the data was all there, just never surfaced.
 *
 * This sets the opportunityProduct table view to:
 *   Product | Quantity | Amount | Line
 * and hides the audit columns. It also orders the record-page field widget the
 * same way.
 *
 * Idempotent: re-running reconciles the view to the same state.
 *
 * Usage:
 *   npx tsx scripts/configure-product-views.ts          # dry-run
 *   npx tsx scripts/configure-product-views.ts --apply
 */

import process from "node:process";

import { fetchObjectMetadata } from "./lib/schema-ensure";
import { TwentyClient, normalizeBaseUrl } from "./lib/twenty-client";

/**
 * Exactly what Eric asked for: "Each line needs to be Product Name, Quantity and
 * Amount." `name` is the record's label identifier (it holds the product name,
 * or "Line 2" for the 173 lines whose brand did not map), so it leads. Twenty
 * will not let the label identifier be hidden, which is also why it stays.
 */
const VISIBLE_COLUMNS = ["name", "quantity", "amount"] as const;

/** Noise on a line item: audit trail, internals, and the product relation whose
 * value already reads out through `name`. */
const HIDDEN_COLUMNS = [
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "sourceId",
  "sourceHash",
  "isMobil",
  "opportunity",
  "lineNumber",
  "product",
] as const;

interface ViewField {
  id: string;
  fieldMetadataId: string;
  isVisible: boolean;
  position: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes("--apply");
  const client = new TwentyClient({
    baseUrl: normalizeBaseUrl(requireEnv("TWENTY_PUBLIC_URL")),
    authToken: requireEnv("TWENTY_API_KEY"),
  });

  const objects = await fetchObjectMetadata(client);
  const line = objects.get("opportunityProduct");
  if (!line) throw new Error('Twenty object "opportunityProduct" not found.');
  const fieldIdByName = new Map(
    [...line.fields.values()].map((field) => [field.name, field.id]),
  );

  const views = await client.requestWithRetry<{
    getViews: Array<{ id: string; name: string; type: string }>;
  }>(
    "/metadata",
    `query ConfigViews($objectMetadataId: String!) {
      getViews(objectMetadataId: $objectMetadataId) { id name type }
    }`,
    { objectMetadataId: line.id },
  );

  const report: Record<string, unknown> = {
    mode: apply ? "apply" : "dry-run",
    views: views.getViews.map((view) => `${view.type}:${view.name}`),
  };
  const changes: string[] = [];

  for (const view of views.getViews) {
    const fields = await client.requestWithRetry<{
      getViewFields: ViewField[];
    }>(
      "/metadata",
      `query ConfigViewFields($viewId: String!) {
        getViewFields(viewId: $viewId) { id fieldMetadataId isVisible position }
      }`,
      { viewId: view.id },
    );
    const existingByFieldId = new Map(
      fields.getViewFields.map((field) => [field.fieldMetadataId, field]),
    );

    // Wanted columns, in order.
    for (const [index, name] of VISIBLE_COLUMNS.entries()) {
      const fieldMetadataId = fieldIdByName.get(name);
      if (!fieldMetadataId) {
        throw new Error(
          `opportunityProduct.${name} not found; run restructure-products first.`,
        );
      }
      const existing = existingByFieldId.get(fieldMetadataId);
      if (existing?.isVisible && existing.position === index) continue;

      changes.push(`${view.type}: show ${name} at ${index}`);
      if (!apply) continue;

      if (existing) {
        await client.requestOnce(
          "/metadata",
          `mutation ConfigUpdateViewField($input: UpdateViewFieldInput!) {
            updateViewField(input: $input) { id }
          }`,
          {
            input: {
              id: existing.id,
              update: { isVisible: true, position: index },
            },
          },
        );
      } else {
        await client.requestOnce(
          "/metadata",
          `mutation ConfigCreateViewField($input: CreateViewFieldInput!) {
            createViewField(input: $input) { id }
          }`,
          {
            input: {
              viewId: view.id,
              fieldMetadataId,
              isVisible: true,
              position: index,
              size: 150,
            },
          },
        );
      }
    }

    // Everything else on the line is noise in a table of deal lines.
    for (const name of HIDDEN_COLUMNS) {
      const fieldMetadataId = fieldIdByName.get(name);
      if (!fieldMetadataId) continue;
      const existing = existingByFieldId.get(fieldMetadataId);
      if (!existing || !existing.isVisible) continue;
      changes.push(`${view.type}: hide ${name}`);
      if (!apply) continue;
      await client.requestOnce(
        "/metadata",
        `mutation ConfigHideViewField($input: UpdateViewFieldInput!) {
          updateViewField(input: $input) { id }
        }`,
        { input: { id: existing.id, update: { isVisible: false } } },
      );
    }
  }

  // --- Opportunity side: render products as a TAB, not inline chips ---------
  // Every other one-to-many relation (tasks, notes, files, timeline) is HIDDEN
  // in the opportunity's record-page field widget, which is what makes Twenty
  // show it as a tab with a full table. `products` was left visible, so it
  // rendered as chips you had to click one at a time. Hiding it surfaces the
  // Products tab, whose columns we set above to Name / Quantity / Amount.
  const opportunity = objects.get("opportunity");
  if (opportunity) {
    const productsFieldId = [...opportunity.fields.values()].find(
      (field) => field.name === "products",
    )?.id;
    const oppViews = await client.requestWithRetry<{
      getViews: Array<{ id: string; type: string }>;
    }>(
      "/metadata",
      `query ConfigOppViews($objectMetadataId: String!) {
        getViews(objectMetadataId: $objectMetadataId) { id type }
      }`,
      { objectMetadataId: opportunity.id },
    );
    const widget = oppViews.getViews.find(
      (view) => view.type === "FIELDS_WIDGET",
    );
    if (widget && productsFieldId) {
      const wf = await client.requestWithRetry<{ getViewFields: ViewField[] }>(
        "/metadata",
        `query ConfigOppWidget($viewId: String!) {
          getViewFields(viewId: $viewId) { id fieldMetadataId isVisible }
        }`,
        { viewId: widget.id },
      );
      const existing = wf.getViewFields.find(
        (field) => field.fieldMetadataId === productsFieldId,
      );
      if (existing?.isVisible) {
        changes.push("opportunity widget: hide products chip (render as tab)");
        if (apply) {
          await client.requestOnce(
            "/metadata",
            `mutation ConfigHideOppProducts($input: UpdateViewFieldInput!) {
              updateViewField(input: $input) { id }
            }`,
            { input: { id: existing.id, update: { isVisible: false } } },
          );
        }
      }
    }
  }

  report.changes =
    changes.length > 0 ? changes : "none — views already correct";
  if (apply && changes.length > 0)
    log(`applied ${changes.length} view changes`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
