import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("bootstrap-workspace no longer syncs the retired repo skill catalog", () => {
  const source = readFileSync(
    path.join(repoRoot, "scripts/bootstrap-workspace.sh"),
    "utf8",
  );

  assert.equal(source.includes("packages/skill-catalog"), false);
  assert.equal(source.includes("skills/catalog"), false);
  assert.match(source, /packages\/workspace-defaults\/files/);
});
