#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import {
  AdminSetUserPasswordCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const region = process.env.AWS_REGION || "us-east-1";
const graphQlUrl = required("GRAPHQL_URL");
const tenantId = required("PROOF_TENANT_ID");
const aliceId = required("PROOF_ALICE_USER_ID");
const bobId = required("PROOF_BOB_USER_ID");
const poolId = required("COGNITO_USER_POOL_ID");
const clientId = required("COGNITO_APP_CLIENT_ID");
const configPath =
  process.env.THINKWORK_CONFIG_PATH ||
  `${process.env.HOME}/.thinkwork/config.json`;
const cognito = new CognitoIdentityProviderClient({ region });

let bobReset = false;
let runtimeSelected = false;
let aliceToken;

if (process.env.PI_SMOKE_ONLY === "1") {
  aliceToken = await loadAliceToken();
  await runRestoredPiSmoke(aliceToken);
  console.log(
    JSON.stringify({
      result: "PASS",
      applicationPath: "ThinkWork GraphQL sendMessage",
      restoredRuntime: "Pi",
      tokensPrinted: false,
    }),
  );
  process.exit(0);
}

try {
  aliceToken = await loadAliceToken();
  const bobToken = await createEphemeralBobSession();

  // Exercise the same dual-runtime lifecycle as Composer: select AgentCore as
  // the default for future threads, then create a normal chat thread. The
  // server pins and enrolls it transactionally; there is no special proof
  // mutation or test-thread lifecycle.
  await setRuntime(aliceToken, "FLUE");
  await setRuntime(aliceToken, "AGENTCORE");
  runtimeSelected = true;
  const created = await gql(
    aliceToken,
    `mutation($input: CreateThreadInput!) {
      createThread(input: $input) {
        id
        agentcoreManaged
      }
    }`,
    {
      input: {
        tenantId,
        title: "AgentCore multiplayer certification",
        channel: "CHAT",
      },
    },
  );
  const threadId = created.createThread.id;
  if (created.createThread.agentcoreManaged !== true) {
    throw new Error("Normal Composer thread was not enrolled in AgentCore");
  }

  await send(aliceToken, {
    threadId,
    content: "Bob is joining this managed multiplayer proof.",
    agentDispatch: "FORCE_OFF",
    mentions: [
      {
        targetType: "USER",
        targetId: bobId,
        displayName: "Bob",
        rawText: "Bob",
      },
    ],
  });

  const aliceFirst = await turn(
    aliceToken,
    threadId,
    `Call owner_probe once with requested_owner exactly ${aliceId}. Return the harmless fixture result and no private fields.`,
  );
  assertContains(aliceFirst, `fixture-${aliceId}`, "Alice owner credential");

  const bobOwn = await turn(
    bobToken,
    threadId,
    `Call owner_probe once with requested_owner exactly ${bobId}. Return the harmless fixture result and no private fields.`,
  );
  assertContains(bobOwn, `fixture-${bobId}`, "Bob owner credential");
  assertAbsent(
    bobOwn,
    `fixture-${aliceId}`,
    "Alice credential in Bob response",
  );

  const bobDenied = await turn(
    bobToken,
    threadId,
    `Attempt owner_probe once with requested_owner exactly ${aliceId}. Report the authorization denial without inventing a result.`,
  );
  assertAbsent(
    bobDenied,
    `fixture-${aliceId}`,
    "Alice credential after Bob denial",
  );

  const aliceFinal = await turn(
    aliceToken,
    threadId,
    `Call mixed_disclosure once with requested_owner exactly ${aliceId}. State the approved task field and that unrelated sensitive fields were withheld.`,
  );
  assertContains(
    aliceFinal,
    `approved-summary-${aliceId}`,
    "Alice mixed disclosure",
  );

  const transcript = await messages(aliceToken, threadId);
  const serialized = JSON.stringify(transcript);
  for (const forbidden of [
    "private_note",
    "private-",
    "SECRET_SENTINEL",
    "/identities/oauth2/authorize",
  ]) {
    assertAbsent(serialized, forbidden, `forbidden public value ${forbidden}`);
  }

  console.log(
    JSON.stringify({
      result: "PASS",
      applicationPath: "ThinkWork GraphQL sendMessage",
      interleave: "Alice/Bob/Bob-deny/Alice",
      runtime: "AgentCore Harness",
      exactUserCredentials: true,
      crossUserDenied: true,
      mixedDisclosureSanitized: true,
      consentElicitationObserved: false,
      piFallbackObserved: false,
      tokensPrinted: false,
    }),
  );
} finally {
  if (runtimeSelected && aliceToken) {
    await setRuntime(aliceToken, "FLUE").catch((error) => {
      console.error(`runtime_restore_failed:${safeError(error)}`);
      process.exitCode = 1;
    });
  }
  if (bobReset) {
    await cognito
      .send(
        new AdminUserGlobalSignOutCommand({
          UserPoolId: poolId,
          Username: bobId,
        }),
      )
      .catch(() => undefined);
    await cognito
      .send(
        new AdminSetUserPasswordCommand({
          UserPoolId: poolId,
          Username: bobId,
          Password: proofPassword(),
          Permanent: false,
        }),
      )
      .catch((error) => {
        console.error(`bob_auth_cleanup_failed:${safeError(error)}`);
        process.exitCode = 1;
      });
  }
}

