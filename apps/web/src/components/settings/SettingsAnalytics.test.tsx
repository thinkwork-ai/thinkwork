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
    expect(componentSource).toContain("visibleSpendUsd");
    expect(componentSource).toContain(
      "budget.visibleSpendUsd / budget.policy.limitUsd",
    );
    expect(componentSource).toContain("formatUsd(budget.visibleSpendUsd)");
  });

  it("queries costByUser and user budget status fields", () => {
    expect(querySource).toContain("query SettingsCostByUser");
    expect(querySource).toContain(
      "costByUser(tenantId: $tenantId, from: $from, to: $to)",
    );
    expect(querySource).toContain("query SettingsBudgetStatus");
    expect(querySource).toContain("userId");
    expect(querySource).not.toContain("query SettingsCostByAgent");
  });

  it("uses a consistent 30-day range for analytics totals and trends", () => {
    expect(componentSource).toContain("const ANALYTICS_DAYS = 30");
    expect(componentSource).toContain("getAnalyticsRange(ANALYTICS_DAYS)");
    expect(componentSource).toContain("...analyticsVars");
    expect(componentSource).toContain("days: ANALYTICS_DAYS");
    expect(querySource).toContain("query SettingsCostSummary(");
    expect(querySource).toContain("$from: AWSDateTime");
    expect(querySource).toContain("$to: AWSDateTime");
    expect(querySource).toContain(
      "costSummary(tenantId: $tenantId, from: $from, to: $to)",
    );
    expect(querySource).toContain("query SettingsCostByModel(");
    expect(querySource).toContain(
      "costByModel(tenantId: $tenantId, from: $from, to: $to)",
    );
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
