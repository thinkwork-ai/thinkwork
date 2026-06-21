import { and, eq } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { workflowEngineBindings } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db as defaultDb } from "../../utils.js";
import { requirePluginTenantAdmin } from "../plugins/shared.js";
import {
  createN8nWorkflowBridgeCredential,
  extractN8nWorkflowBridgeSecret,
  n8nWorkflowBridgeCredentialFromSecret,
  n8nWorkflowBridgeSecretRef,
  serializeN8nWorkflowBridgeSecret,
} from "../../../lib/workflows/n8n-bridge-contract.js";
import {
  createSecretsManagerPluginSecrets,
  type PluginSecretsClient,
} from "../../../lib/plugins/secrets.js";

export async function createN8nWorkflowBridge(
  _parent: unknown,
  args: { input: { workflowId: string; idempotencyKey: string } },
  ctx: GraphQLContext,
  deps: {
    db?: typeof defaultDb;
    createCredential?: typeof createN8nWorkflowBridgeCredential;
    secrets?: PluginSecretsClient;
    stage?: string | null;
  } = {},
) {
  const { tenantId } = await requirePluginTenantAdmin(ctx);
  const idempotencyKey = args.input.idempotencyKey.trim();
  if (!idempotencyKey) {
    throw new GraphQLError("idempotencyKey is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const db = deps.db ?? defaultDb;
  const [binding] = await db
    .select()
    .from(workflowEngineBindings)
    .where(
      and(
        eq(workflowEngineBindings.tenant_id, tenantId),
        eq(workflowEngineBindings.workflow_id, args.input.workflowId),
        eq(workflowEngineBindings.binding_type, "n8n_bridge"),
      ),
    )
    .limit(1);
  if (!binding) {
    throw new GraphQLError("n8n workflow binding was not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  const connectionRef = recordValue(binding.connection_ref);
  const secrets = deps.secrets ?? createSecretsManagerPluginSecrets();
  const existingSecretRef = stringValue(connectionRef.bridgeSecretRef);
  if (
    stringValue(connectionRef.bridgeIdempotencyKey) === idempotencyKey &&
    existingSecretRef
  ) {
    const sharedSecret = extractN8nWorkflowBridgeSecret(
      await secrets.getSecret(existingSecretRef),
    );
    if (!sharedSecret) {
      throw new GraphQLError("n8n workflow bridge credential was not found", {
        extensions: { code: "FAILED_PRECONDITION" },
      });
    }
    return responsePayload({
      binding,
      credential: n8nWorkflowBridgeCredentialFromSecret(sharedSecret),
    });
  }
  const credential = (
    deps.createCredential ?? createN8nWorkflowBridgeCredential
  )();
  const rotatedAt = new Date();
  const secretRef = n8nWorkflowBridgeSecretRef({
    stage: deps.stage ?? process.env.THINKWORK_STAGE ?? process.env.STAGE,
    tenantId,
    bindingId: binding.id,
  });
  await secrets.putSecret(
    secretRef,
    serializeN8nWorkflowBridgeSecret({
      sharedSecret: credential.sharedSecret,
      tenantId,
      workflowId: binding.workflow_id,
      bindingId: binding.id,
      rotatedAt,
    }),
  );
  await db
    .update(workflowEngineBindings)
    .set({
      connection_ref: {
        ...connectionRef,
        bridgeSecretRef: secretRef,
        bridgeSecretSha256: credential.secretSha256,
        bridgeSecretRotatedAt: rotatedAt.toISOString(),
        bridgeIdempotencyKey: idempotencyKey,
      },
      updated_at: rotatedAt,
    })
    .where(eq(workflowEngineBindings.id, binding.id));

  return responsePayload({ binding, credential });
}

function responsePayload(input: {
  binding: typeof workflowEngineBindings.$inferSelect;
  credential: ReturnType<typeof createN8nWorkflowBridgeCredential>;
}) {
  return {
    workflowId: input.binding.workflow_id,
    bindingId: input.binding.id,
    sharedSecret: input.credential.sharedSecret,
    secretPreview: input.credential.secretPreview,
    signingHeader: input.credential.signingHeader,
    timestampHeader: input.credential.timestampHeader,
    replayWindowSeconds: input.credential.replayWindowSeconds,
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
