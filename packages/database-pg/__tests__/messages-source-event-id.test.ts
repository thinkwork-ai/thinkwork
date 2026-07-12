import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { messages } from "../src/schema/messages";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0232 = readFileSync(
  join(HERE, "..", "drizzle", "0232_message_source_event_id.sql"),
  "utf-8",
);

describe("message source-event idempotency", () => {
  it("adds a nullable source event id to normal messages", () => {
    const columns = getTableColumns(messages);

    expect(columns.source_event_id.notNull).toBe(false);
  });

  it("enforces tenant-scoped uniqueness only for provider events", () => {
    expect(migration0232).toContain(
      "-- creates-column: public.messages.source_event_id",
    );
    expect(migration0232).toContain(
      "-- creates: public.uq_messages_tenant_source_event_id",
    );
    expect(migration0232).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_tenant_source_event_id\s+ON public\.messages \(tenant_id, source_event_id\)\s+WHERE source_event_id IS NOT NULL/,
    );
  });
});
