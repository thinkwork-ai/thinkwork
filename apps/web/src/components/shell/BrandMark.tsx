import { cn } from "@thinkwork/ui";
import { useTenantBranding } from "@/hooks/useTenantBranding";

/**
 * Logo + optional header text for the app/settings nav headers, driven by
 * tenant white-label branding (Settings → General → Appearance). Renders an
 * empty placeholder until branding resolves so white-labeled tenants never
 * flash the default mark.
 *
 * `collapsible` adds the icon-rail behavior used by the main app sidebar
 * (text hides, a wide custom logo shrinks into the w-7 slot).
 */
export function BrandMark({ collapsible = false }: { collapsible?: boolean }) {
  const { logoSrc, isCustomLogo, headerText, loaded } = useTenantBranding();

  if (!loaded) {
    return <span aria-hidden className="h-7 w-7 shrink-0" />;
  }

  return (
    <>
      <img
        src={logoSrc}
        alt={headerText ?? "Home"}
        className={cn(
          "h-7 shrink-0 object-contain",
          isCustomLogo ? "w-auto max-w-44 object-left" : "w-7",
          collapsible && isCustomLogo && "group-data-[collapsible=icon]:w-7",
        )}
      />
      {headerText ? (
        <span
          className={cn(
            "truncate text-base font-semibold leading-none tracking-tight",
            collapsible && "group-data-[collapsible=icon]:hidden",
          )}
        >
          {headerText}
        </span>
      ) : null}
    </>
  );
}
