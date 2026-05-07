import { describe, expect, it } from "vitest";
import { DispatchTargetType } from "@/gql/graphql";
import {
  LINEAR_TRACKER_STARTER_CONFIG,
  connectorExecutionCleanupDisplay,
  connectorExecutionCleanupReason,
  connectorExecutionLinearIdentifier,
  connectorExecutionStateTone,
  connectorExecutionThreadId,
  connectorExecutionWritebackDisplay,
  connectorFormValues,
  connectorTargetLabel,
  connectorTargetOptions,
  createConnectorInput,
  formatConnectorConfig,
  linearTrackerStarterConfigJson,
  parseConnectorConfig,
  shouldUseManualTargetInput,
  updateConnectorInput,
} from "@/lib/connector-admin";

describe("connector admin helpers", () => {
  it("formats object and string configs for editing", () => {
    expect(formatConnectorConfig({ project: "TW" })).toBe(
      '{\n  "project": "TW"\n}',
    );
    expect(formatConnectorConfig('{"project":"TW"}')).toBe(
      '{\n  "project": "TW"\n}',
    );
    expect(formatConnectorConfig("{not-json")).toBe("{not-json");
  });

  it("builds create payloads with trimmed values and parsed config", () => {
    const input = createConnectorInput("tenant_1", {
      ...connectorFormValues(),
      name: " Linear intake ",
      type: " linear_tracker ",
      description: " ",
      connectionId: " conn_1 ",
      configJson: '{"team":"ENG"}',
      dispatchTargetType: DispatchTargetType.Agent,
      dispatchTargetId: " agent_1 ",
      enabled: false,
    });

    expect(input).toEqual({
      tenantId: "tenant_1",
      name: "Linear intake",
      type: "linear_tracker",
      description: null,
      connectionId: "conn_1",
      config: { team: "ENG" },
      dispatchTargetType: DispatchTargetType.Agent,
      dispatchTargetId: "agent_1",
      enabled: false,
      createdByType: "admin",
    });
  });

  it("builds update payloads without tenant scoped fields", () => {
    const input = updateConnectorInput({
      ...connectorFormValues(),
      name: "Tracker",
      type: "linear_tracker",
      configJson: "",
      dispatchTargetType: DispatchTargetType.Routine,
      dispatchTargetId: "routine_1",
    });

    expect(input).toMatchObject({
      name: "Tracker",
      type: "linear_tracker",
      config: {},
      dispatchTargetType: DispatchTargetType.Routine,
      dispatchTargetId: "routine_1",
    });
    expect(input).not.toHaveProperty("tenantId");
  });

  it("rejects invalid config json", () => {
    expect(() => parseConnectorConfig("{not-json")).toThrow();
  });

  it("labels dispatch target types", () => {
    expect(connectorTargetLabel(DispatchTargetType.Computer)).toBe("Computer");
    expect(connectorTargetLabel(DispatchTargetType.Agent)).toBe("Agent");
    expect(connectorTargetLabel(DispatchTargetType.HybridRoutine)).toBe(
      "Hybrid Routine",
    );
  });

  it("defaults new connector forms to the first available Computer", () => {
    expect(
      connectorFormValues(null, {
        computers: [
          {
            id: "computer_1",
            name: "Marco",
            owner: { name: "Eric", email: "eric@example.com" },
            runtimeStatus: "RUNNING",
          },
        ],
      }),
    ).toMatchObject({
      dispatchTargetType: DispatchTargetType.Computer,
      dispatchTargetId: "computer_1",
    });

    expect(connectorFormValues()).toMatchObject({
      dispatchTargetType: DispatchTargetType.Computer,
      dispatchTargetId: "",
    });
  });

  it("preserves an existing advanced Agent target when editing", () => {
    expect(
      connectorFormValues(
        {
          dispatchTargetType: DispatchTargetType.Agent,
          dispatchTargetId: "agent_1",
        },
        {
          computers: [{ id: "computer_1", name: "Marco" }],
        },
      ),
    ).toMatchObject({
      dispatchTargetType: DispatchTargetType.Agent,
      dispatchTargetId: "agent_1",
    });
  });

  it("derives picker options for computers, agents, and non-legacy routines", () => {
    expect(
      connectorTargetOptions(
        DispatchTargetType.Computer,
        [
          {
            id: "computer_1",
            name: "Marco",
            owner: { email: "eric@example.com" },
            runtimeStatus: "RUNNING",
          },
        ],
        [],
        [],
      ),
    ).toEqual([
      {
        id: "computer_1",
        label: "Marco",
        description: "eric@example.com · RUNNING",
      },
    ]);

    expect(
      connectorTargetOptions(
        DispatchTargetType.Agent,
        [],
        [
          {
            id: "agent_1",
            name: "Triage Agent",
            role: "ops",
            status: "IDLE",
          },
        ],
        [],
      ),
    ).toEqual([
      {
        id: "agent_1",
        label: "Triage Agent",
        description: "ops · IDLE",
      },
    ]);

    expect(
      connectorTargetOptions(
        DispatchTargetType.Routine,
        [],
        [],
        [
          {
            id: "routine_1",
            name: "Handle issue",
            description: "Routes issue payloads",
            engine: "step_functions",
          },
          {
            id: "routine_2",
            name: "Legacy",
            description: null,
            engine: "legacy_python",
          },
        ],
      ),
    ).toEqual([
      {
        id: "routine_1",
        label: "Handle issue",
        description: "Routes issue payloads",
      },
    ]);
  });

  it("provides a parseable Linear starter config", () => {
    const json = linearTrackerStarterConfigJson();
    expect(JSON.parse(json)).toEqual(LINEAR_TRACKER_STARTER_CONFIG);
  });

  it("uses manual target input for hybrid, empty, and missing targets", () => {
    const options = [{ id: "agent_1", label: "Triage Agent" }];

    expect(
      shouldUseManualTargetInput({
        targetType: DispatchTargetType.HybridRoutine,
        targetId: "",
        targetOptions: options,
        manualTargetId: false,
      }),
    ).toBe(true);

    expect(
      shouldUseManualTargetInput({
        targetType: DispatchTargetType.Agent,
        targetId: "",
        targetOptions: [],
        manualTargetId: false,
      }),
    ).toBe(true);

    expect(
      shouldUseManualTargetInput({
        targetType: DispatchTargetType.Agent,
        targetId: "agent_missing",
        targetOptions: options,
        manualTargetId: false,
      }),
    ).toBe(true);

    expect(
      shouldUseManualTargetInput({
        targetType: DispatchTargetType.Agent,
        targetId: "agent_1",
        targetOptions: options,
        manualTargetId: false,
      }),
    ).toBe(false);
  });

  it("extracts connector execution display fields from AWSJSON payloads", () => {
    const payload = JSON.stringify({
      threadId: "thread_1",
      linear: { identifier: "TECH-58", title: "Pickup proof" },
      cleanup: { reason: "duplicate_connector_pickup_loop" },
    });

    expect(connectorExecutionThreadId(payload)).toBe("thread_1");
    expect(connectorExecutionLinearIdentifier(payload, "external_1")).toBe(
      "TECH-58",
    );
    expect(connectorExecutionCleanupReason(payload)).toBe(
      "duplicate_connector_pickup_loop",
    );
    expect(connectorExecutionLinearIdentifier({}, "external_1")).toBe(
      "external_1",
    );
  });

  it("formats stale cleanup metadata for compact run rows", () => {
    expect(
      connectorExecutionCleanupDisplay({
        cleanup: {
          reason: "incomplete_delegation",
          source: "cleanup-stale-connector-runs",
          appliedAt: "2026-05-07T22:30:00Z",
        },
      }),
    ).toEqual({
      label: "Cleaned: Incomplete Delegation",
      title:
        "Cleanup reason: incomplete_delegation - cleanup-stale-connector-runs - 2026-05-07T22:30:00Z",
    });

    expect(connectorExecutionCleanupDisplay({})).toBeNull();
    expect(connectorExecutionCleanupDisplay("{not-json")).toBeNull();
  });

  it("formats successful Linear writeback payloads for compact run rows", () => {
    expect(
      connectorExecutionWritebackDisplay({
        providerWriteback: {
          provider: "linear",
          action: "move_issue_state",
          status: "updated",
          stateName: "In Progress",
          stateId: "state-started",
        },
      }),
    ).toEqual({
      label: "Linear: In Progress",
      title: "Linear issue moved to In Progress",
      tone: "success",
    });

    expect(
      connectorExecutionWritebackDisplay(
        JSON.stringify({
          providerWriteback: {
            provider: "linear",
            action: "move_issue_state",
            status: "skipped",
            reason: "already_in_state",
            stateName: "In Progress",
          },
        }),
      ),
    ).toEqual({
      label: "Linear: In Progress",
      title: "Linear issue already In Progress - already_in_state",
      tone: "success",
    });
  });

  it("formats failed Linear writeback payloads for compact run rows", () => {
    expect(
      connectorExecutionWritebackDisplay({
        providerWriteback: {
          provider: "linear",
          action: "move_issue_state",
          status: "failed",
          stateName: "In Progress",
          error: "Linear credential lacks issue update permission",
        },
      }),
    ).toEqual({
      label: "Linear writeback failed",
      title:
        "Linear writeback failed - Linear credential lacks issue update permission",
      tone: "destructive",
    });
  });

  it("omits writeback display for old, malformed, and non-Linear payloads", () => {
    expect(connectorExecutionWritebackDisplay({})).toBeNull();
    expect(connectorExecutionWritebackDisplay("{not-json")).toBeNull();
    expect(
      connectorExecutionWritebackDisplay({
        providerWriteback: { provider: "slack", status: "updated" },
      }),
    ).toBeNull();
  });

  it("styles terminal, active, and noisy connector execution states", () => {
    expect(connectorExecutionStateTone("terminal")).toContain("green");
    expect(connectorExecutionStateTone("dispatching")).toContain("blue");
    expect(connectorExecutionStateTone("cancelled")).toContain("muted");
  });
});
