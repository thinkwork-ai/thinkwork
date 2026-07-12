import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  msteamsTenantInstalls,
  msteamsThreads,
  msteamsUserLinks,
} from "../src/schema/msteams";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0233 = readFileSync(
  join(HERE, "..", "drizzle", "0233_msteams_install_and_links.sql"),
  "utf-8"
);

describe("Microsoft Teams app schema", () => {
  it("defines one tenant install row per Entra tenant", () => {
    const columns = getTableColumns(msteamsTenantInstalls);

    expect(getTableName(msteamsTenantInstalls)).toBe("msteams_tenant_installs");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.entra_tenant_id.notNull).toBe(true);
    expect(columns.bot_app_id.notNull).toBe(true);
    expect(columns.installed_by_user_id.notNull).toBe(false);
    expect(columns.installed_at.notNull).toBe(false);
    expect(columns.status.default).toBe("pending");
    expect(columns.consent_status.default).toBe("pending");
  });

  it("holds no secret material on the install row", () => {
    const columnNames = Object.keys(getTableColumns(msteamsTenantInstalls));
    for (const name of columnNames) {
      expect(name).not.toMatch(/token|secret|credential/i);
    }
  });

  it("defines Entra-tenant-scoped Teams user links", () => {
    const columns = getTableColumns(msteamsUserLinks);

    expect(getTableName(msteamsUserLinks)).toBe("msteams_user_links");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.entra_tenant_id.notNull).toBe(true);
    expect(columns.aad_object_id.notNull).toBe(true);
    expect(columns.user_id.notNull).toBe(true);
    expect(columns.display_name.notNull).toBe(false);
    expect(columns.status.default).toBe("active");
  });

  it("defines Teams conversation to ThinkWork thread mapping", () => {
    const columns = getTableColumns(msteamsThreads);

    expect(getTableName(msteamsThreads)).toBe("msteams_threads");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.entra_tenant_id.notNull).toBe(true);
    expect(columns.conversation_id.notNull).toBe(true);
    expect(columns.service_url.notNull).toBe(true);
    expect(columns.thread_id.notNull).toBe(true);
  });

  it("enforces the Teams uniqueness and restrict-delete invariants in SQL", () => {
    expect(migration0233).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_msteams_tenant_installs_entra_tenant\s+ON public\.msteams_tenant_installs \(entra_tenant_id\)/
    );
    expect(migration0233).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_msteams_tenant_installs_tenant_entra_tenant\s+ON public\.msteams_tenant_installs \(tenant_id, entra_tenant_id\)/
    );
    expect(migration0233).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_msteams_tenant_installs_tenant_active\s+ON public\.msteams_tenant_installs \(tenant_id\)\s+WHERE status = 'active'/
    );
    expect(migration0233).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_msteams_user_links_entra_tenant_aad_object\s+ON public\.msteams_user_links \(entra_tenant_id, aad_object_id\)/
    );
    expect(migration0233).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_msteams_threads_entra_tenant_conversation\s+ON public\.msteams_threads \(entra_tenant_id, conversation_id\)/
    );
    expect(migration0233).toMatch(
      /REFERENCES public\.msteams_tenant_installs\(entra_tenant_id\)\s+ON DELETE RESTRICT/
    );
  });

  it("enforces the status vocabularies in SQL checks", () => {
    expect(migration0233).toMatch(
      /CHECK \(status IN \('pending','active','uninstalled','revoked'\)\)/
    );
    expect(migration0233).toMatch(
      /CHECK \(consent_status IN \('pending','granted','admin_required','revoked'\)\)/
    );
    expect(migration0233).toMatch(
      /CHECK \(status IN \('active','unlinked','orphaned','suspended'\)\)/
    );
  });

  it("declares a drift-reporter marker for every created object", () => {
    const created = [
      ...migration0233.matchAll(
        /CREATE (?:TABLE|(?:UNIQUE )?INDEX) IF NOT EXISTS (?:public\.)?([a-z0-9_]+)/g
      ),
    ].map((m) => m[1]);
    expect(created.length).toBeGreaterThan(0);
    for (const name of created) {
      expect(migration0233).toContain(`-- creates: public.${name}`);
    }

    const constraints = [
      ...migration0233.matchAll(/CONSTRAINT ([a-z0-9_]+)/g),
    ].map((m) => m[1]);
    for (const name of constraints) {
      expect(name.length).toBeLessThanOrEqual(63);
      expect(migration0233).toMatch(
        new RegExp(`-- creates-constraint: public\\.[a-z0-9_]+\\.${name}\\b`)
      );
    }
  });
});
