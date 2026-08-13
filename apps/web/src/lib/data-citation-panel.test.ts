import { describe, expect, it } from "vitest";
import {
  dataCitationTitle,
  dataCitePanelId,
  parseDataCitePanelId,
  type DataCitation,
} from "./data-citation-panel";

const citation: DataCitation = {
  kind: "analytics",
  query: "SELECT * FROM fct_ar_open_invoices WHERE amount > 0",
  database: "mart_analytics",
  tables: ["fct_ar_open_invoices"],
  rowCount: 42,
  truncated: true,
  queryExecutionId: "athena-123",
  packSequence: 2,
  elapsedMs: 812,
};

describe("dataCitePanelId / parseDataCitePanelId", () => {
  it("round-trips a full citation", () => {
    expect(parseDataCitePanelId(dataCitePanelId(citation))).toEqual(citation);
  });

  it("round-trips the minimal shape", () => {
    const minimal: DataCitation = { kind: "graph", rowCount: 0, elapsedMs: 5 };
    expect(parseDataCitePanelId(dataCitePanelId(minimal))).toEqual(minimal);
  });

  it("drops extra fields callers attach (row numbering)", () => {
    const id = dataCitePanelId({ ...citation, n: 3 } as DataCitation);
    expect(parseDataCitePanelId(id)).toEqual(citation);
  });

  it("rejects other panel ids and malformed payloads", () => {
    expect(parseDataCitePanelId("artifact-uuid")).toBeNull();
    expect(parseDataCitePanelId("data-cite:not-json")).toBeNull();
    expect(
      parseDataCitePanelId(
        `data-cite:${encodeURIComponent(JSON.stringify({ kind: "sql", rowCount: 1, elapsedMs: 1 }))}`,
      ),
    ).toBeNull();
    expect(
      parseDataCitePanelId(
        `data-cite:${encodeURIComponent(JSON.stringify({ kind: "graph", elapsedMs: 1 }))}`,
      ),
    ).toBeNull();
  });
});

describe("dataCitationTitle", () => {
  it("prefers tables, then database, then a kind label", () => {
    expect(dataCitationTitle(citation)).toBe("fct_ar_open_invoices");
    expect(dataCitationTitle({ ...citation, tables: undefined })).toBe(
      "mart_analytics",
    );
    expect(
      dataCitationTitle({ kind: "graph", rowCount: 1, elapsedMs: 1 }),
    ).toBe("Graph query");
    expect(
      dataCitationTitle({ kind: "analytics", rowCount: 1, elapsedMs: 1 }),
    ).toBe("Analytics query");
  });
});
