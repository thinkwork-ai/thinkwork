import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { findPluginSourceBoundaryViolations } from "../verify-plugin-source-boundary.mjs";
import {
  pluginSourceBoundaryAllowlist,
  sharedPluginTermAllowlist,
} from "../plugin-source-boundary-allowlist.mjs";

describe("verify-plugin-source-boundary", () => {
  it("keeps the default active migration allowlist closed", () => {
    assert.deepEqual(pluginSourceBoundaryAllowlist, []);
    assert.ok(
      sharedPluginTermAllowlist.length > 0,
      "historical/shared false-positive entries should remain separate from migration debt",
    );
  });

  it("accepts plugin-specific source inside the owning plugin package", async () => {
    await withFixture(async (dir) => {
      await writeFixtureFile(dir, "plugins/plane/src/manifest.ts");
      await writeFixtureFile(
        dir,
        "plugins/company-brain/smoke/cognee-managed-app-smoke.mjs",
      );

      const result = await scanFixture(dir);

      assert.deepEqual(result.violations, []);
      assert.deepEqual(result.staleAllowlistEntries, []);
    });
  });

  it("blocks another plugin's source inside the wrong plugin package", async () => {
    await withFixture(async (dir) => {
      await writeFixtureFile(dir, "plugins/lastmile/src/plane-notes.md");

      const result = await scanFixture(dir);

      assert.equal(result.violations.length, 1);
      assert.equal(
        result.violations[0].path,
        "plugins/lastmile/src/plane-notes.md",
      );
      assert.deepEqual(result.violations[0].pluginKeys, ["plane"]);
    });
  });

  it("blocks plugin-specific source outside plugins/<plugin-key>", async () => {
    await withFixture(async (dir) => {
      await writeFixtureFile(
        dir,
        "packages/api/src/lib/plugins/plane-extra.ts",
      );

      const result = await scanFixture(dir);

      assert.equal(result.violations.length, 1);
      assert.equal(
        result.violations[0].path,
        "packages/api/src/lib/plugins/plane-extra.ts",
      );
      assert.deepEqual(result.violations[0].pluginKeys, ["plane"]);
    });
  });

  it("accepts documented migration paths and shared false positives", async () => {
    await withFixture(async (dir) => {
      await writeFixtureFile(
        dir,
        "packages/api/src/lib/plugins/plane-extra.ts",
      );
      await writeFixtureFile(
        dir,
        "terraform/modules/app/deployment-control-plane/main.tf",
      );

      const result = await scanFixture(dir, {
        allowlist: [
          {
            path: "packages/api/src/lib/plugins/plane-extra.ts",
            reason: "fixture migration path",
          },
        ],
        sharedAllowlist: [
          {
            pathPrefix: "terraform/modules/app/deployment-control-plane/",
            reason: "shared control plane fixture",
          },
        ],
      });

      assert.deepEqual(result.violations, []);
      assert.deepEqual(result.staleAllowlistEntries, []);
      assert.equal(result.allowlistMatchCount, 1);
      assert.equal(result.sharedAllowlistMatchCount, 1);
    });
  });

  it("accepts historical and platform fixture entries through the shared allowlist", async () => {
    await withFixture(async (dir) => {
      await writeFixtureFile(
        dir,
        "apps/cli/__tests__/terraform-plane-fixture.test.ts",
      );
      await writeFixtureFile(
        dir,
        "packages/database-pg/__tests__/migration-0166-company-brain-substrate.test.ts",
      );
      await writeFixtureFile(
        dir,
        "apps/web/src/routes/_authed/settings.applications.cognee.tsx",
      );
      const fixtureSharedAllowlist = sharedPluginTermAllowlist.filter(
        (entry) =>
          entry.path === "apps/cli/__tests__/terraform-plane-fixture.test.ts" ||
          entry.path ===
            "packages/database-pg/__tests__/migration-0166-company-brain-substrate.test.ts" ||
          entry.path ===
            "apps/web/src/routes/_authed/settings.applications.cognee.tsx",
      );

      const result = await findPluginSourceBoundaryViolations({
        repoRoot: dir,
        allowlist: pluginSourceBoundaryAllowlist,
        sharedAllowlist: fixtureSharedAllowlist,
      });

      assert.deepEqual(result.violations, []);
      assert.deepEqual(result.staleAllowlistEntries, []);
      assert.equal(result.allowlistMatchCount, 0);
      assert.equal(result.sharedAllowlistMatchCount, 3);
    });
  });

  it("fails stale allowlist entries so migrations remove old exceptions", async () => {
    await withFixture(async (dir) => {
      const result = await scanFixture(dir, {
        allowlist: [
          {
            path: "packages/api/src/lib/plugins/plane-extra.ts",
            reason: "deleted fixture migration path",
          },
        ],
      });

      assert.equal(result.violations.length, 0);
      assert.equal(result.staleAllowlistEntries.length, 1);
      assert.equal(
        result.staleAllowlistEntries[0].path,
        "packages/api/src/lib/plugins/plane-extra.ts",
      );
    });
  });
});

async function scanFixture(dir, overrides = {}) {
  return findPluginSourceBoundaryViolations({
    repoRoot: dir,
    allowlist: [],
    sharedAllowlist: [],
    ...overrides,
  });
}

async function writeFixtureFile(dir, rel) {
  const abs = join(dir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, "\n");
}

async function withFixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), "plugin-source-boundary-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
