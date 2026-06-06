import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Users detail Models configuration", () => {
  const routeSource = readSource("./$userId.tsx");
  const queriesSource = readSource("../../../../lib/graphql-queries.ts");

  it("renders the user model approval section under configuration", () => {
    expect(routeSource).toContain("UserModelsSection");
    expect(routeSource).toContain(
      "<UserModelsSection userId={member.user.id} />",
    );
    expect(routeSource).toContain("max-w-[760px] space-y-6");
    expect(routeSource.indexOf("<HumanProfileSection")).toBeLessThan(
      routeSource.indexOf("<UserModelsSection"),
    );
  });

  it("defines admin GraphQL operations for user model approvals", () => {
    expect(queriesSource).toContain("query UserModelCatalog($userId: ID!)");
    expect(queriesSource).toContain("userModelCatalog(userId: $userId)");
    expect(queriesSource).toContain("mutation SetUserModelApproval");
    expect(queriesSource).toContain("setUserModelApproval(");
    expect(queriesSource).toContain("inputCostPerMillion");
    expect(queriesSource).toContain("outputCostPerMillion");
    expect(queriesSource).toContain("approved");
  });
});
