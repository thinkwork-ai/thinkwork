import { getConfig } from "@thinkwork/runtime-config";
import { GraphQLError } from "graphql";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  emailDomains,
  emailProviderInstalls,
  emailReadinessChecks,
  emailSpacePolicies,
  emailSpaceSenderAllowlists,
  tenants,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { requirePluginTenantAdmin } from "../plugins/shared.js";
import {
  emailDomainPayload,
  emailProviderInstallPayload,
  emailReadinessCheckPayload,
  emailSpacePolicyPayload,
  emailSpaceSenderAllowlistPayload,
  graphqlEnumToDb,
  graphqlJsonInput,
  normalizeDomain,
  normalizeEmailOrDomain,
} from "./mappers.js";
import {
  requireEmailDomain,
  requireEmailProviderInstall,
  requireEmailSpace,
} from "./shared.js";
import {
  storeEmailProviderApiKey,
  storeEmailProviderWebhookSecret,
} from "../../../lib/email-channel/secrets.js";
import { createResendWebhook } from "../../../lib/email-channel/providers/resend.js";
import {
  listSendGridAuthenticatedDomains,
  usableSendGridDomains,
  type SendGridAuthenticatedDomain,
} from "../../../lib/email-channel/providers/sendgrid.js";
import { providerSafeError } from "../../../lib/email-channel/provider-contract.js";
import { runEmailReadinessProbe } from "../../../lib/email-channel/readiness-probes.js";
import { runEmailReadinessProbeMutation } from "./readiness.mutations.js";

type ConfigureEmailProviderInput = {
  providerInstallId?: string | null;
  provider: string;
  displayName?: string | null;
  status?: string | null;
  activeForProduction?: boolean | null;
  credentialSecretRef?: string | null;
  webhookSecretRef?: string | null;
  defaultFromEmail?: string | null;
  metadata?: unknown;
  domain?: {
    domain: string;
    ownershipType: string;
    status?: string | null;
    sendingVerifiedAt?: string | null;
    inboundVerifiedAt?: string | null;
    dnsRecords?: unknown;
    providerMetadata?: unknown;
  } | null;
};

type SaveEmailProviderCredentialInput = {
  providerInstallId?: string | null;
  provider: string;
  apiKey: string;
  displayName?: string | null;
  webhookSecretRef?: string | null;
  defaultFromEmail?: string | null;
  domain?: ConfigureEmailProviderInput["domain"];
};

export async function saveEmailProviderCredential(
  _parent: unknown,
  args: { input: SaveEmailProviderCredentialInput },
  ctx: GraphQLContext,
) {
  const { tenantId } = await requirePluginTenantAdmin(ctx);
  const provider = graphqlEnumToDb(args.input.provider);
  const { secretRef, fingerprint } = await storeEmailProviderApiKey({
    tenantId,
    provider,
    apiKey: args.input.apiKey,
  });
  const defaults = await emailProviderDefaults(ctx, tenantId, provider);
  const providerConfig =
    provider === "sendgrid"
      ? await sendGridCredentialConfiguration({
          apiKey: args.input.apiKey,
          inputDomain: args.input.domain,
        })
      : null;
  const metadata = {
    credentialMasked: "stored",
    credentialFingerprint: fingerprint,
    credentialUpdatedAt: new Date().toISOString(),
    generatedDefaults: defaults.metadata,
    ...(providerConfig?.metadata ?? {}),
  };
  const providerPayload = await configureEmailProvider(
    _parent,
    {
      input: {
        providerInstallId: args.input.providerInstallId,
        provider: args.input.provider,
        displayName:
          args.input.displayName ??
          (provider === "sendgrid" ? "SendGrid" : "Email provider"),
        status: providerConfig?.status ?? "PENDING",
        activeForProduction:
          provider === "sendgrid" ? providerConfig?.status === "READY" : true,
        credentialSecretRef: secretRef,
        webhookSecretRef: args.input.webhookSecretRef,
        defaultFromEmail:
          args.input.defaultFromEmail ??
          providerConfig?.defaultFromEmail ??
          defaults.defaultFromEmail,
        metadata,
        domain: providerConfig?.domain ?? args.input.domain ?? defaults.domain,
      },
    },
    ctx,
  );

  if (provider === "resend") {
    await configureResendWebhookFromApiKey({
      ctx,
      tenantId,
      providerInstallId: providerPayload.id,
      apiKey: args.input.apiKey,
      existingMetadata: metadata,
    });
  }

  await runEmailReadinessAfterCredentialSave({
    ctx,
    tenantId,
    providerInstallId: providerPayload.id,
  });
  const [updated] = await ctx.db
    .select()
    .from(emailProviderInstalls)
    .where(eq(emailProviderInstalls.id, providerPayload.id))
    .limit(1);
  if (updated) return emailProviderInstallPayload(updated);

  return providerPayload;
}

