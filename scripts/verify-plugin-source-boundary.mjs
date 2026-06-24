#!/usr/bin/env node

import { readdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  pluginSourceBoundaryAllowlist,
  sharedPluginTermAllowlist,
} from "./plugin-source-boundary-allowlist.mjs";

const DEFAULT_SCAN_ROOTS = [
  ".agents",
  "apps",
  "packages",
  "plugins",
  "scripts",
  "terraform",
];
const PLUGIN_KEYS = [
  "company-brain",
  "company-data",
  "cognee",
  "data-integrations",
  "email-channel",
  "lastmile",
  "n8n",
  "plane",
  "twenty",
];
const PLUGIN_SOURCE_ROOTS = new Map([
  ["company-brain", ["plugins/company-brain/"]],
  ["company-data", ["plugins/company-data/"]],
  // Cognee is the internal infrastructure substrate for Company Brain.
  ["cognee", ["plugins/company-brain/"]],
  ["data-integrations", ["plugins/data-integrations/"]],
  ["email-channel", ["plugins/email-channel/"]],
  ["lastmile", ["plugins/lastmile/"]],
  ["n8n", ["plugins/n8n/"]],
  ["plane", ["plugins/plane/"]],
  ["twenty", ["plugins/twenty/"]],
]);
const SKIP_DIRS = new Set([
  ".git",
  ".terraform",
  "coverage",
  "dist",
  "node_modules",
  "tmp",
]);

export async function findPluginSourceBoundaryViolations({
  repoRoot = process.cwd(),
  scanRoots = DEFAULT_SCAN_ROOTS,
  allowlist = pluginSourceBoundaryAllowlist,
  sharedAllowlist = sharedPluginTermAllowlist,
} = {}) {
  const root = resolve(repoRoot);
  const files = await listScannedFiles(root, scanRoots);
  const fileSet = new Set(files);
  const sharedMatches = new Set();
  const allowlistMatches = new Set();
  const violations = [];

  for (const file of files) {
    const pluginKeys = matchingPluginKeys(file);
    if (pluginKeys.length === 0) continue;

    const sharedEntry = findAllowlistEntry(file, sharedAllowlist);
    if (sharedEntry) {
      sharedMatches.add(sharedEntry);
      continue;
    }

    const outsideKeys = pluginKeys.filter(
      (pluginKey) =>
        !owningRoots(pluginKey).some((rootPath) => file.startsWith(rootPath)),
    );
    if (outsideKeys.length === 0) continue;

    const allowlistEntry = findAllowlistEntry(file, allowlist);
    if (allowlistEntry) {
      allowlistMatches.add(allowlistEntry);
      continue;
    }

    violations.push({
      path: file,
      pluginKeys: outsideKeys,
      message:
        "Plugin-specific source must live under plugins/<plugin-key>/ or be documented in scripts/plugin-source-boundary-allowlist.mjs.",
    });
  }

  const staleAllowlistEntries = [
    ...findStaleAllowlistEntries(allowlist, fileSet),
    ...findStaleAllowlistEntries(sharedAllowlist, fileSet),
  ];

  return {
    scannedFileCount: files.length,
    violations,
    staleAllowlistEntries,
    allowlistMatchCount: allowlistMatches.size,
    sharedAllowlistMatchCount: sharedMatches.size,
  };
}

async function listScannedFiles(repoRoot, scanRoots) {
  const files = [];
  for (const scanRoot of scanRoots) {
    const abs = resolve(repoRoot, scanRoot);
    if (!(await pathExists(abs))) continue;
    await walk(repoRoot, abs, files);
  }
  return files.sort();
}

async function walk(repoRoot, dir, files) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        await walk(repoRoot, resolve(dir, entry.name), files);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    files.push(
      relative(repoRoot, resolve(dir, entry.name)).split(sep).join("/"),
    );
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function matchingPluginKeys(file) {
  const normalized = file.toLowerCase();
  return PLUGIN_KEYS.filter((pluginKey) => normalized.includes(pluginKey));
}

function owningRoots(pluginKey) {
  return PLUGIN_SOURCE_ROOTS.get(pluginKey) ?? [`plugins/${pluginKey}/`];
}

function findAllowlistEntry(file, entries) {
  return entries.find((entry) => {
    if (entry.path && entry.path === file) return true;
    if (entry.pathPrefix && file.startsWith(entry.pathPrefix)) return true;
    return false;
  });
}

function findStaleAllowlistEntries(entries, fileSet) {
  return entries.filter((entry) => {
    if (entry.path) return !fileSet.has(entry.path);
    if (entry.pathPrefix) {
      return ![...fileSet].some((file) => file.startsWith(entry.pathPrefix));
    }
    return true;
  });
}

async function main() {
  const result = await findPluginSourceBoundaryViolations();
  if (
    result.violations.length === 0 &&
    result.staleAllowlistEntries.length === 0
  ) {
    console.log(
      `verify-plugin-source-boundary: OK — scanned ${result.scannedFileCount} files; ` +
        `${result.allowlistMatchCount} migration paths and ${result.sharedAllowlistMatchCount} shared paths documented.`,
    );
    return;
  }

  for (const violation of result.violations) {
    console.error(
      `verify-plugin-source-boundary: misplaced plugin source: ${violation.path} (${violation.pluginKeys.join(", ")})`,
    );
    console.error(`  ${violation.message}`);
  }
  for (const entry of result.staleAllowlistEntries) {
    console.error(
      `verify-plugin-source-boundary: stale allowlist entry: ${entry.path ?? entry.pathPrefix}`,
    );
    console.error(
      `  ${entry.reason ?? "remove or refresh this allowlist entry"}`,
    );
  }
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
