import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every handler Terraform deploys must have a build step that produces its
 * zip.
 *
 * `aws_lambda_function.handler` is a for_each over a literal set of handler
 * names, and each one resolves to `${lambda_zips_dir}/${each.key}.zip` via
 * `filebase64sha256`. `scripts/build-lambdas.sh` produces those zips from
 * explicit `build_handler "<name>" "<path>"` calls. Nothing links the two
 * lists, so adding a handler to Terraform without adding it to the build
 * script is invisible until `filebase64sha256` fails during a real
 * plan/apply — the code reviews clean, every test passes, and the deploy
 * breaks. (`inbox-approval-sweeper` shipped exactly that way and was caught
 * in review, not by CI.)
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

function read(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

/**
 * The for_each source is the `setsubtract(toset([...]), ...)` literal in
 * aws_lambda_function.handler. Slice that block and pull the quoted names,
 * ignoring comment lines so prose mentioning a handler never counts.
 */
function terraformHandlerNames(): string[] {
  const source = read("terraform/modules/app/lambda-api/handlers.tf");
  const start = source.indexOf("for_each = local.deploy_lambda_handlers");
  assert.ok(start !== -1, "could not locate the handler for_each block");
  const end = source.indexOf("]), toset(local.optional_integration_handler_names))", start);
  assert.ok(end !== -1, "could not locate the end of the handler for_each set");

  return source
    .slice(start, end)
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .flatMap((line) => [...line.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]));
}

function builtHandlerNames(): Set<string> {
  const source = read("scripts/build-lambdas.sh");
  return new Set(
    [...source.matchAll(/^build_handler\s+"([^"]+)"/gm)].map((m) => m[1]),
  );
}

/**
 * Pre-existing gaps, recorded so this guard can block NEW ones today rather
 * than waiting on unrelated cleanup.
 *
 * cron-stall-monitor: c72da3b6a (2026-05-13) renamed the Terraform key "to
 * use the build script's cron-stall-monitor artifact name" — but no such
 * build_handler entry has ever existed, and the repo contains no handler
 * source under that name. Deleting the Terraform entry or writing the
 * handler is an owner decision, not a drive-by fix.
 */
const KNOWN_UNBUILT_HANDLERS = new Set(["cron-stall-monitor"]);

test("every Terraform-deployed handler has a build_handler entry", () => {
  const built = builtHandlerNames();
  const missing = terraformHandlerNames().filter(
    (name) => !built.has(name) && !KNOWN_UNBUILT_HANDLERS.has(name),
  );

  assert.deepEqual(
    missing,
    [],
    `Handlers deployed by Terraform with no zip produced by scripts/build-lambdas.sh: ${missing.join(", ")}. ` +
      `Add a build_handler entry for each, or the deploy fails at filebase64sha256.`,
  );
});

test("the known-gap list stays honest", () => {
  // A fixed gap must leave the allowlist, or the list rots into a place
  // where real regressions can hide.
  const built = builtHandlerNames();
  const terraform = new Set(terraformHandlerNames());
  for (const name of KNOWN_UNBUILT_HANDLERS) {
    assert.ok(
      terraform.has(name) && !built.has(name),
      `${name} is no longer an unbuilt Terraform handler — remove it from KNOWN_UNBUILT_HANDLERS.`,
    );
  }
});

test("the parity check is actually reading both lists", () => {
  // A brittle slice or regex that silently matched nothing would make the
  // assertion above vacuously pass forever.
  const terraform = terraformHandlerNames();
  const built = builtHandlerNames();

  assert.ok(terraform.length > 20, `parsed only ${terraform.length} Terraform handlers`);
  assert.ok(built.size > 20, `parsed only ${built.size} build_handler entries`);
  assert.ok(
    terraform.includes("mcp-approval-sweeper"),
    "expected a known handler in the parsed Terraform set",
  );
  assert.ok(
    built.has("mcp-approval-sweeper"),
    "expected a known handler in the parsed build script set",
  );
});
