import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0188 = readFileSync(
  join(HERE, "..", "drizzle", "0188_company_etl_plugin_rename.sql"),
  "utf-8",
);
const deployWorkflow = readFileSync(
  join(HERE, "..", "..", "..", ".github", "workflows", "deploy.yml"),
  "utf-8",
);

const COMPANY_ETL_PAYLOAD_SHA256 =
  "49681471c865d81257872da252538f84345f42b43299c27764fc2714bb2e8abf";

describe("migration 0188 - Company ETL plugin rename", () => {
  it("declares a drift-checkable marker view", () => {
    expect(migration0188).toContain(
      "-- creates: public.view_company_etl_plugin_rename_0188",
    );
    expect(migration0188).toMatch(
      /CREATE OR REPLACE VIEW public\.view_company_etl_plugin_rename_0188\b/,
    );
  });

  it("fails preflight before partial writes when plugin tables are missing", () => {
    for (const relation of [
      "public.plugin_installs",
      "public.plugin_entitlements",
      "public.plugin_install_keys",
    ]) {
      expect(migration0188).toContain(`to_regclass('${relation}')`);
    }
    expect(migration0188).toMatch(/RAISE EXCEPTION/i);
  });

  it("fails closed when old and new install rows already coexist for a tenant", () => {
    expect(migration0188).toContain(
      "COUNT(DISTINCT plugin_key) = 2",
    );
    expect(migration0188).toContain(
      "both data-integrations and company-etl plugin_installs rows",
    );
    expect(migration0188).not.toMatch(/DELETE FROM public\.plugin_installs/i);
  });

  it("updates install, entitlement, and install-key plugin keys", () => {
    for (const table of [
      "public.plugin_installs",
      "public.plugin_entitlements",
      "public.plugin_install_keys",
    ]) {
      expect(migration0188).toContain(`UPDATE ${table}`);
      expect(migration0188).toMatch(
        new RegExp(
          `UPDATE ${table}[\\s\\S]*plugin_key = 'company-etl'[\\s\\S]*WHERE plugin_key = 'data-integrations'`,
        ),
      );
    }
  });

  it("repins migrated installs to the Company ETL payload digest", () => {
    expect(migration0188).toContain(
      `pinned_payload_sha256 = '${COMPANY_ETL_PAYLOAD_SHA256}'`,
    );
    expect(migration0188).toContain(
      `pinned_payload_sha256 <> '${COMPANY_ETL_PAYLOAD_SHA256}'`,
    );
  });

  it("is applied by the deploy workflow before renamed API code ships", () => {
    expect(deployWorkflow).toContain(
      "Migrate Data Integrations plugin state to Company ETL",
    );
    expect(deployWorkflow).toContain(
      "0188_company_etl_plugin_rename.sql",
    );
    expect(deployWorkflow).toMatch(
      /psql "\$DATABASE_URL"[\s\S]*--single-transaction/,
    );
  });
});
