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
    // The ratchet is the exact list, not emptiness: a fifth entry still
    // fails. Every entry is Twenty or n8n material relocated out of plugins/
    // ahead of the plugin-system removal, because the thing it describes
    // survives that removal — the deployed Terraform stacks and their smoke
    // contracts, and the n8n workflow-operator skill, which now targets a
    // registered n8n MCP server (a connector) rather than a plugin install.
    // The guard only flags them because "twenty" and "n8n" are still plugin
    // keys; once plugins/ is gone they stop being keys and these entries,
    // along with this guard, go away.
    assert.deepEqual(
      pluginSourceBoundaryAllowlist.map((entry) => entry.pathPrefix).sort(),
      [
        "packages/workspace-defaults/files/catalog-skills/n8n-workflow-operator/",
        "scripts/smoke/managed-apps/",
        "terraform/modules/app/n8n/",
        "terraform/modules/app/twenty/",
      ],
    );
    assert.ok(
      pluginSourceBoundaryAllowlist.every((entry) => entry.reason?.length > 0),
      "every migration exception must carry a reason",
    );
    assert.ok(
      sharedPluginTermAllowlist.length > 0,
      "historical/shared false-positive entries should remain separate from migration debt",
    );
  });

  it("accepts plugin-specific source inside the owning plugin package", async () => {
    await withFixture(async (dir) => {
      await writeFixtureFile(dir, "plugins/email-channel/src/manifest.ts");
      await writeFixtureFile(dir, "plugins/n8n/src/manifest.ts");
      await writeFixtureFile(dir, "plugins/twenty/src/manifest.ts");

      const result = await scanFixture(dir);

      assert.deepEqual(result.violations, []);
      assert.deepEqual(result.staleAllowlistEntries, []);
    });
  });

  it("blocks another plugin's source inside the wrong plugin package", async () => {
    await withFixture(async (dir) => {
      await writeFixtureFile(dir, "plugins/twenty/src/email-channel-notes.md");
      await writeFixtureFile(dir, "plugins/twenty/src/n8n-notes.md");
      await writeFixtureFile(dir, "plugins/n8n/src/twenty-notes.md");

      const result = await scanFixture(dir);

      assert.equal(result.violations.length, 3);
      assert.equal(
        result.violations[0].path,
        "plugins/n8n/src/twenty-notes.md",
      );
      assert.deepEqual(result.violations[0].pluginKeys, ["twenty"]);
      assert.equal(
        result.violations[1].path,
        "plugins/twenty/src/email-channel-notes.md",
      );
      assert.deepEqual(result.violations[1].pluginKeys, ["email-channel"]);
      assert.equal(
        result.violations[2].path,
        "plugins/twenty/src/n8n-notes.md",
      );
      assert.deepEqual(result.violations[2].pluginKeys, ["n8n"]);
    });
  });

  it("blocks plugin-specific source outside plugins/<plugin-key>", async () => {
    await withFixture(async (dir) => {
      await writeFixtureFile(
        dir,
        "packages/api/src/lib/plugins/email-channel-extra.ts",
      );
      await writeFixtureFile(dir, "packages/api/src/lib/plugins/n8n-extra.ts");
      await writeFixtureFile(
        dir,
        "packages/api/src/lib/plugins/twenty-extra.ts",
      );

      const result = await scanFixture(dir);

      assert.equal(result.violations.length, 3);
      assert.equal(
        result.violations[0].path,
        "packages/api/src/lib/plugins/email-channel-extra.ts",
      );
      assert.deepEqual(result.violations[0].pluginKeys, ["email-channel"]);
      assert.equal(
        result.violations[1].path,
        "packages/api/src/lib/plugins/n8n-extra.ts",
      );
      assert.deepEqual(result.violations[1].pluginKeys, ["n8n"]);
      assert.equal(
        result.violations[2].path,
        "packages/api/src/lib/plugins/twenty-extra.ts",
      );
      assert.deepEqual(result.violations[2].pluginKeys, ["twenty"]);
    });
  });

  it("accepts documented migration paths and ignores non-plugin shared paths", async () => {
    await withFixture(async (dir) => {
      await writeFixtureFile(
        dir,
        "packages/api/src/lib/plugins/twenty-extra.ts",
      );
      await writeFixtureFile(
        dir,
        "terraform/modules/app/deployment-control-plane/main.tf",
      );

      const result = await scanFixture(dir, {
        allowlist: [
          {
            path: "packages/api/src/lib/plugins/twenty-extra.ts",
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
      assert.equal(result.sharedAllowlistMatchCount, 0);
    });
  });

  it("fails stale allowlist entries so migrations remove old exceptions", async () => {
    await withFixture(async (dir) => {
      const result = await scanFixture(dir, {
        allowlist: [
          {
            path: "packages/api/src/lib/plugins/twenty-extra.ts",
            reason: "deleted fixture migration path",
          },
        ],
      });

      assert.equal(result.violations.length, 0);
      assert.equal(result.staleAllowlistEntries.length, 1);
      assert.equal(
        result.staleAllowlistEntries[0].path,
        "packages/api/src/lib/plugins/twenty-extra.ts",
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
