import { and, eq, sql } from "drizzle-orm";
import {
  emailDomains,
  emailProviderInstalls,
  spaces,
  tenants,
} from "@thinkwork/database-pg/schema";

export interface InboundSpaceRoute {
  recipientEmail: string;
  tenantId: string;
  tenantSlug: string;
  spaceId: string;
  spaceSlug: string;
  spaceStatus: string;
  spaceAccessMode: string | null;
  providerInstallId: string;
  domainId: string;
}

export async function resolveInboundSpaceRoute(input: {
  db: {
    select: (fields?: unknown) => any;
  };
  toEmails: string[];
}): Promise<InboundSpaceRoute | null> {
  for (const recipientEmail of input.toEmails.map(normalizeEmail)) {
    const parsed = parseInboundRecipient(recipientEmail);
    if (!parsed) continue;

    const [route] = await input.db
      .select({
        recipientEmail: sql<string>`${recipientEmail}`,
        tenantId: tenants.id,
        tenantSlug: tenants.slug,
        spaceId: spaces.id,
        spaceSlug: spaces.slug,
        spaceStatus: spaces.status,
        spaceAccessMode: spaces.access_mode,
        providerInstallId: emailProviderInstalls.id,
        domainId: emailDomains.id,
      })
      .from(emailDomains)
      .innerJoin(
        emailProviderInstalls,
        eq(emailProviderInstalls.id, emailDomains.provider_install_id),
      )
      .innerJoin(tenants, eq(tenants.id, emailDomains.tenant_id))
      .innerJoin(
        spaces,
        and(
          eq(spaces.tenant_id, tenants.id),
          sql`lower(${spaces.slug}) = ${parsed.localPart}`,
        ),
      )
      .where(
        and(
          parsed.tenantSlug
            ? sql`(lower(${emailDomains.domain}) = ${parsed.domain} or (lower(${emailDomains.domain}) = ${parsed.parentDomain} and lower(${tenants.slug}) = ${parsed.tenantSlug}))`
            : sql`lower(${emailDomains.domain}) = ${parsed.domain}`,
          eq(emailDomains.status, "verified"),
          eq(emailProviderInstalls.status, "ready"),
          eq(emailProviderInstalls.active_for_production, true),
        ),
      )
      .limit(1);

    if (route) return route;
  }

  return null;
}

export function parseInboundRecipient(value: string): {
  localPart: string;
  domain: string;
  parentDomain: string | null;
  tenantSlug: string | null;
} | null {
  const email = normalizeEmail(value);
  const match = email.match(/^([^@\s]+)@([^@\s]+)$/);
  if (!match) return null;
  const domain = match[2]!;
  const thinkworkMatch = domain.match(/^([a-z0-9-]+)\.thinkwork\.ai$/);
  return {
    localPart: match[1]!,
    domain,
    parentDomain: thinkworkMatch ? "thinkwork.ai" : null,
    tenantSlug: thinkworkMatch?.[1] ?? null,
  };
}

export function normalizeEmail(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const angleMatch = trimmed.match(/<([^>]+)>/);
  return (angleMatch?.[1] || trimmed).trim().toLowerCase();
}
