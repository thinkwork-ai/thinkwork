import { describe, expect, it } from "vitest";
import { toCopilotKitSpikeSnapshot } from "./copilotkit-adapter";
import type { ThinkworkAguiEvent } from "./events";

describe("toCopilotKitSpikeSnapshot", () => {
  it("keeps ThinkWork AG-UI events as the source of truth", () => {
    const events: ThinkworkAguiEvent[] = [
      {
        id: "run-1",
        type: "run_started",
        source: "computer_event",
        createdAt: "2026-05-10T10:00:00.000Z",
        title: "Run started",
      },
      {
        id: "text-2",
        type: "text_delta",
        source: "chunk",
        seq: 2,
        text: "pipeline.",
      },
      {
        id: "text-1",
        type: "text_delta",
        source: "chunk",
        seq: 1,
        text: "Check ",
      },
      {
        id: "canvas-1",
        type: "canvas_component",
        source: "chunk",
        seq: 3,
        component: "lastmile_risk_canvas",
        props: {
          summary: "Two stale enterprise opportunities need follow-up.",
        },
      },
      {
        id: "run-2",
        type: "run_finished",
        source: "computer_event",
        createdAt: "2026-05-10T10:01:00.000Z",
        title: "Run finished",
      },
    ];

    expect(toCopilotKitSpikeSnapshot(events)).toMatchObject({
      messages: [
        {
          id: "thinkwork-agui-assistant-message",
          role: "assistant",
          content: "Check pipeline.",
          sourceEventIds: ["text-1", "text-2"],
        },
      ],
      canvasComponents: [
        {
          id: "copilotkit-canvas-canvas-1",
          component: "lastmile_risk_canvas",
          props: {
            summary: "Two stale enterprise opportunities need follow-up.",
          },
          sourceEventId: "canvas-1",
        },
      ],
      runState: "finished",
      adoption: {
        installPackage: false,
        packageVersion: "@copilotkit/react-core@1.57.1",
      },
    });
  });

  it("exposes unsupported events as diagnostics instead of hiding them", () => {
    expect(
      toCopilotKitSpikeSnapshot([
        {
          id: "diagnostic-1",
          type: "diagnostic",
          source: "chunk",
          severity: "warn",
          message: "Unsupported AG-UI event type: state_delta",
        },
      ]),
    ).toMatchObject({
      diagnostics: [
        {
          id: "copilotkit-diagnostic-diagnostic-1",
          severity: "warn",
          message: "Unsupported AG-UI event type: state_delta",
          sourceEventId: "diagnostic-1",
        },
      ],
      runState: "idle",
    });
  });
});
