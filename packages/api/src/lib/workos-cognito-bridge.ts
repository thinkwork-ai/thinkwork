import {
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { and, eq, gt, sql } from "drizzle-orm";
import { randomBytes, createHash } from "node:crypto";
import { getApiAuthSecret, getConfig } from "@thinkwork/runtime-config";
import { users, workosAuthBridges } from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "./db.js";
import { digestBridgeCode } from "./workos-auth.js";
import { recordWorkosAuthSession } from "./workos-auth-session.js";
import { signObject, verifyObject } from "./mcp-oauth/state.js";

type DbLike = typeof defaultDb;

const CHALLENGE_TTL_SECONDS = 5 * 60;
export const WORKOS_BRIDGE_CHALLENGE_METADATA_KEY = "workos_bridge_challenge";

export interface WorkosBridgeRecord {
  id: string;
  tenantId: string;
  tenantReferenceId: string;
  authProviderResourceId: string;
  workosUserId: string;
  workosSessionId: string;
  workosSessionExpiresAt: Date | null;
  workosEmail: string;
  workosEmailVerified: boolean;
  returnTo: string;
}

export interface WorkosBridgeUser {
  id: string;
  tenantId: string;
  email: string;
  name: string | null;
}

export interface CognitoTokenSet {
  id_token: string;
  access_token: string;
  refresh_token: string;
}

export interface WorkosCognitoChallengePayload extends Record<string, unknown> {
  kind: "workos_cognito_custom_auth";
  bridgeCodeDigest: string;
  userId: string;
  tenantId: string;
  email: string;
  workosUserId: string;
  workosSessionId: string;
  answerDigest: string;
}

export interface WorkosCognitoBridgeDeps {
  consumePendingBridge(args: {
    bridgeCodeDigest: string;
    now: Date;
  }): Promise<WorkosBridgeRecord | null>;
  resolveBridgeUser(bridge: WorkosBridgeRecord): Promise<WorkosBridgeUser | null>;
  startCognitoCustomAuth(args: {
    username: string;
    signedChallenge: string;
    answer: string;
  }): Promise<CognitoTokenSet>;
  recordWorkosSession(args: WorkosAuthSessionInput): Promise<void>;
  signingSecret(): string;
  now(): Date;
  randomToken(bytes?: number): string;
}

export interface WorkosAuthSessionInput {
  tenantId: string;
  userId: string;
  tenantReferenceId: string;
  authProviderResourceId: string;
  cognitoPrincipalId: string;
  cognitoUsername: string;
  workosUserId: string;
  workosSessionId: string;
  workosEmail: string;
  expiresAt: Date | null;
}

export function createDefaultWorkosCognitoBridgeDeps(
  db: DbLike = defaultDb,
  cognito = new CognitoIdentityProviderClient({}),
): WorkosCognitoBridgeDeps {
  return {
    consumePendingBridge: (args) => consumePendingBridge(args, db),
    resolveBridgeUser: (bridge) => resolveBridgeUser(bridge, db),
    startCognitoCustomAuth: (args) => startCognitoCustomAuth(args, cognito),
    recordWorkosSession: (args) => recordWorkosAuthSession(args, db),
    signingSecret: () => getApiAuthSecret(),
    now: () => new Date(),
    randomToken: (bytes = 32) => randomBytes(bytes).toString("base64url"),
  };
}

export async function exchangeWorkosBridgeForCognitoTokens(args: {
  bridgeCode?: string;
  deps?: WorkosCognitoBridgeDeps;
}): Promise<CognitoTokenSet> {
  const deps = args.deps ?? createDefaultWorkosCognitoBridgeDeps();
  const bridgeCode = args.bridgeCode?.trim();
  if (!bridgeCode) throw new WorkosBridgeError("bridge code missing", 400);

  const bridgeCodeDigest = digestBridgeCode(bridgeCode);
  const bridge = await deps.consumePendingBridge({
    bridgeCodeDigest,
    now: deps.now(),
  });
  if (!bridge) {
    throw new WorkosBridgeError("bridge code is invalid or expired", 400);
  }
  if (!bridge.workosEmailVerified) {
    throw new WorkosBridgeError("WorkOS email is not verified", 403);
  }

  const user = await deps.resolveBridgeUser(bridge);
  if (!user || user.tenantId !== bridge.tenantId) {
    throw new WorkosBridgeError("WorkOS user is not assigned to this tenant", 403);
  }
  if (user.email.toLowerCase() !== bridge.workosEmail.toLowerCase()) {
    throw new WorkosBridgeError("WorkOS user email mismatch", 403);
  }

  const answer = deps.randomToken(32);
  const signedChallenge = signWorkosCognitoChallenge(
    {
      kind: "workos_cognito_custom_auth",
      bridgeCodeDigest,
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email.toLowerCase(),
      workosUserId: bridge.workosUserId,
      workosSessionId: bridge.workosSessionId,
      answerDigest: digestAnswer(answer),
    },
    deps.signingSecret(),
  );

  const tokens = await deps.startCognitoCustomAuth({
    username: user.email,
    signedChallenge,
    answer,
  });
  const cognitoClaims = parseCognitoBridgeTokenClaims(tokens.id_token);
  await deps.recordWorkosSession({
    tenantId: user.tenantId,
    userId: user.id,
    tenantReferenceId: bridge.tenantReferenceId,
    authProviderResourceId: bridge.authProviderResourceId,
    cognitoPrincipalId: cognitoClaims.sub,
    cognitoUsername: cognitoClaims.username,
    workosUserId: bridge.workosUserId,
    workosSessionId: bridge.workosSessionId,
    workosEmail: bridge.workosEmail.toLowerCase(),
    expiresAt: bridge.workosSessionExpiresAt ?? cognitoClaims.expiresAt,
  });
  return tokens;
}

export function signWorkosCognitoChallenge(
  payload: WorkosCognitoChallengePayload,
  secret: string,
): string {
  return signObject(payload, secret, CHALLENGE_TTL_SECONDS);
}

export function verifyWorkosCognitoChallenge(
  token: string,
  secret: string,
): WorkosCognitoChallengePayload {
  const payload = verifyObject<WorkosCognitoChallengePayload>(token, secret);
  if (payload.kind !== "workos_cognito_custom_auth") {
    throw new WorkosBridgeError("invalid challenge kind", 400);
  }
  for (const key of [
    "bridgeCodeDigest",
    "userId",
    "tenantId",
    "email",
    "workosUserId",
    "workosSessionId",
    "answerDigest",
  ] as const) {
    if (typeof payload[key] !== "string" || !payload[key]) {
      throw new WorkosBridgeError("invalid challenge payload", 400);
    }
  }
  return payload;
}

export function handleCognitoCustomAuthChallenge(
  event: CognitoCustomAuthEvent,
  secret = getApiAuthSecret(),
): CognitoCustomAuthEvent {
  switch (event.triggerSource) {
    case "DefineAuthChallenge_Authentication":
      return defineAuthChallenge(event);
    case "CreateAuthChallenge_Authentication":
      return createAuthChallenge(event, secret);
    case "VerifyAuthChallengeResponse_Authentication":
      return verifyAuthChallenge(event, secret);
    default:
      return event;
  }
}

export interface CognitoCustomAuthEvent {
  triggerSource: string;
  request: {
    session?: Array<{
      challengeName?: string;
      challengeResult?: boolean;
    }>;
    clientMetadata?: Record<string, string>;
    privateChallengeParameters?: Record<string, string>;
    challengeAnswer?: string;
  };
  response: {
    challengeName?: string;
    issueTokens?: boolean;
    failAuthentication?: boolean;
    publicChallengeParameters?: Record<string, string>;
    privateChallengeParameters?: Record<string, string>;
    answerCorrect?: boolean;
  };
}

export class WorkosBridgeError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

async function consumePendingBridge(
  args: { bridgeCodeDigest: string; now: Date },
  db: DbLike,
): Promise<WorkosBridgeRecord | null> {
  const [row] = await db
    .update(workosAuthBridges)
    .set({
      status: "consumed",
      consumed_at: args.now,
      updated_at: args.now,
    })
    .where(
      and(
        eq(workosAuthBridges.bridge_code_digest, args.bridgeCodeDigest),
        eq(workosAuthBridges.status, "pending"),
        eq(workosAuthBridges.workos_email_verified, true),
        gt(workosAuthBridges.expires_at, args.now),
      ),
    )
    .returning({
      id: workosAuthBridges.id,
      tenantId: workosAuthBridges.tenant_id,
      tenantReferenceId: workosAuthBridges.tenant_auth_provider_reference_id,
      authProviderResourceId: workosAuthBridges.auth_provider_resource_id,
      workosUserId: workosAuthBridges.workos_user_id,
      workosSessionId: workosAuthBridges.workos_session_id,
      workosSessionExpiresAt: workosAuthBridges.workos_session_expires_at,
      workosEmail: workosAuthBridges.workos_email,
      workosEmailVerified: workosAuthBridges.workos_email_verified,
      returnTo: workosAuthBridges.return_to,
    });
  return row ?? null;
}

async function resolveBridgeUser(
  bridge: WorkosBridgeRecord,
  db: DbLike,
): Promise<WorkosBridgeUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      tenantId: users.tenant_id,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(
      and(
        eq(users.tenant_id, bridge.tenantId),
        sql`lower(${users.email}) = ${bridge.workosEmail.toLowerCase()}`,
      ),
    );
  if (!row?.tenantId || !row.email) return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    name: row.name,
  };
}

