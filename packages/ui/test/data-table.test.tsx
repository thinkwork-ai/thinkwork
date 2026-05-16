import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTable } from "../src/index.js";

describe("DataTable", () => {
  it("renders generated-app column definitions", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={[
          { key: "opportunity", label: "Opportunity" },
          {
            key: "value",
            label: "Value",
            align: "right",
            render: (value) => `$${Number(value).toLocaleString()}`,
          },
        ]}
        data={[{ opportunity: "LastMile renewal", value: 42000 }]}
        pageSize={0}
      />,
    );

    expect(html).toContain("Opportunity");
    expect(html).toContain("LastMile renewal");
    expect(html).toContain("$42,000");
  });

  it("accepts rows as a generated-app alias for data", () => {
    const html = renderToStaticMarkup(
      <DataTable
        title="Top risks"
        columns={[{ key: "risk", header: "Risk" }]}
        rows={[{ risk: "Stale activity" }]}
        pageSize={0}
      />,
    );

    expect(html).toContain("Top risks");
    expect(html).toContain("Risk");
    expect(html).toContain("Stale activity");
  });

  it("pins body rows to 40px (h-10) with cell padding and overflow neutralized", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={[{ key: "name", header: "Name" }]}
        data={[{ name: "Row one" }, { name: "Row two" }]}
        pageSize={0}
      />,
    );

    // renderToStaticMarkup HTML-encodes `&` and `>` inside class attrs.
    // Body rows must drop border-b and use an inset shadow so the row's
    // 40px height is the true visual height (no +1px from a bottom border).
    const tbodyRowOpens = [
      ...html.matchAll(/<tr[^>]*data-slot="table-row"[^>]*>/g),
    ];
    // tbody contains body rows; thead contains the header row.
    // Filter to rows that come after the <tbody> open tag.
    const tbodyStart = html.indexOf('data-slot="table-body"');
    const bodyRowClasses = tbodyRowOpens
      .filter((m) => (m.index ?? 0) > tbodyStart)
      .map((m) => m[0]);

    expect(bodyRowClasses.length).toBeGreaterThanOrEqual(2);
    for (const row of bodyRowClasses) {
      expect(row).toContain("h-10");
      expect(row).toContain("border-b-0");
      expect(row).toContain(
        "shadow-[inset_0_-1px_0_var(--color-border)]",
      );
      expect(row).toContain("[&amp;&gt;td]:py-0");
      expect(row).toContain("[&amp;&gt;td]:overflow-hidden");
    }
  });

  it("pins the empty-state row to 40px (h-10)", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={[{ key: "name", header: "Name" }]}
        data={[]}
        pageSize={0}
      />,
    );

    const tbodyStart = html.indexOf('data-slot="table-body"');
    expect(tbodyStart).toBeGreaterThan(-1);
    const tbodyHtml = html.slice(tbodyStart);
    expect(tbodyHtml).toContain("h-10");
    expect(tbodyHtml).toContain("border-b-0");
    expect(tbodyHtml).toContain(
      "shadow-[inset_0_-1px_0_var(--color-border)]",
    );
    expect(tbodyHtml).toContain("[&amp;&gt;td]:py-0");
    expect(tbodyHtml).toContain("[&amp;&gt;td]:overflow-hidden");
    expect(tbodyHtml).not.toContain("h-24");
  });
});
