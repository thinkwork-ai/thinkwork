import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  computerEvents,
  computers,
  computerTasks,
  connectorExecutions,
  connectors,
  messages,
  tenantCredentials,
  tenants,
  threads,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb, type Database } from "../db.js";
import {
  fetchLinearIssues as defaultFetchLinearIssues,
  parseLinearIssueQueryConfig,
  type LinearApiIssue,
  type LinearFetchOptions,
} from "./linear.js";
import { readTenantCredentialSecret as defaultReadTenantCredentialSecret } from "../tenant-credentials/secret-store.js";
import { normalizeTaskInput } from "../computers/tasks.js";

export type ConnectorDispatchTargetType =
  | "agent"
  | "routine"
  | "hybrid_routine"
  | "computer";

export type ConnectorRuntimeRow = typeof connectors.$inferSelect;
export type ConnectorExecutionRow = typeof connectorExecutions.$inferSelect;

export interface LinearSeedIssue {
  id?: string | null;
  identifier?: string | null;
  title?: string | null;
  description?: string | null;
  url?: string | null;
  state?: string | null;
  labels?: string[] | null;
  priority?: string | number | null;
}

export interface ConnectorDispatchCandidate {
  connectorId: string;
  tenantId: string;
  externalRef: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
}

export interface ConnectorRuntimeCredential {
  id: string;
  tenant_id: string;
  slug: string;
  kind: string;
  status: string;
  secret_ref: string;
}

export type ConnectorDispatchResult =
  | {
      status: "dispatched";
      connectorId: string;
      executionId: string;
      externalRef: string;
      threadId: string;
      messageId: string;
      computerId?: string;
      computerTaskId?: string;
    }
  | {
      status: "duplicate";
      connectorId: string;
      executionId?: string;
      externalRef: string;
    }
  | {
      status: "unsupported_target";
      connectorId: string;
      executionId: string;
      externalRef: string;
      targetType: ConnectorDispatchTargetType;
    }
  | {
      status: "skipped";
      connectorId: string;
      reason: string;
      externalRef?: string;
    }
  | {
      status: "failed";
      connectorId: string;
      externalRef?: string;
      executionId?: string;
      error: string;
    };

export interface ConnectorRuntimeTickOptions {
  tenantId?: string;
  connectorId?: string;
  now?: Date;
  limit?: number;
  force?: boolean;
}

export interface AgentInvokePayload {
  threadId: string;
  tenantId: string;
  agentId: string;
  userMessage: string;
  messageId: string;
}

export type AgentInvoker = (payload: AgentInvokePayload) => Promise<boolean>;

export interface ConnectorRuntimeStore {
  listDueConnectors(args: {
    tenantId?: string;
    connectorId?: string;
    now: Date;
    limit: number;
    force?: boolean;
  }): Promise<ConnectorRuntimeRow[]>;
  claimExecution(args: {
    connector: ConnectorRuntimeRow;
    candidate: ConnectorDispatchCandidate;
    now: Date;
  }): Promise<
    | { status: "created"; execution: ConnectorExecutionRow }
    | { status: "duplicate"; execution?: ConnectorExecutionRow }
  >;
  createAgentThread(args: {
    connector: ConnectorRuntimeRow;
    candidate: ConnectorDispatchCandidate;
    execution: ConnectorExecutionRow;
    now: Date;
  }): Promise<{ threadId: string; messageId: string }>;
  createComputerHandoff(args: {
    connector: ConnectorRuntimeRow;
    candidate: ConnectorDispatchCandidate;
    execution: ConnectorExecutionRow;
    now: Date;
  }): Promise<{
    computerId: string;
    computerTaskId: string;
    threadId: string;
    messageId: string;
  }>;
  markExecutionTerminal(args: {
    executionId: string;
    now: Date;
    outcomePayload: Record<string, unknown>;
  }): Promise<void>;
  markExecutionFailed(args: {
    executionId: string;
    now: Date;
    error: string;
  }): Promise<void>;
  markConnectorPolled(args: {
    connectorId: string;
    now: Date;
    nextPollAt: Date;
  }): Promise<void>;
  loadTenantCredential(args: {
    tenantId: string;
    credentialId?: string;
    credentialSlug?: string;
  }): Promise<ConnectorRuntimeCredential | null>;
}

