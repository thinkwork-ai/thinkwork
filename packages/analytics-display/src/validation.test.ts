import { describe, expect, it } from "vitest";

import { analyticsDisplayCatalog } from "./catalog.js";
import { analyticsDisplayLimits } from "./limits.js";
import { createAnalyticsDisplaySummary } from "./summary.js";
import {
  createAnalyticsDisplayFixture,
  createDashboardFixture,
  createThreadGenUIFixture,
} from "./test-fixtures.js";
import { safeDisplayValue } from "./formatters.js";
import { createAnalyticsDisplayRenderModel } from "./react/index.js";
import { validateAnalyticsDisplayPayload } from "./validation.js";
import {
  ANALYTICS_DISPLAY_VERSION,
  type AnalyticsDisplayElement,
  type AnalyticsDisplayRenderPayload,
} from "./spec.js";

describe("validateAnalyticsDisplayPayload", () => {
  it("accepts the shared analytics display fixture", () => {
    const result = validateAnalyticsDisplayPayload(
      createAnalyticsDisplayFixture(),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.analyticsDisplayVersion).toBe(
        ANALYTICS_DISPLAY_VERSION,
      );
      expect(analyticsDisplayCatalog.version).toBe(ANALYTICS_DISPLAY_VERSION);
      expect(
        result.payload.spec.elements.map((element) => element.type),
      ).toEqual(["metric", "chart", "table"]);
    }
  });

  it("uses the same by-value contract for dashboard and Thread GenUI consumers", () => {
    const dashboardPayload = createDashboardFixture();
    const threadPayload = createThreadGenUIFixture();
    const dashboardValidation =
      validateAnalyticsDisplayPayload(dashboardPayload);
    const threadValidation = validateAnalyticsDisplayPayload(threadPayload);

    expect(dashboardValidation.ok).toBe(true);
    expect(threadValidation.ok).toBe(true);
    expect(threadPayload).toEqual(dashboardPayload);
    expect(JSON.stringify(threadPayload)).not.toMatch(
      /dashboardId|datasetId|dashboard_id|dataset_id/,
    );
    if (dashboardValidation.ok && threadValidation.ok) {
      const dashboard = createAnalyticsDisplayRenderModel(
        dashboardValidation.payload,
        {
          host: "dashboard",
          density: "dashboard",
        },
      );
      const thread = createAnalyticsDisplayRenderModel(
        threadValidation.payload,
        {
          host: "thread",
          density: "thread",
        },
      );

      expect(thread.elements.map((element) => element.id)).toEqual(
        dashboard.elements.map((element) => element.id),
      );
      expect(thread.summary.title).toBe(dashboard.summary.title);
    }
  });

  it("escapes snapshot values while rejecting unsafe labels", () => {
    expect(safeDisplayValue(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );

    const payload = createAnalyticsDisplayFixture();
    payload.spec.elements[0].title = "<script>";

    const result = validateAnalyticsDisplayPayload(payload);

    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("ANALYTICS_DISPLAY_LABEL_UNSAFE");
  });

  it("rejects unsafe labels across sequential validations", () => {
    const firstPayload = createAnalyticsDisplayFixture();
    const secondPayload = createAnalyticsDisplayFixture();
    firstPayload.spec.elements[0].title = "<";
    secondPayload.spec.elements[0].title = ">";

    const firstResult = validateAnalyticsDisplayPayload(firstPayload);
    const secondResult = validateAnalyticsDisplayPayload(secondPayload);

    expect(codes(firstResult)).toContain("ANALYTICS_DISPLAY_LABEL_UNSAFE");
    expect(codes(secondResult)).toContain("ANALYTICS_DISPLAY_LABEL_UNSAFE");
  });

  it("rejects unsupported charts, raw styles, and non-token palettes", () => {
    const payload =
      createAnalyticsDisplayFixture() as AnalyticsDisplayRenderPayload & {
        spec: { elements: Array<Record<string, unknown>> };
      };
    payload.spec.elements[1].chartKind = "scatter";
    payload.spec.elements[1].color = "#1d4ed8";
    payload.spec.elements[1].series = [
      {
        key: "high",
        label: "High Priority",
        valueKey: "high",
        palette: "#1d4ed8",
      },
    ];

    const result = validateAnalyticsDisplayPayload(payload);

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "ANALYTICS_DISPLAY_CHART_KIND_INVALID",
        "ANALYTICS_DISPLAY_PALETTE_TOKEN_INVALID",
        "ANALYTICS_DISPLAY_RAW_STYLE_FORBIDDEN",
      ]),
    );
  });

  it("enforces bounded rows, chart points, table columns, and element count", () => {
    const payload = createAnalyticsDisplayFixture();
    payload.data.rows = Array.from(
      { length: analyticsDisplayLimits.maxRows + 1 },
      (_, index) => ({
        day: `2026-06-${String((index % 28) + 1).padStart(2, "0")}`,
        high: index,
        normal: index,
        total: index * 2,
        customer_email: "[redacted]",
      }),
    );
    payload.spec.elements = [
      {
        type: "chart",
        id: "limit-chart",
        title: "Limit Chart",
        chartKind: "bar",
        categoryKey: "day",
        series: [
          {
            key: "total",
            label: "Total",
            valueKey: "total",
            palette: "chart-1",
          },
        ],
      },
      ...(Array.from(
        { length: analyticsDisplayLimits.maxElements + 1 },
        (_, index) => ({
          type: "metric" as const,
          id: `metric-${index}`,
          title: `Metric ${index}`,
          valueKey: "total",
        }),
      ) satisfies AnalyticsDisplayElement[]),
    ];
    payload.spec.elements.push({
      type: "table",
      id: "oversized-table",
      title: "Oversized Table",
      columns: Array.from(
        { length: analyticsDisplayLimits.maxTableColumns + 1 },
        (_, index) => ({
          key: index === 0 ? "day" : "total",
          label: `Column ${index}`,
        }),
      ),
    });

    const result = validateAnalyticsDisplayPayload(payload);

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "ANALYTICS_DISPLAY_TOO_MANY_CHART_POINTS",
        "ANALYTICS_DISPLAY_TOO_MANY_ELEMENTS",
        "ANALYTICS_DISPLAY_TOO_MANY_ROWS",
        "ANALYTICS_DISPLAY_TABLE_COLUMNS_INVALID",
      ]),
    );
  });

  it("rejects undeclared row fields and non-primitive row values", () => {
    const payload =
      createAnalyticsDisplayFixture() as AnalyticsDisplayRenderPayload & {
        data: { rows: Array<Record<string, unknown>> };
      };
    const firstRow = payload.data.rows[0] as Record<string, unknown>;
    firstRow.unknown = "extra";
    firstRow.total = { nested: true };

    const result = validateAnalyticsDisplayPayload(payload);

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "ANALYTICS_DISPLAY_ROW_COLUMN_UNKNOWN",
        "ANALYTICS_DISPLAY_ROW_VALUE_INVALID",
      ]),
    );
  });

  it("rejects unbounded row strings and oversized payloads", () => {
    const longRowValue = createAnalyticsDisplayFixture();
    longRowValue.data.rows[0].day = "x".repeat(
      analyticsDisplayLimits.maxStringValueLength + 1,
    );
    const oversizedPayload = createAnalyticsDisplayFixture();
    oversizedPayload.spec.description = "x".repeat(
      analyticsDisplayLimits.maxSerializedPayloadBytes,
    );

    expect(codes(validateAnalyticsDisplayPayload(longRowValue))).toContain(
      "ANALYTICS_DISPLAY_STRING_VALUE_TOO_LONG",
    );
    expect(codes(validateAnalyticsDisplayPayload(oversizedPayload))).toContain(
      "ANALYTICS_DISPLAY_PAYLOAD_TOO_LARGE",
    );
  });

  it("rejects missing or duplicate element ids", () => {
    const payload =
      createAnalyticsDisplayFixture() as AnalyticsDisplayRenderPayload & {
        spec: { elements: Array<Record<string, unknown>> };
      };
    const elements = payload.spec.elements as Array<Record<string, unknown>>;
    delete elements[0].id;
    elements[2].id = elements[1].id;

    const result = validateAnalyticsDisplayPayload(payload);

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "ANALYTICS_DISPLAY_ELEMENT_ID_REQUIRED",
        "ANALYTICS_DISPLAY_ELEMENT_ID_DUPLICATE",
      ]),
    );
  });

  it("rejects invalid column metadata enums and overlong labels", () => {
    const payload =
      createAnalyticsDisplayFixture() as AnalyticsDisplayRenderPayload & {
        spec: { columns: Array<Record<string, unknown>>; title: string };
      };
    payload.spec.title = "A".repeat(analyticsDisplayLimits.maxLabelLength + 1);
    const firstColumn = payload.spec.columns[0] as Record<string, unknown>;
    firstColumn.type = "money";
    firstColumn.sensitivity = "secret";
    firstColumn.redaction = "masked";

    const result = validateAnalyticsDisplayPayload(payload);

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "ANALYTICS_DISPLAY_LABEL_TOO_LONG",
        "ANALYTICS_DISPLAY_COLUMN_TYPE_INVALID",
        "ANALYTICS_DISPLAY_COLUMN_SENSITIVITY_INVALID",
        "ANALYTICS_DISPLAY_COLUMN_REDACTION_INVALID",
      ]),
    );
  });

  it.each([
    {
      name: "non-object payload",
      payload: null,
      expected: ["ANALYTICS_DISPLAY_PAYLOAD_NOT_OBJECT"],
    },
    {
      name: "missing required envelope fields",
      payload: {},
      expected: [
        "ANALYTICS_DISPLAY_KIND_INVALID",
        "ANALYTICS_DISPLAY_VERSION_UNSUPPORTED",
        "ANALYTICS_DISPLAY_FRESHNESS_REQUIRED",
        "ANALYTICS_DISPLAY_PROVENANCE_REQUIRED",
        "ANALYTICS_DISPLAY_SPEC_REQUIRED",
        "ANALYTICS_DISPLAY_ROWS_REQUIRED",
      ],
    },
    {
      name: "empty spec and malformed rows",
      payload: {
        ...createAnalyticsDisplayFixture(),
        spec: { title: "Empty", columns: [], elements: [] },
        data: { rows: [null] },
      },
      expected: [
        "ANALYTICS_DISPLAY_COLUMNS_REQUIRED",
        "ANALYTICS_DISPLAY_ELEMENTS_REQUIRED",
        "ANALYTICS_DISPLAY_ROW_NOT_OBJECT",
      ],
    },
    {
      name: "unsupported filters and element shape",
      payload: {
        ...createAnalyticsDisplayFixture(),
        spec: {
          ...createAnalyticsDisplayFixture().spec,
          filters: [
            {
              id: "bad",
              label: "Bad Filter",
              columnKey: "missing",
              operator: "regex",
            },
          ],
          elements: [
            null,
            { type: "sparkline", id: "bad", title: "Bad Element" },
            {
              type: "chart",
              id: "bad-chart",
              title: "Bad Chart",
              chartKind: "bar",
              categoryKey: "day",
              series: [],
            },
          ],
        },
      },
      expected: [
        "ANALYTICS_DISPLAY_FILTER_OPERATOR_INVALID",
        "ANALYTICS_DISPLAY_FILTER_COLUMN_UNKNOWN",
        "ANALYTICS_DISPLAY_ELEMENT_NOT_OBJECT",
        "ANALYTICS_DISPLAY_ELEMENT_TYPE_INVALID",
        "ANALYTICS_DISPLAY_CHART_SERIES_INVALID",
      ],
    },
    {
      name: "malformed nested spec entries",
      payload: {
        ...createAnalyticsDisplayFixture(),
        spec: {
          ...createAnalyticsDisplayFixture().spec,
          columns: [null, ...createAnalyticsDisplayFixture().spec.columns],
          filters: [null],
          elements: [
            {
              type: "chart",
              id: "bad-chart",
              title: "Bad Chart",
              chartKind: "bar",
              categoryKey: "day",
              series: [null],
            },
            {
              type: "table",
              id: "bad-table",
              title: "Bad Table",
              columns: [null],
            },
          ],
        },
      },
      expected: [
        "ANALYTICS_DISPLAY_COLUMN_NOT_OBJECT",
        "ANALYTICS_DISPLAY_FILTER_NOT_OBJECT",
        "ANALYTICS_DISPLAY_CHART_SERIES_NOT_OBJECT",
        "ANALYTICS_DISPLAY_TABLE_COLUMN_NOT_OBJECT",
      ],
    },
    {
      name: "malformed optional envelope metadata",
      payload: {
        ...createAnalyticsDisplayFixture(),
        freshness: {
          takenAt: "2026-06-18T15:30:00.000Z",
          oldestAt: 123,
          status: "expired",
        },
        provenance: {
          sourceLabels: ["Warehouse"],
          dataSourceSlugs: [null],
        },
        diagnostics: [{ code: "WARN", message: "Warning", severity: "info" }],
        sensitivity: {
          containsSensitiveFields: true,
          sensitiveColumns: [null],
          policy: "open",
        },
      },
      expected: [
        "ANALYTICS_DISPLAY_FRESHNESS_OLDEST_AT_INVALID",
        "ANALYTICS_DISPLAY_FRESHNESS_STATUS_INVALID",
        "ANALYTICS_DISPLAY_PROVENANCE_SLUGS_INVALID",
        "ANALYTICS_DISPLAY_DIAGNOSTIC_INVALID",
        "ANALYTICS_DISPLAY_SENSITIVITY_COLUMNS_INVALID",
        "ANALYTICS_DISPLAY_SENSITIVITY_POLICY_INVALID",
      ],
    },
  ])("reports public diagnostics for $name", ({ payload, expected }) => {
    const result = validateAnalyticsDisplayPayload(payload);

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(expect.arrayContaining(expected));
  });

  it("rejects portable Thread payloads that include dashboard or dataset references", () => {
    const payload = {
      ...createAnalyticsDisplayFixture(),
      dashboardId: "dash_123",
      spec: {
        ...createAnalyticsDisplayFixture().spec,
        dataset_id: "dataset_123",
        route: "/threads/123",
        renderer: "ThreadChart",
      },
    };

    const result = validateAnalyticsDisplayPayload(payload);

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining(["ANALYTICS_DISPLAY_REFERENCE_FORBIDDEN"]),
    );
  });

  it("rejects sensitive row values unless the field is redacted or aggregate-only", () => {
    const payload = createAnalyticsDisplayFixture();
    payload.data.rows[0].customer_email = "person@example.com";

    const result = validateAnalyticsDisplayPayload(payload);

    expect(result.ok).toBe(false);
    expect(codes(result)).toContain(
      "ANALYTICS_DISPLAY_SENSITIVE_VALUE_EMBEDDED",
    );
  });

  it("creates stable safe summaries for empty datasets", () => {
    const payload = createAnalyticsDisplayFixture();
    payload.data.rows = [];

    const result = validateAnalyticsDisplayPayload(payload);
    const summary = createAnalyticsDisplaySummary(payload);

    expect(result.ok).toBe(true);
    expect(summary.title).toBe("Support Volume");
    expect(summary.lines).toEqual([
      "Total Tickets: No value",
      "Ticket Volume: 0 points",
      "Daily Detail: 0 rows",
    ]);
    expect(summary.provenance).toBe("Source: Zendesk, Warehouse daily rollup");
    expect(summary.freshness).toContain("2026-06-17T00:00:00.000Z");
  });

  it("keeps the core package independent from React, Recharts, and UI dependencies", async () => {
    const packageJson = (
      await import("../package.json", { with: { type: "json" } })
    ).default as Record<string, unknown>;

    expect(packageJson.dependencies ?? {}).toEqual({});
    expect(packageJson.peerDependencies ?? {}).toEqual({});
    expect(packageJson.exports).toMatchObject({
      ".": "./src/index.ts",
      "./react": "./src/react/index.ts",
    });
  });
});

function codes(result: ReturnType<typeof validateAnalyticsDisplayPayload>) {
  return result.ok
    ? []
    : result.diagnostics.map((diagnostic) => diagnostic.code);
}
