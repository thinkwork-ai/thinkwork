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
  githubCredentialSlug: string;
  githubOwner: string;
  githubRepoName: string;
  githubBaseBranch: string;
  githubFilePath: string;
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

export type ConnectorCredentialOption = {
  id: string;
  displayName: string;
  slug: string;
  status?: string | null;
};

export type ConnectorExecutionWritebackDisplay = {
  label: string;
  title: string;
  tone: "success" | "destructive" | "muted";
};

export type ConnectorExecutionPrDisplay = {
  url: string;
  label: string;
  title: string;
};

export type ConnectorExecutionCleanupDisplay = {
  label: string;
  title: string;
};

export const LINEAR_CHECKPOINT_LABEL = "symphony";
export const DEFAULT_LINEAR_CREDENTIAL_SLUG = "linear";
export const DEFAULT_LINEAR_WRITEBACK_STATE = "In Progress";
export const DEFAULT_LINEAR_PR_WRITEBACK_STATE = "In Review";
export const DEFAULT_GITHUB_CREDENTIAL_SLUG = "github";
export const DEFAULT_GITHUB_OWNER = "thinkwork-ai";
export const DEFAULT_GITHUB_REPO_NAME = "thinkwork";
export const DEFAULT_GITHUB_BASE_BRANCH = "main";
export const DEFAULT_GITHUB_FILE_PATH = "README.md";

export const DEFAULT_CONNECTOR_FORM_VALUES: ConnectorFormValues = {
  name: "",
  type: "linear_tracker",
  description: "",
  connectionId: "",
  linearTeamKey: "",
  linearLabel: LINEAR_CHECKPOINT_LABEL,
  linearCredentialSlug: DEFAULT_LINEAR_CREDENTIAL_SLUG,
  linearWritebackState: DEFAULT_LINEAR_WRITEBACK_STATE,
  githubCredentialSlug: DEFAULT_GITHUB_CREDENTIAL_SLUG,
  githubOwner: DEFAULT_GITHUB_OWNER,
  githubRepoName: DEFAULT_GITHUB_REPO_NAME,
  githubBaseBranch: DEFAULT_GITHUB_BASE_BRANCH,
  githubFilePath: DEFAULT_GITHUB_FILE_PATH,
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
    moveOnPrOpened: {
      enabled: true,
      stateName: DEFAULT_LINEAR_PR_WRITEBACK_STATE,
    },
  },
  github: {
    credentialSlug: DEFAULT_GITHUB_CREDENTIAL_SLUG,
    owner: DEFAULT_GITHUB_OWNER,
    repoName: DEFAULT_GITHUB_REPO_NAME,
    baseBranch: DEFAULT_GITHUB_BASE_BRANCH,
    filePath: DEFAULT_GITHUB_FILE_PATH,
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
    githubCredentialSlug: linearFields.githubCredentialSlug,
    githubOwner: linearFields.githubOwner,
    githubRepoName: linearFields.githubRepoName,
    githubBaseBranch: linearFields.githubBaseBranch,
    githubFilePath: linearFields.githubFilePath,
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
  options: { activeCredentialSlugs?: readonly string[] } = {},
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
  if (!values.githubCredentialSlug.trim()) {
    return "GitHub credential slug is required.";
  }
  if (!values.githubOwner.trim()) return "GitHub owner is required.";
  if (!values.githubRepoName.trim()) return "GitHub repository is required.";
  if (!values.githubBaseBranch.trim()) return "GitHub base branch is required.";
  if (!values.githubFilePath.trim()) return "GitHub file path is required.";
  if (
    values.enabled &&
    options.activeCredentialSlugs &&
    !options.activeCredentialSlugs.includes(values.githubCredentialSlug.trim())
  ) {
    return `Active GitHub credential "${values.githubCredentialSlug.trim()}" is required before enabling this connector.`;
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
  const moveOnPrOpened = parsePayloadRecord(writeback.moveOnPrOpened) ?? {};
  const github = parsePayloadRecord(config.github) ?? {};

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
      moveOnPrOpened: {
        ...moveOnPrOpened,
        enabled: moveOnPrOpened.enabled ?? true,
        stateName:
          cleanString(moveOnPrOpened.stateName) ??
          DEFAULT_LINEAR_PR_WRITEBACK_STATE,
      },
    },
    github: {
      ...github,
      credentialSlug: values.githubCredentialSlug.trim(),
      owner: values.githubOwner.trim(),
      repoName: values.githubRepoName.trim(),
      baseBranch: values.githubBaseBranch.trim(),
      filePath: values.githubFilePath.trim(),
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

export function connectorExecutionPrDisplay(
  ...payloads: unknown[]
): ConnectorExecutionPrDisplay | null {
  for (const payload of payloads) {
    const parsed = parsePayloadRecord(payload);
    const symphony = parsePayloadRecord(parsed?.symphony);
    const github = parsePayloadRecord(parsed?.github);
    const url =
      cleanString(parsed?.prUrl) ??
      cleanString(symphony?.prUrl) ??
      cleanString(github?.prUrl);
    if (!url) continue;

    const branch =
      cleanString(parsed?.branch) ??
      cleanString(symphony?.branch) ??
      cleanString(github?.branch);
    const prNumber =
      typeof parsed?.prNumber === "number"
        ? parsed.prNumber
        : typeof symphony?.prNumber === "number"
          ? symphony.prNumber
          : null;
    return {
      url,
      label: prNumber ? `PR #${prNumber}` : "Draft PR",
      title: [branch, url].filter(Boolean).join(" - "),
    };
  }
  return null;
}

export function connectorGitHubCredentialStatus(
  config: unknown,
  activeCredentialSlugs: readonly string[],
): { slug: string; missing: boolean; label: string; title: string } {
  const fields = linearConnectorFieldsFromConfig(config);
  const slug = fields.githubCredentialSlug;
  const missing = !activeCredentialSlugs.includes(slug);

  return {
    slug,
    missing,
    label: missing ? "GitHub setup required" : "GitHub ready",
    title: missing
      ? `Active GitHub credential "${slug}" is missing.`
      : `Using GitHub credential "${slug}".`,
  };
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
  githubCredentialSlug: string;
  githubOwner: string;
  githubRepoName: string;
  githubBaseBranch: string;
  githubFilePath: string;
} {
  const parsed = parsePayloadRecord(config);
  const issueQuery = parsePayloadRecord(parsed?.issueQuery);
  const labels = readStringArray(issueQuery?.labels ?? parsed?.labels);
  const writeback = parsePayloadRecord(parsed?.writeback);
  const moveOnDispatch = parsePayloadRecord(writeback?.moveOnDispatch);
  const github = parsePayloadRecord(parsed?.github);

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
    githubCredentialSlug:
      cleanString(github?.credentialSlug ?? parsed?.githubCredentialSlug) ??
      DEFAULT_GITHUB_CREDENTIAL_SLUG,
    githubOwner:
      cleanString(github?.owner ?? parsed?.githubOwner) ?? DEFAULT_GITHUB_OWNER,
    githubRepoName:
      cleanString(
        github?.repoName ?? github?.repository ?? parsed?.githubRepoName,
      ) ?? DEFAULT_GITHUB_REPO_NAME,
    githubBaseBranch:
      cleanString(github?.baseBranch ?? parsed?.githubBaseBranch) ??
      DEFAULT_GITHUB_BASE_BRANCH,
    githubFilePath:
      cleanString(github?.filePath ?? parsed?.githubFilePath) ??
      DEFAULT_GITHUB_FILE_PATH,
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
