/**
 * Artifact Delivery Lambda
 *
 * Delivers artifact content via email (HTML from markdown).
 *
 * Route: POST /api/artifacts/:id/deliver
 * Auth: THINKWORK_API_SECRET bearer token
 *
 * THINK-227 U5 — workflow-delivery mode: the interpreter's deliver-step
 * executor invokes this Lambda DIRECTLY (RequestResponse, IAM-gated — no
 * bearer) with `{ workflowDelivery: {...} }`. That mode sends the workflow's
 * maintained document to the operator-configured recipient list: inline HTML
 * + a living share link, idempotent per run against the email ledger.
 */

import { getApiAuthSecret, getConfig } from "@thinkwork/runtime-config";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  artifacts,
  agents,
  agentCapabilities,
  agentLoops,
  emailLedgerEvents,
  workflows,
  workflowRuns,
} from "@thinkwork/database-pg/schema";
import {
  renderEmailDelivery,
  renderSmsDelivery,
} from "../lib/artifact-delivery.js";
import {
  isArtifactPayloadS3Key,
  readArtifactPayloadFromS3,
} from "../lib/artifacts/payload-storage.js";
import { getOrCreateArtifactShare } from "../lib/artifacts/share-links.js";
import { signShareToken } from "../lib/artifacts/share-tokens.js";

// THINK-246: the hardcoded dev fallback (noreply@agents.thinkwork.ai) is
// only a verified SES identity in the ThinkWork dev account — customer
// stages set ARTIFACT_DELIVERY_FROM_EMAIL (terraform derives it from their
// verified customer domain) or every delivery fails at SES.
const DEFAULT_FROM_ADDRESS =
  process.env.ARTIFACT_DELIVERY_FROM_EMAIL || "noreply@agents.thinkwork.ai";

const db = getDb();

interface DeliverRequest {
  channel: "email" | "sms";
  to: string;
  /** Override the default subject (email only) */
  subject?: string;
}

/** Direct-invoke payload from the workflow deliver-step executor (U5). */
interface WorkflowDeliveryRequest {
  tenantId: string;
  artifactId: string;
  recipients: string[];
  subjectTemplate?: string | null;
  idempotencyKey: string;
  workflowRunId: string;
}

interface WorkflowDeliveryResponse {
  ok: boolean;
  delivery?: "sent" | "skipped_duplicate";
  recipients?: string[];
  subject?: string | null;
  shareUrl?: string | null;
  error?: string | null;
}

const MAX_WORKFLOW_RECIPIENTS = 50;
const RECIPIENT_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handler(
  event: APIGatewayProxyEventV2 | { workflowDelivery: WorkflowDeliveryRequest },
) {
  // Workflow-delivery mode: direct Lambda invoke from the interpreter's
  // deliver-step executor. IAM (cross-function invoke grant) is the auth
  // boundary — there is no API Gateway request to bearer-check.
  if ("workflowDelivery" in event) {
    try {
      return await handleWorkflowDelivery(event.workflowDelivery);
    } catch (err) {
      console.error("[artifact-deliver] workflow delivery failed:", err);
      return {
        ok: false,
        error: (err as Error).message?.slice(0, 500) ?? "delivery failed",
      } satisfies WorkflowDeliveryResponse;
    }
  }
  return handleApiGatewayDeliver(event);
}

