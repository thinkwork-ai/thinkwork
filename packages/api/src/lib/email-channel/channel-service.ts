import type { EmailChannelProvider } from "@thinkwork/database-pg/schema";
import {
  EmailProviderError,
  type EmailDomainInstructions,
  type EmailProviderAdapter,
  type EmailProviderSendInput,
  type EmailProviderSendResult,
  type EmailProviderWebhookInput,
  type EmailReadinessCheckResult,
  type NormalizedProviderEvent,
} from "./provider-contract.js";
import { createResendProvider } from "./providers/resend.js";
import { createSendGridProvider } from "./providers/sendgrid.js";
import { createSesProvider } from "./providers/ses.js";

export interface EmailChannelService {
  send(
    provider: EmailChannelProvider,
    input: EmailProviderSendInput,
  ): Promise<EmailProviderSendResult>;
  verifyEvent(
    provider: EmailChannelProvider,
    input: EmailProviderWebhookInput,
  ): Promise<NormalizedProviderEvent>;
  readinessChecks(
    provider: EmailChannelProvider,
    input: Parameters<EmailProviderAdapter["readinessChecks"]>[0],
  ): Promise<EmailReadinessCheckResult[]>;
  domainInstructions(
    provider: EmailChannelProvider,
    input: Parameters<EmailProviderAdapter["domainInstructions"]>[0],
  ): EmailDomainInstructions;
}

export interface EmailChannelServiceDeps {
  providers?: Partial<Record<EmailChannelProvider, EmailProviderAdapter>>;
}

export function createEmailChannelService(
  deps: EmailChannelServiceDeps = {},
): EmailChannelService {
  const providers: Record<EmailChannelProvider, EmailProviderAdapter> = {
    resend: deps.providers?.resend ?? createResendProvider(),
    sendgrid: deps.providers?.sendgrid ?? createSendGridProvider(),
    ses: deps.providers?.ses ?? createSesProvider(),
  };

  return {
    send: (provider, input) => adapterFor(providers, provider).send(input),
    verifyEvent: (provider, input) =>
      adapterFor(providers, provider).verifyEvent(input),
    readinessChecks: (provider, input) =>
      adapterFor(providers, provider).readinessChecks(input),
    domainInstructions: (provider, input) =>
      adapterFor(providers, provider).domainInstructions(input),
  };
}

function adapterFor(
  providers: Record<EmailChannelProvider, EmailProviderAdapter>,
  provider: EmailChannelProvider,
): EmailProviderAdapter {
  const adapter = providers[provider];
  if (!adapter) {
    throw new EmailProviderError(
      provider,
      "EMAIL_PROVIDER_UNSUPPORTED",
      `Unsupported email provider: ${provider}`,
    );
  }
  return adapter;
}
