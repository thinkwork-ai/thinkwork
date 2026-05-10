import type { AguiChunkInput } from "./events";

export const LASTMILE_AGUI_SMOKE_PROMPT =
  "Build a CRM pipeline risk dashboard for LastMile opportunities, including stale activity, stage exposure, and the top risks to review.";

export function buildLastMileRiskCanvasSmokeChunk(): AguiChunkInput {
  return {
    seq: 10_000,
    publishedAt: new Date(0).toISOString(),
    chunk: {
      type: "canvas_component",
      eventId: "lastmile-risk-smoke-canvas",
      component: "lastmile_risk_canvas",
      props: {
        title: "LastMile AG-UI smoke",
        summary:
          "Fixture-backed AG-UI Canvas event for the LastMile pipeline-risk scenario. Use it to compare the experimental Thread + Canvas route before live AgentCore output is available.",
        kpis: [
          {
            label: "At-risk pipeline",
            value: 1450000,
            detail: "3 stale opportunities",
            tone: "risk",
          },
          {
            label: "Stage exposure",
            value: "Proposal",
            detail: "Largest stale concentration",
            tone: "neutral",
          },
          {
            label: "Source coverage",
            value: "Partial",
            detail: "CRM fixture loaded; email/calendar pending",
            tone: "neutral",
          },
        ],
        risks: [
          {
            account: "Northstar Freight",
            opportunity: "Fleet rollout expansion",
            stage: "Proposal",
            amount: 560000,
            daysStale: 21,
            riskLevel: "high",
            nextStep: "Confirm buying committee and schedule exec review.",
          },
          {
            account: "Acme Logistics",
            opportunity: "Renewal expansion",
            stage: "Negotiation",
            amount: 410000,
            daysStale: 18,
            riskLevel: "high",
            nextStep: "Review pricing blocker and last customer touch.",
          },
          {
            account: "Harbor Foods",
            opportunity: "Warehouse automation pilot",
            stage: "Discovery",
            amount: 190000,
            daysStale: 9,
            riskLevel: "medium",
            nextStep: "Refresh activity summary before next rep check-in.",
          },
        ],
        sources: [
          {
            name: "CRM opportunities",
            status: "connected",
            recordCount: 42,
            asOf: "2026-05-10T11:00:00.000Z",
          },
          {
            name: "Email activity",
            status: "stale",
            detail:
              "Fixture marks activity coverage as stale for smoke visibility.",
          },
          {
            name: "Calendar engagement",
            status: "missing",
            detail: "No calendar source attached to this smoke fixture.",
          },
        ],
      },
    },
  };
}

export function isLastMileAguiSmokeEnabled(
  search = globalThis.location?.search,
) {
  return new URLSearchParams(search).get("aguiSmoke") === "lastmile";
}
