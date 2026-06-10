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
import { StartExecutionCommand, SFNClient } from "@aws-sdk/client-sfn";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import {
  bootstrapCredentialLeases,
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
import {
  bootstrapCredentialLeasePublicMetadata,
  bootstrapCredentialLeaseSecretName,
  deleteBootstrapCredentialLeaseSecret,
  putBootstrapCredentialLeaseSecret,
  validateBootstrapCredentialLease,
  type BootstrapCredentialLeaseBody,
} from "../lib/bootstrap-credential-lease.js";

const SESSION_TOKEN_BYTES = 32;
const SESSION_TTL_DAYS = 14;
const CONTROLLER_CONTRACT = "thinkwork.deployment.controller.v1";
const CONTROLLER_SCHEMA_VERSION = 1;
const sfn = new SFNClient({});

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

type ControllerAction = "deploy" | "update" | "destroy" | "plan";

type ControllerSessionRow = {
  id: string;
  requested_action?: string | null;
  source?: string | null;
  customer_name?: string | null;
  environment_name?: string | null;
  aws_account_id?: string | null;
  aws_region?: string | null;
  availability_zones?: unknown;
  admin_name?: string | null;
  admin_email?: string | null;
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

    const leaseMatch = path.match(
      /^\/api\/deployment-sessions\/([0-9a-fA-F-]+)\/bootstrap-credential-lease$/,
    );
    if (leaseMatch && method === "POST") {
      return connectBootstrapCredentialLease(leaseMatch[1]!, event);
    }
    if (leaseMatch && method === "DELETE") {
      return revokeBootstrapCredentialLease(leaseMatch[1]!, event);
    }

    const authorityTransferMatch = path.match(
      /^\/api\/deployment-sessions\/([0-9a-fA-F-]+)\/authority-transfer$/,
    );
    if (authorityTransferMatch && method === "POST") {
      return completeAuthorityTransfer(authorityTransferMatch[1]!, event);
    }

    const startMatch = path.match(
      /^\/api\/deployment-sessions\/([0-9a-fA-F-]+)\/start$/,
    );
    if (startMatch && method === "POST") {
      return startDeployment(startMatch[1]!, event);
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

async function startDeployment(
  sessionId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const session = await loadSession(sessionId);
  if (!session) return notFound("Deployment session not found");
  if (!isAuthorizedSessionRequest(session, event)) {
    return forbidden("Deployment session token is invalid");
  }

  if (
    session.status === "teardown_requested" ||
    session.status === "destroyed"
  ) {
    return error("Deployment cannot start after teardown is requested", 409);
  }
  if (
    session.credentials_status !== "validated" &&
    session.credentials_status !== "transferred"
  ) {
    return error(
      "Bootstrap credential lease must be validated before deployment starts",
      409,
    );
  }

  const priorRun = deploymentRunConfig(session.session_config);
  if (priorRun.executionArn) {
    await appendSessionEvent({
      sessionId: session.id,
      eventType: "deployment_start_reused",
      stepKey: "foundation",
      message: "Deployment execution is already running for this session.",
      payload: {
        executionArn: priorRun.executionArn,
        stateMachineArn: priorRun.stateMachineArn,
      },
      idempotencyKey: "deployment_start_reused",
    });
    const events = await loadSessionEvents(session.id);
    return json({ session: toSessionPayload(session, events) });
  }

  const stateMachineArn = deploymentStateMachineArnForSession(session);
  const evidenceBucket = deploymentEvidenceBucket();
  if (!stateMachineArn) {
    const [updated] = await db
      .update(customerDeploymentSessions)
      .set({
        status: "runner_not_configured",
        current_step_key: "foundation",
        runner_mode: "step_functions",
        error_message: "Deployment state machine ARN is not configured.",
        session_config: {
          ...objectConfig(session.session_config),
          stateAuthority: "thinkwork-control-plane",
          runnerConfigured: false,
        },
        updated_at: new Date(),
      })
      .where(eq(customerDeploymentSessions.id, session.id))
      .returning();

    await appendSessionEvent({
      sessionId: session.id,
      eventType: "runner_not_configured",
      stepKey: "foundation",
      message:
        "Deployment runner is not configured yet. The session is saved and can be resumed after the platform release is updated.",
      payload: { requiredEnv: "THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN" },
      idempotencyKey: "runner_not_configured",
    });
    const events = await loadSessionEvents(session.id);
    return json({ session: toSessionPayload(updated ?? session, events) });
  }

  await db
    .update(customerDeploymentSessions)
    .set({
      status: "starting",
      current_step_key: "foundation",
      runner_mode: "step_functions",
      terraform_backend: {
        stateMachineArn,
        evidenceBucket,
      },
      error_message: null,
      updated_at: new Date(),
    })
    .where(eq(customerDeploymentSessions.id, session.id));

  await appendSessionEvent({
    sessionId: session.id,
    eventType: "deployment_start_requested",
    stepKey: "foundation",
    message: "Standard deployment runbook requested.",
    payload: {
      stateMachineArn,
      evidenceBucket,
    },
    idempotencyKey: "deployment_start_requested",
  });

  try {
    const controllerInput = buildControllerInput(
      session,
      "deploy",
      evidenceBucket,
    );
    const response = await sfn.send(
      new StartExecutionCommand({
        stateMachineArn,
        name: deploymentExecutionName(session.id),
        input: JSON.stringify(controllerInput),
      }),
    );
    const executionArn = response.executionArn ?? null;
    const [updated] = await db
      .update(customerDeploymentSessions)
      .set({
        status: "deploying",
        current_step_key: "foundation",
        session_config: {
          ...objectConfig(session.session_config),
          stateAuthority: "thinkwork-control-plane",
          runnerConfigured: true,
          deploymentRun: {
            executionArn,
            stateMachineArn,
            evidenceBucket,
            evidencePrefix: controllerInput.evidence.prefix,
            contract: CONTROLLER_CONTRACT,
            release: controllerInput.release,
            startedAt: new Date().toISOString(),
          },
        },
        updated_at: new Date(),
      })
      .where(eq(customerDeploymentSessions.id, session.id))
      .returning();

    await appendSessionEvent({
      sessionId: session.id,
      eventType: "deployment_execution_started",
      stepKey: "foundation",
      message: "Deployment execution started.",
      payload: controllerRunEventPayload(
        controllerInput,
        executionArn,
        stateMachineArn,
      ),
      idempotencyKey: "deployment_execution_started",
    });
    const events = await loadSessionEvents(session.id);
    return json({ session: toSessionPayload(updated ?? session, events) });
  } catch (err) {
    const [failed] = await db
      .update(customerDeploymentSessions)
      .set({
        status: "failed",
        error_message: (err as Error).message,
        updated_at: new Date(),
      })
      .where(eq(customerDeploymentSessions.id, session.id))
      .returning();
    await appendSessionEvent({
      sessionId: session.id,
      eventType: "deployment_execution_failed",
      stepKey: "foundation",
      message: (err as Error).message,
      payload: { stateMachineArn },
      idempotencyKey: "deployment_execution_failed",
    });
    const events = await loadSessionEvents(session.id);
    return json({ session: toSessionPayload(failed ?? session, events) });
  }
}

async function connectBootstrapCredentialLease(
  sessionId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const session = await loadSession(sessionId);
  if (!session) return notFound("Deployment session not found");
  if (!isAuthorizedSessionRequest(session, event)) {
    return forbidden("Deployment session token is invalid");
  }
  if (
    session.status === "teardown_requested" ||
    session.status === "destroyed"
  ) {
    return error(
      "Bootstrap credentials cannot be connected after teardown",
      409,
    );
  }

  let lease;
  try {
    lease = validateBootstrapCredentialLease(
      parseBody(event) as BootstrapCredentialLeaseBody,
    );
  } catch (err) {
    await appendSessionEvent({
      sessionId: session.id,
      eventType: "bootstrap_credential_lease_rejected",
      stepKey: "connect_aws",
      message: (err as Error).message,
      payload: { credentialMaterialPersisted: false },
      idempotencyKey: `bootstrap_credential_lease_rejected:${Date.now()}`,
    });
    return error((err as Error).message, 400);
  }

  const leaseId = randomUUID();
  const secretName = bootstrapCredentialLeaseSecretName({
    sessionId: session.id,
    leaseId,
  });
  let secretArn: string;
  try {
    secretArn = await putBootstrapCredentialLeaseSecret({
      secretName,
      payload: lease.secretPayload,
      sessionId: session.id,
      leaseId,
      leaseType: lease.leaseType,
      expiresAt: lease.expiresAt,
    });
  } catch (err) {
    await appendSessionEvent({
      sessionId: session.id,
      eventType: "bootstrap_credential_lease_failed",
      stepKey: "connect_aws",
      message:
        "Bootstrap credential lease could not be stored in the server-side vault.",
      payload: {
        credentialMaterialPersisted: false,
        errorName: errorName(err),
      },
      idempotencyKey: `bootstrap_credential_lease_failed:${Date.now()}`,
    });
    return error("Bootstrap credential lease could not be stored", 502);
  }

  const now = new Date();
  await db.insert(bootstrapCredentialLeases).values({
    id: leaseId,
    session_id: session.id,
    status: "validated",
    lease_type: lease.leaseType,
    secret_arn: secretArn,
    secret_fingerprint: lease.secretFingerprint,
    external_id_hash: lease.externalIdHash,
    role_arn: lease.roleArn,
    expires_at: lease.expiresAt,
    validated_at: now,
    audit_metadata: lease.auditMetadata,
  });

  const publicLease = {
    id: leaseId,
    status: "validated",
    ...bootstrapCredentialLeasePublicMetadata(lease),
  };
  const [updated] = await db
    .update(customerDeploymentSessions)
    .set({
      status: "ready_to_deploy",
      current_step_key: "foundation",
      credentials_status: "validated",
      session_config: {
        ...objectConfig(session.session_config),
        bootstrapCredentialLease: publicLease,
      },
      updated_at: now,
    })
    .where(eq(customerDeploymentSessions.id, session.id))
    .returning();

  await appendSessionEvent({
    sessionId: session.id,
    eventType: "bootstrap_credential_lease_validated",
    stepKey: "connect_aws",
    message:
      "Bootstrap credential lease validated and stored in the server-side vault.",
    payload: publicLease,
    idempotencyKey: "bootstrap_credential_lease_validated",
  });

  const events = await loadSessionEvents(session.id);
  return json({ session: toSessionPayload(updated ?? session, events) });
}

async function revokeBootstrapCredentialLease(
  sessionId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const session = await loadSession(sessionId);
  if (!session) return notFound("Deployment session not found");
  if (!isAuthorizedSessionRequest(session, event)) {
    return forbidden("Deployment session token is invalid");
  }

  const lease = await loadLatestBootstrapCredentialLease(session.id);
  if (!lease) {
    const events = await loadSessionEvents(session.id);
    return json({ session: toSessionPayload(session, events) });
  }

  const now = new Date();
  try {
    await deleteBootstrapCredentialLeaseSecret({
      secretRef: String(lease.secret_arn),
    });
    await db
      .update(bootstrapCredentialLeases)
      .set({
        status: "revoked",
        revoked_at: now,
        updated_at: now,
      })
      .where(eq(bootstrapCredentialLeases.id, lease.id as string));

    const [updated] = await db
      .update(customerDeploymentSessions)
      .set({
        credentials_status: "revoked",
        current_step_key: "connect_aws",
        session_config: {
          ...objectConfig(session.session_config),
          bootstrapCredentialLease: {
            id: lease.id,
            status: "revoked",
            secretFingerprint: lease.secret_fingerprint,
            credentialMaterialPersisted: false,
          },
        },
        updated_at: now,
      })
      .where(eq(customerDeploymentSessions.id, session.id))
      .returning();

    await appendSessionEvent({
      sessionId: session.id,
      eventType: "bootstrap_credential_lease_revoked",
      stepKey: "connect_aws",
      message: "Bootstrap credential lease revoked and deleted from the vault.",
      payload: {
        leaseId: lease.id,
        secretFingerprint: lease.secret_fingerprint,
        credentialMaterialPersisted: false,
      },
      idempotencyKey: "bootstrap_credential_lease_revoked",
    });
    const events = await loadSessionEvents(session.id);
    return json({ session: toSessionPayload(updated ?? session, events) });
  } catch (err) {
    await db
      .update(bootstrapCredentialLeases)
      .set({
        status: "failed_cleanup",
        failed_cleanup_reason: (err as Error).message,
        updated_at: now,
      })
      .where(eq(bootstrapCredentialLeases.id, lease.id as string));

    await appendSessionEvent({
      sessionId: session.id,
      eventType: "bootstrap_credential_lease_cleanup_failed",
      stepKey: "connect_aws",
      message: "Bootstrap credential lease cleanup failed.",
      payload: {
        leaseId: lease.id,
        errorName: errorName(err),
        credentialMaterialPersisted: false,
      },
      idempotencyKey: "bootstrap_credential_lease_cleanup_failed",
    });
    const events = await loadSessionEvents(session.id);
    return json({ session: toSessionPayload(session, events) }, 500);
  }
}

async function completeAuthorityTransfer(
  sessionId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const session = await loadSession(sessionId);
  if (!session) return notFound("Deployment session not found");
  if (!isAuthorizedSessionRequest(session, event)) {
    return forbidden("Deployment session token is invalid");
  }

  const proof = authorityTransferProof(parseBody(event));
  if ("error" in proof) return error(proof.error, 400);

  const lease = await loadLatestBootstrapCredentialLease(session.id);
  if (!lease) {
    return error(
      "Bootstrap credential lease is required before authority transfer",
      409,
    );
  }

  const now = new Date();
  try {
    await deleteBootstrapCredentialLeaseSecret({
      secretRef: String(lease.secret_arn),
    });
  } catch (err) {
    await db
      .update(bootstrapCredentialLeases)
      .set({
        status: "failed_cleanup",
        failed_cleanup_reason: (err as Error).message,
        updated_at: now,
      })
      .where(eq(bootstrapCredentialLeases.id, lease.id as string));

    const [failed] = await db
      .update(customerDeploymentSessions)
      .set({
        status: "authority_transfer_failed",
        error_message:
          "Bootstrap credential lease cleanup failed after authority transfer.",
        updated_at: now,
      })
      .where(eq(customerDeploymentSessions.id, session.id))
      .returning();

    await appendSessionEvent({
      sessionId: session.id,
      eventType: "authority_transfer_cleanup_failed",
      stepKey: "authority_transfer",
      message:
        "Customer controller proof was received, but the bootstrap credential lease could not be deleted.",
      payload: {
        leaseId: lease.id,
        controller: proof.controller,
        errorName: errorName(err),
        credentialMaterialPersisted: false,
      },
      idempotencyKey: "authority_transfer_cleanup_failed",
    });
    const events = await loadSessionEvents(session.id);
    return json({ session: toSessionPayload(failed ?? session, events) }, 500);
  }

  await db
    .update(bootstrapCredentialLeases)
    .set({
      status: "transferred",
      transferred_at: now,
      revoked_at: now,
      updated_at: now,
    })
    .where(eq(bootstrapCredentialLeases.id, lease.id as string));

  const [updated] = await db
    .update(customerDeploymentSessions)
    .set({
      status: "authority_transferred",
      current_step_key: "first_admin",
      credentials_status: "transferred",
      runner_mode: "customer_controller",
      session_config: {
        ...objectConfig(session.session_config),
        authorityTransfer: {
          transferredAt: now.toISOString(),
          controller: proof.controller,
          release: proof.release,
          profile: proof.profile,
          bootstrapCredentialLease: {
            id: lease.id,
            status: "transferred",
            secretFingerprint: lease.secret_fingerprint,
            credentialMaterialPersisted: false,
          },
        },
      },
      updated_at: now,
    })
    .where(eq(customerDeploymentSessions.id, session.id))
    .returning();

  await appendSessionEvent({
    sessionId: session.id,
    eventType: "authority_transferred",
    stepKey: "authority_transfer",
    message:
      "Customer AWS controller owns future deployment operations. Bootstrap credential lease deleted.",
    payload: {
      controller: proof.controller,
      release: proof.release,
      leaseId: lease.id,
      credentialMaterialPersisted: false,
    },
    idempotencyKey: "authority_transferred",
  });

  const events = await loadSessionEvents(session.id);
  return json({ session: toSessionPayload(updated ?? session, events) });
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

  const stateMachineArn = deploymentStateMachineArnForSession(session);
  const priorTeardown = teardownRunConfig(session.session_config);
  if (!terminal && stateMachineArn && !priorTeardown.executionArn) {
    try {
      const controllerInput = buildControllerInput(
        session,
        "destroy",
        deploymentEvidenceBucket(),
      );
      const response = await sfn.send(
        new StartExecutionCommand({
          stateMachineArn,
          name: teardownExecutionName(session.id),
          input: JSON.stringify(controllerInput),
        }),
      );
      const executionArn = response.executionArn ?? null;
      const [destroying] = await db
        .update(customerDeploymentSessions)
        .set({
          status: "destroying",
          runner_mode: "step_functions",
          session_config: {
            ...objectConfig(session.session_config),
            teardownRun: {
              executionArn,
              stateMachineArn,
              evidenceBucket: controllerInput.evidence.bucket,
              evidencePrefix: controllerInput.evidence.prefix,
              contract: CONTROLLER_CONTRACT,
              release: controllerInput.release,
              startedAt: new Date().toISOString(),
            },
          },
          updated_at: new Date(),
        })
        .where(eq(customerDeploymentSessions.id, session.id))
        .returning();

      await appendSessionEvent({
        sessionId: session.id,
        eventType: "teardown_execution_started",
        stepKey: "teardown",
        message: "Teardown execution started.",
        payload: controllerRunEventPayload(
          controllerInput,
          executionArn,
          stateMachineArn,
        ),
        idempotencyKey: "teardown_execution_started",
      });
      const events = await loadSessionEvents(session.id);
      return json({
        session: toSessionPayload(destroying ?? updated ?? session, events),
      });
    } catch (err) {
      const [failed] = await db
        .update(customerDeploymentSessions)
        .set({
          status: "teardown_failed",
          error_message: (err as Error).message,
          updated_at: new Date(),
        })
        .where(eq(customerDeploymentSessions.id, session.id))
        .returning();
      await appendSessionEvent({
        sessionId: session.id,
        eventType: "teardown_execution_failed",
        stepKey: "teardown",
        message: (err as Error).message,
        payload: { stateMachineArn },
        idempotencyKey: "teardown_execution_failed",
      });
      const events = await loadSessionEvents(session.id);
      return json({
        session: toSessionPayload(failed ?? updated ?? session, events),
      });
    }
  }

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

async function loadLatestBootstrapCredentialLease(sessionId: string) {
  const [lease] = await db
    .select()
    .from(bootstrapCredentialLeases)
    .where(eq(bootstrapCredentialLeases.session_id, sessionId))
    .orderBy(desc(bootstrapCredentialLeases.created_at))
    .limit(1);
  return lease ?? null;
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

function deploymentStateMachineArn(): string | null {
  return (
    process.env.THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN ||
    process.env.DEPLOYMENT_STATE_MACHINE_ARN ||
    null
  );
}

function deploymentStateMachineArnForSession(session: {
  session_config?: unknown;
}): string | null {
  const transfer = objectConfig(
    objectConfig(session.session_config).authorityTransfer,
  );
  const controller = objectConfig(transfer.controller);
  return (
    stringField(controller, "stateMachineArn") || deploymentStateMachineArn()
  );
}

function deploymentEvidenceBucket(): string | null {
  return (
    process.env.THINKWORK_DEPLOYMENT_EVIDENCE_BUCKET ||
    process.env.DEPLOYMENT_EVIDENCE_BUCKET ||
    null
  );
}

function releaseVersionToTerraformModuleVersion(version: string): string {
  return version.replace(/^v/, "");
}

function buildControllerInput(
  session: ControllerSessionRow,
  action: ControllerAction,
  evidenceBucket: string | null,
) {
  const release = deploymentReleaseSelection();
  const evidencePrefix = `sessions/${session.id}/${action}`;
  const phase = action === "destroy" ? "teardown" : action;

  return {
    schemaVersion: CONTROLLER_SCHEMA_VERSION,
    contract: CONTROLLER_CONTRACT,
    phase,
    action,
    sessionId: session.id,
    customerName: session.customer_name,
    environmentName: session.environment_name,
    awsAccountId: session.aws_account_id,
    awsRegion: session.aws_region,
    availabilityZones: session.availability_zones,
    firstAdmin: {
      name: session.admin_name,
      email: session.admin_email,
    },
    source: session.source,
    evidenceBucket,
    evidence: {
      bucket: evidenceBucket,
      prefix: evidencePrefix,
      expectedArtifacts: expectedEvidenceArtifacts(action),
    },
    releaseVersion: release.version,
    releaseManifestUrl: release.manifestUrl,
    releaseManifestSha256: release.manifestSha256,
    terraformModuleVersion: releaseVersionToTerraformModuleVersion(
      release.version,
    ),
    release,
    session: {
      id: session.id,
      source: session.source,
      requestedAction: session.requested_action,
    },
    operation: {
      kind: "foundation",
      action,
      plan: true,
      apply: action !== "plan",
      destroy: action === "destroy",
    },
    features: {
      baseInstall: {
        cognee: false,
        slack: false,
        stripe: false,
        twenty: false,
      },
      optionalApps: [],
    },
    terraform: {
      stateRecovery:
        action === "destroy"
          ? {
              mode: "state-or-tags",
              recoverByTags: true,
            }
          : {
              mode: "state",
              recoverByTags: false,
            },
    },
  };
}

function deploymentReleaseSelection() {
  return {
    version: process.env.THINKWORK_RELEASE_VERSION || "unresolved",
    manifestUrl: process.env.THINKWORK_RELEASE_MANIFEST_URL || "",
    manifestSha256: process.env.THINKWORK_RELEASE_MANIFEST_SHA256 || "",
  };
}

function expectedEvidenceArtifacts(action: ControllerAction): string[] {
  const base = [
    "controller-input-summary.json",
    "redacted-terraform-vars.json",
    "terraform-plan.json",
    "deployment-evidence.json",
  ];
  if (action !== "plan" && action !== "destroy") {
    base.splice(3, 0, "terraform-outputs.json");
  }
  return base;
}

function controllerRunEventPayload(
  controllerInput: ReturnType<typeof buildControllerInput>,
  executionArn: string | null,
  stateMachineArn: string,
) {
  return {
    executionArn,
    stateMachineArn,
    contract: controllerInput.contract,
    schemaVersion: controllerInput.schemaVersion,
    action: controllerInput.action,
    evidence: controllerInput.evidence,
    release: controllerInput.release,
    features: controllerInput.features,
  };
}

function deploymentExecutionName(sessionId: string): string {
  return `tw-session-${sessionId.replace(/-/g, "").slice(0, 48)}`;
}

function teardownExecutionName(sessionId: string): string {
  return `tw-teardown-${sessionId.replace(/-/g, "").slice(0, 46)}`;
}

function errorName(err: unknown): string {
  return err && typeof err === "object" && "name" in err
    ? String((err as { name?: unknown }).name)
    : "Error";
}

function authorityTransferProof(body: unknown):
  | {
      controller: Record<string, unknown>;
      profile: Record<string, unknown>;
      release: Record<string, unknown>;
    }
  | { error: string } {
  const payload = objectConfig(body);
  const profile = objectConfig(payload.profile);
  const controller = objectConfig(payload.controller || profile.controller);
  const release = objectConfig(payload.release);
  const controllerArn = stringField(controller, "stateMachineArn");
  const profileApi =
    stringField(profile, "apiEndpoint") || stringField(profile, "apiUrl");
  const cognitoUserPoolId = stringField(profile, "cognitoUserPoolId");
  if (!controllerArn) {
    return { error: "Customer controller stateMachineArn is required" };
  }
  if (!profileApi || !cognitoUserPoolId) {
    return {
      error: "Customer deployment profile is missing required runtime fields",
    };
  }
  return {
    controller,
    profile,
    release: {
      version:
        stringField(release, "version") ||
        stringField(profile, "releaseVersion"),
      manifestUrl:
        stringField(release, "manifestUrl") ||
        stringField(profile, "releaseManifestUrl"),
      manifestSha256:
        stringField(release, "manifestSha256") ||
        stringField(profile, "releaseManifestSha256"),
    },
  };
}

function stringField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

function objectConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function deploymentRunConfig(value: unknown): {
  executionArn?: string;
  stateMachineArn?: string;
} {
  const config = objectConfig(value);
  const deploymentRun = objectConfig(config.deploymentRun);
  return {
    executionArn:
      typeof deploymentRun.executionArn === "string"
        ? deploymentRun.executionArn
        : undefined,
    stateMachineArn:
      typeof deploymentRun.stateMachineArn === "string"
        ? deploymentRun.stateMachineArn
        : undefined,
  };
}

function teardownRunConfig(value: unknown): {
  executionArn?: string;
  stateMachineArn?: string;
} {
  const config = objectConfig(value);
  const teardownRun = objectConfig(config.teardownRun);
  return {
    executionArn:
      typeof teardownRun.executionArn === "string"
        ? teardownRun.executionArn
        : undefined,
    stateMachineArn:
      typeof teardownRun.stateMachineArn === "string"
        ? teardownRun.stateMachineArn
        : undefined,
  };
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
