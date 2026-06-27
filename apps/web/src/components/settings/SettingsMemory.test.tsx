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

  it("uses the operator Hindsight record query for the settings table", () => {
    expect(source).toContain('scope: "OPERATOR"');
    expect(source).toContain("Search Hindsight records...");
    expect(source).toContain("No Hindsight records were returned");
    expect(queries).toContain("$scope: MemoryRecordScope");
    expect(queries).toContain("bankId");
    expect(queries).toContain("ownerType");
    expect(queries).toContain("ownerId");
  });

  it("renders operator evidence columns and disables cross-bank forget", () => {
    expect(source).toContain('header: "Bank"');
    expect(source).toContain('header: "Scope"');
    expect(source).toContain('header: "Updated"');
    expect(source).toContain("canForget={false}");
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
