import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0262_auth_subscription_tickets.sql"),
  "utf8",
);

describe("0262 auth subscription tickets migration", () => {
  it("stores only the nonce digest and one-use state", () => {
    expect(migration).toContain('"nonce_digest" text NOT NULL');
    expect(migration).toContain("\"status\" text DEFAULT 'issued' NOT NULL");
    expect(migration).not.toMatch(/bearer_token|private_key|signature"/i);
  });

  it("separates connect and registration ticket shapes", () => {
    expect(migration).toContain("auth_subscription_tickets_kind_allowed");
    expect(migration).toContain("auth_subscription_tickets_operation_shape");
  });

  it("creates a durable invalidation outbox", () => {
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "auth_subscription_invalidations"',
    );
    expect(migration).toContain("idx_auth_subscription_invalidations_pending");
  });
});
