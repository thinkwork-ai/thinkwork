import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const componentSource = readFileSync(
  new URL("./CostView.tsx", import.meta.url),
  "utf8",
);
const querySource = readFileSync(
  new URL("../../../../lib/graphql-queries.ts", import.meta.url),
  "utf8",
);

describe("CostView user cost reporting", () => {
  it("uses a user budget table instead of agent chargeback UI", () => {
    expect(componentSource).toContain("function UserBudgetTable");
    expect(componentSource).toContain("Cost by User");
    expect(componentSource).toContain("User-attributed spend");
    expect(componentSource).not.toContain("Cost by Agent");
    expect(componentSource).not.toContain("function AgentBudgetTable");
    expect(componentSource).not.toContain("AgentsListQuery");
  });

  it("renders system/unattributed spend as a non-user row", () => {
    expect(componentSource).toContain("System or unattributed spend");
    expect(componentSource).toContain('row.isSystem ? "Not assigned"');
    expect(componentSource).toContain('row.userId ?? "system"');
  });

  it("queries costByUser and user budget policy fields", () => {
    expect(querySource).toContain("query CostByUser");
    expect(querySource).toContain("costByUser(tenantId: $tenantId");
    expect(querySource).toContain("userEmail");
    expect(querySource).toContain("isSystem");
    expect(querySource).toContain("userId");
    expect(querySource).not.toContain("query CostByAgent");
  });
});