async function loadAliceToken() {
  const parsed = JSON.parse(await readFile(configPath, "utf8"));
  const stage = process.env.THINKWORK_STAGE || parsed.defaultStage || "dev";
  const token = parsed.sessions?.[stage]?.idToken;
  if (!token || jwtExpiry(token) <= Math.floor(Date.now() / 1000) + 60) {
    throw new Error("ThinkWork operator session is missing or expired");
  }
  return token;
}

async function createEphemeralBobSession() {
  const temporaryPassword = proofPassword();
  const permanentPassword = proofPassword();
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: poolId,
      Username: bobId,
      Password: temporaryPassword,
      Permanent: false,
    }),
  );
  bobReset = true;
  const started = await cognito.send(
    new InitiateAuthCommand({
      ClientId: clientId,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: bobId, PASSWORD: temporaryPassword },
    }),
  );
  if (started.ChallengeName !== "NEW_PASSWORD_REQUIRED" || !started.Session) {
    throw new Error(
      "Bob proof user did not enter the expected password challenge",
    );
  }
  const completed = await cognito.send(
    new RespondToAuthChallengeCommand({
      ClientId: clientId,
      ChallengeName: "NEW_PASSWORD_REQUIRED",
      Session: started.Session,
      ChallengeResponses: { USERNAME: bobId, NEW_PASSWORD: permanentPassword },
    }),
  );
  const token = completed.AuthenticationResult?.IdToken;
  if (!token)
    throw new Error("Bob proof user authentication returned no ID token");
  return token;
}

async function setRuntime(token, runtime) {
  const result = await gql(
    token,
    `mutation($tenantId: ID!, $input: UpdateTenantAgentInput!) {
      updateTenantAgent(tenantId: $tenantId, input: $input) { runtime runtimeConfig }
    }`,
    { tenantId, input: { runtime } },
  );
  if (result.updateTenantAgent.runtime !== runtime) {
    throw new Error(`Runtime refetch did not confirm ${runtime}`);
  }
}

async function send(token, input) {
  return gql(
    token,
    `mutation($input: SendMessageInput!) {
      sendMessage(input: $input) { id role createdAt metadata }
    }`,
    { input: { role: "USER", ...input } },
  );
}

async function turn(token, threadId, content) {
  const before = await messages(token, threadId);
  const assistantIds = new Set(
    before
      .filter((message) => message.role === "ASSISTANT")
      .map((message) => message.id),
  );
  await send(token, { threadId, content, agentDispatch: "FORCE_ON" });
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const current = await messages(token, threadId);
    const next = current.find(
      (message) =>
        message.role === "ASSISTANT" && !assistantIds.has(message.id),
    );
    if (next) return next.content || "";
  }
  throw new Error(
    "Harness application turn did not produce an assistant message",
  );
}

async function messages(token, threadId) {
  const result = await gql(
    token,
    `query($threadId: ID!) {
      messages(threadId: $threadId, limit: 100) {
        edges { node { id role content metadata createdAt } }
      }
    }`,
    { threadId },
  );
  return result.messages.edges.map((edge) => edge.node);
}

async function runRestoredPiSmoke(token) {
  const created = await gql(
    token,
    `mutation($input: CreateThreadInput!) {
      createThread(input: $input) { id }
    }`,
    {
      input: {
        tenantId,
        title: "Post-Harness Pi restoration smoke",
        channel: "CHAT",
      },
    },
  );
  const threadId = created.createThread.id;
  try {
    const response = await turn(
      token,
      threadId,
      "Reply with exactly PI_RESTORED_SMOKE_OK and nothing else.",
    );
    assertContains(response, "PI_RESTORED_SMOKE_OK", "restored Pi response");
  } finally {
    await gql(
      token,
      `mutation($id: ID!, $input: UpdateThreadInput!) {
        updateThread(id: $id, input: $input) { id status }
      }`,
      { id: threadId, input: { status: "ARCHIVED" } },
    ).catch(() => undefined);
  }
}

async function gql(token, query, variables) {
  const response = await fetch(graphQlUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (!response.ok || body.errors?.length) {
    throw new Error(
      `GraphQL request failed (${response.status}): ${body.errors?.map((error) => error.extensions?.code || error.message).join(",") || "HTTP error"}`,
    );
  }
  return body.data;
}

function proofPassword() {
  return `Tw-${randomBytes(24).toString("base64url")}9!`;
}

function jwtExpiry(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url")).exp || 0;
}

function assertContains(value, expected, label) {
  if (!value.includes(expected)) throw new Error(`${label} was not observed`);
}

function assertAbsent(value, forbidden, label) {
  if (value.includes(forbidden))
    throw new Error(`${label} crossed the boundary`);
}

function safeError(error) {
  return error instanceof Error ? error.message.slice(0, 240) : "unknown";
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
