import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../drizzle/0264_harness_tool_execution_ledger.sql", import.meta.url),
  "utf8",
);

describe("Harness target-side tool execution ledger schema", () => {
  it("defines one append-only start and terminal event contract", async () => {
    const schema = await import("../src/schema/harness-multiplayer.js");
    expect(schema.harnessToolExecutionEvents).toBeDefined();
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS public.harness_tool_execution_events",
    );
    expect(migration).toContain(
      "event_type IN ('started','completed','failed','uncertain')",
    );
    expect(migration).toContain("uq_harness_tool_execution_started");
    expect(migration).toContain("uq_harness_tool_execution_terminal");
    expect(migration).toContain("reject_harness_tool_execution_event_mutation");
    expect(migration).toContain("validate_harness_tool_execution_event_insert");
  });

  it("persists correlation and sanitized previews without credential columns", () => {
    for (const column of [
      "tenant_id",
      "thread_id",
      "turn_id",
      "principal_type",
      "principal_id",
      "tool_use_id",
      "operation",
      "policy_revision",
      "idempotency_key",
      "input_preview",
      "output_preview",
      "error_preview",
    ]) {
      expect(migration).toMatch(new RegExp(`\\b${column}\\b`));
    }
    for (const forbidden of [
      "access_token",
      "refresh_token",
      "cookie",
      "authorization_header",
      "vault_handle",
    ]) {
      expect(migration).not.toMatch(new RegExp(`\\b${forbidden}\\b`, "i"));
    }
  });
});
