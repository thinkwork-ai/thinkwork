import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { spaces } from "../src/schema/spaces";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0114 = readFileSync(
  join(
    HERE,
    "..",
    "drizzle",
    "0114_migrate_templates_to_agents_and_spaces.sql",
  ),
  "utf-8",
);

describe("agent Template removal migration", () => {
  it("declares a drift marker for the migrated Template Space lookup index", () => {
    expect(migration0114).toMatch(
      /--\s*creates:\s*public\.idx_spaces_migrated_template\b/,
    );
    expect(migration0114).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_spaces_migrated_template\s+ON public\.spaces \(tenant_id, template_key\)\s+WHERE template_key LIKE 'agent-template:%'/,
    );
  });

  it("seeds tenant default Spaces and migrated Template Spaces idempotently", () => {
    expect(migration0114).toContain("'default'");
    expect(migration0114).toContain("'agent-template:' || t.slug");
    expect(migration0114).toContain("ON CONFLICT (tenant_id, slug)");
    expect(migration0114).toContain(
      "workspaceSourcePrefix', format('tenants/%s/spaces/default/source/'",
    );
  });

  it("copies Template runtime and contextual bindings forward", () => {
    expect(migration0114).toContain("UPDATE public.agents a");
    expect(migration0114).toContain("runtime = COALESCE(t.runtime");
    expect(migration0114).toContain("INSERT INTO public.agent_skills");
    expect(migration0114).toContain("INSERT INTO public.agent_knowledge_bases");
    expect(migration0114).toContain("INSERT INTO public.agent_mcp_servers");
    expect(migration0114).toContain("INSERT INTO public.space_mcp_servers");
    expect(migration0114).toContain(
      "INSERT INTO public.space_agent_assignments",
    );
  });

  it("models the migrated Template lookup index in the Drizzle schema", () => {
    const config = getTableConfig(spaces);
    expect(config.indexes.map((index) => index.config.name)).toContain(
      "idx_spaces_migrated_template",
    );
  });
});
