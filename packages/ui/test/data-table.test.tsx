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
});
