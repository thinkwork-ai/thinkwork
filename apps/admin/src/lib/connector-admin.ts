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
  linearTeamKey: string;
  linearLabel: string;
  linearCredentialSlug: string;
  linearWritebackState: string;
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

export const LINEAR_CHECKPOINT_LABEL = "symphony";
export const DEFAULT_LINEAR_CREDENTIAL_SLUG = "linear";
export const DEFAULT_LINEAR_WRITEBACK_STATE = "In Progress";

export const DEFAULT_CONNECTOR_FORM_VALUES: ConnectorFormValues = {
  name: "",
  type: "linear_tracker",
  description: "",
  connectionId: "",
  linearTeamKey: "",
  linearLabel: LINEAR_CHECKPOINT_LABEL,
  linearCredentialSlug: DEFAULT_LINEAR_CREDENTIAL_SLUG,
  linearWritebackState: DEFAULT_LINEAR_WRITEBACK_STATE,
  configJson: "{}",
  dispatchTargetType: DispatchTargetType.Computer,
  dispatchTargetId: "",
  enabled: true,
};

export const LINEAR_TRACKER_STARTER_CONFIG = {
  provider: "linear",
  sourceKind: "tracker_issue",
  credentialSlug: DEFAULT_LINEAR_CREDENTIAL_SLUG,
  issueQuery: {
    teamKey: "",
    labels: [LINEAR_CHECKPOINT_LABEL],
    states: [],
    limit: 10,
  },
  payload: {
    includeDescription: true,
    includeComments: true,
    includeAttachments: false,
  },
  writeback: {
    moveOnDispatch: {
      enabled: true,
      stateName: DEFAULT_LINEAR_WRITEBACK_STATE,
    },
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
      configJson: linearTrackerStarterConfigJson(),
      dispatchTargetId: defaultComputerId,
    };
  }
  const configJson =
    source.configJson ?? formatConnectorConfig(source.config ?? null);
  const linearFields = linearConnectorFieldsFromConfig(configJson);

  return {
    name: source.name ?? "",
    type: source.type ?? "linear_tracker",
    description: source.description ?? "",
    connectionId: source.connectionId ?? "",
    linearTeamKey: linearFields.teamKey,
    linearLabel: linearFields.label,
    linearCredentialSlug: linearFields.credentialSlug,
    linearWritebackState: linearFields.writebackState,
    configJson,
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

export function validateConnectorFormValues(
  values: ConnectorFormValues,
): string | null {
  if (!values.name.trim()) return "Name is required.";
  if (!values.type.trim()) return "Type is required.";
  if (!values.dispatchTargetId.trim()) return "Dispatch target is required.";
  if (values.type.trim() !== "linear_tracker") {
    return "Symphony supports Linear tracker connectors here.";
  }
  if (!values.linearTeamKey.trim()) return "Linear team key is required.";
  if (!values.linearCredentialSlug.trim()) {
    return "Linear credential slug is required.";
  }
  if (values.linearLabel.trim() !== LINEAR_CHECKPOINT_LABEL) {
    return "Checkpoint connector label must be symphony.";
  }
  if (!values.linearWritebackState.trim()) {
    return "Linear writeback state is required.";
  }

  try {
    parseConnectorConfig(values.configJson);
  } catch {
    return "Advanced JSON must be valid JSON.";
  }

  return null;
}

export function linearConnectorConfigFromValues(
  values: ConnectorFormValues,
): Record<string, unknown> {
  const parsed = parseConnectorConfig(values.configJson);
  const config = parsePayloadRecord(parsed) ?? {};
  const issueQuery = parsePayloadRecord(config.issueQuery) ?? {};
  const payload = parsePayloadRecord(config.payload) ?? {};
  const writeback = parsePayloadRecord(config.writeback) ?? {};
  const moveOnDispatch = parsePayloadRecord(writeback.moveOnDispatch) ?? {};

  return {
    ...config,
    provider: "linear",
    sourceKind: cleanString(config.sourceKind) ?? "tracker_issue",
    credentialSlug: values.linearCredentialSlug.trim(),
    issueQuery: {
      ...issueQuery,
      teamKey: values.linearTeamKey.trim(),
      labels: [values.linearLabel.trim()],
      limit: Number.isFinite(issueQuery.limit as number)
        ? issueQuery.limit
        : LINEAR_TRACKER_STARTER_CONFIG.issueQuery.limit,
    },
    payload: {
      ...LINEAR_TRACKER_STARTER_CONFIG.payload,
      ...payload,
    },
    writeback: {
      ...writeback,
      moveOnDispatch: {
        ...moveOnDispatch,
        enabled: moveOnDispatch.enabled ?? true,
        stateName: values.linearWritebackState.trim(),
      },
    },
  };
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
    config: linearConnectorConfigFromValues(values),
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
    config: linearConnectorConfigFromValues(values),
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

function linearConnectorFieldsFromConfig(config: unknown): {
  teamKey: string;
  label: string;
  credentialSlug: string;
  writebackState: string;
} {
  const parsed = parsePayloadRecord(config);
  const issueQuery = parsePayloadRecord(parsed?.issueQuery);
  const labels = readStringArray(issueQuery?.labels ?? parsed?.labels);
  const writeback = parsePayloadRecord(parsed?.writeback);
  const moveOnDispatch = parsePayloadRecord(writeback?.moveOnDispatch);

  return {
    teamKey: cleanString(parsed?.teamKey ?? issueQuery?.teamKey) ?? "",
    label:
      cleanString(issueQuery?.label ?? parsed?.label) ??
      labels[0] ??
      LINEAR_CHECKPOINT_LABEL,
    credentialSlug:
      cleanString(parsed?.credentialSlug ?? issueQuery?.credentialSlug) ??
      DEFAULT_LINEAR_CREDENTIAL_SLUG,
    writebackState:
      cleanString(
        moveOnDispatch?.stateName ??
          writeback?.onDispatchState ??
          parsed?.onDispatchState,
      ) ?? DEFAULT_LINEAR_WRITEBACK_STATE,
  };
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanString(item))
    .filter((item): item is string => Boolean(item));
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
