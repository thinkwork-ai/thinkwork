import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const skillDir = resolve(dirname(new URL(import.meta.url).pathname), "..");
const scanner = join(skillDir, "scripts/scan-plugin-builder-output.mjs");

describe("thinkwork-plugin-builder skill package", () => {
  it("declares the expected skill metadata and keeps SKILL.md concise", async () => {
    const skill = await readFile(join(skillDir, "SKILL.md"), "utf8");

    assert.match(skill, /^name: thinkwork-plugin-builder$/m);
    assert.match(
      skill,
      /Terraform projects as reviewable ThinkWork Application Plugin catalog contributions/,
    );
    assert.ok(
      skill.split("\n").length < 120,
      "SKILL.md should preserve progressive disclosure",
    );
  });

  it("keeps every referenced bundled resource present", async () => {
    const skill = await readFile(join(skillDir, "SKILL.md"), "utf8");
    const references = [...skill.matchAll(/`(references\/[^`]+)`/g)].map(
      (match) => match[1],
    );
    const assets = [...skill.matchAll(/`(assets\/[^`]+)`/g)].map(
      (match) => match[1],
    );
    const scripts = [...skill.matchAll(/`(scripts\/[^`]+)`/g)].map(
      (match) => match[1].split(" ")[0],
    );

    for (const rel of [...references, ...assets, ...scripts]) {
      const text = await readFile(join(skillDir, rel), "utf8");
      assert.ok(text.length > 0, `${rel} should exist and be non-empty`);
    }
  });

  it("points contributors at the actual plugin catalog contracts", async () => {
    const files = await Promise.all(
      [
        "SKILL.md",
        "references/plugin-design.md",
        "references/catalog-contribution.md",
        "references/adapter-gap-review.md",
        "references/publication-checklist.md",
      ].map((rel) => readFile(join(skillDir, rel), "utf8")),
    );
    const text = files.join("\n");

    assert.match(text, /packages\/plugin-catalog\/src\/contracts\.ts/);
    assert.match(text, /validatePluginManifest/);
    assert.match(text, /packages\/deployment-runner\/src\/apps\/registry\.ts/);
    assert.match(text, /installKeyRequired/);
    assert.doesNotMatch(text, /\/Users\/ericodom/);
  });
});

describe("scan-plugin-builder-output", () => {
  it("accepts safe generated output with supported adapter and handoff docs", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "contribution-plan.md"),
        "# Contribution Plan\n\nAdapter fit: twenty.\n",
      );
      await writeFile(
        join(dir, "publication-checklist.md"),
        "# Publication Checklist\n\n- [x] Secret exclusion reviewed.\n",
      );
      await writePluginPackage(dir, {
        pluginKey: "mcpherson-lakehouse",
        managedAppKey: "twenty",
      });

      const result = runScanner(dir);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).blockingCount, 0);
    });
  });

  it("blocks legacy catalog plugin paths and incomplete package output", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "contribution-plan.md"), "# Plan\n");
      await writeFile(join(dir, "publication-checklist.md"), "# Checklist\n");
      await mkdir(
        join(dir, "packages/plugin-catalog/src/plugins/mcpherson-lakehouse"),
        { recursive: true },
      );
      await writeFile(
        join(
          dir,
          "packages/plugin-catalog/src/plugins/mcpherson-lakehouse/manifest.ts",
        ),
        'export const manifest = { pluginKey: "mcpherson-lakehouse" };\n',
      );

      const result = runScanner(dir);
      const parsed = JSON.parse(result.stdout);
      assert.equal(result.status, 1);
      assert.ok(
        parsed.findings.some(
          (finding) => finding.code === "legacy-catalog-plugin-path",
        ),
      );
      assert.ok(
        parsed.findings.some(
          (finding) => finding.code === "missing-plugin-package-root",
        ),
      );
    });
  });

  it("blocks raw tfvars, secret markers, local paths, and invalid plugin keys", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "terraform.tfvars"), "raw_bucket_name = x\n");
      await writeFile(
        join(dir, "manifest.ts"),
        [
          'export const manifest = { pluginKey: "McPherson_Lakehouse" };',
          "const localPath = '/Users/alex/work/mcpherson';",
          "const marker = 'AWS_SECRET_ACCESS_KEY';",
        ].join("\n"),
      );

      const result = runScanner(dir);
      const parsed = JSON.parse(result.stdout);
      assert.equal(result.status, 1);
      assert.deepEqual(
        new Set(parsed.findings.map((finding) => finding.code)),
        new Set([
          "raw-tfvars",
          "absolute-local-path",
          "secret-marker",
          "invalid-plugin-key",
          "missing-contribution-plan",
          "missing-publication-checklist",
        ]),
      );
    });
  });

  it("blocks unsupported managed app keys unless an adapter gap review is present", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "contribution-plan.md"), "# Plan\n");
      await writeFile(join(dir, "publication-checklist.md"), "# Checklist\n");
      await writePluginPackage(dir, {
        pluginKey: "mcpherson-lakehouse",
        managedAppKey: "lakehouse",
      });

      const blocked = runScanner(dir);
      assert.equal(blocked.status, 1);
      assert.match(blocked.stdout, /unsupported-managed-app-key/);

      await writeFile(
        join(dir, "adapter-gap-review.md"),
        "## Adapter Gap Review\n\nCurrent adapters do not fit.\n",
      );
      const reviewed = runScanner(dir);
      const parsed = JSON.parse(reviewed.stdout);
      assert.equal(reviewed.status, 0, reviewed.stderr);
      assert.equal(parsed.blockingCount, 0);
      assert.ok(
        parsed.findings.some(
          (finding) => finding.code === "unsupported-managed-app-key",
        ),
      );
    });
  });
});

async function writePluginPackage(dir, { pluginKey, managedAppKey }) {
  const root = join(dir, "plugins", pluginKey);
  const manifestName = `${camelPluginKey(pluginKey)}Manifest`;
  const packageExportName = `${camelPluginKey(pluginKey)}PluginPackage`;
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: `@thinkwork/plugin-${pluginKey}`,
        version: "0.0.0",
        private: true,
        type: "module",
        main: "./src/index.ts",
        exports: {
          ".": "./src/index.ts",
          "./manifest": "./src/manifest.ts",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(root, "tsconfig.json"),
    '{ "extends": "../../tsconfig.base.json", "include": ["./**/*.ts"] }\n',
  );
  await writeFile(join(root, "README.md"), `# ${pluginKey} Plugin\n`);
  await writeFile(
    join(root, "src/index.ts"),
    [
      `import { ${manifestName} } from "./manifest";`,
      "",
      `export const ${packageExportName} = {`,
      `  packageKey: "${pluginKey}",`,
      `  sourceRoot: "plugins/${pluginKey}",`,
      `  manifest: ${manifestName},`,
      "} as const;",
    ].join("\n"),
  );
  await writeFile(
    join(root, "src/manifest.ts"),
    `export const ${manifestName} = { pluginKey: "${pluginKey}", versions: [{ components: [{ type: "infrastructure", managedAppKey: "${managedAppKey}" }] }] };\n`,
  );
}

function camelPluginKey(pluginKey) {
  return pluginKey.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
}

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "plugin-builder-skill-"));
  try {
    await mkdir(dir, { recursive: true });
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runScanner(dir) {
  return spawnSync(process.execPath, [scanner, dir], {
    encoding: "utf8",
  });
}
