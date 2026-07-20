import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

function tfFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === ".terraform") continue;
      out.push(...tfFiles(path));
    } else if (entry.endsWith(".tf")) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Terraform 1.5–1.8 rejects variable validation conditions that reference any
 * variable other than the one being validated ("Invalid reference in variable
 * validation") — the failure surfaces at init in the customer deployment
 * runner, which pins Terraform 1.8.5. Cross-variable invariants belong in
 * resource lifecycle preconditions instead. TEI's v0.1.0-canary.368 update
 * failed on exactly this (agentcore_turn_assertion_active_key_version).
 */
describe("terraform variable validation repo-floor compatibility", () => {
  it("no variable validation condition references another variable", () => {
    const offenders: string[] = [];
    for (const file of tfFiles(resolve(REPO_ROOT, "terraform"))) {
      const src = readFileSync(file, "utf8");
      const variableBlocks = src.matchAll(
        /variable\s+"([^"]+)"\s*\{([\s\S]*?)\n\}/g,
      );
      for (const [, name, body] of variableBlocks) {
        const validations = body.matchAll(/validation\s*\{([\s\S]*?)\}/g);
        for (const [validation] of validations) {
          const condition = /condition\s*=([\s\S]*?)(?:error_message|$)/.exec(
            validation,
          )?.[1];
          if (!condition) continue;
          const refs = new Set(
            [...condition.matchAll(/var\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]),
          );
          refs.delete(name);
          if (refs.size > 0) {
            offenders.push(
              `${file}: variable "${name}" references ${[...refs].join(", ")}`,
            );
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it.each([
    "terraform/modules/thinkwork/variables.tf",
    "terraform/modules/foundation/cognito/variables.tf",
  ])("%s accepts Entra tenant aliases alongside a directory GUID", (path) => {
    const src = readFileSync(resolve(REPO_ROOT, path), "utf8");
    expect(src).toMatch(
      /contains\(\["common", "organizations", "consumers"\], var\.microsoft_oauth_tenant\)/,
    );
    expect(src).toMatch(
      /microsoft_oauth_tenant must be an Entra directory GUID or one of the Cognito-supported aliases/,
    );
  });

  it("active turn-assertion key membership is enforced by a resource precondition", () => {
    const mcpOauth = readFileSync(
      resolve(REPO_ROOT, "terraform/modules/app/lambda-api/mcp-oauth.tf"),
      "utf8",
    );
    expect(mcpOauth).toMatch(
      /precondition\s*\{\s*condition\s*=\s*contains\(var\.agentcore_turn_assertion_key_versions,\s*var\.agentcore_turn_assertion_active_key_version\)/,
    );
  });
});