async function startCognitoCustomAuth(
  args: {
    username: string;
    signedChallenge: string;
    answer: string;
  },
  cognito: CognitoIdentityProviderClient,
): Promise<CognitoTokenSet> {
  const userPoolId = getConfig("COGNITO_USER_POOL_ID", "");
  const clientId = getConfig("ADMIN_CLIENT_ID", "");
  if (!userPoolId || !clientId) {
    throw new WorkosBridgeError("Cognito bridge is not configured", 500);
  }
  const clientMetadata = {
    [WORKOS_BRIDGE_CHALLENGE_METADATA_KEY]: args.signedChallenge,
  };

  const start = await cognito.send(
    new AdminInitiateAuthCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
      AuthFlow: "CUSTOM_AUTH",
      AuthParameters: {
        USERNAME: args.username,
      },
      ClientMetadata: clientMetadata,
    }),
  );
  if (start.ChallengeName !== "CUSTOM_CHALLENGE" || !start.Session) {
    throw new WorkosBridgeError("Cognito did not issue a bridge challenge", 502);
  }

  const response = await cognito.send(
    new AdminRespondToAuthChallengeCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
      ChallengeName: "CUSTOM_CHALLENGE",
      Session: start.Session,
      ChallengeResponses: {
        USERNAME: args.username,
        ANSWER: args.answer,
      },
      ClientMetadata: clientMetadata,
    }),
  );
  const tokens = response.AuthenticationResult;
  if (
    !tokens?.IdToken ||
    !tokens.AccessToken ||
    !tokens.RefreshToken
  ) {
    throw new WorkosBridgeError("Cognito bridge returned no tokens", 502);
  }
  return {
    id_token: tokens.IdToken,
    access_token: tokens.AccessToken,
    refresh_token: tokens.RefreshToken,
  };
}