async function handleApiGatewayDeliver(event: APIGatewayProxyEventV2) {
  // Auth — fail closed when the secret is unresolved (empty)
  const authHeader = event.headers?.authorization || "";
  const secret = getApiAuthSecret();
  if (
    !authHeader.startsWith("Bearer ") ||
    !(secret && authHeader.slice(7) === secret)
  ) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  if (event.requestContext.http.method !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // Extract artifact ID from path: /api/artifacts/:id/deliver
  const pathMatch = event.rawPath.match(
    /\/api\/artifacts\/([0-9a-f-]+)\/deliver$/i,
  );
  if (!pathMatch) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "Invalid path — expected /api/artifacts/:id/deliver",
      }),
    };
  }
  const artifactId = pathMatch[1];

  let req: DeliverRequest;
  try {
    req = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  if (!req.channel || !req.to) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "Missing required fields: channel, to",
      }),
    };
  }

  // Fetch artifact
  const [artifact] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, artifactId));
  if (!artifact) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: "Artifact not found" }),
    };
  }

  let artifactContent = artifact.content;
  if (
    artifactContent === null &&
    artifact.s3_key &&
    artifact.type !== "applet" &&
    artifact.type !== "applet_state" &&
    isArtifactPayloadS3Key(artifact.tenant_id, artifact.s3_key)
  ) {
    try {
      artifactContent = await readArtifactPayloadFromS3({
        tenantId: artifact.tenant_id,
        key: artifact.s3_key,
      });
    } catch (err) {
      console.warn(
        `[artifact-deliver] failed to read artifact payload ${artifact.id}: ${(err as Error).message}`,
      );
    }
  }

  if (artifactContent === null) {
    return {
      statusCode: 422,
      body: JSON.stringify({
        error: "Artifact content is unavailable for delivery",
      }),
    };
  }

  const payload = {
    id: artifact.id,
    title: artifact.title,
    type: artifact.type,
    status: artifact.status,
    content: artifactContent,
    summary: artifact.summary,
    metadata: artifact.metadata as Record<string, unknown> | null,
  };

  if (req.channel === "email") {
    const delivery = renderEmailDelivery(payload);
    const subject = req.subject ?? delivery.subject;

    // Resolve sender address from agent's email channel config
    let fromAddress = DEFAULT_FROM_ADDRESS;
    if (artifact.agent_id) {
      const [cap] = await db
        .select()
        .from(agentCapabilities)
        .where(eq(agentCapabilities.agent_id, artifact.agent_id));
      if (cap?.config) {
        const config =
          typeof cap.config === "string" ? JSON.parse(cap.config) : cap.config;
        if (config?.vanityAddress) {
          fromAddress = config.vanityAddress;
        }
      }
    }

    // Send via SES
    try {
      const { SESClient, SendRawEmailCommand } =
        await import("@aws-sdk/client-ses");
      const ses = new SESClient({});

      const recipients = req.to
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
      if (recipients.length > 10) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Maximum 10 recipients per delivery",
          }),
        };
      }

      const boundary = `----=_Part_${Date.now()}`;
      const rawEmail = [
        `From: Thinkwork <${fromAddress}>`,
        `To: ${recipients.join(", ")}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=UTF-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        delivery.textBody,
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset=UTF-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        delivery.htmlBody,
        ``,
        `--${boundary}--`,
      ].join("\r\n");

      await ses.send(
        new SendRawEmailCommand({
          RawMessage: {
            Data: Buffer.from(rawEmail, "utf-8"),
          },
        }),
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          channel: "email",
          recipients,
          subject,
        }),
      };
    } catch (err: any) {
      console.error("[artifact-deliver] SES send failed:", err);
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: "Email delivery failed",
          detail: err.message,
        }),
      };
    }
  }

  if (req.channel === "sms") {
    const sms = renderSmsDelivery(payload);

    // SMS delivery via SNS
    try {
      const { SNSClient, PublishCommand } = await import("@aws-sdk/client-sns");
      const sns = new SNSClient({});

      await sns.send(
        new PublishCommand({
          PhoneNumber: req.to,
          Message: sms.body,
        }),
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          channel: "sms",
          to: req.to,
          body: sms.body,
        }),
      };
    } catch (err: any) {
      console.error("[artifact-deliver] SNS send failed:", err);
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: "SMS delivery failed",
          detail: err.message,
        }),
      };
    }
  }

  return {
    statusCode: 400,
    body: JSON.stringify({
      error: `Unsupported channel: ${req.channel}. Supported: email, sms`,
    }),
  };
}

// ---------------------------------------------------------------------------
// Workflow delivery (THINK-227 U5)
// ---------------------------------------------------------------------------

/** CR/LF anywhere in a header-bound input is a header-injection attempt —
 * reject the whole delivery rather than sanitize-and-send (KTD8: honest
 * failures over silent mangling). */
function assertNoHeaderInjection(label: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${label} contains line breaks — refusing to send`);
  }
}

