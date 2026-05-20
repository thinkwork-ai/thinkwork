import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { agents } from "../src/schema/agents";
import { agentTemplates } from "../src/schema/agent-templates";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0113 = readFileSync(
  join(HERE, "..", "drizzle", "0113_agents_own_runtime_fields.sql"),
  "utf-8",
);

describe("agent runtime selector schema", () => {
  it("defaults agents to the Strands runtime", () => {
    const columns = getTableColumns(agents);
    expect(columns.runtime.notNull).toBe(true);
    expect(columns.runtime.hasDefault).toBe(true);
  });

  it("models direct Agent runtime and operational policy fields", () => {
    const columns = getTableColumns(agents);

    expect(columns.template_id.notNull).toBe(false);
    expect(columns.model.notNull).toBe(false);
    expect(columns.guardrail_id.notNull).toBe(false);
    expect(columns.blocked_tools.notNull).toBe(false);
    expect(columns.sandbox.notNull).toBe(false);
    expect(columns.browser.notNull).toBe(false);
    expect(columns.web_search.notNull).toBe(false);
    expect(columns.send_email.notNull).toBe(false);
    expect(columns.context_engine.notNull).toBe(false);
  });

  it("declares manual migration drift markers for Agent-owned runtime fields", () => {
    for (const column of [
      "model",
      "guardrail_id",
      "blocked_tools",
      "sandbox",
      "browser",
      "web_search",
      "send_email",
      "context_engine",
    ]) {
      expect(migration0113).toMatch(
        new RegExp(`--\\s*creates-column:\\s*public\\.agents\\.${column}\\b`),
      );
      expect(migration0113).toMatch(
        new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`),
      );
    }
    expect(migration0113).toContain("ALTER COLUMN template_id DROP NOT NULL");
    expect(migration0113).toContain("agents_guardrail_id_guardrails_id_fk");
  });

  it("defaults agent templates to the Strands runtime", () => {
    const columns = getTableColumns(agentTemplates);
    expect(columns.runtime.notNull).toBe(true);
    expect(columns.runtime.hasDefault).toBe(true);
  });
});
