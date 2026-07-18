import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@thinkwork/database-pg";
import { threadParticipants, threads } from "@thinkwork/database-pg/schema";
import {
  Kind,
  parse,
  print,
  type FieldNode,
  type OperationDefinitionNode,
} from "graphql";

import { db } from "./db.js";
import { subscriptionOperationHash } from "./subscription-ticket-signing.js";

const OPERATION_SCOPES = {
  onAgentStatusChanged: { variable: "tenantId", kind: "tenant" },
  onHeartbeatActivity: { variable: "tenantId", kind: "tenant" },
  onThreadUpdated: { variable: "tenantId", kind: "tenant" },
  onInboxItemStatusChanged: { variable: "tenantId", kind: "tenant" },
  onThreadTurnUpdated: { variable: "tenantId", kind: "tenant" },
  onOrgUpdated: { variable: "tenantId", kind: "tenant" },
  onCostRecorded: { variable: "tenantId", kind: "tenant" },
  onEvalRunUpdated: { variable: "tenantId", kind: "tenant" },
  onThreadActivity: { variable: "userId", kind: "user" },
  onWorkspaceAccessRevoked: { variable: "userId", kind: "user" },
  onNewMessage: { variable: "threadId", kind: "thread" },
  onThreadTurnStep: { variable: "threadId", kind: "thread" },
} as const;

export type AllowedSubscriptionField = keyof typeof OPERATION_SCOPES;

export interface SubscriptionResourceBinding {
  operationName: string;
  operationHash: string;
  fieldName: AllowedSubscriptionField;
  resourceKind: "tenant" | "user" | "thread";
  resourceId: string;
}

export interface SubscriptionAdmissionRepository {
  canReadThread(args: {
    threadId: string;
    tenantId: string;
    userId: string;
  }): Promise<boolean>;
}

export class SubscriptionAdmissionError extends Error {
  constructor(public readonly code: string) {
    super("Subscription registration rejected");
    this.name = "SubscriptionAdmissionError";
  }
}

export async function admitSubscriptionOperation(
  input: {
    operationName: string;
    query: string;
    variables: Record<string, unknown>;
    userId: string;
    tenantId: string;
  },
  repository: SubscriptionAdmissionRepository = createDbSubscriptionAdmissionRepository(),
): Promise<SubscriptionResourceBinding> {
  const operation = parseNamedSubscription(input.query, input.operationName);
  const field = operation.selectionSet.selections[0] as FieldNode;
  const fieldName = field.name.value as AllowedSubscriptionField;
  const scope = OPERATION_SCOPES[fieldName];
  if (!scope) throw new SubscriptionAdmissionError("operation_not_allowed");
  if (field.alias || field.arguments?.length !== 1) {
    throw new SubscriptionAdmissionError("operation_shape_invalid");
  }
  const argument = field.arguments[0];
  if (
    argument.name.value !== scope.variable ||
    argument.value.kind !== Kind.VARIABLE ||
    argument.value.name.value !== scope.variable
  ) {
    throw new SubscriptionAdmissionError("scope_argument_invalid");
  }
  const rawResourceId = input.variables[scope.variable];
  if (typeof rawResourceId !== "string" || rawResourceId.length === 0) {
    throw new SubscriptionAdmissionError("scope_variable_invalid");
  }
  if (scope.kind === "tenant" && rawResourceId !== input.tenantId) {
    throw new SubscriptionAdmissionError("tenant_mismatch");
  }
  if (scope.kind === "user" && rawResourceId !== input.userId) {
    throw new SubscriptionAdmissionError("user_mismatch");
  }
  if (
    scope.kind === "thread" &&
    !(await repository.canReadThread({
      threadId: rawResourceId,
      tenantId: input.tenantId,
      userId: input.userId,
    }))
  ) {
    throw new SubscriptionAdmissionError("thread_not_accessible");
  }
  const canonicalQuery = print(operation);
  return {
    operationName: input.operationName,
    operationHash: subscriptionOperationHash({
      operationName: input.operationName,
      query: canonicalQuery,
      variables: input.variables,
    }),
    fieldName,
    resourceKind: scope.kind,
    resourceId: rawResourceId,
  };
}

function parseNamedSubscription(
  query: string,
  operationName: string,
): OperationDefinitionNode {
  if (!operationName || query.length === 0 || query.length > 20_000) {
    throw new SubscriptionAdmissionError("operation_invalid");
  }
  let document;
  try {
    document = parse(query, { maxTokens: 2_000 });
  } catch {
    throw new SubscriptionAdmissionError("operation_invalid");
  }
  const operations = document.definitions.filter(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === Kind.OPERATION_DEFINITION,
  );
  const operation = operations.find(
    (candidate) => candidate.name?.value === operationName,
  );
  if (
    operations.length !== 1 ||
    !operation ||
    operation.operation !== "subscription" ||
    operation.selectionSet.selections.length !== 1 ||
    operation.selectionSet.selections[0].kind !== Kind.FIELD
  ) {
    throw new SubscriptionAdmissionError("operation_shape_invalid");
  }
  return operation;
}

export function createDbSubscriptionAdmissionRepository(
  database: Database = db,
): SubscriptionAdmissionRepository {
  return {
    async canReadThread({ threadId, tenantId, userId }) {
      const rows = await database
        .select({ id: threads.id })
        .from(threads)
        .where(
          and(
            eq(threads.id, threadId),
            eq(threads.tenant_id, tenantId),
            sql`(
              ${threads.user_id} = ${userId}
              OR EXISTS (
                SELECT 1 FROM ${threadParticipants} ticket_tp
                 WHERE ticket_tp.tenant_id = ${tenantId}
                   AND ticket_tp.thread_id = ${threads.id}
                   AND ticket_tp.participant_type = 'user'
                   AND ticket_tp.user_id = ${userId}
              )
              OR EXISTS (
                SELECT 1
                  FROM work_item_thread_links ticket_witl
                  JOIN work_items ticket_wi
                    ON ticket_wi.tenant_id = ticket_witl.tenant_id
                   AND ticket_wi.id = ticket_witl.work_item_id
                 WHERE ticket_witl.tenant_id = ${tenantId}
                   AND ticket_witl.thread_id = ${threads.id}
                   AND ticket_wi.owner_user_id = ${userId}
                   AND ticket_wi.archived_at IS NULL
              )
            )`,
          ),
        )
        .limit(1);
      return rows.length === 1;
    },
  };
}
