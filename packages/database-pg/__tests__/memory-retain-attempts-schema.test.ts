import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  memoryRetainAttempts,
  memoryRetainAttemptStatuses,
} from "../src/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0194 = readFileSync(
  join(HERE, "..", "drizzle", "0194_memory_retain_attempts.sql"),
  "utf-8",
);

describe("memory retain attempts schema", () => {
  it("models durable retain attempt identity and retry state", () => {
    expect(getTableName(memoryRetainAttempts)).toBe("memory_retain_attempts");

    const columns = getTableColumns(memoryRetainAttempts);
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.user_id.notNull).toBe(false);
    expect(columns.space_id.notNull).toBe(false);
    expect(columns.thread_id.notNull).toBe(true);
    expect(columns.thread_turn_id.notNull).toBe(false);
    expect(columns.source_event_key.notNull).toBe(true);
    expect(columns.source_event_type.notNull).toBe(true);
    expect(columns.provider.notNull).toBe(true);
    expect(columns.status.notNull).toBe(true);
    expect(columns.attempt_count.notNull).toBe(true);
    expect(columns.max_attempts.notNull).toBe(true);
    expect(columns.next_retry_at.notNull).toBe(false);
    expect(columns.locked_at.notNull).toBe(false);
    expect(columns.locked_by.notNull).toBe(false);
    expect(columns.started_at.notNull).toBe(false);
    expect(columns.finished_at.notNull).toBe(false);
    expect(columns.backend_latency_ms.notNull).toBe(false);
    expect(columns.provider_document_id.notNull).toBe(false);
    expect(columns.provider_result.notNull).toBe(false);
    expect(columns.error_class.notNull).toBe(false);
    expect(columns.error_message.notNull).toBe(false);
    expect(columns.metadata.notNull).toBe(false);
    expect(columns.created_at.notNull).toBe(true);
    expect(columns.updated_at.notNull).toBe(true);
  });

  it("declares stable retain attempt statuses", () => {
    expect(memoryRetainAttemptStatuses).toEqual([
      "queued",
      "running",
      "retained",
      "failed_timeout",
      "failed_backend",
      "dead_lettered",
    ]);
    expect(migration0194).toContain(
      "CHECK (status IN ('queued','running','retained','failed_timeout','failed_backend','dead_lettered'))",
    );
  });

  it("enforces idempotency by tenant, thread, and source event", () => {
    expect(migration0194).toContain(
      "-- creates: public.memory_retain_attempts_source_event_uidx",
    );
    expect(migration0194).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS memory_retain_attempts_source_event_uidx",
    );
    expect(migration0194).toMatch(
      /ON public\.memory_retain_attempts \(tenant_id, thread_id, source_event_key\)/,
    );
  });

  it("indexes retry, diagnostic, and owner lookups", () => {
    for (const indexName of [
      "memory_retain_attempts_due_idx",
      "memory_retain_attempts_tenant_status_idx",
      "memory_retain_attempts_thread_idx",
      "memory_retain_attempts_user_idx",
      "memory_retain_attempts_space_idx",
      "memory_retain_attempts_turn_idx",
    ]) {
      expect(migration0194).toContain(`-- creates: public.${indexName}`);
      expect(migration0194).toContain(
        `CREATE INDEX IF NOT EXISTS ${indexName}`,
      );
    }
  });

  it("declares manual migration markers for drift reporting", () => {
    for (const marker of [
      "creates: public.memory_retain_attempts",
      "creates-constraint: public.memory_retain_attempts.memory_retain_attempts_tenant_id_tenants_id_fk",
      "creates-constraint: public.memory_retain_attempts.memory_retain_attempts_user_id_users_id_fk",
      "creates-constraint: public.memory_retain_attempts.memory_retain_attempts_space_id_spaces_id_fk",
      "creates-constraint: public.memory_retain_attempts.memory_retain_attempts_thread_id_threads_id_fk",
      "creates-constraint: public.memory_retain_attempts.memory_retain_attempts_thread_turn_id_thread_turns_id_fk",
      "creates-constraint: public.memory_retain_attempts.memory_retain_attempts_status_allowed",
      "creates-constraint: public.memory_retain_attempts.memory_retain_attempts_attempt_count_nonnegative",
      "creates-constraint: public.memory_retain_attempts.memory_retain_attempts_max_attempts_positive",
    ]) {
      expect(migration0194).toContain(`-- ${marker}`);
    }
  });
});
