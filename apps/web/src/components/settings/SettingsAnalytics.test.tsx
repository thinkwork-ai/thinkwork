import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const componentSource = readFileSync(
  join(process.cwd(), "src/components/settings/SettingsAnalytics.tsx"),
  "utf8",
);
const querySource = readFileSync(
  join(process.cwd(), "src/lib/settings-queries.ts"),
  "utf8",
);

describe("SettingsAnalytics user cost reporting", () => {
  it("renders user cost reporting instead of agent chargeback wording", () => {
    expect(componentSource).toContain("Cost by User");
    expect(componentSource).not.toContain("Cost by Agent");
    expect(componentSource).not.toContain("CostByAgent");
  });

  it("shows identity, system spend, and user budget state", () => {
    expect(componentSource).toContain("userEmail");
    expect(componentSource).toContain("isSystem");
    expect(componentSource).toContain('r.userId ?? "system"');
    expect(componentSource).toContain('r.isSystem ? "System" : r.userName');
    expect(componentSource).not.toContain("System / unattributed");
    expect(componentSource).not.toContain("Not assigned");
    expect(componentSource).not.toContain("No budget");
    expect(componentSource).toContain("Unlimited");
    expect(componentSource).toContain("BudgetProgress");
  });

  it("queries costByUser and user budget status fields", () => {
    expect(querySource).toContain("query SettingsCostByUser");
    expect(querySource).toContain("costByUser(tenantId: $tenantId)");
    expect(querySource).toContain("query SettingsBudgetStatus");
    expect(querySource).toContain("userId");
    expect(querySource).not.toContain("query SettingsCostByAgent");
  });

  it("keeps profile account usage separate from tenant analytics", () => {
    expect(querySource).toContain("query SettingsAccountUsage");
    expect(querySource).toContain(
      "accountUsage(tenantId: $tenantId, userId: $userId, days: $days)",
    );

    expect(componentSource).toContain("SettingsCostSummaryQuery");
    expect(componentSource).toContain("SettingsCostByUserQuery");
    expect(componentSource).toContain("SettingsCostByModelQuery");
    expect(componentSource).toContain("SettingsCostTimeSeriesQuery");
    expect(componentSource).not.toContain("SettingsAccountUsageQuery");
    expect(componentSource).not.toContain("accountUsage");
  });
});
