import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { threadParticipants } from "../src/schema/thread-participants";
import { threads } from "../src/schema/threads";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0106 = readFileSync(
  join(HERE, "..", "drizzle", "0106_space_threads_participants.sql"),
  "utf-8",
);
const migration0137 = readFileSync(
  join(HERE, "..", "drizzle", "0137_thread_participant_pins.sql"),
  "utf-8",
);
const rollback0137 = readFileSync(
  join(HERE, "..", "drizzle", "0137_thread_participant_pins_rollback.sql"),
  "utf-8",
);

describe("Space thread participants schema", () => {
  it("requires every Thread to belong to a Space", () => {
    const columns = getTableColumns(threads);

    expect(columns.space_id.notNull).toBe(true);
  });

  it("models human and agent Thread participants separately from ownership", () => {
    const columns = getTableColumns(threadParticipants);

    expect(getTableName(threadParticipants)).toBe("thread_participants");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.thread_id.notNull).toBe(true);
    expect(columns.space_id.notNull).toBe(true);
    expect(columns.participant_type.notNull).toBe(true);
    expect(columns.user_id.notNull).toBe(false);
    expect(columns.agent_id.notNull).toBe(false);
    expect(columns.role.default).toBe("member");
    expect(columns.source.default).toBe("manual");
    expect(columns.notification_preference.default).toBe("subscribed");
    expect(columns.last_read_at.notNull).toBe(false);
  });

  it("models per-user thread pin state", () => {
    const columns = getTableColumns(threadParticipants);

    expect(columns.pinned_at.notNull).toBe(false);
    expect(columns.pin_order.notNull).toBe(false);
  });

  it("declares participant-scoped read-state migration markers", () => {
    const migration0110 = readFileSync(
      join(HERE, "..", "drizzle", "0110_thread_participant_read_state.sql"),
      "utf-8",
    );

    for (const marker of [
      "creates-column: public.thread_participants.last_read_at",
      "creates: public.idx_thread_participants_user_unread",
    ]) {
      expect(migration0110).toContain(`-- ${marker}`);
    }
    expect(migration0110).toContain("ADD COLUMN IF NOT EXISTS last_read_at");
    expect(migration0110).toContain(
      "WHERE participant_type = 'user' AND user_id IS NOT NULL",
    );
  });

  it("declares manual migration drift markers for thread pin state", () => {
    expect(migration0137).toMatch(
      /--\s*creates-column:\s*public\.thread_participants\.pinned_at\b/,
    );
    expect(migration0137).toMatch(
      /--\s*creates-column:\s*public\.thread_participants\.pin_order\b/,
    );
    expect(migration0137).toMatch(
      /--\s*creates:\s*public\.idx_thread_participants_user_pins\b/,
    );
    expect(migration0137).toMatch(/ADD COLUMN IF NOT EXISTS pinned_at\b/);
    expect(migration0137).toMatch(/ADD COLUMN IF NOT EXISTS pin_order\b/);
    expect(migration0137).toContain(
      "CREATE INDEX IF NOT EXISTS idx_thread_participants_user_pins",
    );
  });

  it("rolls back pin state without touching participant read state", () => {
    expect(rollback0137).toContain(
      "DROP INDEX IF EXISTS public.idx_thread_participants_user_pins",
    );
    expect(rollback0137).toMatch(/DROP COLUMN IF EXISTS pin_order\b/);
    expect(rollback0137).toMatch(/DROP COLUMN IF EXISTS pinned_at\b/);
    expect(rollback0137).not.toContain("last_read_at");
  });

  it("declares the access backfill migration for owners and mentioned users", () => {
    const migration0116 = readFileSync(
      join(
        HERE,
        "..",
        "drizzle",
        "0116_backfill_thread_participants_access.sql",
      ),
      "utf-8",
    );

    expect(migration0116).toContain(
      "-- creates: public.view_thread_participants_access_backfilled",
    );
    expect(migration0116).toContain("FROM public.threads t");
    expect(migration0116).toContain("t.user_id IS NOT NULL");
    expect(migration0116).toContain("FROM public.message_mentions mm");
    expect(migration0116).toContain("WHERE mm.target_type = 'user'");
    expect(migration0116).toContain(
      "ON CONFLICT (tenant_id, thread_id, user_id)",
    );
    expect(migration0116).toContain("DO NOTHING");
  });

  it("declares manual migration markers for Space thread objects", () => {
    for (const marker of [
      "creates-column: public.threads.space_id",
      "creates: public.idx_threads_tenant_space_updated",
      "creates: public.thread_participants",
      "creates: public.uq_thread_participants_user",
      "creates: public.uq_thread_participants_agent",
      "creates-function: public.enforce_thread_participant_tenant",
      "creates-function: public.enforce_thread_space_tenant",
      "creates-trigger: public.thread_participants.thread_participants_tenant_guard",
      "creates-trigger: public.threads.threads_space_tenant_guard",
    ]) {
      expect(migration0106).toContain(`-- ${marker}`);
    }
  });

  it("guards Thread participants against cross-tenant and cross-Space references", () => {
    expect(migration0106).toMatch(
      /CREATE OR REPLACE FUNCTION public\.enforce_thread_space_tenant\(\)/,
    );
    expect(migration0106).toContain(
      "CREATE TRIGGER threads_space_tenant_guard",
    );
    expect(migration0106).toContain("thread space tenant mismatch");
    expect(migration0106).toMatch(
      /CREATE OR REPLACE FUNCTION public\.enforce_thread_participant_tenant\(\)/,
    );
    expect(migration0106).toContain(
      "CREATE TRIGGER thread_participants_tenant_guard",
    );
    expect(migration0106).toContain("thread participant tenant mismatch");
    expect(migration0106).toContain("thread participant space mismatch");
    expect(migration0106).toMatch(
      /CHECK \(participant_type IN \('user', 'agent'\)\)/,
    );
  });
});