function defineAuthChallenge(
  event: CognitoCustomAuthEvent,
): CognitoCustomAuthEvent {
  const session = event.request.session ?? [];
  const last = session[session.length - 1];
  if (last?.challengeName === "CUSTOM_CHALLENGE" && last.challengeResult) {
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
    return event;
  }
  if (session.some((entry) => entry.challengeResult === false)) {
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
    return event;
  }
  event.response.challengeName = "CUSTOM_CHALLENGE";
  event.response.issueTokens = false;
  event.response.failAuthentication = false;
  return event;
}

function createAuthChallenge(
  event: CognitoCustomAuthEvent,
  secret: string,
): CognitoCustomAuthEvent {
  const signedChallenge =
    event.request.clientMetadata?.[WORKOS_BRIDGE_CHALLENGE_METADATA_KEY];
  if (!signedChallenge) {
    throw new WorkosBridgeError("missing WorkOS bridge challenge", 400);
  }
  verifyWorkosCognitoChallenge(signedChallenge, secret);
  event.response.publicChallengeParameters = {
    challenge: "workos_bridge",
  };
  event.response.privateChallengeParameters = {
    [WORKOS_BRIDGE_CHALLENGE_METADATA_KEY]: signedChallenge,
  };
  return event;
}

function verifyAuthChallenge(
  event: CognitoCustomAuthEvent,
  secret: string,
): CognitoCustomAuthEvent {
  const signedChallenge =
    event.request.privateChallengeParameters?.[
      WORKOS_BRIDGE_CHALLENGE_METADATA_KEY
    ];
  if (!signedChallenge) {
    event.response.answerCorrect = false;
    return event;
  }
  try {
    const challenge = verifyWorkosCognitoChallenge(signedChallenge, secret);
    event.response.answerCorrect =
      digestAnswer(event.request.challengeAnswer ?? "") ===
      challenge.answerDigest;
  } catch {
    event.response.answerCorrect = false;
  }
  return event;
}

function digestAnswer(answer: string): string {
  return createHash("sha256").update(answer).digest("base64url");
}

function parseCognitoBridgeTokenClaims(token: string): {
  sub: string;
  username: string;
  expiresAt: Date | null;
} {
  const payload = decodeJwtPayload(token);
  const sub = payload.sub;
  if (typeof sub !== "string" || !sub) {
    throw new WorkosBridgeError("Cognito bridge token missing sub", 502);
  }
  const username =
    typeof payload["cognito:username"] === "string" &&
    payload["cognito:username"]
      ? payload["cognito:username"]
      : sub;
  const exp = payload.exp;
  return {
    sub,
    username,
    expiresAt:
      typeof exp === "number" && Number.isFinite(exp) && exp > 0
        ? new Date(exp * 1000)
        : null,
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  if (!payload) {
    throw new WorkosBridgeError("Cognito bridge returned invalid token", 502);
  }
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new WorkosBridgeError("Cognito bridge returned invalid token", 502);
  }
}
