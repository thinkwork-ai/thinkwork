import type { ComputerTaskType } from "./tasks.js";
import { enqueueComputerTask } from "./tasks.js";
import { hasComputerRequesterAccess } from "./thread-cutover.js";

export type ConnectorTriggerConfig = {
  version: 1;
  provider: string;
  eventType: string;
  connectionId: string;
  computerId: string;
  requesterUserId: string;
  credentialSubject: {
    type: "user";
    userId: string;
    connectionId: string;
    provider: string;
  };
  contextClass: "personal_connector_event";
  filters?: Record<string, unknown>;
};

export type PreparedConnectorTrigger = {
  triggerType: "event";
  scheduleType: "event";
  computerId: string;
  config: Record<string, unknown> & {
    connectorTrigger: ConnectorTriggerConfig;
  };
};

export type ConnectorTriggerDeps = {
  resolveConnection?: (input: {
    tenantId: string;
    userId: string;
    provider: string;
    connectionId: string;
  }) => Promise<{ connectionId: string; providerId: string } | null>;
  hasComputerAccess?: (input: {
    tenantId: string;
    computerId: string;
    requesterUserId: string;
  }) => Promise<boolean>;
  enqueueTask?: (input: {
    tenantId: string;
    computerId: string;
    taskType: ComputerTaskType;
    taskInput?: unknown;
    idempotencyKey?: string | null;
    createdByUserId?: string | null;
  }) => Promise<unknown>;
};

export async function prepareConnectorTriggerDefinition(
  input: {
    tenantId: string;
    requesterUserId: string | null;
    computerId?: string | null;
    config: Record<string, unknown> | null;
  },
  deps: ConnectorTriggerDeps = {},
): Promise<PreparedConnectorTrigger> {
  const requesterUserId = required(input.requesterUserId, "requesterUserId");
  const raw = connectorTriggerInput(input.config);
  const provider = required(raw.provider, "connectorTrigger.provider");
  const eventType = required(raw.eventType, "connectorTrigger.eventType");
  const connectionId = required(
    raw.connectionId,
    "connectorTrigger.connectionId",
  );
  const computerId = required(
    input.computerId ?? raw.computerId,
    "connectorTrigger.computerId",
  );

  const resolveConnection =
    deps.resolveConnection ??
    (async (resolveInput: {
      tenantId: string;
      userId: string;
      provider: string;
      connectionId: string;
    }) => {
      const { resolveConnectionForUserById } = await import(
        "../oauth-token.js"
      );
      return resolveConnectionForUserById({
        tenantId: resolveInput.tenantId,
        userId: resolveInput.userId,
        providerName: resolveInput.provider,
        connectionId: resolveInput.connectionId,
      });
    });
  const connection = await resolveConnection({
    tenantId: input.tenantId,
    userId: requesterUserId,
    provider,
    connectionId,
  });
  if (!connection) {
    throw new Error(
      "Connector trigger requires an active requester-owned connection",
    );
  }

  const hasAccess = await (
    deps.hasComputerAccess ?? hasComputerRequesterAccess
  )({
    tenantId: input.tenantId,
    computerId,
    requesterUserId,
  });
  if (!hasAccess) {
    throw new Error(
      "Connector trigger target Computer is not assigned to requester",
    );
  }

  const connectorTrigger: ConnectorTriggerConfig = {
    version: 1,
    provider,
    eventType,
    connectionId,
    computerId,
    requesterUserId,
    credentialSubject: {
      type: "user",
      userId: requesterUserId,
      connectionId,
      provider,
    },
    contextClass: "personal_connector_event",
    filters: recordOrUndefined(raw.filters),
  };

  return {
    triggerType: "event",
    scheduleType: "event",
    computerId,
    config: {
      ...(input.config ?? {}),
      connectorTrigger,
    },
  };
}

export async function routeConnectorEventToComputer(
  input: {
    tenantId: string;
    triggerId: string;
    enabled: boolean;
    triggerType: string;
    computerId?: string | null;
    config: Record<string, unknown> | null;
    threadId?: string | null;
    messageId?: string | null;
    eventId?: string | null;
    eventType?: string | null;
    eventMetadata?: Record<string, unknown> | null;
  },
  deps: ConnectorTriggerDeps = {},
): Promise<
  | { ok: true; task: unknown; taskInput: Record<string, unknown> }
  | { ok: false; reason: string }
