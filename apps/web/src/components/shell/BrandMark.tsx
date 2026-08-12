import { useLayoutEffect, useRef } from "react";
import { cn } from "@thinkwork/ui";
import { useTenantBranding } from "@/hooks/useTenantBranding";

// Header text auto-fits the space left of the logo: it renders at the
// default nav-title size and scales down (never below the minimum) until it
// fits on one line. Below the minimum it truncates with an ellipsis.
const MAX_BRAND_FONT_PX = 16; // matches the default text-base header
const MIN_BRAND_FONT_PX = 11;

/**
 * Logo + optional header text for the app/settings nav headers, driven by
 * tenant white-label branding (Settings → General → Appearance). Renders an
 * empty placeholder until branding resolves so white-labeled tenants never
 * flash the default mark.
 *
 * `collapsible` adds the icon-rail behavior used by the main app sidebar
 * (text hides, a wide custom logo shrinks into the w-7 slot).
 */
/**
 * Attribution line at the bottom of the nav sidebars, shown only when the
 * tenant runs a custom (white-label) logo.
 */
export function PoweredByThinkWork({ className }: { className?: string }) {
  const { isCustomLogo, loaded } = useTenantBranding();
  if (!loaded || !isCustomLogo) return null;
  return (
    <div
      className={cn(
        "px-3 pb-2 pt-1 text-[11px] leading-none text-sidebar-foreground/45 group-data-[collapsible=icon]:hidden",
        className,
      )}
    >
      Powered by ThinkWork
    </div>
  );
}

export function BrandMark({ collapsible = false }: { collapsible?: boolean }) {
  const { logoSrc, isCustomLogo, headerText, loaded } = useTenantBranding();
  const textRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const fit = () => {
      // Measure the text's natural width at the maximum size, then scale
      // the font down proportionally until it fits the allocated width.
      el.style.fontSize = `${MAX_BRAND_FONT_PX}px`;
      const needed = el.scrollWidth;
      const available = el.clientWidth;
      if (needed > available && available > 0) {
        const scaled = (available / needed) * MAX_BRAND_FONT_PX;
        // Round down to 0.5px steps so rounding never re-triggers ellipsis.
        const next = Math.max(MIN_BRAND_FONT_PX, Math.floor(scaled * 2) / 2);
        el.style.fontSize = `${next}px`;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [headerText, loaded]);

  if (!loaded) {
    return <span aria-hidden className="h-7 w-7 shrink-0" />;
  }

  return (
    <>
      <img
        src={logoSrc}
        alt={headerText ?? "Home"}
        className={cn(
          "shrink-0 object-contain",
          // Custom logos render smaller alongside text so a full company
          // name still fits; logo-only mode gets the full header height.
          isCustomLogo
            ? headerText
              ? "h-4.5 w-auto max-w-24 object-left"
              : "h-7 w-auto max-w-44 object-left"
            : "h-7 w-7",
          collapsible && isCustomLogo && "group-data-[collapsible=icon]:w-7",
        )}
      />
      {headerText ? (
        <span
          ref={textRef}
          className={cn(
            "min-w-0 flex-1 truncate font-semibold leading-none tracking-tight",
            collapsible && "group-data-[collapsible=icon]:hidden",
          )}
        >
          {headerText}
        </span>
      ) : null}
    </>
  );
}
