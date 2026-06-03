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
const migration0123 = readFileSync(
  join(HERE, "..", "drizzle", "0123_single_platform_agent_and_overrides.sql"),
  "utf-8",
);
const migration0142 = readFileSync(
  join(HERE, "..", "drizzle", "0142_pi_only_agent_runtime.sql"),
  "utf-8",
);
const rollback0142 = readFileSync(
  join(HERE, "..", "drizzle", "0142_pi_only_agent_runtime_rollback.sql"),
  "utf-8",
);

describe("agent runtime selector schema", () => {
  it("defaults agents to the Pi runtime", () => {
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
    expect(columns.is_platform_default.notNull).toBe(true);
    expect(columns.is_platform_default.default).toBe(false);
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

  it("declares the platform-agent marker and one-per-tenant index", () => {
    expect(migration0123).toMatch(
      /--\s*creates-column:\s*public\.agents\.is_platform_default\b/,
    );
    expect(migration0123).toMatch(
      /--\s*creates:\s*public\.uq_agents_platform_default_per_tenant\b/,
    );
    expect(migration0123).toMatch(
      /ADD COLUMN IF NOT EXISTS is_platform_default boolean\b/,
    );
    expect(migration0123).toContain(
      "ALTER COLUMN is_platform_default SET DEFAULT false",
    );
    expect(migration0123).toContain(
      "ALTER COLUMN is_platform_default SET NOT NULL",
    );
    expect(migration0123).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_platform_default_per_tenant",
    );
    expect(migration0123).toContain("WHERE is_platform_default IS TRUE");
  });

  it("defaults agent templates to the Pi runtime", () => {
    const columns = getTableColumns(agentTemplates);
    expect(columns.runtime.notNull).toBe(true);
    expect(columns.runtime.hasDefault).toBe(true);
  });

  it("backfills legacy runtime values and tightens constraints to Pi-only", () => {
    expect(migration0142).toMatch(
      /--\s*creates-constraint:\s*public\.agents\.agents_runtime_check\b/,
    );
    expect(migration0142).toMatch(
      /--\s*creates-constraint:\s*public\.agent_templates\.agent_templates_runtime_check\b/,
    );
    expect(migration0142).toContain("WHERE runtime IN ('strands', 'flue')");
    expect(migration0142).toContain("ALTER COLUMN runtime SET DEFAULT 'pi'");
    expect(migration0142).toContain("CHECK (runtime = 'pi')");
    expect(rollback0142).toContain("CHECK (runtime IN ('strands', 'pi'))");
  });
});
