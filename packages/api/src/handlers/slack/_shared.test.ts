import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import {
  computeSlackSignature,
  createSlackHandler,
  verifySlackSignature,
  type SlackWorkspaceContext,
} from "./_shared.js";

const NOW_SECONDS = 1_800_000_000;
const NOW_MS = NOW_SECONDS * 1000;
const SIGNING_SECRET = "slack-signing-secret";
const WORKSPACE: SlackWorkspaceContext = {
  tenantId: "tenant-1",
  slackTeamId: "T123",
  slackTeamName: "Acme",
  botUserId: "B123",
  botTokenSecretPath:
    "thinkwork/tenants/tenant-1/slack/workspaces/T123/bot-token",
  appId: "A123",
  status: "active",
};

function makeEvent(
  rawBody: string,
  opts: {
    timestamp?: number;
    signature?: string;
    headers?: Record<string, string>;
    isBase64Encoded?: boolean;
  } = {},
): APIGatewayProxyEventV2 {
  const timestamp = String(opts.timestamp ?? NOW_SECONDS);
  const body = opts.isBase64Encoded
    ? Buffer.from(rawBody, "utf8").toString("base64")
    : rawBody;
  const signature =
    opts.signature ??
    computeSlackSignature(SIGNING_SECRET, timestamp, Buffer.from(rawBody));

  return {
    version: "2.0",
    routeKey: "POST /slack/events",
    rawPath: "/slack/events",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
      ...opts.headers,
    },
    requestContext: {
      http: {
        method: "POST",
        path: "/slack/events",
        sourceIp: "127.0.0.1",
        userAgent: "Slackbot",
      },
    } as APIGatewayProxyEventV2["requestContext"],
    body,
    isBase64Encoded: !!opts.isBase64Encoded,
  };
}

function makeHandler(
  overrides: Partial<Parameters<typeof createSlackHandler>[1]> = {},
) {
  const dispatch = vi.fn(async () => ({
    statusCode: 200,
    body: JSON.stringify({ ok: true }),
  }));
  const lookupWorkspace = vi.fn(async () => WORKSPACE);
  const loadBotToken = vi.fn(async () => "xoxb-token");
  const handler = createSlackHandler(
    {
      name: "events",
      extractTeamId: ({ rawBodyText }) =>
        (JSON.parse(rawBodyText) as { team_id?: string }).team_id ?? null,
      dispatch,
    },
    {
      loadSigningSecret: async () => SIGNING_SECRET,
      lookupWorkspace,
      loadBotToken,
      nowMs: () => NOW_MS,
      ...overrides,
    },
  );
  return { handler, dispatch, lookupWorkspace, loadBotToken };
}

