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

export type ConnectorTargetOption = {
  id: string;
  label: string;
  description?: string | null;
};

export type ConnectorComputerTarget = {
  id: string;
  name: string;
  owner?: { name?: string | null; email?: string | null } | null;
  runtimeStatus?: string | null;
  status?: string | null;
};

export type ConnectorAgentTarget = {
  id: string;
  name: string;
  role?: string | null;
  status?: string | null;
};

export type ConnectorRoutineTarget = {
  id: string;
  name: string;
  description?: string | null;
  engine?: string | null;
};

export type ConnectorExecutionWritebackDisplay = {
  label: string;
  title: string;
  tone: "success" | "destructive" | "muted";
};

export type ConnectorExecutionCleanupDisplay = {
  label: string;
  title: string;
};

export const DEFAULT_CONNECTOR_FORM_VALUES: ConnectorFormValues = {
  name: "",
  type: "linear_tracker",
  description: "",
  connectionId: "",
  configJson: "{}",
  dispatchTargetType: DispatchTargetType.Computer,
  dispatchTargetId: "",
  enabled: true,
};

export const LINEAR_TRACKER_STARTER_CONFIG = {
  provider: "linear",
  sourceKind: "tracker_issue",
  credentialSlug: "linear",
  issueQuery: {
    teamKey: "",
    labels: ["symphony"],
    states: [],
    limit: 10,
  },
  payload: {
    includeDescription: true,
    includeComments: true,
    includeAttachments: false,
  },
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

export function linearTrackerStarterConfigJson(): string {
  return formatConnectorConfig(LINEAR_TRACKER_STARTER_CONFIG);
}

export function connectorFormValues(
  source?: ConnectorFormSource | null,
  options: { computers?: ConnectorComputerTarget[] } = {},
): ConnectorFormValues {
  const defaultComputerId = options.computers?.[0]?.id ?? "";
  if (!source) {
    return {
      ...DEFAULT_CONNECTOR_FORM_VALUES,
      dispatchTargetId: defaultComputerId,
    };
  }

  return {
    name: source.name ?? "",
    type: source.type ?? "linear_tracker",
    description: source.description ?? "",
    connectionId: source.connectionId ?? "",
    configJson:
      source.configJson ?? formatConnectorConfig(source.config ?? null),
    dispatchTargetType:
      source.dispatchTargetType ??
      DEFAULT_CONNECTOR_FORM_VALUES.dispatchTargetType,
    dispatchTargetId: source.dispatchTargetId ?? defaultComputerId,
    enabled: source.enabled ?? true,
  };
}

export function connectorTargetOptions(
  targetType: DispatchTargetType,
  computers: ConnectorComputerTarget[],
  agents: ConnectorAgentTarget[],
  routines: ConnectorRoutineTarget[],
): ConnectorTargetOption[] {
  if (targetType === DispatchTargetType.Computer) {
    return computers.map((computer) => ({
      id: computer.id,
      label: computer.name,
      description: [
        computer.owner?.name ?? computer.owner?.email,
        computer.runtimeStatus ?? computer.status,
      ]
        .filter(Boolean)
        .join(" · "),
    }));
  }

  if (targetType === DispatchTargetType.Agent) {
    return agents.map((agent) => ({
      id: agent.id,
      label: agent.name,
      description: [agent.role, agent.status].filter(Boolean).join(" · "),
    }));
  }

  if (targetType === DispatchTargetType.Routine) {
    return routines
      .filter((routine) => routine.engine !== "legacy_python")
      .map((routine) => ({
        id: routine.id,
        label: routine.name,
        description: routine.description,
      }));
  }

  return [];
}

export function shouldUseManualTargetInput({
  targetType,
  targetId,
  targetOptions,
  manualTargetId,
}: {
  targetType: DispatchTargetType;
  targetId: string;
  targetOptions: ConnectorTargetOption[];
  manualTargetId: boolean;
}): boolean {
  if (manualTargetId || targetType === DispatchTargetType.HybridRoutine) {
    return true;
  }

  if (targetOptions.length === 0) return true;

  return (
    targetId.trim().length > 0 &&
    !targetOptions.some((option) => option.id === targetId)
  );
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
    case DispatchTargetType.Computer:
      return "Computer";
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

export function connectorExecutionStateTone(state: string): string {
  switch (state) {
    case "terminal":
      return "bg-green-500/15 text-green-700 dark:text-green-300";
    case "failed":
      return "bg-red-500/15 text-red-700 dark:text-red-300";
    case "cancelled":
      return "bg-muted text-muted-foreground";
    case "pending":
    case "dispatching":
    case "invoking":
    case "recording_result":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
    default:
      return "bg-secondary text-secondary-foreground";
  }
}

export function connectorExecutionThreadId(payload: unknown): string | null {
  const parsed = parsePayloadRecord(payload);
  const value = parsed?.threadId;
  return typeof value === "string" && value.trim() ? value : null;
}

export function connectorExecutionLinearIdentifier(
  payload: unknown,
  fallback: string,
): string {
  const parsed = parsePayloadRecord(payload);
  const linear = parsePayloadRecord(parsed?.linear);
  const identifier = linear?.identifier;
  if (typeof identifier === "string" && identifier.trim()) return identifier;
  const title = linear?.title;
  if (typeof title === "string" && title.trim()) return title;
  return fallback;
}

export function connectorExecutionCleanupReason(
  payload: unknown,
): string | null {
  const parsed = parsePayloadRecord(payload);
  const cleanup = parsePayloadRecord(parsed?.cleanup);
  const reason = cleanup?.reason;
  return typeof reason === "string" && reason.trim() ? reason : null;
}

export function connectorExecutionCleanupDisplay(
  payload: unknown,
): ConnectorExecutionCleanupDisplay | null {
  const parsed = parsePayloadRecord(payload);
  const cleanup = parsePayloadRecord(parsed?.cleanup);
  const reason = cleanString(cleanup?.reason);
  if (!reason) return null;

  return {
    label: `Cleaned: ${statusLabel(reason)}`,
    title: [
      `Cleanup reason: ${reason}`,
      cleanString(cleanup?.source),
      cleanString(cleanup?.appliedAt),
    ]
      .filter(Boolean)
      .join(" - "),
  };
}

export function connectorExecutionWritebackDisplay(
  payload: unknown,
): ConnectorExecutionWritebackDisplay | null {
  const parsed = parsePayloadRecord(payload);
  const writeback = parsePayloadRecord(parsed?.providerWriteback);
  const provider = cleanString(writeback?.provider);
  if (provider !== "linear") return null;

  const status = cleanString(writeback?.status);
  const stateName = cleanString(writeback?.stateName);
  const reason = cleanString(writeback?.reason);
  const error = cleanString(writeback?.error);

  if (status === "failed") {
    return {
      label: "Linear writeback failed",
      title: ["Linear writeback failed", error].filter(Boolean).join(" - "),
      tone: "destructive",
    };
  }

  if ((status === "updated" || status === "skipped") && stateName) {
    return {
      label: `Linear: ${stateName}`,
      title: [
        `Linear issue ${status === "updated" ? "moved to" : "already"} ${stateName}`,
        reason,
      ]
        .filter(Boolean)
        .join(" - "),
      tone: "success",
    };
  }

  if (status) {
    return {
      label: `Linear: ${statusLabel(status)}`,
      title: `Linear writeback ${status}`,
      tone: "muted",
    };
  }

  return null;
}

function parsePayloadRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return parsePayloadRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function statusLabel(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