export type LinearIssueFetcher = (
  options: LinearFetchOptions,
) => Promise<LinearApiIssue[]>;

export type TenantCredentialSecretReader = (
  secretRef: string,
) => Promise<Record<string, unknown>>;

export interface ConnectorRuntimeDeps {
  store?: ConnectorRuntimeStore;
  invokeAgent?: AgentInvoker;
  fetchLinearIssues?: LinearIssueFetcher;
  readTenantCredentialSecret?: TenantCredentialSecretReader;
}

const ACTIVE_EXECUTION_STATES = [
  "pending",
  "dispatching",
  "invoking",
  "recording_result",
];

const DEFAULT_POLL_INTERVAL_MS = 60_000;

export async function runConnectorDispatchTick(
  options: ConnectorRuntimeTickOptions = {},
  deps: ConnectorRuntimeDeps = {},
): Promise<ConnectorDispatchResult[]> {
  const now = options.now ?? new Date();
  const store =
    deps.store ??
    createDrizzleConnectorRuntimeStore(defaultDb, deps.invokeAgent);
  const connectorsToRun = await store.listDueConnectors({
    tenantId: options.tenantId,
    connectorId: options.connectorId,
    now,
    limit: options.limit ?? 50,
    force: options.force,
  });

  const results: ConnectorDispatchResult[] = [];
  for (const connector of connectorsToRun) {
    if (!isRuntimeEligibleConnector(connector, now, options)) {
      results.push({
        status: "skipped",
        connectorId: connector.id,
        reason: "connector_not_active_enabled_due",
      });
      continue;
    }

    let candidates: ConnectorDispatchCandidate[];
    try {
      candidates = await loadConnectorDispatchCandidates(connector, store, {
        fetchLinearIssues: deps.fetchLinearIssues ?? defaultFetchLinearIssues,
        readTenantCredentialSecret:
          deps.readTenantCredentialSecret ?? defaultReadTenantCredentialSecret,
      });
    } catch (error) {
      results.push({
        status: "failed",
        connectorId: connector.id,
        error: error instanceof Error ? error.message : String(error),
      });
      await markConnectorPolled(store, connector.id, now);
      continue;
    }
    if (candidates.length === 0) {
      results.push({
        status: "skipped",
        connectorId: connector.id,
        reason: "no_dispatch_candidates",
      });
      await markConnectorPolled(store, connector.id, now);
      continue;
    }

    for (const candidate of candidates) {
      results.push(
        await dispatchCandidate({ store, connector, candidate, now }),
      );
    }
    await markConnectorPolled(store, connector.id, now);
  }

  return results;
}

export function isRuntimeEligibleConnector(
  connector: ConnectorRuntimeRow,
  now: Date,
  filters: Pick<
    ConnectorRuntimeTickOptions,
    "tenantId" | "connectorId" | "force"
  > = {},
): boolean {
  if (filters.tenantId && connector.tenant_id !== filters.tenantId)
    return false;
  if (filters.connectorId && connector.id !== filters.connectorId) return false;
  if (connector.status !== "active") return false;
  if (connector.enabled !== true) return false;
  if (!filters.force && connector.next_poll_at && connector.next_poll_at > now)
    return false;
  return true;
}

export async function loadConnectorDispatchCandidates(
  connector: ConnectorRuntimeRow,
  store: Pick<ConnectorRuntimeStore, "loadTenantCredential">,
  deps: {
    fetchLinearIssues: LinearIssueFetcher;
    readTenantCredentialSecret: TenantCredentialSecretReader;
  },
): Promise<ConnectorDispatchCandidate[]> {
  const seedCandidates = buildLinearTrackerCandidates(connector);
  if (seedCandidates.length > 0) return seedCandidates;
  if (connector.type !== "linear_tracker") return [];

  const config = asRecord(connector.config);
  if (!isLinearTrackerConfig(config)) return [];

  const query = parseLinearIssueQueryConfig(config);
  if (!query) return [];

  const credential = await store.loadTenantCredential({
    tenantId: connector.tenant_id,
    credentialId: query.credentialId,
    credentialSlug: query.credentialSlug,
  });
  if (!credential) {
    throw new Error("Linear credential not found");
  }
  if (credential.kind !== "api_key") {
    throw new Error("Linear connector credential must be an api_key");
  }

  const secret = await deps.readTenantCredentialSecret(credential.secret_ref);
  const apiKey = cleanString(secret.apiKey);
  if (!apiKey) {
    throw new Error("Linear credential secret is missing apiKey");
  }

  const issues = await deps.fetchLinearIssues({ apiKey, query });
  return issues.flatMap((issue) => {
    const candidate = linearIssueToCandidate(connector, issue);
    return candidate ? [candidate] : [];
  });
}

