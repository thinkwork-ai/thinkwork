#!/usr/bin/env node
/**
 * Bundle Terraform modules into dist/terraform/ for npm distribution.
 * Called as part of `npm run build`.
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(__dirname, "..");
const repoRoot = resolve(cliRoot, "../..");

const src = resolve(repoRoot, "terraform");
const dst = resolve(cliRoot, "dist/terraform");

if (!existsSync(src)) {
  console.warn("⚠ terraform/ not found at repo root — skipping bundle");
  process.exit(0);
}

mkdirSync(dst, { recursive: true });

const dirs = ["modules", "examples"];
for (const dir of dirs) {
  const srcDir = resolve(src, dir);
  const dstDir = resolve(dst, dir);
  if (existsSync(srcDir)) {
    cpSync(srcDir, dstDir, {
      recursive: true,
      filter: (path) => {
        if (path.includes(".terraform")) return false;
        if (path.endsWith(".tfstate")) return false;
        if (path.endsWith(".tfstate.backup")) return false;
        if (path.endsWith("terraform.tfvars")) return false;
        if (path.endsWith(".terraform.lock.hcl")) return false;
        return true;
      },
    });
  }
}

const schemaPath = resolve(src, "schema.graphql");
if (existsSync(schemaPath)) {
  cpSync(schemaPath, resolve(dst, "schema.graphql"));
}

console.log("✓ Terraform modules bundled into dist/terraform/");