describe("verifySlackSignature", () => {
  it("accepts a valid v0 signature with a fresh timestamp", () => {
    const rawBody = Buffer.from(JSON.stringify({ team_id: "T123" }));
    const timestamp = String(NOW_SECONDS);
    const signature = computeSlackSignature(SIGNING_SECRET, timestamp, rawBody);

    expect(
      verifySlackSignature({
        headers: {
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature,
        },
        rawBody,
        signingSecret: SIGNING_SECRET,
        nowMs: () => NOW_MS,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a timestamp outside the five-minute replay window", () => {
    const rawBody = Buffer.from("{}");
    const timestamp = String(NOW_SECONDS - 6 * 60);
    const signature = computeSlackSignature(SIGNING_SECRET, timestamp, rawBody);

    const result = verifySlackSignature({
      headers: {
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
      rawBody,
      signingSecret: SIGNING_SECRET,
      nowMs: () => NOW_MS,
    });

    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(result).toHaveProperty(
      "message",
      "Slack request timestamp is outside the replay window",
    );
  });

  it("uses timingSafeEqual for same-length signature comparisons", () => {
    const rawBody = Buffer.from("{}");
    const timestamp = String(NOW_SECONDS);
    const signature = computeSlackSignature(SIGNING_SECRET, timestamp, rawBody);
    const wrongLastByte = `${signature.slice(0, -1)}${
      signature.endsWith("0") ? "1" : "0"
    }`;
    const timingSafeEqualFn = vi.fn(() => false);

    const result = verifySlackSignature({
      headers: {
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": wrongLastByte,
      },
      rawBody,
      signingSecret: SIGNING_SECRET,
      nowMs: () => NOW_MS,
      timingSafeEqualFn,
    });

    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(timingSafeEqualFn).toHaveBeenCalledTimes(1);
  });
});

describe("createSlackHandler", () => {
  it("runs dispatch after valid signature, workspace lookup, and bot-token load", async () => {
    const { handler, dispatch, lookupWorkspace, loadBotToken } = makeHandler();
    const rawBody = JSON.stringify({ team_id: "T123", event_id: "Ev1" });

    const res = await handler(makeEvent(rawBody));

    expect(res.statusCode).toBe(200);
    expect(lookupWorkspace).toHaveBeenCalledWith("T123");
    expect(loadBotToken).toHaveBeenCalledWith(WORKSPACE.botTokenSecretPath);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        rawBody: Buffer.from(rawBody),
        rawBodyText: rawBody,
        workspace: WORKSPACE,
        botToken: "xoxb-token",
      }),
    );
  });

  it("rejects invalid signatures before downstream lookup or dispatch", async () => {
    const { handler, dispatch, lookupWorkspace } = makeHandler();

    const res = await handler(
      makeEvent(JSON.stringify({ team_id: "T123" }), {
        signature: "v0=not-valid",
      }),
    );

    expect(res.statusCode).toBe(401);
    expect(lookupWorkspace).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("short-circuits signed Slack retries without downstream lookup or dispatch", async () => {
    const { handler, dispatch, lookupWorkspace } = makeHandler();

    const res = await handler(
      makeEvent(JSON.stringify({ team_id: "T123" }), {
        headers: {
          "x-slack-retry-num": "1",
          "x-slack-retry-reason": "http_timeout",
        },
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body || "{}")).toEqual({ ok: true, retried: true });
    expect(lookupWorkspace).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("allows signed requests to respond before workspace lookup", async () => {
    const preDispatch = vi.fn(async () => ({
      statusCode: 200,
      body: JSON.stringify({ challenge: "challenge-1" }),
    }));
    const { handler, dispatch, lookupWorkspace } = makeHandler({
      lookupWorkspace: async () => {
        throw new Error("lookup should not run");
      },
    });
    const rawBody = JSON.stringify({
      type: "url_verification",
      team_id: "T123",
      challenge: "challenge-1",
    });
    const signedHandler = createSlackHandler(
      {
        name: "events",
        extractTeamId: ({ rawBodyText }) =>
          (JSON.parse(rawBodyText) as { team_id?: string }).team_id ?? null,
        preDispatch,
        dispatch,
      },
      {
        loadSigningSecret: async () => SIGNING_SECRET,
        lookupWorkspace,
        loadBotToken: async () => "xoxb-token",
        nowMs: () => NOW_MS,
      },
    );

    const res = await signedHandler(makeEvent(rawBody));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body || "{}")).toEqual({ challenge: "challenge-1" });
    expect(preDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ rawBodyText: rawBody }),
    );
    expect(lookupWorkspace).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("uses raw form-encoded bytes for signature verification", async () => {
    const dispatch = vi.fn(async () => ({
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    }));
    const handler = createSlackHandler(
      {
        name: "slash-command",
        extractTeamId: ({ rawBodyText }) =>
          new URLSearchParams(rawBodyText).get("team_id"),
        dispatch,
      },
      {
        loadSigningSecret: async () => SIGNING_SECRET,
        lookupWorkspace: async () => WORKSPACE,
        loadBotToken: async () => "xoxb-token",
        nowMs: () => NOW_MS,
      },
    );
    const rawBody = "team_id=T123&text=hello+world";

    const res = await handler(makeEvent(rawBody));

    expect(res.statusCode).toBe(200);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ rawBodyText: rawBody }),
    );
  });

  it("preserves base64-decoded raw bytes for API Gateway binary bodies", async () => {
    const { handler, dispatch } = makeHandler();
    const rawBody = JSON.stringify({ team_id: "T123", text: "hello" });

    const res = await handler(makeEvent(rawBody, { isBase64Encoded: true }));

    expect(res.statusCode).toBe(200);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ rawBody: Buffer.from(rawBody) }),
    );
  });

  it("returns 404 for a signed request from an unknown Slack workspace", async () => {
    const { handler, dispatch } = makeHandler({
      lookupWorkspace: async () => null,
    });

    const res = await handler(makeEvent(JSON.stringify({ team_id: "T404" })));

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body || "{}")).toEqual({
      error: "Slack workspace is not installed",
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
