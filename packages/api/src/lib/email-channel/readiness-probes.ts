import { and, eq, isNull, sql } from "drizzle-orm";
import {
  emailDomains,
  emailProviderInstalls,
  emailReadinessChecks,
  type EmailReadinessCheckKey,
} from "@thinkwork/database-pg/schema";
import type { Database } from "@thinkwork/database-pg";
import { createEmailChannelService } from "./channel-service.js";
import type { EmailProviderKey } from "./provider-contract.js";
import { productionReadinessPassed } from "./readiness.js";

type Db = Database;
type ReadinessCheckRow = typeof emailReadinessChecks.$inferSelect;

export async function runEmailReadinessProbe(input: {
  db: Db;
  tenantId: string;
  providerInstallId: string;
}) {
  const [provider] = await input.db
    .select()
    .from(emailProviderInstalls)
    .where(
      and(
        eq(emailProviderInstalls.tenant_id, input.tenantId),
        eq(emailProviderInstalls.id, input.providerInstallId),
      ),
    )
    .limit(1);
  if (!provider) throw new Error("Email provider install not found");

  const domains = await input.db
    .select()
    .from(emailDomains)
    .where(
      and(
        eq(emailDomains.tenant_id, input.tenantId),
        eq(emailDomains.provider_install_id, provider.id),
      ),
    );
  const existing = await input.db
    .select()
    .from(emailReadinessChecks)
    .where(
      and(
        eq(emailReadinessChecks.tenant_id, input.tenantId),
        eq(emailReadinessChecks.provider_install_id, provider.id),
      ),
    );
  const existingByKey = new Map(
    existing.map((check) => [check.check_key, check]),
  );
  const domain =
    domains.find((candidate) => candidate.status === "verified") ??
    domains[0] ??
    null;
  const providerEventsAlreadyPassed =
    existingByKey.get("provider_events")?.status === "pass";
  const loopTestAlreadyPassed =
    existingByKey.get("loop_test")?.status === "pass";

  const checks = await createEmailChannelService().readinessChecks(
    provider.provider as EmailProviderKey,
    {
      credentialConfigured: Boolean(provider.credential_secret_ref),
      webhookSecretConfigured: Boolean(provider.webhook_secret_ref),
      domainVerified: Boolean(
        domain &&
          (domain.status === "verified" ||
            domain.sending_verified_at ||
            domain.inbound_verified_at),
      ),
      inboundVerified: Boolean(domain?.inbound_verified_at),
      providerEventsReachable: providerEventsAlreadyPassed,
      loopTestPassed: loopTestAlreadyPassed,
    },
  );

  const rows: ReadinessCheckRow[] = [];
  for (const check of checks) {
    const checkKey = check.checkKey as EmailReadinessCheckKey;
    const existingCheck = existingByKey.get(checkKey);
    const values = {
      tenant_id: input.tenantId,
      provider_install_id: provider.id,
      domain_id:
        checkKey === "credentials" || checkKey === "webhook_signature"
          ? null
          : (domain?.id ?? null),
      check_key: checkKey,
      status: check.status,
      failure_code: check.failureCode ?? null,
      failure_message: check.failureMessage ?? null,
      metadata: check.metadata,
      last_checked_at: new Date(),
      updated_at: sql`now()`,
    };
    const [row] = existingCheck
      ? await input.db
          .update(emailReadinessChecks)
          .set(values)
          .where(eq(emailReadinessChecks.id, existingCheck.id))
          .returning()
      : await input.db.insert(emailReadinessChecks).values(values).returning();
    if (row) rows.push(row);
  }

  const productionReady = productionReadinessPassed(checks);
  await input.db
    .update(emailProviderInstalls)
    .set({
      status: productionReady ? "ready" : "pending",
      updated_at: sql`now()`,
    })
    .where(eq(emailProviderInstalls.id, provider.id));

  return {
    providerInstallId: provider.id,
    checks: rows,
    productionReady,
  };
}

export function readinessWhereProviderDomain(input: {
  tenantId: string;
  providerInstallId: string;
  domainId?: string | null;
  checkKey: string;
}) {
  return and(
    eq(emailReadinessChecks.tenant_id, input.tenantId),
    eq(emailReadinessChecks.provider_install_id, input.providerInstallId),
    input.domainId
      ? eq(emailReadinessChecks.domain_id, input.domainId)
      : isNull(emailReadinessChecks.domain_id),
    eq(emailReadinessChecks.check_key, input.checkKey),
  );
}
