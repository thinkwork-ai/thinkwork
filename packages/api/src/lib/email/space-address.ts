const SPACE_EMAIL_BASE_DOMAIN = "agents.thinkwork.ai";
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const SPACE_RECIPIENT_PATTERN =
  /^([a-z0-9-]+)\.([a-z0-9-]+)@agents\.thinkwork\.ai$/;

export function deriveSpaceAddress(input: {
  tenantSlug: string;
  spaceSlug: string;
}): string {
  const tenantSlug = input.tenantSlug.trim();
  const spaceSlug = input.spaceSlug.trim();
  if (!SLUG_PATTERN.test(tenantSlug)) {
    throw new Error(
      `Invalid tenant slug for Space email address: ${tenantSlug}`,
    );
  }
  if (!SLUG_PATTERN.test(spaceSlug)) {
    throw new Error(`Invalid Space slug for Space email address: ${spaceSlug}`);
  }
  return `${tenantSlug}.${spaceSlug}@${SPACE_EMAIL_BASE_DOMAIN}`;
}

export function parseSpaceRecipient(
  fullAddress: string,
): { tenantSlug: string; spaceSlug: string } | null {
  const match = fullAddress.trim().toLowerCase().match(SPACE_RECIPIENT_PATTERN);
  if (!match) return null;
  const [, tenantSlug, spaceSlug] = match;
  return { tenantSlug, spaceSlug };
}
