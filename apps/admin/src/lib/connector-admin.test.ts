import { describe, expect, it } from "vitest";
import { DispatchTargetType } from "@/gql/graphql";
import {
  LINEAR_TRACKER_STARTER_CONFIG,
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
    expect(connectorTargetLabel(DispatchTargetType.Agent)).toBe("Agent");
    expect(connectorTargetLabel(DispatchTargetType.HybridRoutine)).toBe(
      "Hybrid Routine",
    );
  });

  it("derives picker options for agents and non-legacy routines", () => {
    expect(
      connectorTargetOptions(
        DispatchTargetType.Agent,
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
});
