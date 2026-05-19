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
