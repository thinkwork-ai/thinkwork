import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppHeader,
  BarChart,
  DataTable,
  EvidenceList,
  KpiStrip,
  RefreshBar,
  SourceStatusList,
  StackedBarChart,
  formatCurrency,
} from "../index.js";

afterEach(cleanup);

describe("@thinkwork/computer-stdlib primitives", () => {
  it("renders KPI cards and shared formatters", () => {
    render(
      <KpiStrip
        cards={[
          {
            label: "Open pipeline",
            value: formatCurrency(1_250_000),
            detail: "12 opportunities",
            tone: "success",
          },
          {
            label: "High-risk exposure",
            value: formatCurrency(310_000),
            detail: "3 high-risk deals",
            tone: "risk",
          },
        ]}
      />,
    );

    expect(screen.getByText("Open pipeline")).toBeTruthy();
    expect(screen.getByText("$1.3M")).toBeTruthy();
    expect(screen.getByText("High-risk exposure")).toBeTruthy();
  });

  it("renders no empty KPI grid when there are no cards", () => {
    const { container } = render(<KpiStrip cards={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders header provenance and badges", () => {
    render(
      <AppHeader
        title="Meeting prep"
        summary="Agenda and account notes"
        badges={[{ label: "Read-only", variant: "outline" }]}
        generatedAt="2026-05-09T12:00:00.000Z"
      />,
    );

    expect(screen.getByText("Meeting prep")).toBeTruthy();
    expect(screen.getByText("Agenda and account notes")).toBeTruthy();
    expect(screen.getByText("Read-only")).toBeTruthy();
    expect(screen.getByText("Private artifact")).toBeTruthy();
  });

  it("renders table rows and an empty-state slot", () => {
    render(
      <DataTable
        title="Opportunity risk"
        columns={[
          { key: "name", header: "Name" },
          {
            key: "amount",
            header: "Amount",
            align: "right",
            render: (value) => formatCurrency(Number(value)),
          },
        ]}
        rows={[{ name: "Renewal", amount: 500_000 }]}
      />,
    );

    expect(screen.getByText("Opportunity risk")).toBeTruthy();
    expect(screen.getByText("Renewal")).toBeTruthy();
    expect(screen.getByText("$500,000")).toBeTruthy();

    cleanup();

    render(
      <DataTable
        columns={[{ key: "name", header: "Name" }]}
        rows={[]}
        emptyState="No opportunities"
      />,
    );

    expect(screen.getByText("No opportunities")).toBeTruthy();
  });

  it("renders evidence links and text-only evidence", () => {
    render(
      <EvidenceList
        items={[
          {
            id: "email",
            title: "Email signal",
            snippet: "Prospect asked for legal review",
            sourceId: "gmail",
            fetchedAt: "2026-05-09T12:00:00.000Z",
            url: "https://example.com",
          },
          {
            id: "note",
            title: "Internal note",
            snippet: "No source URL",
          },
        ]}
      />,
    );

    expect(screen.getByText("Email signal")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Source" })).toBeTruthy();
    expect(screen.getByText("Internal note")).toBeTruthy();
  });

  it("renders source status and chart empty states", () => {
    render(
      <>
        <SourceStatusList
          sources={[
            { id: "crm", label: "CRM", status: "success", recordCount: 5 },
            {
              id: "email",
              label: "Email",
              status: "partial",
              error: "Some messages were skipped",
            },
          ]}
        />
        <BarChart title="Stage exposure" data={[]} />
        <StackedBarChart
          title="Product exposure"
          data={[]}
          segments={[{ key: "risk", label: "Risk", color: "red" }]}
        />
      </>,
    );

    expect(screen.getByText("CRM")).toBeTruthy();
    expect(screen.getByText("partial")).toBeTruthy();
    expect(screen.getAllByText("No chart data yet.")).toHaveLength(2);
  });

  it("renders failed refresh state and hides Ask Computer unless provided", () => {
    const onRefresh = vi.fn();
    render(
      <RefreshBar
        refreshState="failed"
        error="Refresh failed"
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText("Refresh failed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask Computer" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("hides the refresh button when refresh is disabled", () => {
    render(<RefreshBar disabled onRefresh={() => undefined} />);

    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });
});
