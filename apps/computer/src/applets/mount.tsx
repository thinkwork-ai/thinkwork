import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  IframeAppletController,
  type IframeControllerStatus,
} from "@/applets/iframe-controller";
import type { AppletPayload } from "@/lib/app-artifacts";

const THEME_VARIABLES = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--border",
  "--input",
  "--ring",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  "--sidebar-ring",
] as const;

function readHostThemeOverrides(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const computed = window.getComputedStyle(document.documentElement);
  const overrides: Record<string, string> = {};
  for (const name of THEME_VARIABLES) {
    const value = computed.getPropertyValue(name).trim();
    if (value) overrides[name] = value;
  }
  return overrides;
}

function readHostTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Generated app artifacts always mount through the iframe substrate.
 * There is intentionally no same-origin generated-code fallback: if
 * sandbox infrastructure is missing, rendering should fail closed
 * instead of executing LLM-authored code inside computer.thinkwork.ai.
 */
export interface AppletMountProps {
  appId: string;
  instanceId: string;
  source: string;
  version: number;
  onHeaderActionChange?: (action: ReactNode | null) => void;
  hideRefreshControl?: boolean;
  fitContentHeight?: boolean;
}

export function AppletMount(props: AppletMountProps) {
  return <IframeAppletMount {...props} />;
}

/* ─────────────────────────────────────────────────────────────────
 * Iframe path (production default)
 * ───────────────────────────────────────────────────────────────── */

function IframeAppletMount({
  appId,
  instanceId,
  source,
  version,
  onHeaderActionChange,
  fitContentHeight = false,
}: AppletMountProps) {
  const [theme, setTheme] = useState<"light" | "dark">(readHostTheme);
  const [status, setStatus] = useState<IframeControllerStatus | "loading">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<IframeAppletController | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    if (typeof MutationObserver !== "function") return;
    const observer = new MutationObserver(() => setTheme(readHostTheme()));
    observer.observe(document.documentElement, {
      attributeFilter: ["class"],
      attributes: true,
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    const container = containerRef.current;
    if (!container) return;

    const controller = new IframeAppletController({
      tsx: source,
      version: String(version),
      theme: themeRef.current,
      themeOverrides: readHostThemeOverrides(),
      onError: (payload) => {
        if (cancelled) return;
        setStatus("errored");
        setError(payload.message);
      },
      fitContentHeight,
    });
    controllerRef.current = controller;
    container.replaceChildren(controller.element);

    controller.ready
      .then(() => {
        if (cancelled) return;
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus("errored");
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      controller.dispose();
      controllerRef.current = null;
      if (container) container.replaceChildren();
    };
  }, [appId, instanceId, source, version]);

  useEffect(() => {
    controllerRef.current?.applyTheme(readHostThemeOverrides(), theme);
  }, [theme]);

  useEffect(() => {
    if (!onHeaderActionChange) return;
    onHeaderActionChange(null);
    return () => onHeaderActionChange(null);
  }, [onHeaderActionChange]);

  return (
    <div
      className={
        fitContentHeight
          ? "grid min-h-0 min-w-0"
          : "grid h-full min-h-0 min-w-0"
      }
    >
      {status === "loading" || status === "pending" ? <AppletLoading /> : null}
      {status === "errored" ? (
        <AppletFailure>{error ?? "App mount failed."}</AppletFailure>
      ) : null}
      {/* The iframe element is appended into this div by the
          controller's lifecycle. Always render the host so the
          element has a stable mount point even before the controller
          attaches. */}
      <div
        ref={containerRef}
        data-testid="applet-iframe-host"
        className={
          fitContentHeight
            ? "min-h-0 min-w-0 overflow-x-hidden"
            : "h-full min-h-0 min-w-0 overflow-x-hidden"
        }
      />
    </div>
  );
}

export function useAppletInstanceId(appId: string) {
  const [instanceId, setInstanceId] = useState(() =>
    storedAppletInstanceId(appId),
  );

  useEffect(() => {
    setInstanceId(storedAppletInstanceId(appId));
  }, [appId]);

  return instanceId;
}

function storedAppletInstanceId(appId: string) {
  const key = `thinkwork:applet-instance:${appId}`;
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const next =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.sessionStorage.setItem(key, next);
  return next;
}

export function AppletLoading() {
  return (
    <div className="rounded-lg border border-border/70 bg-background p-6 text-sm text-muted-foreground">
      Loading artifact...
    </div>
  );
}

export function AppletFailure({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-background p-6 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function appletSource(applet: AppletPayload | null): string | null {
  if (!applet) return null;
  if (typeof applet.source === "string" && applet.source.trim()) {
    return applet.source;
  }
  if (applet.files && typeof applet.files["App.tsx"] === "string") {
    return applet.files["App.tsx"];
  }
  return null;
}
