import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const source = read("src/components/settings/SettingsMemory.tsx");
const queries = read("src/lib/graphql-queries.ts");

describe("SettingsMemory", () => {
  it("queries the explicit Cognee user and space memory mode fields", () => {
    expect(source).toContain("ComputerMemorySystemConfigQuery");
    expect(queries).toContain("activeEngine");
    expect(queries).toContain("cogneeMemoryEnabled");
    expect(queries).toContain("userMemoryEnabled");
    expect(queries).toContain("spaceMemoryEnabled");
    expect(queries).toContain("legacyHindsightAvailable");
  });

  it("surfaces Cognee user and space memory without claiming company/wiki completion", () => {
    expect(source).toContain("Cognee memory");
    expect(source).toContain("User memory");
    expect(source).toContain("Space memory");
    expect(source).toContain("Hindsight legacy available");
    expect(source).toContain("Company distillation");
    expect(source).toContain("Wiki projection");
    expect(source).toContain("deferred");
  });
});
