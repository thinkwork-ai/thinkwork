/**
 * Golden fixture corpus for the house chart renderer.
 *
 * Fixed literal data, no randomness, no dates — every case exists so the
 * extracted renderer can be proven byte-identical to the pre-extraction
 * `packages/api/src/lib/artifacts/document-charts.ts` output (Gate 1) and so
 * non-default frames stay deterministic (Gate 2).
 */
import type { ChartDirectiveData } from "../types.js";

export interface FixtureCase {
  /** Golden file basename: `<kind>-<case>`. */
  name: string;
  data: ChartDirectiveData;
}

export const FIXTURES: FixtureCase[] = [
  // --- bar ------------------------------------------------------------------
  {
    name: "bar-typical",
    data: {
      type: "bar",
      title: "Pipeline by stage",
      qualifier: "count of opportunities",
      series: [
        { label: "Q1", value: 12 },
        { label: "Q2", value: 18 },
        { label: "Q3", value: 27 },
        { label: "Q4", value: 35 },
      ],
    },
  },
  {
    name: "bar-single",
    data: {
      type: "bar",
      title: "Single quarter",
      series: [{ label: "Q1", value: 12 }],
    },
  },
  {
    name: "bar-zero-values",
    data: {
      type: "bar",
      title: "Nothing closed",
      qualifier: "count of opportunities",
      series: [
        { label: "Jan", value: 0 },
        { label: "Feb", value: 0 },
        { label: "Mar", value: 0 },
        { label: "Apr", value: 0 },
      ],
    },
  },

  // --- line -----------------------------------------------------------------
  {
    name: "line-typical",
    data: {
      type: "line",
      title: "Weekly active accounts",
      qualifier: "accounts with ≥1 session",
      series: [
        { label: "W1", value: 120 },
        { label: "W2", value: 138 },
        { label: "W3", value: 131 },
        { label: "W4", value: 164 },
        { label: "W5", value: 190 },
      ],
    },
  },
  {
    name: "line-single",
    data: {
      type: "line",
      title: "One reading",
      series: [{ label: "W1", value: 120 }],
    },
  },
  {
    name: "line-24-points",
    data: {
      type: "line",
      title: "Hourly throughput",
      qualifier: "requests per hour",
      series: [
        10, 14, 19, 23, 21, 27, 34, 41, 38, 45, 52, 60, 58, 63, 71, 68, 74, 80,
        77, 85, 91, 88, 94, 100,
      ].map((value, i) => ({ label: `H${i}`, value })),
    },
  },

  // --- donut ----------------------------------------------------------------
  {
    name: "donut-typical",
    data: {
      type: "donut",
      title: "Revenue by segment",
      qualifier: "closed-won, share of total",
      series: [
        { label: "Enterprise", value: 480 },
        { label: "Mid-market", value: 260 },
        { label: "SMB", value: 140 },
        { label: "Partner", value: 60 },
      ],
    },
  },
  {
    name: "donut-single",
    data: {
      type: "donut",
      title: "One segment",
      series: [{ label: "Enterprise", value: 480 }],
    },
  },
  {
    name: "donut-six-segments",
    data: {
      type: "donut",
      title: "Spend by category",
      qualifier: "share of total spend",
      series: [
        { label: "Compute", value: 320 },
        { label: "Storage", value: 180 },
        { label: "Network", value: 120 },
        { label: "Support", value: 90 },
        { label: "Licenses", value: 60 },
        { label: "Other", value: 30 },
      ],
    },
  },

  // --- stat-strip -----------------------------------------------------------
  {
    name: "stat-strip-typical",
    data: {
      type: "stat-strip",
      title: "Quarter at a glance",
      qualifier: "as of quarter close",
      series: [
        { label: "Closed-won", value: 1240 },
        { label: "Open pipeline", value: 3820 },
        { label: "Win rate %", value: 31.5 },
        { label: "Avg deal", value: 18.25 },
      ],
    },
  },
  {
    name: "stat-strip-single",
    data: {
      type: "stat-strip",
      title: "One number",
      series: [{ label: "Closed-won", value: 1240 }],
    },
  },
  {
    name: "stat-strip-six",
    data: {
      type: "stat-strip",
      title: "Operational snapshot",
      series: [
        { label: "Accounts", value: 412 },
        { label: "Seats", value: 5820 },
        { label: "Tickets", value: 96 },
        { label: "SLA %", value: 99.2 },
        { label: "Churn %", value: 1.4 },
        { label: "NPS", value: 47 },
      ],
    },
  },

  // --- sparkline ------------------------------------------------------------
  {
    name: "sparkline-typical",
    data: {
      type: "sparkline",
      title: "Signups trend",
      series: [
        { label: "M1", value: 30 },
        { label: "M2", value: 42 },
        { label: "M3", value: 38 },
        { label: "M4", value: 55 },
        { label: "M5", value: 61 },
      ],
    },
  },
  {
    name: "sparkline-single",
    data: {
      type: "sparkline",
      title: "One point",
      series: [{ label: "M1", value: 30 }],
    },
  },
  {
    name: "sparkline-zero-values",
    data: {
      type: "sparkline",
      title: "Flat at zero",
      series: [
        { label: "M1", value: 0 },
        { label: "M2", value: 0 },
        { label: "M3", value: 0 },
      ],
    },
  },

  // --- meter ----------------------------------------------------------------
  {
    name: "meter-typical",
    data: {
      type: "meter",
      title: "Quota attainment",
      qualifier: "fiscal year to date",
      series: [{ label: "Bookings vs quota", value: 68 }],
      max: 100,
    },
  },
  {
    name: "meter-at-max",
    data: {
      type: "meter",
      title: "Quota attainment",
      series: [{ label: "Bookings vs quota", value: 250 }],
      max: 250,
    },
  },
  {
    name: "meter-no-max",
    data: {
      type: "meter",
      title: "Adoption",
      series: [{ label: "Seats activated", value: 0 }],
    },
  },

  // --- funnel ---------------------------------------------------------------
  {
    name: "funnel-typical",
    data: {
      type: "funnel",
      title: "Pipeline by stage",
      qualifier: "opportunities, current quarter",
      series: [
        { label: "Leads", value: 1200 },
        { label: "Qualified", value: 640 },
        { label: "Proposal", value: 310 },
        { label: "Negotiation", value: 150 },
        { label: "Closed-won", value: 72 },
      ],
      caption: "Qualification is the biggest drop-off.",
    },
  },
  {
    name: "funnel-single",
    data: {
      type: "funnel",
      title: "One stage",
      series: [{ label: "Leads", value: 1200 }],
    },
  },
  {
    name: "funnel-long-labels",
    data: {
      type: "funnel",
      title: "Enterprise procurement funnel",
      series: [
        {
          label: "Inbound requests from the partner portal",
          value: 900,
        },
        {
          label: "Security & compliance review completed",
          value: 420,
        },
        {
          label: "Procurement approval and PO issued <&>",
          value: 130,
        },
      ],
    },
  },
];