> {
  if (!input.enabled) return { ok: false, reason: "trigger_disabled" };
  if (input.triggerType !== "event") {
    return { ok: false, reason: "trigger_not_event" };
  }
  if (!input.threadId || !input.messageId) {
    return { ok: false, reason: "thread_message_required" };
  }

  const connectorTrigger = connectorTriggerConfig(input.config);
  if (!connectorTrigger) {
    return { ok: false, reason: "connector_trigger_missing" };
  }

  const prepared = await prepareConnectorTriggerDefinition(
    {
      tenantId: input.tenantId,
      requesterUserId: connectorTrigger.requesterUserId,
      computerId: input.computerId ?? connectorTrigger.computerId,
      config: input.config,
    },
    deps,
  );
  const eventType = input.eventType ?? connectorTrigger.eventType;
  const event = {
    provider: connectorTrigger.provider,
    eventType,
    eventId: input.eventId ?? null,
    metadata: input.eventMetadata ?? null,
  };
  const taskInput = {
    threadId: input.threadId,
    messageId: input.messageId,
    source: "personal_connector_event",
    actorType: "user",
    actorId: connectorTrigger.requesterUserId,
    requesterUserId: connectorTrigger.requesterUserId,
    contextClass: "personal_connector_event",
    triggerId: input.triggerId,
    triggerType: "event",
    credentialSubject: connectorTrigger.credentialSubject,
    event,
    surfaceContext: {
      source: "personal_connector_event",
      provider: connectorTrigger.provider,
      eventType,
      eventId: input.eventId ?? null,
      connectionId: connectorTrigger.connectionId,
      triggerId: input.triggerId,
      computerId: prepared.computerId,
    },
  };
  const task = await (deps.enqueueTask ?? enqueueComputerTask)({
    tenantId: input.tenantId,
    computerId: prepared.computerId,
    taskType: "thread_turn",
    taskInput,
    idempotencyKey: `connector-event:${input.triggerId}:${
      input.eventId ?? input.messageId
    }`,
    createdByUserId: connectorTrigger.requesterUserId,
  });
  return { ok: true, task, taskInput };
}

export function connectorTriggerConfig(
  config: Record<string, unknown> | null,
): ConnectorTriggerConfig | null {
  const raw = connectorTriggerInput(config);
  if (!raw.provider || !raw.eventType || !raw.connectionId || !raw.computerId) {
    return null;
  }
  const requesterUserId = optional(raw.requesterUserId);
  const credentialSubject = recordOrUndefined(raw.credentialSubject);
  const credentialSubjectUserId = optional(credentialSubject?.userId);
  if (!requesterUserId && !credentialSubjectUserId) return null;
  return {
    version: 1,
    provider: String(raw.provider),
    eventType: String(raw.eventType),
    connectionId: String(raw.connectionId),
    computerId: String(raw.computerId),
    requesterUserId: requesterUserId ?? credentialSubjectUserId!,
    credentialSubject: {
      type: "user",
      userId: requesterUserId ?? credentialSubjectUserId!,
      connectionId: String(raw.connectionId),
      provider: String(raw.provider),
    },
    contextClass: "personal_connector_event",
    filters: recordOrUndefined(raw.filters),
  };
}

export function hasConnectorTriggerDefinition(
  config: Record<string, unknown> | null,
): boolean {
  if (recordOrUndefined(config?.connectorTrigger)) return true;
  const raw = connectorTriggerInput(config);
  return Boolean(raw.connectionId);
}

function connectorTriggerInput(config: Record<string, unknown> | null) {
  const nested = recordOrUndefined(config?.connectorTrigger);
  return nested ?? config ?? {};
}

function required(value: unknown, name: string): string {
  const stringValue = optional(value);
  if (!stringValue) throw new Error(`${name} is required`);
  return stringValue;
}

function optional(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordOrUndefined(
  value: unknown,
): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