async function handleWorkflowDelivery(
  req: WorkflowDeliveryRequest,
): Promise<WorkflowDeliveryResponse> {
  if (!req.tenantId || !req.artifactId || !req.idempotencyKey) {
    return {
      ok: false,
      error: "tenantId, artifactId, and idempotencyKey are required",
    };
  }
  const recipients = Array.isArray(req.recipients)
    ? req.recipients.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  if (recipients.length === 0 || recipients.length > MAX_WORKFLOW_RECIPIENTS) {
    return {
      ok: false,
      error: `delivery requires 1-${MAX_WORKFLOW_RECIPIENTS} recipients`,
    };
  }
  for (const recipient of recipients) {
    assertNoHeaderInjection("recipient", recipient);
    if (!RECIPIENT_SHAPE.test(recipient)) {
      return {
        ok: false,
        error: `recipient '${recipient.slice(0, 80)}' is not a plausible email address`,
      };
    }
  }

  // Idempotency (KTD8): one send per run — a retried/resumed run that already
  // sent must not double-email. The ledger's send_succeeded row is the record.
  const [priorSend] = await db
    .select({ id: emailLedgerEvents.id })
    .from(emailLedgerEvents)
    .where(
      and(
        eq(emailLedgerEvents.tenant_id, req.tenantId),
        eq(emailLedgerEvents.event_type, "send_succeeded"),
        sql`${emailLedgerEvents.metadata}->>'idempotencyKey' = ${req.idempotencyKey}`,
      ),
    )
    .limit(1);
  if (priorSend) {
    return { ok: true, delivery: "skipped_duplicate", recipients };
  }

  const [artifact] = await db
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.id, req.artifactId),
        eq(artifacts.tenant_id, req.tenantId),
      ),
    )
    .limit(1);
  if (!artifact) {
    return { ok: false, error: "bound document not found in this tenant" };
  }

  let artifactContent = artifact.content;
  if (
    artifactContent === null &&
    artifact.s3_key &&
    isArtifactPayloadS3Key(artifact.tenant_id, artifact.s3_key)
  ) {
    artifactContent = await readArtifactPayloadFromS3({
      tenantId: artifact.tenant_id,
      key: artifact.s3_key,
    });
  }
  if (artifactContent === null) {
    return { ok: false, error: "document content is unavailable for delivery" };
  }

  // The share link is minted/reused as the automation's run-as user — the
  // identity whose finalize produced the document (share rows require a
  // creator). A missing run-as user is a configuration fault, not a silent
  // linkless email (R7: the share link is always included).
  const mintedBy = await resolveDeliveryActingUser(
    req.tenantId,
    req.workflowRunId,
  );
  if (!mintedBy) {
    return {
      ok: false,
      error:
        "the automation has no valid run-as user to mint the share link — set one and re-run",
    };
  }
  const { shareId } = await getOrCreateArtifactShare(db, {
    tenantId: req.tenantId,
    artifactId: req.artifactId,
    createdBy: mintedBy,
    artifactTitle: artifact.title,
  });
  const apiBaseUrl = (getConfig("THINKWORK_API_URL") ?? "").replace(/\/$/, "");
  if (!apiBaseUrl) {
    return { ok: false, error: "THINKWORK_API_URL is not configured" };
  }
  const shareUrl = `${apiBaseUrl}/share/${signShareToken(shareId)}`;

  const delivery = renderEmailDelivery(
    {
      id: artifact.id,
      title: artifact.title,
      type: artifact.type,
      status: artifact.status,
      content: artifactContent,
      summary: artifact.summary,
      metadata: artifact.metadata as Record<string, unknown> | null,
    },
    { shareUrl },
  );
  const subject = (req.subjectTemplate?.trim() || delivery.subject).slice(
    0,
    300,
  );
  assertNoHeaderInjection("subject", subject);

  // Resolve sender address from the agent's email channel config (same
  // from-address model as the API-gateway path).
  let fromAddress = DEFAULT_FROM_ADDRESS;
  if (artifact.agent_id) {
    const [cap] = await db
      .select()
      .from(agentCapabilities)
      .where(eq(agentCapabilities.agent_id, artifact.agent_id));
    if (cap?.config) {
      const config =
        typeof cap.config === "string" ? JSON.parse(cap.config) : cap.config;
      if (config?.vanityAddress) fromAddress = config.vanityAddress;
    }
  }
  assertNoHeaderInjection("from address", fromAddress);

  const ledgerMetadata = {
    idempotencyKey: req.idempotencyKey,
    workflowRunId: req.workflowRunId,
    artifactId: req.artifactId,
    shareId,
    source: "workflow_deliver_step",
  };
  await db.insert(emailLedgerEvents).values({
    tenant_id: req.tenantId,
    event_type: "send_attempted",
    subject,
    from_email: fromAddress,
    to_emails: recipients,
    metadata: ledgerMetadata,
  });

  try {
    const { SESClient, SendRawEmailCommand } =
      await import("@aws-sdk/client-ses");
    const ses = new SESClient({});
    const boundary = `----=_Part_${Date.now()}`;
    const rawEmail = [
      `From: Thinkwork <${fromAddress}>`,
      `To: ${recipients.join(", ")}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      delivery.textBody,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      delivery.htmlBody,
      ``,
      `--${boundary}--`,
    ].join("\r\n");

    const sesResponse = await ses.send(
      new SendRawEmailCommand({
        RawMessage: { Data: Buffer.from(rawEmail, "utf-8") },
      }),
    );

    await db.insert(emailLedgerEvents).values({
      tenant_id: req.tenantId,
      event_type: "send_succeeded",
      provider_message_id: sesResponse.MessageId ?? null,
      subject,
      from_email: fromAddress,
      to_emails: recipients,
      metadata: ledgerMetadata,
    });
    return { ok: true, delivery: "sent", recipients, subject, shareUrl };
  } catch (err) {
    const message = (err as Error).message?.slice(0, 500) ?? "SES send failed";
    // Honest failure (KTD8): the ledger records it and the caller surfaces it
    // as failed step evidence — never a silent success.
    await db.insert(emailLedgerEvents).values({
      tenant_id: req.tenantId,
      event_type: "send_failed",
      subject,
      from_email: fromAddress,
      to_emails: recipients,
      reason_code: "ses_send_failed",
      metadata: { ...ledgerMetadata, error: message },
    });
    return { ok: false, error: message };
  }
}

/** The workflow run's acting identity: run → workflow → source automation →
 * membership-relevant `run_as_user_id`. Null when the chain breaks. */
async function resolveDeliveryActingUser(
  tenantId: string,
  workflowRunId: string,
): Promise<string | null> {
  if (!workflowRunId) return null;
  const [row] = await db
    .select({ run_as_user_id: agentLoops.run_as_user_id })
    .from(workflowRuns)
    .innerJoin(workflows, eq(workflowRuns.workflow_id, workflows.id))
    .innerJoin(agentLoops, eq(workflows.source_agent_loop_id, agentLoops.id))
    .where(
      and(
        eq(workflowRuns.id, workflowRunId),
        eq(workflowRuns.tenant_id, tenantId),
      ),
    )
    .limit(1);
  return row?.run_as_user_id ?? null;
}
