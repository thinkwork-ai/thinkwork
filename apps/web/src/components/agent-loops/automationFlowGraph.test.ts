import { describe, expect, it } from "vitest";
import { buildAutomationFlowGraph } from "./automationFlowGraph";
import { defaultAgentLoopDraft } from "./agent-loop-utils";
import type { AgentLoopDraft } from "./agent-loop-types";

function draftWith(overrides: Partial<AgentLoopDraft>): AgentLoopDraft {
  return {
    ...defaultAgentLoopDraft(
      [{ id: "agent-1", type: "agent", label: "Agent" }],
      [{ id: "space-1", name: "General" }],
    ),
    ...overrides,
  };
}

describe("buildAutomationFlowGraph (THINK-247)", () => {
  it("renders trigger → work → document → deliver for agent-thread automations", () => {
    const graph = buildAutomationFlowGraph({
      draft: draftWith({
        instructions: "Refresh the pipeline report",
        scheduleType: "cron",
        scheduleExpression: "cron(0 9 ? * MON-FRI *)",
        timezone: "America/Chicago",
        bindingMode: "existing",
        bindingArtifactId: "art-1",
        deliveryEnabled: true,
        deliveryRecipients: "eric@thinkwork.ai",
      }),
      boundDocumentTitle: "Sales Pipeline Health",
    });
    expect(graph.nodes.map((node) => node.id)).toEqual([
      "trigger",
      "work",
      "document",
      "deliver",
    ]);
    expect(graph.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual(
      ["trigger->work", "work->document", "document->deliver"],
    );
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    expect(byId.get("trigger")?.subtitle).toContain("Weekdays at 9:00 AM");
    expect(byId.get("trigger")?.subtitle).toContain("America/Chicago");
    expect(byId.get("work")?.subtitle).toContain("Refresh the pipeline");
    expect(byId.get("document")?.subtitle).toBe("Sales Pipeline Health");
    expect(byId.get("deliver")?.subtitle).toBe("eric@thinkwork.ai");
  });

  it("keeps document/deliver nodes visible when unconfigured — off states are discoverable", () => {
    const graph = buildAutomationFlowGraph({
      draft: draftWith({ instructions: "Do work" }),
    });
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    expect(byId.get("document")?.subtitle).toMatch(/off/i);
    expect(byId.get("deliver")?.subtitle).toMatch(/needs a maintained doc/i);
  });

  it("collapses to trigger → run for routine targets", () => {
    const graph = buildAutomationFlowGraph({
      draft: draftWith({ targetKind: "routine", routineId: "r-1" }),
      targetLabel: "Nightly digest",
    });
    expect(graph.nodes.map((node) => node.id)).toEqual(["trigger", "work"]);
    expect(graph.nodes[1].label).toBe("Run routine");
    expect(graph.nodes[1].subtitle).toBe("Nightly digest");
  });

  it("summarizes multi-recipient delivery", () => {
    const graph = buildAutomationFlowGraph({
      draft: draftWith({
        bindingMode: "create",
        bindingTitle: "Weekly",
        deliveryEnabled: true,
        deliveryRecipients: "a@x.com, b@x.com; c@x.com",
      }),
    });
    const deliver = graph.nodes.find((node) => node.id === "deliver");
    expect(deliver?.subtitle).toBe("a@x.com +2 more");
  });

  it("labels webhook triggers", () => {
    const graph = buildAutomationFlowGraph({
      draft: draftWith({ triggerFamily: "webhook" }),
    });
    expect(graph.nodes[0].label).toBe("Webhook trigger");
  });
});
