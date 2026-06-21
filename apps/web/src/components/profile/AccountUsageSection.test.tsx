import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const queryDocs = vi.hoisted(() => ({
  SettingsAccountUsageQuery: Symbol("SettingsAccountUsageQuery"),
}));
const urqlMocks = vi.hoisted(() => ({
  calls: [] as Array<{
    pause?: boolean;
    query: symbol;
    variables: { tenantId: string; userId: string; days: number };
  }>,
  result: {
    data: undefined as unknown,
    error: undefined as unknown,
    fetching: false,
  },
}));

vi.mock("@/lib/settings-queries", () => queryDocs);
vi.mock("urql", () => ({
  useQuery: (args: {
    pause?: boolean;
    query: symbol;
    variables: { tenantId: string; userId: string; days: number };
  }) => {
    urqlMocks.calls.push(args);
    return [urqlMocks.result];
  },
}));
vi.mock("@/components/LoadingShimmer", () => ({
  LoadingShimmer: () => <div>Loading...</div>,
}));
vi.mock("@thinkwork/ui", () => ({
  cn: (...classes: Array<string | undefined | false | null>) =>
    classes.filter(Boolean).join(" "),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <div className={className} data-testid="usage-tooltip">
      {children}
    </div>
  ),
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { AccountUsageSection } from "./AccountUsageSection";

const activeUsage = {
  accountUsage: {
    tenantId: "tenant-1",
    userId: "user-1",
    periodStart: "2026-03-23T00:00:00.000Z",
    periodEnd: "2026-06-21T12:00:00.000Z",
    summary: {
      totalUsd: 8,
      llmUsd: 7,
      computeUsd: 0.75,
      toolsUsd: 0.25,
      inputTokens: 1800,
      outputTokens: 3700,
      eventCount: 12,
    },
    daily: [
      {
        day: "2026-06-19",
        totalUsd: 1.25,
        llmUsd: 1.25,
        computeUsd: 0,
        toolsUsd: 0,
        inputTokens: 500,
        outputTokens: 750,
        eventCount: 2,
      },
      {
        day: "2026-06-20",
        totalUsd: 3.5,
        llmUsd: 3,
        computeUsd: 0.5,
        toolsUsd: 0,
        inputTokens: 1000,
        outputTokens: 2000,
        eventCount: 7,
      },
      {
        day: "2026-06-21",
        totalUsd: 3.25,
        llmUsd: 2.75,
        computeUsd: 0.25,
        toolsUsd: 0.25,
        inputTokens: 300,
        outputTokens: 950,
        eventCount: 3,
      },
    ],
    models: [
      {
        model: "anthropic.claude-3-haiku-20240307-v1:0",
        displayName: "Haiku",
        totalUsd: 1.25,
        inputTokens: 500,
        outputTokens: 750,
        usageShare: 0.18,
      },
      {
        model: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
        displayName: "Claude 3.5 Sonnet",
        totalUsd: 5.75,
        inputTokens: 1300,
        outputTokens: 2950,
        usageShare: 0.82,
      },
    ],
  },
};

beforeEach(() => {
  urqlMocks.calls = [];
  urqlMocks.result = {
    data: activeUsage,
    error: undefined,
    fetching: false,
  };
});

afterEach(() => {
  cleanup();
});

describe("AccountUsageSection", () => {
  it("renders totals, a 90-day calendar, active day labels, and model breakdown sorted by spend", () => {
    render(<AccountUsageSection tenantId="tenant-1" userId="user-1" />);

    expect(screen.getByText("Account Usage")).toBeTruthy();
    expect(screen.getByText("Total Spend")).toBeTruthy();
    expect(screen.getByText("$8.00")).toBeTruthy();
    expect(screen.getByText("5.5k")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getAllByText("3")[0]).toBeTruthy();

    expect(screen.getAllByTestId("usage-day")).toHaveLength(90);
    const calendar = screen.getByLabelText(
      "Account usage calendar for the last 90 days",
    );
    expect(calendar.className).toContain("grid-flow-col");
    expect(calendar.className).toContain("grid-rows-7");
    expect(screen.getAllByTestId("usage-calendar-cell")).toHaveLength(1);
    expect(
      screen.getByLabelText("2026-06-20: $3.50 spend, 3.0k tokens, 7 events"),
    ).toBeTruthy();
    expect(screen.getAllByTestId("usage-tooltip")[0].className).toContain(
      "space-y-1.5",
    );
    expect(screen.getAllByTestId("usage-tooltip")[0].className).toContain(
      "pointer-events-none",
    );
    expect(screen.getAllByText("Spend")[0]).toBeTruthy();
    expect(screen.getAllByText("Tokens")[0]).toBeTruthy();
    expect(screen.getAllByText("Events")[0]).toBeTruthy();

    const sonnet = screen.getByText("Claude 3.5 Sonnet");
    const haiku = screen.getByText("Haiku");
    expect(screen.getAllByTestId("model-row")[0].className).toContain(
      "grid-cols-[minmax(12rem,1fr)_8rem_7rem_5rem]",
    );
    expect(
      sonnet.compareDocumentPosition(haiku) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("82%")).toBeTruthy();
    expect(screen.getByText("18%")).toBeTruthy();

    expect(urqlMocks.calls[0]).toMatchObject({
      pause: false,
      query: queryDocs.SettingsAccountUsageQuery,
      variables: { tenantId: "tenant-1", userId: "user-1", days: 90 },
    });
  });

  it("renders a stable empty state when the user has no account usage", () => {
    urqlMocks.result = {
      data: {
        accountUsage: {
          ...activeUsage.accountUsage,
          summary: {
            totalUsd: 0,
            llmUsd: 0,
            computeUsd: 0,
            toolsUsd: 0,
            inputTokens: 0,
            outputTokens: 0,
            eventCount: 0,
          },
          daily: [],
          models: [],
        },
      },
      error: undefined,
      fetching: false,
    };

    render(<AccountUsageSection tenantId="tenant-1" userId="user-1" />);

    expect(screen.getByText("No usage yet")).toBeTruthy();
    expect(screen.getByText("No model usage in this period.")).toBeTruthy();
    expect(screen.getAllByTestId("usage-day")).toHaveLength(90);
    expect(
      screen.getByLabelText("2026-06-21: $0.00 spend, 0 tokens, 0 events"),
    ).toBeTruthy();
  });

  it("uses event count for calendar intensity when spend is zero", () => {
    urqlMocks.result = {
      data: {
        accountUsage: {
          ...activeUsage.accountUsage,
          summary: {
            ...activeUsage.accountUsage.summary,
            totalUsd: 0,
            eventCount: 4,
          },
          daily: [
            {
              day: "2026-06-20",
              totalUsd: 0,
              llmUsd: 0,
              computeUsd: 0,
              toolsUsd: 0,
              inputTokens: 0,
              outputTokens: 0,
              eventCount: 1,
            },
            {
              day: "2026-06-21",
              totalUsd: 0,
              llmUsd: 0,
              computeUsd: 0,
              toolsUsd: 0,
              inputTokens: 0,
              outputTokens: 0,
              eventCount: 3,
            },
          ],
          models: [],
        },
      },
      error: undefined,
      fetching: false,
    };

    render(
      <AccountUsageSection tenantId="tenant-1" userId="user-1" days={2} />,
    );

    expect(screen.getAllByTestId("usage-day")).toHaveLength(2);
    expect(screen.getAllByTestId("usage-calendar-cell")).toHaveLength(5);
    expect(
      screen.getByLabelText("2026-06-21: $0.00 spend, 0 tokens, 3 events")
        .className,
    ).toContain("bg-cyan-600");
  });

  it("pauses the account usage query when the profile scope is incomplete", () => {
    const { container } = render(
      <AccountUsageSection tenantId={null} userId="user-1" />,
    );

    expect(container.textContent).toBe("");
    expect(urqlMocks.calls[0]).toMatchObject({
      pause: true,
      variables: { tenantId: "", userId: "user-1", days: 90 },
    });
  });
});