export function buildLinearTrackerCandidates(
  connector: ConnectorRuntimeRow,
): ConnectorDispatchCandidate[] {
  if (connector.type !== "linear_tracker") return [];

  const config = asRecord(connector.config);
  if (!isLinearTrackerConfig(config)) return [];

  const seedIssues = readSeedIssues(config);
  return seedIssues.flatMap((issue) => {
    const candidate = linearIssueToCandidate(connector, issue);
    return candidate ? [candidate] : [];
  });
}

export function linearIssueToCandidate(
  connector: ConnectorRuntimeRow,
  issue: LinearSeedIssue,
): ConnectorDispatchCandidate | null {
  const externalRef = cleanString(issue.id) ?? cleanString(issue.identifier);
  if (!externalRef) return null;

  const title =
    cleanString(issue.title) ?? cleanString(issue.identifier) ?? externalRef;
  const description = cleanString(issue.description);
  const url = cleanString(issue.url);
  const labels = Array.isArray(issue.labels)
    ? issue.labels.filter((label): label is string => typeof label === "string")
    : [];

  const lines = [
    `Linear issue ${cleanString(issue.identifier) ?? externalRef}: ${title}`,
    "",
    description ?? "No issue description was provided.",
  ];
  if (url) lines.push("", `Issue URL: ${url}`);
  if (issue.state) lines.push(`State: ${issue.state}`);
  if (labels.length > 0) lines.push(`Labels: ${labels.join(", ")}`);
  if (issue.priority !== undefined && issue.priority !== null) {
    lines.push(`Priority: ${String(issue.priority)}`);
  }

  return {
    connectorId: connector.id,
    tenantId: connector.tenant_id,
    externalRef,
    title,
    body: lines.join("\n"),
    metadata: {
      sourceKind: "tracker_issue",
      connectorId: connector.id,
      connectorType: connector.type,
      externalRef,
      linear: {
        id: issue.id ?? null,
        identifier: issue.identifier ?? null,
        title,
        url: url ?? null,
        state: issue.state ?? null,
        labels,
        priority: issue.priority ?? null,
      },
    },
  };
}

