/**
 * Usage Sync Lambda
 *
 * Runs on a 5-minute EventBridge schedule.
 * Reads LiteLLM_SpendLogs from Aurora (last 10 minutes with overlap)
 * and POSTs each record to Convex /usage/sync for deduplication + storage.
 *
 * v1: All records stored under a single tenantId (USAGE_SYNC_TENANT_ID).
 * v2: Per-tenant attribution once virtual key → tenant mapping exists.
 */

import { Client } from "pg";

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function extractRequestTags(metadata: any, requestTags: unknown): string[] {
  const fromRequestTags = toStringArray(requestTags);
  const fromTopLevel = toStringArray(metadata?.tags);
  const fromNested = toStringArray(metadata?.metadata?.tags);
  const merged = [...fromRequestTags, ...fromTopLevel, ...fromNested];
  return [...new Set(merged)];
}

export async function handler() {
  const dbClient = new Client({
    host: process.env.DB_HOST,
    port: 5432,
    database: "thinkwork",
    user: "thinkwork_admin",
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });

  await dbClient.connect();

  try {
    // Query the last 10 minutes (overlap is safe — Convex dedupes by requestId)
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const result = await dbClient.query(
      `SELECT
         "request_id",
         "model",
         "spend",
         "total_tokens",
         "prompt_tokens",
         "completion_tokens",
         extract(epoch from "startTime") * 1000 AS ts,
         "user",
         "end_user",
         "request_tags",
         "metadata"
       FROM "LiteLLM_SpendLogs"
       WHERE "status" = 'success'
         AND "startTime" > $1
       ORDER BY "startTime" ASC`,
      [tenMinAgo],
    );

    const convexSyncUrl = process.env.CONVEX_SYNC_URL;
    const syncSecret = process.env.SYNC_SECRET;

    if (!convexSyncUrl || !syncSecret) {
      throw new Error("CONVEX_SYNC_URL and SYNC_SECRET environment variables are required");
    }

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of result.rows) {
      try {
        const response = await fetch(convexSyncUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${syncSecret}`,
          },
          body: JSON.stringify({
            requestId: row.request_id,
            model: row.model ?? "unknown",
            promptTokens: Number(row.prompt_tokens ?? 0),
            completionTokens: Number(row.completion_tokens ?? 0),
            totalTokens: Number(row.total_tokens ?? 0),
            cost: Number(row.spend ?? 0),
            timestamp: Math.round(Number(row.ts ?? Date.now())),
            tags: extractRequestTags(row.metadata, row.request_tags),
            metadata: {
              ...(row.metadata ?? {}),
              user: row.user ?? undefined,
              end_user: row.end_user ?? undefined,
              request_tags: row.request_tags ?? undefined,
            },
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          console.error(`Failed to sync requestId=${row.request_id}: ${response.status} ${text}`);
          errors++;
          continue;
        }

        const json = (await response.json()) as { ok?: boolean; skipped?: boolean };
        if (json.skipped) {
          skipped++;
        } else {
          synced++;
        }
      } catch (err) {
        console.error(`Error syncing requestId=${row.request_id}:`, err);
        errors++;
      }
    }

    const summary = {
      total: result.rows.length,
      synced,
      skipped,
      errors,
    };
    console.log("Usage sync complete:", summary);
    return summary;
  } finally {
    await dbClient.end();
  }
}
