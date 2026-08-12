// Tenant white-label branding stored under `tenant_settings.features.branding`
// (same read-modify-write pattern as `features.artifactStyle`). Shape:
//   { logoDataUrl?: string; headerText?: string; updatedAt: string }
// `headerText` semantics: undefined = default "ThinkWork Agent"; "" = hide the
// text entirely (logo-only header).

export const DEFAULT_HEADER_TEXT = "ThinkWork Agent";
export const DEFAULT_LOGO_SRC = "/logo.png";

/** Max accepted logo file size — the image is stored as a data URL in the
 *  tenant features JSON blob, so keep it small. */
export const MAX_LOGO_BYTES = 300 * 1024;
export const MAX_HEADER_TEXT_LENGTH = 60;

export type TenantBranding = {
  logoDataUrl?: string;
  headerText?: string;
};

export type ResolvedBranding = {
  /** Image src for the nav headers (custom data URL or the bundled default). */
  logoSrc: string;
  /** True when a custom (tenant-uploaded) logo is set — rendered wide. */
  isCustomLogo: boolean;
  /** Header text to render, or null to render the logo only. */
  headerText: string | null;
};

export function normalizeFeatures(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return normalizeRecord(JSON.parse(value)) ?? {};
    } catch {
      return {};
    }
  }
  return normalizeRecord(value) ?? {};
}

export function brandingFromFeatures(
  features: Record<string, unknown>,
): TenantBranding {
  const branding = normalizeRecord(features.branding);
  if (!branding) return {};
  return {
    logoDataUrl:
      typeof branding.logoDataUrl === "string" &&
      branding.logoDataUrl.startsWith("data:image/")
        ? branding.logoDataUrl
        : undefined,
    headerText:
      typeof branding.headerText === "string" ? branding.headerText : undefined,
  };
}

export function resolveBranding(branding: TenantBranding): ResolvedBranding {
  const isCustomLogo = !!branding.logoDataUrl;
  const logoSrc = branding.logoDataUrl ?? DEFAULT_LOGO_SRC;
  let headerText: string | null;
  if (branding.headerText === undefined) {
    headerText = DEFAULT_HEADER_TEXT;
  } else {
    const trimmed = branding.headerText.trim();
    // Blank text means "logo only" — but never render a fully empty header:
    // without a custom logo, fall back to the default title.
    headerText = trimmed ? trimmed : isCustomLogo ? null : DEFAULT_HEADER_TEXT;
  }
  return { logoSrc, isCustomLogo, headerText };
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
