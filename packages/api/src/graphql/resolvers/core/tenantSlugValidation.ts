import { GraphQLError } from "graphql";
import {
  isReservedTenantSlug,
  TENANT_SLUG_PATTERN,
} from "@thinkwork/database-pg/utils/reserved-slugs";

type PgErrorLike = {
  code?: unknown;
  cause?: unknown;
};

export function tenantSlugError(message: string, code: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } });
}

export function validateTenantSlug(slug: string): void {
  if (!TENANT_SLUG_PATTERN.test(slug)) {
    throw tenantSlugError(
      "Tenant slug must be 3-30 lowercase letters, numbers, or hyphens, and cannot start or end with a hyphen",
      "INVALID_SLUG",
    );
  }
  if (isReservedTenantSlug(slug)) {
    throw tenantSlugError("Tenant slug is reserved", "RESERVED_SLUG");
  }
}

export function hasPgErrorCode(err: unknown, code: string): boolean {
  let current: unknown = err;
  while (current && typeof current === "object") {
    const maybe = current as PgErrorLike;
    if (maybe.code === code) return true;
    current = maybe.cause;
  }
  return false;
}
