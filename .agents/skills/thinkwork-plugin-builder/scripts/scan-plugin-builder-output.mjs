#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";

const SUPPORTED_MANAGED_APP_KEYS = new Set(["cognee", "n8n", "twenty"]);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SKIP_DIRS = new Set([".git", "node_modules", ".terraform", "dist"]);
const SHARED_PLUGIN_SOURCE_ROOTS = [
  "apps/web/",
  "packages/api/",
  "packages/deployment-runner/",
  "scripts/smoke/",
  "terraform/modules/app/",
];
const PLUGIN_PACKAGE_REQUIRED_FILES = [
  "package.json",
  "tsconfig.json",
  "README.md",
  "src/index.ts",
  "src/manifest.ts",
];

async function main() {
  const target = process.argv[2];
  if (!target || target === "-h" || target === "--help") {
    printHelp();
    process.exit(target ? 0 : 1);
  }

  const root = resolve(target);
  const files = await listFiles(root);
  const contents = await Promise.all(
    files.map(async (file) => ({
      abs: file,
      rel: relative(root, file).split(sep).join("/"),
      text: await readFile(file, "utf8").catch(() => ""),
    })),
  );

  const hasAdapterGapReview = contents.some(
    ({ rel, text }) =>
      /adapter-gap-review/i.test(rel) || /## Adapter Gap Review/i.test(text),
  );

  const findings = [];
  for (const file of contents) {
    scanPath(file, findings);
    scanText(file, findings, hasAdapterGapReview);
  }
  scanPluginPackageShape(contents, findings);
  scanRequiredHandoff(contents, findings);

  const blocking = findings.filter(
    (finding) => finding.severity === "blocking",
  );
  const result = {
    target: root,
    fileCount: files.length,
    blockingCount: blocking.length,
    findings,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(blocking.length > 0 ? 1 : 0);
}

function printHelp() {
  console.error(
    "Usage: node scripts/scan-plugin-builder-output.mjs <generated-output-dir>",
  );
  console.error(
    "Scans proposed plugin-builder output without modifying files.",
  );
}

async function listFiles(root) {
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Target is not a directory: ${root}`);
  }

  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(resolve(dir, entry.name));
        continue;
      }
      if (entry.isFile()) files.push(resolve(dir, entry.name));
    }
  }

  await walk(root);
  return files.sort();
}

function scanPath(file, findings) {
  const name = basename(file.rel);
  if (file.rel.startsWith("packages/plugin-catalog/src/plugins/")) {
    findings.push({
      severity: "blocking",
      code: "legacy-catalog-plugin-path",
      path: file.rel,
      message:
        "Generated plugin-specific source must live under plugins/<plugin-key>/, not packages/plugin-catalog/src/plugins/.",
    });
  }

  for (const root of SHARED_PLUGIN_SOURCE_ROOTS) {
    if (!file.rel.startsWith(root)) continue;
    findings.push({
      severity: "blocking",
      code: "shared-plugin-source-path",
      path: file.rel,
      message:
        "Generated plugin-specific source must live under plugins/<plugin-key>/; shared API, web, deployment-runner, smoke, or Terraform roots require a generic platform adapter change.",
    });
  }

  if (name === "terraform.tfvars" || name.endsWith(".tfvars")) {
    findings.push({
      severity: "blocking",
      code: "raw-tfvars",
      path: file.rel,
      message:
        "Do not include raw tfvars in generated plugin artifacts; convert values to input contracts.",
    });
  }
}

function scanText(file, findings, hasAdapterGapReview) {
  addIfMatch(
    file,
    findings,
    "absolute-local-path",
    /(?:\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\)/,
    "Replace developer-local absolute paths with repo-relative paths or input contracts.",
  );

  addIfMatch(
    file,
    findings,
    "secret-marker",
    /\b(AWS_SECRET_ACCESS_KEY|aws_secret_access_key|client_secret|private_key)\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
    "Generated output appears to contain a secret marker; remove raw secrets and document secret references only.",
  );

  addIfMatch(
    file,
    findings,
    "unsupported-license-field",
    /\b(licenseKey|license_key|licenseSecret|license_secret)\b/,
    "Use ThinkWork premium install-key metadata instead of unsupported manifest license fields.",
  );

  for (const match of file.text.matchAll(
    /\bpluginKey\s*:\s*["']([^"']+)["']/g,
  )) {
    const value = match[1];
    if (!SLUG_RE.test(value)) {
      findings.push({
        severity: "blocking",
        code: "invalid-plugin-key",
        path: file.rel,
        message: `pluginKey "${value}" must be a lowercase slug compatible with the catalog contract.`,
      });
    }
  }

  for (const match of file.text.matchAll(/\bslug\s*:\s*["']([^"']+)["']/g)) {
    const value = match[1];
    if (SLUG_RE.test(value) && !value.includes("--")) {
      findings.push({
        severity: "warning",
        code: "generic-skill-slug",
        path: file.rel,
        message: `Skill slug "${value}" is not hyphen-namespaced with a plugin prefix.`,
      });
    }
  }

  for (const match of file.text.matchAll(
    /\bmanagedAppKey\s*:\s*["']([^"']+)["']/g,
  )) {
    const value = match[1];
    if (!SUPPORTED_MANAGED_APP_KEYS.has(value)) {
      findings.push({
        severity: hasAdapterGapReview ? "warning" : "blocking",
        code: "unsupported-managed-app-key",
        path: file.rel,
        message: hasAdapterGapReview
          ? `managedAppKey "${value}" is unsupported; adapter gap review is present for maintainer decision.`
          : `managedAppKey "${value}" is unsupported; write an adapter gap review instead of finalizing this manifest.`,
      });
    }
  }
}

function scanPluginPackageShape(contents, findings) {
  const byRel = new Map(contents.map((file) => [file.rel, file]));
  const pluginKeys = new Set();
  for (const file of contents) {
    for (const match of file.text.matchAll(
      /\bpluginKey\s*:\s*["']([^"']+)["']/g,
    )) {
      pluginKeys.add(match[1]);
    }
    for (const match of file.text.matchAll(
      /\bpackageKey\s*:\s*["']([^"']+)["']/g,
    )) {
      pluginKeys.add(match[1]);
    }
  }

  for (const pluginKey of pluginKeys) {
    if (!SLUG_RE.test(pluginKey)) continue;
    const packageRoot = `plugins/${pluginKey}`;
    const pluginFiles = contents.filter((file) =>
      file.rel.startsWith(`${packageRoot}/`),
    );
    if (pluginFiles.length === 0) {
      findings.push({
        severity: "blocking",
        code: "missing-plugin-package-root",
        path: ".",
        message: `Plugin "${pluginKey}" must be emitted under ${packageRoot}/.`,
      });
      continue;
    }

    for (const requiredFile of PLUGIN_PACKAGE_REQUIRED_FILES) {
      const rel = `${packageRoot}/${requiredFile}`;
      if (!byRel.has(rel)) {
        findings.push({
          severity: "blocking",
          code: "missing-plugin-package-file",
          path: packageRoot,
          message: `Plugin "${pluginKey}" is missing ${rel}.`,
        });
      }
    }

    scanPackageJson(
      pluginKey,
      byRel.get(`${packageRoot}/package.json`),
      findings,
    );
    scanPackageIndex(
      pluginKey,
      byRel.get(`${packageRoot}/src/index.ts`),
      findings,
    );
    scanManifestLocation(
      pluginKey,
      byRel.get(`${packageRoot}/src/manifest.ts`),
      findings,
    );
  }
}

function scanPackageJson(pluginKey, file, findings) {
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(file.text);
  } catch (error) {
    findings.push({
      severity: "blocking",
      code: "invalid-plugin-package-json",
      path: file.rel,
      message: `Plugin package.json must be valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return;
  }

  const expectedName = `@thinkwork/plugin-${pluginKey}`;
  if (parsed.name !== expectedName) {
    findings.push({
      severity: "blocking",
      code: "plugin-package-name-mismatch",
      path: file.rel,
      message: `Plugin package name must be "${expectedName}".`,
    });
  }
  if (parsed.main !== "./src/index.ts") {
    findings.push({
      severity: "blocking",
      code: "plugin-package-main-mismatch",
      path: file.rel,
      message: 'Plugin package main must be "./src/index.ts".',
    });
  }
  if (parsed.exports?.["."] !== "./src/index.ts") {
    findings.push({
      severity: "blocking",
      code: "plugin-package-export-missing",
      path: file.rel,
      message: 'Plugin package exports must expose "." as "./src/index.ts".',
    });
  }
  if (parsed.exports?.["./manifest"] !== "./src/manifest.ts") {
    findings.push({
      severity: "blocking",
      code: "plugin-manifest-export-missing",
      path: file.rel,
      message:
        'Plugin package exports must expose "./manifest" as "./src/manifest.ts".',
    });
  }
}