async function sendGridCredentialConfiguration(input: {
  apiKey: string;
  inputDomain?: SaveEmailProviderCredentialInput["domain"];
}): Promise<{
  status: "READY" | "PENDING" | "FAILED";
  defaultFromEmail?: string;
  domain?: ConfigureEmailProviderInput["domain"];
  metadata: Record<string, unknown>;
}> {
  try {
    const domains = await listSendGridAuthenticatedDomains({
      credential: input.apiKey,
    });
    const usable = usableSendGridDomains(domains);
    const selected =
      selectedSendGridDomain(input.inputDomain, usable) ??
      (usable.length === 1 ? usable[0] : null);
    return {
      status: selected ? "READY" : usable.length > 0 ? "PENDING" : "FAILED",
      defaultFromEmail: selected ? `noreply@${selected.domain}` : undefined,
      domain: selected ? sendGridDomainInput(selected) : undefined,
      metadata: {
        sendgridDomains: {
          fetchedAt: new Date().toISOString(),
          usableCount: usable.length,
          totalCount: domains.length,
          selectedDomainId: selected?.id ?? null,
          choices: usable.map(sendGridDomainChoice),
          failureCode: usable.length === 0 ? "no_usable_domains" : null,
          guidance:
            usable.length === 0
              ? "Authenticate a sending domain in SendGrid, then refresh this provider."
              : null,
        },
      },
    };
  } catch (error) {
    const safe = providerSafeError(error);
    return {
      status: "FAILED",
      metadata: {
        sendgridDomains: {
          fetchedAt: new Date().toISOString(),
          usableCount: 0,
          totalCount: 0,
          failureCode: safe.code,
          failureMessage: safe.message,
        },
      },
    };
  }
}

function selectedSendGridDomain(
  inputDomain: SaveEmailProviderCredentialInput["domain"] | undefined,
  choices: SendGridAuthenticatedDomain[],
) {
  if (!inputDomain?.domain) return null;
  const requested = normalizeDomain(inputDomain.domain);
  return (
    choices.find(
      (choice) =>
        normalizeDomain(choice.domain) === requested || choice.id === requested,
    ) ?? null
  );
}

function sendGridDomainInput(
  domain: SendGridAuthenticatedDomain,
): ConfigureEmailProviderInput["domain"] {
  const now = new Date().toISOString();
  return {
    domain: domain.domain,
    ownershipType: "CUSTOMER_OWNED",
    status: "VERIFIED",
    sendingVerifiedAt: now,
    inboundVerifiedAt: null,
    dnsRecords: domain.dns,
    providerMetadata: domain.metadata,
  };
}

function sendGridDomainChoice(domain: SendGridAuthenticatedDomain) {
  return {
    id: domain.id,
    domain: domain.domain,
    subdomain: domain.subdomain ?? null,
    default: domain.default,
    username: domain.username ?? null,
  };
}

