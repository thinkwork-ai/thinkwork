import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { messageMentions, messages } from "../src/schema/messages";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0108 = readFileSync(
  join(HERE, "..", "drizzle", "0108_message_mentions.sql"),
  "utf-8",
);

describe("Message mentions schema", () => {
  it("models structured mentions attached to Thread messages", () => {
    const messageColumns = getTableColumns(messages);
    const mentionColumns = getTableColumns(messageMentions);

    expect(messageColumns.sender_type.notNull).toBe(false);
    expect(messageColumns.sender_id.notNull).toBe(false);
    expect(getTableName(messageMentions)).toBe("message_mentions");
    expect(mentionColumns.tenant_id.notNull).toBe(true);
    expect(mentionColumns.thread_id.notNull).toBe(true);
    expect(mentionColumns.message_id.notNull).toBe(true);
    expect(mentionColumns.target_type.notNull).toBe(true);
    expect(mentionColumns.target_id.notNull).toBe(true);
    expect(mentionColumns.display_name.notNull).toBe(true);
    expect(mentionColumns.raw_text.notNull).toBe(false);
    expect(mentionColumns.start_offset.notNull).toBe(false);
    expect(mentionColumns.end_offset.notNull).toBe(false);
  });

  it("declares manual migration markers for message mention objects", () => {
    for (const marker of [
      "creates: public.message_mentions",
      "creates: public.uq_message_mentions_target",
      "creates: public.idx_message_mentions_thread",
      "creates: public.idx_message_mentions_target",
      "creates-function: public.enforce_message_mention_tenant",
      "creates-trigger: public.message_mentions.message_mentions_tenant_guard",
      "creates-constraint: public.message_mentions.message_mentions_tenant_id_tenants_id_fk",
      "creates-constraint: public.message_mentions.message_mentions_thread_id_threads_id_fk",
      "creates-constraint: public.message_mentions.message_mentions_message_id_messages_id_fk",
      "creates-constraint: public.message_mentions.message_mentions_target_type_allowed",
    ]) {
      expect(migration0108).toContain(`-- ${marker}`);
    }
  });

  it("guards mentions against cross-message thread and tenant references", () => {
    expect(migration0108).toMatch(
      /CREATE OR REPLACE FUNCTION public\.enforce_message_mention_tenant\(\)/,
    );
    expect(migration0108).toContain(
      "CREATE TRIGGER message_mentions_tenant_guard",
    );
    expect(migration0108).toContain("message_mentions tenant mismatch");
    expect(migration0108).toContain("message_mentions thread mismatch");
    expect(migration0108).toMatch(
      /CHECK \(target_type IN \('user', 'agent'\)\)/,
    );
  });
});
