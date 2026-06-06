import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { userModelApprovals } from "../src/schema/agents";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0149 = readFileSync(
  join(HERE, "..", "drizzle", "0149_user_model_approvals.sql"),
  "utf-8",
);
const rollback0149 = readFileSync(
  join(HERE, "..", "drizzle", "0149_user_model_approvals_rollback.sql"),
  "utf-8",
);
const agentTypes = readFileSync(
  join(HERE, "..", "graphql", "types", "agents.graphql"),
  "utf-8",
);

describe("migration 0149 — user model approvals", () => {
  it("models per-user catalog approval rows in Drizzle", () => {
    const columns = getTableColumns(userModelApprovals);

    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.user_id.notNull).toBe(true);
    expect(columns.model_id.notNull).toBe(true);
    expect(columns.created_at.notNull).toBe(true);
    expect(columns.updated_at.notNull).toBe(true);

    const indexes = getTableConfig(userModelApprovals).indexes.map(
      (index) => index.config.name,
    );
    expect(indexes).toContain("uq_user_model_approvals_tenant_user_model");
    expect(indexes).toContain("idx_user_model_approvals_tenant_user");
    expect(indexes).toContain("idx_user_model_approvals_model");
  });

  it("declares drift markers for table, indexes, and constraints", () => {
    for (const marker of [
      "public.user_model_approvals",
      "public.uq_user_model_approvals_tenant_user_model",
      "public.idx_user_model_approvals_tenant_user",
      "public.idx_user_model_approvals_model",
    ]) {
      expect(migration0149).toMatch(
        new RegExp(`--\\s*creates:\\s*${marker}\\b`),
      );
    }

    for (const marker of [
      "public.user_model_approvals.user_model_approvals_tenant_id_tenants_id_fk",
      "public.user_model_approvals.user_model_approvals_user_id_users_id_fk",
      "public.user_model_approvals.user_model_approvals_model_id_model_catalog_model_id_fk",
    ]) {
      expect(migration0149).toMatch(
        new RegExp(`--\\s*creates-constraint:\\s*${marker}\\b`),
      );
      expect(migration0149).toContain(marker.split(".").pop());
    }
  });

  it("backfills available tenant defaults so existing users retain composer access", () => {
    expect(migration0149).toContain("FROM public.tenant_settings");
    expect(migration0149).toContain("FROM public.agents");
    expect(migration0149).toContain("FROM public.agent_templates");
    expect(migration0149).toContain("JOIN public.model_catalog mc");
    expect(migration0149).toContain("mc.is_available IS TRUE");
    expect(migration0149).toContain(
      "ON CONFLICT (tenant_id, user_id, model_id) DO NOTHING",
    );
  });

  it("exposes admin and self model approval APIs in GraphQL source types", () => {
    expect(agentTypes).toContain("type UserModelCatalogEntry");
    expect(agentTypes).toMatch(
      /type UserModelCatalogEntry[\s\S]*approved: Boolean!/,
    );
    expect(agentTypes).toContain("userModelCatalog(userId: ID!)");
    expect(agentTypes).toContain("myApprovedModelCatalog");
    expect(agentTypes).toContain("setUserModelApproval(");
  });

  it("rolls back the approval table and indexes", () => {
    for (const statement of [
      "DROP INDEX IF EXISTS public.idx_user_model_approvals_model",
      "DROP INDEX IF EXISTS public.idx_user_model_approvals_tenant_user",
      "DROP INDEX IF EXISTS public.uq_user_model_approvals_tenant_user_model",
      "DROP TABLE IF EXISTS public.user_model_approvals",
    ]) {
      expect(rollback0149).toContain(statement);
    }
    expect(rollback0149).toContain("\\set ON_ERROR_STOP on");
  });
});
