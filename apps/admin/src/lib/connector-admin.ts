import {
  DispatchTargetType,
  type CreateConnectorInput,
  type UpdateConnectorInput,
} from "@/gql/graphql";

export type ConnectorFormValues = {
  name: string;
  type: string;
  description: string;
  connectionId: string;
  configJson: string;
  dispatchTargetType: DispatchTargetType;
  dispatchTargetId: string;
  enabled: boolean;
};

export type ConnectorFormSource = Omit<
  Partial<ConnectorFormValues>,
  "description" | "connectionId"
> & {
  description?: string | null;
  connectionId?: string | null;
  config?: unknown;
};

export const DEFAULT_CONNECTOR_FORM_VALUES: ConnectorFormValues = {
  name: "",
  type: "linear_tracker",
  description: "",
  connectionId: "",
  configJson: "{}",
  dispatchTargetType: DispatchTargetType.Agent,
  dispatchTargetId: "",
  enabled: true,
};

export function formatConnectorConfig(config: unknown): string {
  if (config == null || config === "") return "{}";

  if (typeof config === "string") {
    try {
      return JSON.stringify(JSON.parse(config), null, 2);
    } catch {
      return config;
    }
  }

  return JSON.stringify(config, null, 2);
}

export function connectorFormValues(
  source?: ConnectorFormSource | null,
): ConnectorFormValues {
  if (!source) return DEFAULT_CONNECTOR_FORM_VALUES;

  return {
    name: source.name ?? "",
    type: source.type ?? "linear_tracker",
    description: source.description ?? "",
    connectionId: source.connectionId ?? "",
    configJson:
      source.configJson ?? formatConnectorConfig(source.config ?? null),
    dispatchTargetType:
      source.dispatchTargetType ?? DispatchTargetType.Agent,
    dispatchTargetId: source.dispatchTargetId ?? "",
    enabled: source.enabled ?? true,
  };
}

export function parseConnectorConfig(configJson: string): unknown {
  const trimmed = configJson.trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed);
}

export function createConnectorInput(
  tenantId: string,
  values: ConnectorFormValues,
): CreateConnectorInput {
  return {
    tenantId,
    name: values.name.trim(),
    type: values.type.trim(),
    description: emptyToNull(values.description),
    connectionId: emptyToNull(values.connectionId),
    config: parseConnectorConfig(values.configJson),
    dispatchTargetType: values.dispatchTargetType,
    dispatchTargetId: values.dispatchTargetId.trim(),
    enabled: values.enabled,
    createdByType: "admin",
  };
}

export function updateConnectorInput(
  values: ConnectorFormValues,
): UpdateConnectorInput {
  return {
    name: values.name.trim(),
    type: values.type.trim(),
    description: emptyToNull(values.description),
    connectionId: emptyToNull(values.connectionId),
    config: parseConnectorConfig(values.configJson),
    dispatchTargetType: values.dispatchTargetType,
    dispatchTargetId: values.dispatchTargetId.trim(),
    enabled: values.enabled,
  };
}

export function connectorTargetLabel(targetType: DispatchTargetType): string {
  switch (targetType) {
    case DispatchTargetType.Agent:
      return "Agent";
    case DispatchTargetType.Routine:
      return "Routine";
    case DispatchTargetType.HybridRoutine:
      return "Hybrid Routine";
  }
}

export function connectorStatusTone(status: string): string {
  switch (status) {
    case "active":
      return "bg-green-500/15 text-green-700 dark:text-green-300";
    case "paused":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    case "unhealthy":
      return "bg-red-500/15 text-red-700 dark:text-red-300";
    case "archived":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-secondary text-secondary-foreground";
  }
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
