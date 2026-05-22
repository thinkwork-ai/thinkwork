const SPACE_EMAIL_DOMAIN = "agents.thinkwork.ai";
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const SPACE_LOCAL_PART_PATTERN = /^([a-z0-9-]+)\.([a-z0-9-]+)$/;

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
  return `${tenantSlug}.${spaceSlug}@${SPACE_EMAIL_DOMAIN}`;
}

export function parseSpaceAddress(
  localPart: string,
): { tenantSlug: string; spaceSlug: string } | null {
  const match = localPart.trim().toLowerCase().match(SPACE_LOCAL_PART_PATTERN);
  if (!match) return null;
  return { tenantSlug: match[1], spaceSlug: match[2] };
}
