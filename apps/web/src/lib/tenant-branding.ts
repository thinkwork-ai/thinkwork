// Tenant white-label branding stored under `tenant_settings.features.branding`
// (same read-modify-write pattern as `features.artifactStyle`). Shape:
//   { logoDataUrl?: string; headerText?: string; logoHeightPx?: number;
//     updatedAt: string }
// `headerText` semantics: undefined = default "ThinkWork Agent"; "" = hide the
// text entirely (logo-only header).

export const DEFAULT_HEADER_TEXT = "ThinkWork Agent";
export const DEFAULT_LOGO_SRC = "/logo.png";

/** Max accepted logo file size — the image is stored as a data URL in the
 *  tenant features JSON blob, so keep it small. */
export const MAX_LOGO_BYTES = 300 * 1024;
export const MAX_HEADER_TEXT_LENGTH = 60;

/** Height of the custom logo in a logo-only header, clamped. The default
 *  matches the standard 28px (h-7) header mark; larger values let a full
 *  lockup (logo + baked-in company name) fill the header on its own. */
export const DEFAULT_LOGO_HEIGHT_PX = 28;
export const MIN_LOGO_HEIGHT_PX = 20;
export const MAX_LOGO_HEIGHT_PX = 64;

export const LOGO_SIZE_OPTIONS = [
  { label: "Small", px: 28 },
  { label: "Medium", px: 40 },
  { label: "Large", px: 56 },
] as const;

export type TenantBranding = {
  logoDataUrl?: string;
  headerText?: string;
  logoHeightPx?: number;
};

export type ResolvedBranding = {
  /** Image src for the nav headers (custom data URL or the bundled default). */
  logoSrc: string;
  /** True when a custom (tenant-uploaded) logo is set — rendered wide. */
  isCustomLogo: boolean;
  /** Header text to render, or null to render the logo only. */
  headerText: string | null;
  /** Custom-logo height for a logo-only header (defaults to 28). */
  logoHeightPx: number;
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
    logoHeightPx:
      typeof branding.logoHeightPx === "number" &&
      Number.isFinite(branding.logoHeightPx)
        ? Math.min(
            MAX_LOGO_HEIGHT_PX,
            Math.max(MIN_LOGO_HEIGHT_PX, Math.round(branding.logoHeightPx)),
          )
        : undefined,
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
  return {
    logoSrc,
    isCustomLogo,
    headerText,
    logoHeightPx: branding.logoHeightPx ?? DEFAULT_LOGO_HEIGHT_PX,
  };
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
