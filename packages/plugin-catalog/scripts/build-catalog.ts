/**
 * Build the signed plugin catalog JSON from every manifest registered in
 * `src/plugins/`.
 *
 * Signing key input (ed25519 PKCS#8 PEM), in precedence order:
 *   1. `--key <path>` — file containing the private key PEM
 *   2. `PLUGIN_CATALOG_SIGNING_KEY` env var — the PEM content itself
 *
 * Output defaults to `dist/catalog.json` (override with `--out <path>`).
 *
 * Usage: pnpm --filter @thinkwork/plugin-catalog build:catalog -- --key signing-key.pem
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildPluginCatalog, signPluginCatalog } from "../src/catalog";
import type { PluginManifest } from "../src/contracts";
import { allPluginManifests } from "../src/plugins";

export function buildSignedCatalogJson(options: {
  manifests: readonly PluginManifest[];
  privateKeyPem: string;
  generatedAt?: Date | string;
}): string {
  const catalog = buildPluginCatalog({
    manifests: options.manifests,
    generatedAt: options.generatedAt,
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
