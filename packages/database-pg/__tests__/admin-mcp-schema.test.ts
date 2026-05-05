import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";

import { agentTemplates } from "../src/schema/agent-templates";
import {
  adminMcpServers,
  agentAdminMcpServers,
  agentTemplateAdminMcpServers,
} from "../src/schema/admin-mcp-servers";

const HERE = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  join(HERE, "..", "drizzle", "0065_admin_mcp_separation.sql"),
  "utf-8",
);
const rollbackSql = readFileSync(
  join(HERE, "..", "drizzle", "0065_admin_mcp_separation_rollback.sql"),
  "utf-8",
);

describe("admin MCP separation — schema shape (U1)", () => {
  it("adds is_admin to agent_templates with notNull + default", () => {
    const columns = getTableColumns(agentTemplates);
    expect(columns.is_admin).toBeDefined();
    expect(columns.is_admin.notNull).toBe(true);
    expect(columns.is_admin.hasDefault).toBe(true);
  });

  it("admin_mcp_servers mirrors tenant_mcp_servers columns", () => {
    const columns = getTableColumns(adminMcpServers);
    // Required columns expected by buildMcpConfigs callers
    for (const name of [
      "id",
      "tenant_id",
      "name",
      "slug",
      "url",
      "transport",
      "auth_type",
      "auth_config",
      "tools",
      "enabled",
      "status",
      "url_hash",
      "approved_by",
      "approved_at",
      "created_at",
      "updated_at",
    ]) {
      expect(columns[name as keyof typeof columns], `missing column ${name}`).toBeDefined();
    }
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.name.notNull).toBe(true);
    expect(columns.slug.notNull).toBe(true);
    expect(columns.url.notNull).toBe(true);
    expect(columns.enabled.notNull).toBe(true);
    expect(columns.status.notNull).toBe(true);
  });

  it("agent_admin_mcp_servers join references admin_mcp_servers", () => {
    const columns = getTableColumns(agentAdminMcpServers);
    expect(columns.agent_id).toBeDefined();
    expect(columns.tenant_id).toBeDefined();
    expect(columns.mcp_server_id).toBeDefined();
    expect(columns.enabled).toBeDefined();
    expect(columns.config).toBeDefined();
    expect(columns.agent_id.notNull).toBe(true);
    expect(columns.mcp_server_id.notNull).toBe(true);
  });

  it("agent_template_admin_mcp_servers join references admin_mcp_servers", () => {
    const columns = getTableColumns(agentTemplateAdminMcpServers);
    expect(columns.template_id).toBeDefined();
    expect(columns.tenant_id).toBeDefined();
    expect(columns.mcp_server_id).toBeDefined();
    expect(columns.enabled).toBeDefined();
    expect(columns.template_id.notNull).toBe(true);
    expect(columns.mcp_server_id.notNull).toBe(true);
  });
});

describe("admin MCP separation — migration 0065 (U1)", () => {
  it("declares every drift-detected object", () => {
    expect(migrationSql).toMatch(
      /--\s*creates-column:\s*public\.agent_templates\.is_admin\b/,
    );
    expect(migrationSql).toMatch(
      /--\s*creates:\s*public\.agent_templates_is_admin_one_way\b/,
    );
    expect(migrationSql).toMatch(/--\s*creates:\s*public\.admin_mcp_servers\b/);
    expect(migrationSql).toMatch(
      /--\s*creates:\s*public\.admin_mcp_servers_status_enum\b/,
    );
    expect(migrationSql).toMatch(
      /--\s*creates:\s*public\.uq_admin_mcp_servers_slug\b/,
    );
    expect(migrationSql).toMatch(
      /--\s*creates:\s*public\.idx_admin_mcp_servers_tenant\b/,
    );
    expect(migrationSql).toMatch(
      /--\s*creates:\s*public\.agent_admin_mcp_servers\b/,
    );
    expect(migrationSql).toMatch(
      /--\s*creates:\s*public\.uq_agent_admin_mcp_servers\b/,
    );
    expect(migrationSql).toMatch(
      /--\s*creates:\s*public\.idx_agent_admin_mcp_servers_agent\b/,
    );
    expect(migrationSql).toMatch(
      /--\s*creates:\s*public\.agent_template_admin_mcp_servers\b/,
    );
    expect(migrationSql).toMatch(
      /--\s*creates:\s*public\.uq_agent_template_admin_mcp_servers\b/,
    );
    expect(migrationSql).toMatch(
      /--\s*creates:\s*public\.idx_agent_template_admin_mcp_servers_template\b/,
    );
  });

  it("uses idempotent DDL for additive changes", () => {
    expect(migrationSql).toMatch(
      /ALTER TABLE public\.agent_templates\s+ADD COLUMN IF NOT EXISTS is_admin/i,
    );
    expect(migrationSql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.admin_mcp_servers/i,
    );
    expect(migrationSql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.agent_admin_mcp_servers/i,
    );
    expect(migrationSql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.agent_template_admin_mcp_servers/i,
    );
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_mcp_servers_slug/,
    );
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_admin_mcp_servers/,
    );
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_template_admin_mcp_servers/,
    );
  });

  it("blocks demoting is_admin via a BEFORE UPDATE trigger (one-way door)", () => {
    // CHECK constraints can't reference OLD/NEW — the one-way door is enforced
    // by a trigger function that raises when is_admin transitions true → false.
    expect(migrationSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.enforce_agent_templates_is_admin_one_way/,
    );
    expect(migrationSql).toMatch(
      /IF OLD\.is_admin = true AND NEW\.is_admin = false THEN/,
    );
    expect(migrationSql).toMatch(/RAISE EXCEPTION/);
    expect(migrationSql).toMatch(
      /CREATE TRIGGER agent_templates_is_admin_one_way\s+BEFORE UPDATE OF is_admin/,
    );
  });

  it("constrains admin_mcp_servers.status to the three-value domain", () => {
    expect(migrationSql).toMatch(
      /CONSTRAINT admin_mcp_servers_status_enum CHECK \(\s*status IN \('pending', 'approved', 'rejected'\)\s*\)/,
    );
  });

  it("rolls back joins before the parent registry and the flag column last", () => {
    const dropTemplate = rollbackSql.indexOf(
      "DROP TABLE IF EXISTS public.agent_template_admin_mcp_servers",
    );
    const dropAgent = rollbackSql.indexOf(
      "DROP TABLE IF EXISTS public.agent_admin_mcp_servers",
    );
    const dropRegistry = rollbackSql.indexOf(
      "DROP TABLE IF EXISTS public.admin_mcp_servers",
    );
    const dropTrigger = rollbackSql.indexOf(
      "DROP TRIGGER IF EXISTS agent_templates_is_admin_one_way",
    );
    const dropColumn = rollbackSql.indexOf(
      "DROP COLUMN IF EXISTS is_admin",
    );

    expect(dropTemplate).toBeGreaterThanOrEqual(0);
    expect(dropAgent).toBeGreaterThanOrEqual(0);
    expect(dropRegistry).toBeGreaterThanOrEqual(0);
    expect(dropTrigger).toBeGreaterThanOrEqual(0);
    expect(dropColumn).toBeGreaterThanOrEqual(0);

    // Joins → registry → trigger → column
    expect(dropTemplate).toBeLessThan(dropRegistry);
    expect(dropAgent).toBeLessThan(dropRegistry);
    expect(dropRegistry).toBeLessThan(dropTrigger);
    expect(dropTrigger).toBeLessThan(dropColumn);
  });
});
