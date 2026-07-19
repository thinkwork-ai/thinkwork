import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(
    HERE,
    "..",
    "drizzle",
    "0265_require_fully_valid_auth_publication.sql",
  ),
  "utf8",
);

describe("migration 0265", () => {
  it("unpublishes partial providers before enforcing fully valid publication", () => {
    expect(migration).toContain("validation_status <> 'valid'");
    expect(migration).toContain(
      "DROP CONSTRAINT IF EXISTS auth_provider_resources_no_public_without_valid",
    );
    expect(migration).toContain("validation_status = 'valid'");
    expect(migration).not.toContain("IN ('valid', 'partially_valid')");
  });
});