export function createDrizzleConnectorRuntimeStore(
  db: Database,
  invokeAgent: AgentInvoker = invokeChatAgentByDefault,
): ConnectorRuntimeStore {
  return {
    async listDueConnectors({ tenantId, connectorId, now, limit, force }) {
      const conditions = [
        eq(connectors.status, "active"),
        eq(connectors.enabled, true),
      ];
      if (!force) {
        const dueCondition = or(
          isNull(connectors.next_poll_at),
          lte(connectors.next_poll_at, now),
        );
        if (dueCondition) conditions.push(dueCondition);
      }
      if (tenantId) conditions.push(eq(connectors.tenant_id, tenantId));
      if (connectorId) conditions.push(eq(connectors.id, connectorId));

      return db
        .select()
        .from(connectors)
        .where(and(...conditions))
        .orderBy(asc(connectors.next_poll_at), asc(connectors.created_at))
        .limit(limit);
    },

    async claimExecution({ connector, candidate }) {
      const [existing] = await db
        .select()
        .from(connectorExecutions)
        .where(
          and(
            eq(connectorExecutions.connector_id, connector.id),
            eq(connectorExecutions.external_ref, candidate.externalRef),
          ),
        )
        .limit(1);
      if (existing) return { status: "duplicate", execution: existing };

      try {
        const [execution] = await db
          .insert(connectorExecutions)
          .values({
            tenant_id: connector.tenant_id,
            connector_id: connector.id,
            external_ref: candidate.externalRef,
            current_state: "pending",
            outcome_payload: {
              candidate: candidate.metadata,
              dispatchTitle: candidate.title,
            },
          })
          .returning();
        if (!execution) return { status: "duplicate" };
        return { status: "created", execution };
      } catch (error) {
        if (isUniqueViolation(error)) {
          const [existing] = await db
            .select()
            .from(connectorExecutions)
            .where(
              and(
                eq(connectorExecutions.connector_id, connector.id),
                eq(connectorExecutions.external_ref, candidate.externalRef),
                inArray(
                  connectorExecutions.current_state,
                  ACTIVE_EXECUTION_STATES,
                ),
              ),
            )
            .limit(1);
          return existing
            ? { status: "duplicate", execution: existing }
            : { status: "duplicate" };
        }
        throw error;
      }
    },

    async createAgentThread({ connector, candidate, execution }) {
      const created = await db.transaction(async (tx) => {
        const [tenant] = await tx
          .update(tenants)
          .set({ issue_counter: sql`${tenants.issue_counter} + 1` })
          .where(eq(tenants.id, connector.tenant_id))
          .returning({ nextNumber: sql<number>`${tenants.issue_counter}` });
        if (!tenant) throw new Error("Tenant not found");

        const identifier = `CONN-${tenant.nextNumber}`;
        const metadata = {
          kind: "connector_dispatch",
          connectorId: connector.id,
          connectorType: connector.type,
          connectorExecutionId: execution.id,
          externalRef: candidate.externalRef,
          sourceKind: "tracker_issue",
          candidate: candidate.metadata,
        };

        const [thread] = await tx
          .insert(threads)
          .values({
            tenant_id: connector.tenant_id,
            agent_id: connector.dispatch_target_id,
            number: tenant.nextNumber,
            identifier,
            title: candidate.title,
            status: "in_progress",
            channel: "connector",
            created_by_type: "connector",
            created_by_id: connector.id,
            metadata,
          })
          .returning({ id: threads.id });
        if (!thread) throw new Error("Failed to create connector thread");

        const [message] = await tx
          .insert(messages)
          .values({
            thread_id: thread.id,
            tenant_id: connector.tenant_id,
            role: "user",
            content: candidate.body,
            sender_type: "connector",
            sender_id: connector.id,
            metadata,
          })
          .returning({ id: messages.id });
        if (!message) throw new Error("Failed to create connector message");

        return { threadId: thread.id, messageId: message.id };
      });
      const dispatched = await invokeAgent({
        threadId: created.threadId,
        tenantId: connector.tenant_id,
        agentId: connector.dispatch_target_id,
        userMessage: candidate.body,
        messageId: created.messageId,
      });
      if (!dispatched) {
        throw new Error("chat-agent-invoke dispatch failed");
      }
      return created;
    },

    async createComputerHandoff({ connector, candidate, execution }) {
      return db.transaction(async (tx) => {
        const [computer] = await tx
          .select({
            id: computers.id,
            owner_user_id: computers.owner_user_id,
          })
          .from(computers)
          .where(
            and(
              eq(computers.id, connector.dispatch_target_id),
              eq(computers.tenant_id, connector.tenant_id),
            ),
          )
          .limit(1);
        if (!computer) throw new Error("Computer not found");

        const idempotencyKey = `connector:${connector.id}:external:${candidate.externalRef}`;
        const normalizedInput = normalizeTaskInput("connector_work", {
          connectorId: connector.id,
          connectorExecutionId: execution.id,
          externalRef: candidate.externalRef,
          title: candidate.title,
          body: candidate.body,
          metadata: candidate.metadata,
        });

        let [task] = await tx
          .insert(computerTasks)
          .values({
            tenant_id: connector.tenant_id,
            computer_id: computer.id,
            task_type: "connector_work",
            input: normalizedInput,
            idempotency_key: idempotencyKey,
          })
          .onConflictDoNothing()
          .returning({ id: computerTasks.id });
        if (!task) {
          [task] = await tx
            .select({ id: computerTasks.id })
            .from(computerTasks)
            .where(
              and(
                eq(computerTasks.tenant_id, connector.tenant_id),
                eq(computerTasks.computer_id, computer.id),
                eq(computerTasks.idempotency_key, idempotencyKey),
              ),
            )
            .limit(1);
        }
        if (!task) throw new Error("Failed to create connector Computer task");

        const [tenant] = await tx
          .update(tenants)
          .set({ issue_counter: sql`${tenants.issue_counter} + 1` })
          .where(eq(tenants.id, connector.tenant_id))
          .returning({ nextNumber: sql<number>`${tenants.issue_counter}` });
        if (!tenant) throw new Error("Tenant not found");

        const identifier = `CONN-${tenant.nextNumber}`;
        const metadata = {
          kind: "connector_dispatch",
          connectorId: connector.id,
          connectorType: connector.type,
          connectorExecutionId: execution.id,
          externalRef: candidate.externalRef,
          sourceKind: "tracker_issue",
          candidate: candidate.metadata,
          dispatchTargetType: "computer",
          computerId: computer.id,
          computerTaskId: task.id,
        };

        await tx.insert(computerEvents).values({
          tenant_id: connector.tenant_id,
          computer_id: computer.id,
          task_id: task.id,
          event_type: "connector_work_received",
          level: "info",
          payload: {
            connectorId: connector.id,
            connectorExecutionId: execution.id,
            externalRef: candidate.externalRef,
            title: candidate.title,
            idempotencyKey,
          },
        });

        const [thread] = await tx
          .insert(threads)
          .values({
            tenant_id: connector.tenant_id,
            user_id: computer.owner_user_id,
            number: tenant.nextNumber,
            identifier,
            title: candidate.title,
            status: "in_progress",
            channel: "connector",
            assignee_type: "computer",
            assignee_id: computer.id,
            created_by_type: "computer",
            created_by_id: computer.id,
            metadata,
          })
          .returning({ id: threads.id });
        if (!thread) throw new Error("Failed to create connector thread");

        const [message] = await tx
          .insert(messages)
          .values({
            thread_id: thread.id,
            tenant_id: connector.tenant_id,
            role: "user",
            content: candidate.body,
            sender_type: "connector",
            sender_id: connector.id,
            metadata,
          })
          .returning({ id: messages.id });
        if (!message) throw new Error("Failed to create connector message");

        return {
          computerId: computer.id,
          computerTaskId: task.id,
          threadId: thread.id,
          messageId: message.id,
        };
      });
    },

    async markExecutionTerminal({ executionId, now, outcomePayload }) {
      await db
        .update(connectorExecutions)
        .set({
          current_state: "terminal",
          started_at: now,
          finished_at: now,
          outcome_payload: outcomePayload,
        })
        .where(eq(connectorExecutions.id, executionId));
    },

    async markExecutionFailed({ executionId, now, error }) {
      await db
        .update(connectorExecutions)
        .set({
          current_state: "failed",
          finished_at: now,
          error_class: error,
        })
        .where(eq(connectorExecutions.id, executionId));
    },

    async markConnectorPolled({ connectorId, now, nextPollAt }) {
      await db
        .update(connectors)
        .set({
          last_poll_at: now,
          next_poll_at: nextPollAt,
          updated_at: now,
        })
        .where(eq(connectors.id, connectorId));
    },

    async loadTenantCredential({ tenantId, credentialId, credentialSlug }) {
      if (!credentialId && !credentialSlug) return null;
      const conditions = [
        eq(tenantCredentials.tenant_id, tenantId),
        eq(tenantCredentials.status, "active"),
      ];
      if (credentialId) conditions.push(eq(tenantCredentials.id, credentialId));
      if (credentialSlug)
        conditions.push(eq(tenantCredentials.slug, credentialSlug));

      const [credential] = await db
        .select({
          id: tenantCredentials.id,
          tenant_id: tenantCredentials.tenant_id,
          slug: tenantCredentials.slug,
          kind: tenantCredentials.kind,
          status: tenantCredentials.status,
          secret_ref: tenantCredentials.secret_ref,
        })
        .from(tenantCredentials)
        .where(and(...conditions))
        .limit(1);
      return credential ?? null;
    },
  };
}

