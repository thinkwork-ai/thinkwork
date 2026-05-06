import { describe, expect, it } from "vitest";
import { DispatchTargetType } from "@/gql/graphql";
import {
  connectorFormValues,
  connectorTargetLabel,
  createConnectorInput,
  formatConnectorConfig,
  parseConnectorConfig,
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
});
