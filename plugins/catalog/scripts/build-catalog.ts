/**
 * Build the signed plugin catalog JSON from manifests discovered through the
 * generated `plugins/*` package registry.
 *
 * Signing key input (ed25519 PKCS#8 PEM), in precedence order:
 *   1. `--key <path>` — file containing the private key PEM
 *   2. `PLUGIN_CATALOG_SIGNING_KEY` env var — the PEM content itself
 *
 * Output defaults to `dist/catalog.json` (override with `--out <path>`).
 * Source provenance can be passed explicitly or inherited from GitHub Actions:
 *   --source-repository / PLUGIN_CATALOG_SOURCE_REPOSITORY / GITHUB_REPOSITORY
 *   --source-ref        / PLUGIN_CATALOG_SOURCE_REF        / GITHUB_REF_NAME / GITHUB_REF
 *   --source-commit     / PLUGIN_CATALOG_SOURCE_COMMIT_SHA / GITHUB_SHA
 *
 * Usage: pnpm --filter @thinkwork/plugin-catalog build:catalog -- --key signing-key.pem
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildPluginCatalog,
  signPluginCatalog,
  type PluginCatalogSourceProvenance,
} from "../src/catalog";
import type { PluginManifest } from "../src/contracts";
import { allPluginManifests } from "../src/registry";

export function buildSignedCatalogJson(options: {
  manifests: readonly PluginManifest[];
  privateKeyPem: string;
  generatedAt?: Date | string;
  source?: PluginCatalogSourceProvenance;
}): string {
  const catalog = buildPluginCatalog({
    manifests: options.manifests,
    generatedAt: options.generatedAt,
    source: options.source,
  });
  const document = signPluginCatalog({
    catalog,
    privateKeyPem: options.privateKeyPem,
    signedAt: options.generatedAt,
  });
  return `${JSON.stringify(document, null, 2)}\n`;
}

function readArg(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function readSourceProvenance(
  argv: string[],
): PluginCatalogSourceProvenance | undefined {
  const repository =
    readArg(argv, "--source-repository") ??
    process.env.PLUGIN_CATALOG_SOURCE_REPOSITORY ??
    process.env.GITHUB_REPOSITORY;
  const ref =
    readArg(argv, "--source-ref") ??
    process.env.PLUGIN_CATALOG_SOURCE_REF ??
    process.env.GITHUB_REF_NAME ??
    process.env.GITHUB_REF;
  const commitSha =
    readArg(argv, "--source-commit") ??
    process.env.PLUGIN_CATALOG_SOURCE_COMMIT_SHA ??
    process.env.GITHUB_SHA;

  const values = [repository, ref, commitSha].filter(Boolean);
  if (values.length === 0) return undefined;
  if (!repository || !ref || !commitSha) {
    throw new Error(
      "Catalog source provenance requires repository, ref, and commit SHA. " +
        "Pass --source-repository, --source-ref, and --source-commit or set the matching env vars.",
    );
  }
  return { repository, ref, commitSha };
}

function main(): void {
  const argv = process.argv.slice(2);
  const keyPath = readArg(argv, "--key");
  const privateKeyPem = keyPath
    ? readFileSync(keyPath, "utf8")
    : process.env.PLUGIN_CATALOG_SIGNING_KEY;
  if (!privateKeyPem) {
    console.error(
      "Missing signing key: pass --key <pem-file> or set PLUGIN_CATALOG_SIGNING_KEY",
    );
    process.exit(1);
  }

  const outPath =
    readArg(argv, "--out") ??
    fileURLToPath(new URL("../dist/catalog.json", import.meta.url));
  const json = buildSignedCatalogJson({
    manifests: allPluginManifests,
    privateKeyPem,
    source: readSourceProvenance(argv),
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json, "utf8");
  console.log(
    `Wrote signed catalog (${allPluginManifests.length} plugin${allPluginManifests.length === 1 ? "" : "s"}) to ${outPath}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
