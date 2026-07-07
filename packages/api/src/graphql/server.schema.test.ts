/**
 * Schema-construction regression guard.
 *
 * `makeExecutableSchema` runs at module load in the graphql-http Lambda; a
 * resolver field with no matching schema field (or vice versa) throws at
 * COLD START and takes down every GraphQL query platform-wide — exactly the
 * 2026-07-07 outage where Query.plateConformance shipped in the resolver map
 * without its `extend type Query` schema entry (#3483). Importing the schema
 * here reproduces the cold-start construction, so that class of drift fails
 * CI instead of production.
 *
 * server.ts resolves the .graphql sources relative to process.cwd() (the
 * Lambda bundle layout), so the import happens after chdir'ing to the repo
 * root — the same relative shape the bundle provides.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GraphQLSchema } from "graphql";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

async function loadSchema(): Promise<GraphQLSchema> {
  const prevCwd = process.cwd();
  process.chdir(REPO_ROOT);
  try {
    const { schema } = await import("./server.js");
    return schema;
  } finally {
    process.chdir(prevCwd);
  }
}

describe("executable schema construction (cold-start guard)", () => {
  it("constructs the schema with the full resolver map — a resolver field missing from the schema throws here, not at Lambda cold start", async () => {
    const schema = await loadSchema();
    // (Truthiness, not instanceof — vitest can load a second `graphql`
    // module instance, which breaks cross-realm instanceof checks.)
    expect(schema.getQueryType()).toBeTruthy();
    expect(schema.getMutationType()).toBeTruthy();
    // The field whose absence caused the outage.
    expect(schema.getQueryType()!.getFields().plateConformance).toBeDefined();
  });
});
