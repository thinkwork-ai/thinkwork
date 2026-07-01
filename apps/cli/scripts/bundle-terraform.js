#!/usr/bin/env node
/**
 * Bundle Terraform modules into dist/terraform/ for npm distribution.
 * Called as part of `npm run build`.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(__dirname, "..");
const repoRoot = resolve(cliRoot, "../..");

const src = resolve(repoRoot, "terraform");
const dst = resolve(cliRoot, "dist/terraform");
const pluginsSrc = resolve(repoRoot, "plugins");
const pluginsDst = resolve(cliRoot, "dist/plugins");

if (!existsSync(src)) {
  console.warn("⚠ terraform/ not found at repo root — skipping bundle");
  process.exit(0);
}

rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
rmSync(pluginsDst, { recursive: true, force: true });

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

// Operational scripts (U6): bootstrap-workspace + post-deploy must behave
// identically from npm/brew installs and repo checkouts.
const scriptsDst = resolve(cliRoot, "dist/scripts");
rmSync(scriptsDst, { recursive: true, force: true });
mkdirSync(scriptsDst, { recursive: true });
for (const script of ["bootstrap-workspace.sh", "post-deploy.sh"]) {
  const scriptSrc = resolve(repoRoot, "scripts", script);
  if (existsSync(scriptSrc)) {
    cpSync(scriptSrc, resolve(scriptsDst, script));
  }
}
console.log("✓ Operational scripts bundled into dist/scripts/");

// Journaled Drizzle migrations (U10): the deploy tail applies these to fresh
// stages via the Aurora Data API. Only journal-listed files ship — hand-rolled
// .sql outside meta/_journal.json stays repo-only by design.
const drizzleSrc = resolve(repoRoot, "packages/database-pg/drizzle");
const drizzleDst = resolve(cliRoot, "dist/drizzle");
const journalPath = resolve(drizzleSrc, "meta/_journal.json");
if (existsSync(journalPath)) {
  rmSync(drizzleDst, { recursive: true, force: true });
  mkdirSync(resolve(drizzleDst, "meta"), { recursive: true });
  cpSync(journalPath, resolve(drizzleDst, "meta/_journal.json"));
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  let copied = 0;
  for (const entry of journal.entries ?? []) {
    const sqlFile = resolve(drizzleSrc, `${entry.tag}.sql`);
    if (existsSync(sqlFile)) {
      cpSync(sqlFile, resolve(drizzleDst, `${entry.tag}.sql`));
      copied += 1;
    }
  }
  console.log(`✓ ${copied} journaled migrations bundled into dist/drizzle/`);
}

if (existsSync(pluginsSrc)) {
  mkdirSync(pluginsDst, { recursive: true });
  cpSync(pluginsSrc, pluginsDst, {
    recursive: true,
    filter: (path) => {
      if (path.includes("node_modules")) return false;
      if (path.includes("/dist/")) return false;
      if (path.endsWith(".tsbuildinfo")) return false;
      return true;
    },
  });
  console.log("✓ Plugin source bundled into dist/plugins/");
}

const enterpriseTemplatesSrc = resolve(
  cliRoot,
  "src/commands/enterprise/templates",
);
const enterpriseTemplatesDst = resolve(
  cliRoot,
  "dist/commands/enterprise/templates",
);

if (existsSync(enterpriseTemplatesSrc)) {
  rmSync(enterpriseTemplatesDst, { recursive: true, force: true });
  mkdirSync(dirname(enterpriseTemplatesDst), { recursive: true });
  cpSync(enterpriseTemplatesSrc, enterpriseTemplatesDst, { recursive: true });
  console.log(
    "✓ Enterprise deployment templates bundled into dist/commands/enterprise/templates/",
  );
}