function scanPackageIndex(pluginKey, file, findings) {
  if (!file) return;
  const sourceRoot = `plugins/${pluginKey}`;
  const expectedPackageExport = `${camelPluginKey(pluginKey)}PluginPackage`;
  if (!file.text.includes(`packageKey: "${pluginKey}"`)) {
    findings.push({
      severity: "blocking",
      code: "plugin-package-key-missing",
      path: file.rel,
      message: `src/index.ts must declare packageKey: "${pluginKey}".`,
    });
  }
  if (!file.text.includes(`sourceRoot: "${sourceRoot}"`)) {
    findings.push({
      severity: "blocking",
      code: "plugin-source-root-missing",
      path: file.rel,
      message: `src/index.ts must declare sourceRoot: "${sourceRoot}".`,
    });
  }
  if (!file.text.includes(expectedPackageExport)) {
    findings.push({
      severity: "warning",
      code: "plugin-package-export-name",
      path: file.rel,
      message: `Expected package descriptor export name to include ${expectedPackageExport}.`,
    });
  }
}

function scanManifestLocation(pluginKey, file, findings) {
  if (!file) return;
  if (!file.text.includes(`pluginKey: "${pluginKey}"`)) {
    findings.push({
      severity: "blocking",
      code: "manifest-plugin-key-mismatch",
      path: file.rel,
      message: `src/manifest.ts must declare pluginKey: "${pluginKey}".`,
    });
  }
}

function camelPluginKey(pluginKey) {
  return pluginKey.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function scanRequiredHandoff(contents, findings) {
  const hasContributionPlan = contents.some(({ rel }) =>
    /contribution-plan/i.test(rel),
  );
  const hasPublicationChecklist = contents.some(({ rel }) =>
    /publication-checklist/i.test(rel),
  );

  if (!hasContributionPlan) {
    findings.push({
      severity: "warning",
      code: "missing-contribution-plan",
      path: ".",
      message:
        "Generated output should include a contribution plan before catalog file edits.",
    });
  }
  if (!hasPublicationChecklist) {
    findings.push({
      severity: "warning",
      code: "missing-publication-checklist",
      path: ".",
      message:
        "Generated output should include a publication checklist for maintainer handoff.",
    });
  }
}

function addIfMatch(file, findings, code, pattern, message) {
  if (!pattern.test(file.text)) return;
  findings.push({
    severity: "blocking",
    code,
    path: file.rel,
    message,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
