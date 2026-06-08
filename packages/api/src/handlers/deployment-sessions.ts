/**
 * Browser-first deployment session lifecycle.
 *
 * Public by design, but possession-gated after creation: the browser receives
 * a one-time client token and must present it to read or request teardown.
 * The persisted session stores install state only, never AWS secret keys or
 * first-admin passwords.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import {
  customerDeploymentSessionEvents,
  customerDeploymentSessions,
} from "@thinkwork/database-pg/schema";
import { db } from "../lib/db.js";
import {
  handleCors,
  json,
  error,
  notFound,
  forbidden,
} from "../lib/response.js";

const SESSION_TOKEN_BYTES = 32;
const SESSION_TTL_DAYS = 14;

type CreateSessionBody = {
  customerName?: unknown;
  environmentName?: unknown;
  awsAccountId?: unknown;
  awsRegion?: unknown;
  availabilityZones?: unknown;
  adminName?: unknown;
  adminEmail?: unknown;
  source?: unknown;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AWS_ACCOUNT_ID_RE = /^\d{12}$/;
const AWS_REGION_RE = /^[a-z]{2}-[a-z]+-\d$/;

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  try {
    if (path === "/api/deployment-sessions" && method === "POST") {
      return createSession(event);
    }

    const sessionMatch = path.match(
      /^\/api\/deployment-sessions\/([0-9a-fA-F-]+)$/,
    );
    if (sessionMatch && method === "GET") {
      return readSession(sessionMatch[1]!, event);
    }

    const teardownMatch = path.match(
      /^\/api\/deployment-sessions\/([0-9a-fA-F-]+)\/teardown$/,
    );
    if (teardownMatch && method === "POST") {
      return requestTeardown(teardownMatch[1]!, event);
    }

    return notFound("Deployment session route not found");
  } catch (err) {
    console.error("[deployment-sessions] handler error:", err);
    return error("Internal server error", 500);
  }
}

async function createSession(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const body = parseBody(event) as CreateSessionBody;
  const input = validateCreateSessionBody(body);
  if ("error" in input) return error(input.error);

  const clientToken = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  const clientTokenHash = hashToken(clientToken);
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  const [session] = await db
    .insert(customerDeploymentSessions)
    .values({
      status: "ready_for_credentials",
      current_step_key: "connect_aws",
      requested_action: "deploy",
      client_token_hash: clientTokenHash,
      source: input.source,
      customer_name: input.customerName,
      environment_name: input.environmentName,
      aws_account_id: input.awsAccountId,
      aws_region: input.awsRegion,
      availability_zones: input.availabilityZones,
      admin_name: input.adminName,
      admin_email: input.adminEmail,
      credentials_status: "not_connected",
      runner_mode: "hosted",
      session_config: {
        stateAuthority: "thinkwork-control-plane",
        passwordPersisted: false,
      },
      expires_at: expiresAt,
    })
    .returning();

  if (!session) return error("Failed to create deployment session", 500);

  await appendSessionEvent({
    sessionId: session.id,
    eventType: "session_created",
    stepKey: "intake",
    message: "Deployment session created in the ThinkWork control plane.",
    payload: {
      stateAuthority: "thinkwork-control-plane",
      credentialsPersisted: false,
      passwordPersisted: false,
    },
    idempotencyKey: "session_created",
  });

  const events = await loadSessionEvents(session.id);
  return json(
    {
      session: toSessionPayload(session, events),
      clientToken,
    },
    201,
  );
}

async function readSession(
  sessionId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const session = await loadSession(sessionId);
  if (!session) return notFound("Deployment session not found");
  if (!isAuthorizedSessionRequest(session, event)) {
    return forbidden("Deployment session token is invalid");
  }
  const events = await loadSessionEvents(session.id);
  return json({ session: toSessionPayload(session, events) });
}

async function requestTeardown(
  sessionId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const session = await loadSession(sessionId);
  if (!session) return notFound("Deployment session not found");
  if (!isAuthorizedSessionRequest(session, event)) {
    return forbidden("Deployment session token is invalid");
  }

  const terminal = session.status === "destroyed";
  const [updated] = terminal
    ? [session]
    : await db
        .update(customerDeploymentSessions)
        .set({
          requested_action: "teardown",
          status: "teardown_requested",
          current_step_key: "teardown",
          updated_at: new Date(),
        })
        .where(eq(customerDeploymentSessions.id, session.id))
        .returning();

  await appendSessionEvent({
    sessionId: session.id,
    eventType: terminal ? "teardown_already_complete" : "teardown_requested",
    stepKey: "teardown",
    message: terminal
      ? "Deployment session is already destroyed."
      : "Teardown requested. The runner will destroy tagged resources and recorded Terraform state.",
    payload: {
      requestedAction: "teardown",
      recoverByTags: true,
    },
    idempotencyKey: terminal
      ? "teardown_already_complete"
      : `teardown_requested:${session.requested_action}`,
  });

  const events = await loadSessionEvents(session.id);
  return json({ session: toSessionPayload(updated ?? session, events) });
}

async function loadSession(sessionId: string) {
  const [session] = await db
    .select()
    .from(customerDeploymentSessions)
    .where(eq(customerDeploymentSessions.id, sessionId))
    .limit(1);
  return session ?? null;
}

async function loadSessionEvents(sessionId: string) {
  return db
    .select()
    .from(customerDeploymentSessionEvents)
    .where(eq(customerDeploymentSessionEvents.session_id, sessionId))
    .orderBy(asc(customerDeploymentSessionEvents.created_at));
}

async function appendSessionEvent(args: {
  sessionId: string;
  eventType: string;
  stepKey: string;
  message: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
}) {
  const insert = db.insert(customerDeploymentSessionEvents).values({
    session_id: args.sessionId,
    event_type: args.eventType,
    step_key: args.stepKey,
    message: args.message,
    payload: args.payload ?? {},
    idempotency_key: args.idempotencyKey,
  });
  if (args.idempotencyKey) {
    await insert.onConflictDoNothing();
    return;
  }
  await insert;
}

function parseBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function validateCreateSessionBody(body: CreateSessionBody):
  | {
      customerName: string;
      environmentName: string;
      awsAccountId: string;
      awsRegion: string;
      availabilityZones: string[];
      adminName: string;
      adminEmail: string;
      source: string;
    }
  | { error: string } {
  const customerName = cleanText(body.customerName);
  const environmentName = cleanText(body.environmentName);
  const awsAccountId = cleanText(body.awsAccountId);
  const awsRegion = cleanText(body.awsRegion).toLowerCase();
  const adminName = cleanText(body.adminName);
  const adminEmail = cleanText(body.adminEmail).toLowerCase();
  const source = cleanText(body.source) || "browser";
  const availabilityZones = normalizeAvailabilityZones(body.availabilityZones);

  if (!customerName) return { error: "Customer name is required" };
  if (!environmentName) return { error: "Environment name is required" };
  if (!AWS_ACCOUNT_ID_RE.test(awsAccountId)) {
    return { error: "AWS account ID must be 12 digits" };
  }
  if (!AWS_REGION_RE.test(awsRegion)) {
    return { error: "AWS region is required" };
  }
  if (availabilityZones.length < 2) {
    return { error: "At least two availability zones are required" };
  }
  if (!adminName) return { error: "First admin name is required" };
  if (!EMAIL_RE.test(adminEmail)) {
    return { error: "A valid first admin email is required" };
  }
  if (!["browser", "local_dev"].includes(source)) {
    return { error: "Unknown deployment session source" };
  }

  return {
    customerName,
    environmentName,
    awsAccountId,
    awsRegion,
    availabilityZones,
    adminName,
    adminEmail,
    source,
  };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 240) : "";
}

function normalizeAvailabilityZones(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s]+/)
      : [];
  return [
    ...new Set(
      raw
        .map((zone) => cleanText(zone).toLowerCase())
        .filter((zone) => /^[a-z]{2}-[a-z]+-\d[a-z]$/.test(zone)),
    ),
  ].slice(0, 6);
}

function isAuthorizedSessionRequest(
  session: { client_token_hash: string },
  event: APIGatewayProxyEventV2,
): boolean {
  const supplied =
    event.headers["x-thinkwork-deployment-token"] ||
    event.headers["X-ThinkWork-Deployment-Token"] ||
    bearerToken(event.headers.authorization || event.headers.Authorization);
  if (!supplied) return false;
  return constantTimeEquals(hashToken(supplied), session.client_token_hash);
}

function bearerToken(value: string | undefined): string | null {
  if (!value) return null;
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function toSessionPayload(
  session: Record<string, unknown>,
  events: Array<Record<string, unknown>>,
) {
  return {
    id: session.id,
    status: session.status,
    currentStepKey: session.current_step_key,
    requestedAction: session.requested_action,
    source: session.source,
    customerName: session.customer_name,
    environmentName: session.environment_name,
    awsAccountId: session.aws_account_id,
    awsRegion: session.aws_region,
    availabilityZones: session.availability_zones,
    adminName: session.admin_name,
    adminEmail: session.admin_email,
    credentialsStatus: session.credentials_status,
    runnerMode: session.runner_mode,
    terraformBackend: session.terraform_backend,
    sessionConfig: session.session_config,
    errorMessage: session.error_message,
    expiresAt: session.expires_at,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    events: events.map((event) => ({
      id: event.id,
      eventType: event.event_type,
      stepKey: event.step_key,
      message: event.message,
      payload: event.payload,
      createdAt: event.created_at,
    })),
  };
}
