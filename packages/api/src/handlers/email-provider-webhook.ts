import { getSecret } from "@thinkwork/runtime-config";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { emailProviderInstalls } from "@thinkwork/database-pg/schema";
import { createResendProvider } from "../lib/email-channel/providers/resend.js";
import { createSesProvider } from "../lib/email-channel/providers/ses.js";
import type {
  EmailProviderAdapter,
  EmailProviderKey,
} from "../lib/email-channel/provider-contract.js";
import {
  EmailProviderError,
  providerSafeError,
} from "../lib/email-channel/provider-contract.js";
import { readStoredEmailProviderApiKey } from "../lib/email-channel/secrets.js";
import { processNormalizedInboundEmail } from "./email-inbound.js";

const db = getDb();

function json(
  body: unknown,
  statusCode = 200,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function readRawBody(event: APIGatewayProxyEventV2): string {
  if (!event.body) return "";
  return event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const providerInstallId = event.pathParameters?.providerInstallId ?? "";
  if (!providerInstallId) {
    return json({ error: "Missing provider install id" }, 400);
  }

  const rawBody = readRawBody(event);
  if (!rawBody) return json({ error: "Empty body" }, 400);

  const [install] = await db
    .select()
    .from(emailProviderInstalls)
    .where(
      and(
        eq(emailProviderInstalls.id, providerInstallId),
        eq(emailProviderInstalls.active_for_production, true),
      ),
    )
    .limit(1);

  if (!install || install.status !== "ready") {
    console.warn("[email-provider-webhook] install missing or not ready");
    return json({ error: "Webhook not configured" }, 404);
  }
  if (!install.webhook_secret_ref) {
    console.error(
      "[email-provider-webhook] ready provider missing webhook secret ref",
    );
    return json({ error: "Webhook not configured" }, 500);
  }

  const webhookSecret = (await getSecret(install.webhook_secret_ref)).trim();
  if (!webhookSecret) {
    console.error("[email-provider-webhook] webhook secret resolved empty");
    return json({ error: "Webhook not configured" }, 500);
  }

  let credential: string | undefined;
  if (install.credential_secret_ref) {
    credential = readStoredEmailProviderApiKey(
      await getSecret(install.credential_secret_ref),
    );
  }

  const provider = providerAdapter(install.provider as EmailProviderKey);
  try {
    const providerEvent = await provider.verifyEvent({
      rawBody,
      headers: event.headers,
      webhookSecret,
      credential,
    });

    if (providerEvent.eventType === "received" && providerEvent.inbound) {
      await processNormalizedInboundEmail({
        inbound: providerEvent.inbound,
        providerEvent,
      });
    }

    return json({
      received: true,
      eventType: providerEvent.eventType,
      providerEventId: providerEvent.providerEventId,
    });
  } catch (err) {
    if (err instanceof EmailProviderError) {
      const safe = providerSafeError(err);
      const statusCode =
        err.code.includes("SIGNATURE") || err.code.includes("MISSING")
          ? 400
          : 422;
      console.warn(
        `[email-provider-webhook] provider event rejected code=${safe.code}`,
      );
      return json({ error: safe.code, message: safe.message }, statusCode);
    }
    console.error("[email-provider-webhook] provider event failed:", err);
    return json({ error: "Webhook processing failed" }, 500);
  }
}

function providerAdapter(provider: EmailProviderKey): EmailProviderAdapter {
  switch (provider) {
    case "resend":
      return createResendProvider();
    case "ses":
      return createSesProvider();
    default:
      throw new EmailProviderError(
        provider,
        "EMAIL_PROVIDER_UNSUPPORTED",
        "Email provider is not supported for webhooks.",
      );
  }
}
