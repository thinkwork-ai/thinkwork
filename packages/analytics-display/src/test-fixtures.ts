import {
  ANALYTICS_DISPLAY_KIND,
  ANALYTICS_DISPLAY_VERSION,
  type AnalyticsDisplayRenderPayload,
} from "./spec.js";

export function createAnalyticsDisplayFixture(): AnalyticsDisplayRenderPayload {
  return {
    kind: ANALYTICS_DISPLAY_KIND,
    analyticsDisplayVersion: ANALYTICS_DISPLAY_VERSION,
    spec: {
      title: "Support Volume",
      description: "Daily support tickets by priority.",
      columns: [
        { key: "day", label: "Day", type: "date" },
        { key: "high", label: "High Priority", type: "number" },
        { key: "normal", label: "Normal Priority", type: "number" },
        { key: "total", label: "Total", type: "number" },
        {
          key: "customer_email",
          label: "Customer Email",
          type: "string",
          sensitivity: "pii",
          redaction: "redacted",
        },
      ],
      filters: [
        {
          id: "priority",
          label: "Priority",
          columnKey: "high",
          operator: "range",
          range: { min: 0, max: 25 },
        },
      ],
      elements: [
        {
          type: "metric",
          id: "total",
          title: "Total Tickets",
          valueKey: "total",
          palette: "chart-1",
        },
        {
          type: "chart",
          id: "volume-chart",
          title: "Ticket Volume",
          chartKind: "bar",
          categoryKey: "day",
          series: [
            {
              key: "high",
              label: "High Priority",
              valueKey: "high",
              palette: "chart-1",
            },
            {
              key: "normal",
              label: "Normal Priority",
              valueKey: "normal",
              palette: "chart-2",
            },
          ],
        },
        {
          type: "table",
          id: "volume-table",
          title: "Daily Detail",
          columns: [
            { key: "day", label: "Day" },
            { key: "high", label: "High Priority" },
            { key: "normal", label: "Normal Priority" },
            { key: "total", label: "Total" },
          ],
        },
      ],
      emptyState: {
        title: "No support volume yet",
        description: "The selected source did not return rows.",
      },
    },
    data: {
      rows: [
        {
          day: "2026-06-17",
          high: 12,
          normal: 44,
          total: 56,
          customer_email: "[redacted]",
        },
        {
          day: "2026-06-18",
          high: 18,
          normal: 41,
          total: 59,
          customer_email: "[redacted]",
        },
      ],
    },
    freshness: {
      takenAt: "2026-06-18T15:30:00.000Z",
      oldestAt: "2026-06-17T00:00:00.000Z",
      status: "fresh",
    },
    provenance: {
      sourceLabels: ["Zendesk", "Warehouse daily rollup"],
      dataSourceSlugs: ["zendesk", "warehouse-daily-rollup"],
    },
    sensitivity: {
      containsSensitiveFields: true,
      sensitiveColumns: ["customer_email"],
      policy: "redacted",
    },
  };
}

export function createThreadGenUIFixture(): AnalyticsDisplayRenderPayload {
  return createAnalyticsDisplayFixture();
}

export function createDashboardFixture(): AnalyticsDisplayRenderPayload {
  return createAnalyticsDisplayFixture();
}

export function createCrmOpportunityValueByOwnerFixture(): AnalyticsDisplayRenderPayload {
  return {
    kind: ANALYTICS_DISPLAY_KIND,
    analyticsDisplayVersion: ANALYTICS_DISPLAY_VERSION,
    spec: {
      title: "Opportunity Value by Owner",
      description: "Open Twenty CRM opportunity value grouped by owner.",
      columns: [
        { key: "owner", label: "Owner", type: "string" },
        { key: "open_value", label: "Open Value", type: "number" },
        { key: "opportunity_count", label: "Opportunities", type: "number" },
      ],
      filters: [
        {
          id: "status",
          label: "Open opportunities",
          columnKey: "open_value",
          operator: "range",
          range: { min: 0 },
        },
      ],
      elements: [
        {
          type: "metric",
          id: "pipeline-total",
          title: "Top Owner Value",
          valueKey: "open_value",
          unit: "USD",
          palette: "chart-1",
        },
        {
          type: "chart",
          id: "owner-value-chart",
          title: "Open Opportunity Value",
          chartKind: "bar",
          categoryKey: "owner",
          series: [
            {
              key: "open_value",
              label: "Open Value",
              valueKey: "open_value",
              palette: "chart-1",
            },
          ],
        },
        {
          type: "table",
          id: "owner-value-table",
          title: "Owner Detail",
          columns: [
            { key: "owner", label: "Owner" },
            { key: "open_value", label: "Open Value" },
            { key: "opportunity_count", label: "Opportunities" },
          ],
        },
      ],
      emptyState: {
        title: "No open opportunities",
        description: "Twenty CRM did not return open opportunity rows.",
      },
    },
    data: {
      rows: [
        { owner: "Maya Chen", open_value: 184000, opportunity_count: 7 },
        { owner: "Owen Brooks", open_value: 139500, opportunity_count: 5 },
        { owner: "Priya Shah", open_value: 118250, opportunity_count: 4 },
        { owner: "Luis Romero", open_value: 86500, opportunity_count: 3 },
      ],
    },
    freshness: {
      takenAt: "2026-06-21T14:10:00.000Z",
      status: "fresh",
    },
    provenance: {
      sourceLabels: ["Twenty CRM", "Opportunity snapshot"],
      dataSourceSlugs: ["twenty-crm"],
    },
    sensitivity: {
      containsSensitiveFields: false,
      policy: "aggregate_only",
    },
  };
}