async function invokeChatAgentByDefault(
  payload: AgentInvokePayload,
): Promise<boolean> {
  const { invokeChatAgent } = await import("../../graphql/utils.js");
  return invokeChatAgent(payload);
}

async function markConnectorPolled(
  store: ConnectorRuntimeStore,
  connectorId: string,
  now: Date,
): Promise<void> {
  await store.markConnectorPolled({
    connectorId,
    now,
    nextPollAt: defaultNextPollAt(now),
  });
}

export function defaultNextPollAt(now: Date): Date {
  return new Date(now.getTime() + DEFAULT_POLL_INTERVAL_MS);
}

async function dispatchCandidate(args: {
  store: ConnectorRuntimeStore;
  connector: ConnectorRuntimeRow;
  candidate: ConnectorDispatchCandidate;
  now: Date;
}): Promise<ConnectorDispatchResult> {
  const { store, connector, candidate, now } = args;
  let execution: ConnectorExecutionRow | undefined;

  try {
    const claim = await store.claimExecution({ connector, candidate, now });
    if (claim.status === "duplicate") {
      return {
        status: "duplicate",
        connectorId: connector.id,
        executionId: claim.execution?.id,
        externalRef: candidate.externalRef,
      };
    }
    execution = claim.execution;

    const targetType =
      connector.dispatch_target_type as ConnectorDispatchTargetType;
    if (targetType === "computer") {
      const { computerId, computerTaskId, threadId, messageId } =
        await store.createComputerHandoff({
          connector,
          candidate,
          execution,
          now,
        });
      await store.markExecutionTerminal({
        executionId: execution.id,
        now,
        outcomePayload: {
          ...candidate.metadata,
          threadId,
          messageId,
          computerId,
          computerTaskId,
          dispatchTargetType: targetType,
          dispatchTargetId: connector.dispatch_target_id,
        },
      });

      return {
        status: "dispatched",
        connectorId: connector.id,
        executionId: execution.id,
        externalRef: candidate.externalRef,
        threadId,
        messageId,
        computerId,
        computerTaskId,
      };
    }

    if (targetType !== "agent") {
      return {
        status: "unsupported_target",
        connectorId: connector.id,
        executionId: execution.id,
        externalRef: candidate.externalRef,
        targetType,
      };
    }

    const { threadId, messageId } = await store.createAgentThread({
      connector,
      candidate,
      execution,
      now,
    });
    await store.markExecutionTerminal({
      executionId: execution.id,
      now,
      outcomePayload: {
        ...candidate.metadata,
        threadId,
        messageId,
        dispatchTargetType: targetType,
        dispatchTargetId: connector.dispatch_target_id,
      },
    });

    return {
      status: "dispatched",
      connectorId: connector.id,
      executionId: execution.id,
      externalRef: candidate.externalRef,
      threadId,
      messageId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (execution) {
      await store.markExecutionFailed({
        executionId: execution.id,
        now,
        error: message,
      });
    }
    return {
      status: "failed",
      connectorId: connector.id,
      externalRef: candidate.externalRef,
      executionId: execution?.id,
      error: message,
    };
  }
}

function readSeedIssues(config: Record<string, unknown>): LinearSeedIssue[] {
  const raw =
    config.seedIssues ??
    config.seed_issues ??
    config.issues ??
    asRecord(config.payload)?.seedIssues ??
    asRecord(config.payload)?.issues;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (issue): issue is LinearSeedIssue => asRecord(issue) !== null,
  );
}

function isLinearTrackerConfig(
  config: Record<string, unknown> | null,
): config is Record<string, unknown> {
  if (!config) return false;
  const provider = typeof config.provider === "string" ? config.provider : null;
  const sourceKind =
    typeof config.sourceKind === "string" ? config.sourceKind : null;
  if (provider && provider !== "linear") return false;
  if (sourceKind && sourceKind !== "tracker_issue") return false;
  return true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUniqueViolation(error: unknown): boolean {
  const maybe = error as { code?: unknown; cause?: { code?: unknown } };
  return maybe.code === "23505" || maybe.cause?.code === "23505";
}