async function runEmailReadinessAfterCredentialSave(input: {
  ctx: GraphQLContext;
  tenantId: string;
  providerInstallId: string;
}) {
  try {
    await runEmailReadinessProbe({
      db: input.ctx.db,
      tenantId: input.tenantId,
      providerInstallId: input.providerInstallId,
    });
  } catch (error) {
    console.warn("Email readiness probe after credential save failed", {
      providerInstallId: input.providerInstallId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function emailProviderDefaults(
  ctx: GraphQLContext,
  tenantId: string,
  provider: string,
) {
  const [tenant] = await ctx.db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant?.slug) {
    throw new GraphQLError("Tenant slug required for email defaults", {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }
  const domain = "thinkwork.ai";
  const tenantSubdomain = `${tenant.slug}.thinkwork.ai`;
  const defaultFromEmail = `noreply@${domain}`;
  return {
    defaultFromEmail,
    domain: {
      domain,
      ownershipType: "THINKWORK_OWNED",
      status: "VERIFIED",
      sendingVerifiedAt: new Date().toISOString(),
      inboundVerifiedAt: new Date().toISOString(),
      providerMetadata: {
        generatedBy: "email_channel_one_key_install",
        domainPattern: "*.thinkwork.ai",
        tenantSubdomain,
        provider,
      },
    },
    metadata: {
      domain,
      defaultFromEmail,
      domainPattern: "*.thinkwork.ai",
      tenantSubdomain,
      generatedAt: new Date().toISOString(),
    },
  };
}

async function configureResendWebhookFromApiKey(input: {
  ctx: GraphQLContext;
  tenantId: string;
  providerInstallId: string;
  apiKey: string;
  existingMetadata: Record<string, unknown>;
}) {
  const apiBaseUrl = (getConfig("THINKWORK_API_URL") ?? "").replace(/\/$/, "");
  if (!apiBaseUrl) {
    await markResendWebhookSetupFailure(input, {
      code: "EMAIL_WEBHOOK_ENDPOINT_MISSING",
      message: "THINKWORK_API_URL is not configured.",
    });
    return;
  }

  const endpoint = `${apiBaseUrl}/api/email/provider-webhook/${input.providerInstallId}`;
  try {
    const webhook = await createResendWebhook({
      credential: input.apiKey,
      endpoint,
      events: [
        "email.sent",
        "email.delivered",
        "email.delivery_delayed",
        "email.failed",
        "email.bounced",
        "email.complained",
        "email.opened",
        "email.clicked",
        "email.received",
      ],
    });
    const { secretRef, fingerprint } = await storeEmailProviderWebhookSecret({
      tenantId: input.tenantId,
      provider: "resend",
      signingSecret: webhook.signingSecret,
    });
    await input.ctx.db
      .update(emailProviderInstalls)
      .set({
        webhook_secret_ref: secretRef,
        metadata: {
          ...input.existingMetadata,
          resendWebhook: {
            id: webhook.id,
            endpoint,
            signingSecretFingerprint: fingerprint,
            configuredAt: new Date().toISOString(),
          },
        },
        updated_at: sql`now()`,
      })
      .where(eq(emailProviderInstalls.id, input.providerInstallId));
  } catch (error) {
    const safe = providerSafeError(error);
    await markResendWebhookSetupFailure(input, {
      code: safe.code,
      message: safe.message,
    });
  }
}

async function markResendWebhookSetupFailure(
  input: {
    ctx: GraphQLContext;
    providerInstallId: string;
    existingMetadata: Record<string, unknown>;
  },
  error: { code: string; message: string },
) {
  await input.ctx.db
    .update(emailProviderInstalls)
    .set({
      webhook_secret_ref: null,
      metadata: {
        ...input.existingMetadata,
        resendWebhook: {
          status: "failed",
          failureCode: error.code,
          failureMessage: error.message,
          failedAt: new Date().toISOString(),
        },
      },
      updated_at: sql`now()`,
    })
    .where(eq(emailProviderInstalls.id, input.providerInstallId));
}

export async function configureEmailProvider(
  _parent: unknown,
  args: { input: ConfigureEmailProviderInput },
  ctx: GraphQLContext,
) {
  const { tenantId } = await requirePluginTenantAdmin(ctx);
  const input = args.input;
  const provider = graphqlEnumToDb(input.provider);
  const activeForProduction = input.activeForProduction ?? false;
  const metadata = jsonInput(input.metadata, "metadata");
  if (activeForProduction) {
    await ctx.db
      .update(emailProviderInstalls)
      .set({ active_for_production: false, updated_at: sql`now()` })
      .where(eq(emailProviderInstalls.tenant_id, tenantId));
  }

  const set = {
    display_name: input.displayName ?? null,
    status: input.status ? graphqlEnumToDb(input.status) : "pending",
    active_for_production: activeForProduction,
    credential_secret_ref: input.credentialSecretRef ?? null,
    webhook_secret_ref: input.webhookSecretRef ?? null,
    default_from_email: input.defaultFromEmail ?? null,
    metadata,
    updated_at: sql`now()`,
  };

  let providerRow;
  if (input.providerInstallId) {
    await requireEmailProviderInstall(ctx, tenantId, input.providerInstallId);
    const [updated] = await ctx.db
      .update(emailProviderInstalls)
      .set(set)
      .where(
        and(
          eq(emailProviderInstalls.tenant_id, tenantId),
          eq(emailProviderInstalls.id, input.providerInstallId),
        ),
      )
      .returning();
    providerRow = updated;
  } else {
    const [upserted] = await ctx.db
      .insert(emailProviderInstalls)
      .values({
        tenant_id: tenantId,
        provider,
        ...set,
      })
      .onConflictDoUpdate({
        target: [
          emailProviderInstalls.tenant_id,
          emailProviderInstalls.provider,
        ],
        set,
      })
      .returning();
    providerRow = upserted;
  }

  if (!providerRow) {
    throw new GraphQLError("Failed to configure email provider", {
      extensions: { code: "INTERNAL_ERROR" },
    });
  }
  if (input.domain) {
    await upsertDomainForProvider(ctx, tenantId, providerRow.id, input.domain);
  }
  return emailProviderInstallPayload(providerRow);
}

export async function updateEmailReadinessCheck(
  _parent: unknown,
  args: {
    input: {
      providerInstallId: string;
      domainId?: string | null;
      checkKey: string;
      status: string;
      failureCode?: string | null;
      failureMessage?: string | null;
      metadata?: unknown;
      lastCheckedAt?: string | null;
    };
  },
  ctx: GraphQLContext,
) {
  const { tenantId } = await requirePluginTenantAdmin(ctx);
  const input = args.input;
  await requireEmailProviderInstall(ctx, tenantId, input.providerInstallId);
  if (input.domainId) {
    await requireEmailDomain(
      ctx,
      tenantId,
      input.providerInstallId,
      input.domainId,
    );
  }
  const checkKey = graphqlEnumToDb(input.checkKey);
  const where = and(
    eq(emailReadinessChecks.tenant_id, tenantId),
    eq(emailReadinessChecks.provider_install_id, input.providerInstallId),
    input.domainId
      ? eq(emailReadinessChecks.domain_id, input.domainId)
      : isNull(emailReadinessChecks.domain_id),
    eq(emailReadinessChecks.check_key, checkKey),
  );
  const [existing] = await ctx.db
    .select({ id: emailReadinessChecks.id })
    .from(emailReadinessChecks)
    .where(where)
    .limit(1);
  const values = {
    tenant_id: tenantId,
    provider_install_id: input.providerInstallId,
    domain_id: input.domainId ?? null,
    check_key: checkKey,
    status: graphqlEnumToDb(input.status),
    last_checked_at: input.lastCheckedAt
      ? new Date(input.lastCheckedAt)
      : new Date(),
    failure_code: input.failureCode ?? null,
    failure_message: input.failureMessage ?? null,
    metadata: jsonInput(input.metadata, "metadata"),
    updated_at: sql`now()`,
  };
  const [row] = existing
    ? await ctx.db
        .update(emailReadinessChecks)
        .set(values)
        .where(eq(emailReadinessChecks.id, existing.id))
        .returning()
    : await ctx.db.insert(emailReadinessChecks).values(values).returning();
  if (!row) {
    throw new GraphQLError("Failed to update email readiness check", {
      extensions: { code: "INTERNAL_ERROR" },
    });
  }
  return emailReadinessCheckPayload(row);
}

export async function upsertEmailSpacePolicy(
  _parent: unknown,
  args: {
    input: {
      spaceId: string;
      providerInstallId?: string | null;
      enabled?: boolean | null;
      registeredUsersAllowed?: boolean | null;
      privateSpaceMembershipRequired?: boolean | null;
      outsideSenderDefault?: string | null;
      firstSendReviewRequired?: boolean | null;
      policy?: unknown;
    };
  },
  ctx: GraphQLContext,
) {
  const { tenantId } = await requirePluginTenantAdmin(ctx);
  const input = args.input;
  await requireEmailSpace(ctx, tenantId, input.spaceId);
  if (input.providerInstallId) {
    await requireEmailProviderInstall(ctx, tenantId, input.providerInstallId);
  }
  const outsideSenderDefault = normalizeOutsideSenderDefault(
    input.outsideSenderDefault ?? "deny",
  );
  const values = {
    tenant_id: tenantId,
    space_id: input.spaceId,
    provider_install_id: input.providerInstallId ?? null,
    enabled: input.enabled ?? false,
    registered_users_allowed: input.registeredUsersAllowed ?? true,
    private_space_membership_required:
      input.privateSpaceMembershipRequired ?? true,
    outside_sender_default: outsideSenderDefault,
    first_send_review_required: input.firstSendReviewRequired ?? true,
    policy: jsonInput(input.policy, "policy"),
    updated_at: sql`now()`,
  };
  const [row] = await ctx.db
    .insert(emailSpacePolicies)
    .values(values)
    .onConflictDoUpdate({
      target: [emailSpacePolicies.tenant_id, emailSpacePolicies.space_id],
      set: values,
    })
    .returning();
  if (!row) {
    throw new GraphQLError("Failed to upsert email Space policy", {
      extensions: { code: "INTERNAL_ERROR" },
    });
  }
  const allowlists = await ctx.db
    .select()
    .from(emailSpaceSenderAllowlists)
    .where(
      and(
        eq(emailSpaceSenderAllowlists.tenant_id, tenantId),
        eq(emailSpaceSenderAllowlists.space_id, input.spaceId),
      ),
    );
  return emailSpacePolicyPayload(row, allowlists);
}

export async function addEmailSpaceSenderAllowlist(
  _parent: unknown,
  args: {
    input: {
      spaceId: string;
      valueType: string;
      value: string;
      reason?: string | null;
    };
  },
  ctx: GraphQLContext,
) {
  const { tenantId, callerUserId } = await requirePluginTenantAdmin(ctx);
  const input = args.input;
  await requireEmailSpace(ctx, tenantId, input.spaceId);
  const valueType = graphqlEnumToDb(input.valueType);
  const value = normalizeEmailOrDomain(valueType, input.value);
  const [row] = await ctx.db
    .insert(emailSpaceSenderAllowlists)
    .values({
      tenant_id: tenantId,
      space_id: input.spaceId,
      value_type: valueType,
      value,
      reason: input.reason ?? null,
      created_by_user_id: callerUserId,
    })
    .onConflictDoUpdate({
      target: [
        emailSpaceSenderAllowlists.tenant_id,
        emailSpaceSenderAllowlists.space_id,
        emailSpaceSenderAllowlists.value_type,
        emailSpaceSenderAllowlists.value,
      ],
      set: {
        reason: input.reason ?? null,
        created_by_user_id: callerUserId,
      },
    })
    .returning();
  if (!row) {
    throw new GraphQLError("Failed to add email sender allowlist entry", {
      extensions: { code: "INTERNAL_ERROR" },
    });
  }
  return emailSpaceSenderAllowlistPayload(row);
}

export async function removeEmailSpaceSenderAllowlist(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
) {
  const { tenantId } = await requirePluginTenantAdmin(ctx);
  const deleted = await ctx.db
    .delete(emailSpaceSenderAllowlists)
    .where(
      and(
        eq(emailSpaceSenderAllowlists.tenant_id, tenantId),
        eq(emailSpaceSenderAllowlists.id, args.id),
      ),
    )
    .returning({ id: emailSpaceSenderAllowlists.id });
  return deleted.length > 0;
}

async function upsertDomainForProvider(
  ctx: GraphQLContext,
  tenantId: string,
  providerInstallId: string,
  input: NonNullable<ConfigureEmailProviderInput["domain"]>,
) {
  const values = {
    tenant_id: tenantId,
    provider_install_id: providerInstallId,
    domain: normalizeDomain(input.domain),
    ownership_type: graphqlEnumToDb(input.ownershipType),
    status: input.status ? graphqlEnumToDb(input.status) : "pending",
    sending_verified_at: input.sendingVerifiedAt
      ? new Date(input.sendingVerifiedAt)
      : null,
    inbound_verified_at: input.inboundVerifiedAt
      ? new Date(input.inboundVerifiedAt)
      : null,
    dns_records: jsonInput(input.dnsRecords, "dnsRecords"),
    provider_metadata: jsonInput(input.providerMetadata, "providerMetadata"),
    updated_at: sql`now()`,
  };
  const [row] = await ctx.db
    .insert(emailDomains)
    .values(values)
    .onConflictDoUpdate({
      target: [emailDomains.tenant_id, emailDomains.domain],
      set: values,
    })
    .returning();
  if (!row) {
    throw new GraphQLError("Failed to configure email domain", {
      extensions: { code: "INTERNAL_ERROR" },
    });
  }
  return emailDomainPayload(row);
}

function jsonInput(value: unknown, fieldName: string): Record<string, unknown> {
  try {
    return graphqlJsonInput(value);
  } catch {
    throw new GraphQLError(`${fieldName} must be a JSON object`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}

function normalizeOutsideSenderDefault(value: string): "deny" | "allowlist" {
  const normalized = value.trim().toLowerCase();
  if (normalized !== "deny" && normalized !== "allowlist") {
    throw new GraphQLError(
      "outsideSenderDefault must be 'deny' or 'allowlist'",
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }
  return normalized;
}

export const emailChannelMutations = {
  configureEmailProvider,
  updateEmailReadinessCheck,
  upsertEmailSpacePolicy,
  addEmailSpaceSenderAllowlist,
  removeEmailSpaceSenderAllowlist,
  saveEmailProviderCredential,
  runEmailReadinessProbe: runEmailReadinessProbeMutation,
};
