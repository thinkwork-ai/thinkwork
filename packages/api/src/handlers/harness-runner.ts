/**
 * harness-runner Lambda (THINK-311 U5).
 *
 * Event-mode target for harness-flagged agents: the chat dispatch selector
 * (resolveRuntimeFunctionName) routes their turns here instead of the Pi
 * container Lambda, wrapped in the same API-GW-shaped /invocations
 * envelope. This handler wires real AWS/db/platform effects into the
 * pure-ish run loop in lib/harness/runner.ts.
 *
 * Lifecycle: maximum_retry_attempts=0 in terraform (async-retry
 * idempotency) — a crashed run must never re-execute a turn; the stall
 * monitor times out abandoned turns without retry-queue re-dispatch
 * (runtime_type='harness' exclusion) and releases the thread checkout.
 */

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { threadTurns } from "@thinkwork/database-pg/schema";
import { getConfig } from "@thinkwork/runtime-config";
import {
  BedrockAgentCoreControlClient,
  CreateHarnessCommand,
  GetHarnessCommand,
  ListHarnessesCommand,
  UpdateHarnessCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";
import {
  BedrockAgentCoreClient,
  InvokeHarnessCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  parseHarnessInvokeEvent,
  runHarnessTurn,
  type EnsuredHarness,
  type HarnessRunnerDeps,
  type HarnessStreamEvent,
} from "../lib/harness/runner.js";
import type { HarnessProjectedConfig } from "../lib/harness/projection.js";
import { handleDocumentEmission } from "../lib/artifacts/document-emission.js";
import { processFinalize } from "../lib/chat-finalize/process-finalize.js";
import { listTenantModelCatalogByIds } from "../lib/model-catalog/tenant-catalog.js";

const region =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const controlClient = new BedrockAgentCoreControlClient({ region });
const dataClient = new BedrockAgentCoreClient({ region });
const s3 = new S3Client({ region });

const HARNESS_READY_TIMEOUT_MS = 120_000;
const HARNESS_READY_POLL_MS = 3_000;

function toSdkHarnessFields(
  config: HarnessProjectedConfig,
  executionRoleArn: string,
) {
  return {
    executionRoleArn,
    model: {
      bedrockModelConfig: {
        modelId: config.model.bedrockModelConfig.modelId,
      },
    },
    systemPrompt: [{ text: config.systemPrompt }],
    tools: config.tools.map((tool) =>
      tool.type === "mcp"
        ? {
            type: "remote_mcp" as const,
            name: tool.name,
            config: { remoteMcp: tool.remoteMcp },
          }
        : {
            type: "inline_function" as const,
            name: tool.name,
            config: { inlineFunction: tool.inlineFunction },
          },
    ),
    // Installed workspace skill folders already carry SKILL.md at their
    // root; passed as-is as S3 bundle sources (as-is vs. packaging
    // transform — decided against the real folder, verified live in U6).
    ...(config.skillMaterializations.length > 0
      ? {
          skills: config.skillMaterializations.map((skill) => ({
            s3: { uri: skill.sourceS3Uri },
          })),
        }
      : {}),
    allowedTools: config.allowedTools,
    maxIterations: config.maxIterations,
    timeoutSeconds: config.timeoutSeconds,
    ...(config.maxTokens ? { maxTokens: config.maxTokens } : {}),
    tags: {
      thinkwork_projection_fingerprint: config.evidence.projectionFingerprint,
      thinkwork_manifest_fingerprint: config.evidence.manifestFingerprint,
    },
  };
}

function readIdentity(response: Record<string, unknown>): EnsuredHarness {
  const harnessId = String(response.harnessId ?? response.id ?? "");
  const harnessArn = String(response.harnessArn ?? response.arn ?? "");
  const harnessVersion = String(
    response.harnessVersion ?? response.latestVersion ?? response.version ?? "",
  );
  if (!harnessId || !harnessArn) {
    throw new Error(
      `Harness control-plane response missing identity fields: ${JSON.stringify(Object.keys(response))}`,
    );
  }
  return { harnessId, harnessArn, harnessVersion };
}

async function ensureHarness(
  config: HarnessProjectedConfig,
  executionRoleArn: string,
): Promise<EnsuredHarness> {
  const fields = toSdkHarnessFields(config, executionRoleArn);
  const listed = await controlClient.send(
    new ListHarnessesCommand({ maxResults: 100 }),
  );
  const existing = (
    (listed as unknown as Record<string, unknown>).harnesses as
      | Array<Record<string, unknown>>
      | undefined
  )?.find((h) => h.harnessName === config.harnessName);

  let identity: EnsuredHarness;
  if (existing) {
    const updated = await controlClient.send(
      new UpdateHarnessCommand({
        harnessId: String(existing.harnessId ?? existing.id),
        ...fields,
      } as never),
    );
    identity = readIdentity({
      ...existing,
      ...(updated as unknown as Record<string, unknown>),
    });
  } else {
    const created = await controlClient.send(
      new CreateHarnessCommand({
        harnessName: config.harnessName,
        ...fields,
      } as never),
    );
    identity = readIdentity(created as unknown as Record<string, unknown>);
  }

  // Wait for READY — InvokeHarness against a CREATING/UPDATING harness fails.
  const deadline = Date.now() + HARNESS_READY_TIMEOUT_MS;
  for (;;) {
    const got = (await controlClient.send(
      new GetHarnessCommand({ harnessId: identity.harnessId } as never),
    )) as unknown as Record<string, unknown>;
    const status = String(got.status ?? "");
    if (status === "READY" || status === "ACTIVE") {
      return readIdentity({ ...identity, ...got });
    }
    if (status.includes("FAIL")) {
      throw new Error(
        `Harness ${identity.harnessId} entered status ${status} (${JSON.stringify(got.failureReason ?? "")})`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Harness ${identity.harnessId} not READY within ${HARNESS_READY_TIMEOUT_MS}ms (status ${status})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, HARNESS_READY_POLL_MS));
  }
}

function createRealDeps(): HarnessRunnerDeps {
  const workspaceBucket = getConfig("WORKSPACE_BUCKET", "");
  const executionRoleArn = getConfig("HARNESS_EXECUTION_ROLE_ARN", "");
  return {
    executionRoleArn,
    workspaceBucket,
    ensureHarness,
    async invokeHarness(input) {
      const response = await dataClient.send(
        new InvokeHarnessCommand({
          harnessArn: input.harnessArn,
          runtimeSessionId: input.runtimeSessionId,
          ...(input.runtimeUserId
            ? { runtimeUserId: input.runtimeUserId }
            : {}),
          messages: input.messages,
        } as never),
      );
      const stream = (response as unknown as Record<string, unknown>).stream;
      if (!stream) {
        throw new Error("InvokeHarness returned no stream");
      }
      return stream as AsyncIterable<HarnessStreamEvent>;
    },
    async emitDocument(input) {
      // Resolve triggering_message_id the same way the activity handler
      // does — handleDocumentEmission derives the acting user from it.
      const db = getDb();
      const [turnRow] = await db
        .select({
          triggering_message_id: threadTurns.triggering_message_id,
        })
        .from(threadTurns)
        .where(
          and(
            eq(threadTurns.id, input.turnId),
            eq(threadTurns.tenant_id, input.tenantId),
          ),
        )
        .limit(1);
      return handleDocumentEmission({
        tenantId: input.tenantId,
        threadId: input.threadId,
        agentId: input.agentId,
        turnId: input.turnId,
        triggeringMessageId: turnRow?.triggering_message_id ?? null,
        raw: input.raw,
      });
    },
    async finalize(payload) {
      return processFinalize(payload);
    },
    async bumpTurnActivity({ turnId, tenantId }) {
      const db = getDb();
      await db
        .update(threadTurns)
        .set({ last_activity_at: new Date() })
        .where(
          and(
            eq(threadTurns.id, turnId),
            eq(threadTurns.tenant_id, tenantId),
            eq(threadTurns.status, "running"),
            sql`${threadTurns.finalized_at} IS NULL`,
          ),
        );
    },
    async fetchWorkspaceText(key) {
      if (!workspaceBucket) return null;
      try {
        const object = await s3.send(
          new GetObjectCommand({ Bucket: workspaceBucket, Key: key }),
        );
        return (await object.Body?.transformToString()) ?? null;
      } catch {
        return null;
      }
    },
    async resolveModelProvider({ tenantId, modelId }) {
      try {
        const rows = await listTenantModelCatalogByIds({
          tenantId,
          modelIds: [modelId],
        });
        const row = rows.find((r) => r.modelId === modelId) as
          | { provider?: string | null }
          | undefined;
        return row?.provider ?? null;
      } catch (err) {
        console.warn(`[harness-runner] model provider lookup failed:`, err);
        return null;
      }
    },
  };
}

export async function handler(event: unknown): Promise<{ ok: boolean }> {
  const payload = parseHarnessInvokeEvent(event);
  console.log(
    `[harness-runner] thread=${payload.thread_id} turn=${payload.thread_turn_id} agent=${payload.assistant_id}`,
  );
  // runHarnessTurn finalizes every internal failure itself; anything that
  // escapes (payload missing ids, finalize failure) lands in the DLQ and
  // the stall monitor reconciles the turn (KTD-9 backstop).
  const result = await runHarnessTurn(payload, createRealDeps());
  console.log(
    `[harness-runner] turn ${payload.thread_turn_id}: ${result.status}`,
  );
  return { ok: result.status === "completed" };
}
