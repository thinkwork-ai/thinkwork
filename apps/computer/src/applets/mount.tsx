import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import type { AppletRefreshResult } from "@thinkwork/computer-stdlib";
import { registerAppletRefreshHandler } from "@/applets/host-applet-api";
import { loadAppletHostExternals } from "@/applets/host-registry";
import { transformApplet } from "@/applets/transform/transform";
import { AppRefreshControl } from "@/components/apps/AppRefreshControl";
import { AppletErrorBoundary } from "@/components/apps/AppletErrorBoundary";
import {
  IframeAppletController,
  type IframeControllerStatus,
} from "@/applets/iframe-controller";
import { isLegacyLoaderEnabled } from "@/applets/_testing/legacy-loader";
import type { AppletPayload } from "@/lib/app-artifacts";

export type AppletModule = {
  default?: ComponentType<AppletComponentProps>;
  refresh?: () => Promise<AppletRefreshResult>;
};

export type AppletModuleLoader = (moduleUrl: string) => Promise<AppletModule>;

export interface AppletComponentProps {
  appId: string;
  instanceId: string;
  refreshData?: unknown;
}

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
 * Plan-012 U11.5: production AppletMount uses IframeAppletController
 * by default. The legacy same-origin module loader stays available
 * behind `VITE_APPLET_LEGACY_LOADER === "true"` for emergency
 * rollback. After Phase 2 stabilizes ≥1 week, a follow-up cleanup PR
 * removes the legacy path, the same-origin host registry, and the
 * transform/ directory.
 *
 * The `loadModule` prop on AppletMountProps survives only as a test
 * seam for the legacy path. Iframe-mode does not consume it.
 */
export const defaultAppletModuleLoader: AppletModuleLoader = (moduleUrl) =>
  import(/* @vite-ignore */ moduleUrl) as Promise<AppletModule>;

export interface AppletMountProps {
  appId: string;
  instanceId: string;
  source: string;
  version: number;
  /** Legacy same-origin loader override (test seam; production uses
   * the iframe substrate). */
  loadModule?: AppletModuleLoader;
  onHeaderActionChange?: (action: ReactNode | null) => void;
  hideRefreshControl?: boolean;
  fitContentHeight?: boolean;
}

export function AppletMount(props: AppletMountProps) {
  // Production cutover: iframe is the default, legacy is the rollback
  // flag. Test runs that explicitly pass loadModule still hit the
  // legacy code path so the existing applet test suite keeps working
  // without an iframe in JSDOM.
  const useIframe = !isLegacyLoaderEnabled() && props.loadModule === undefined;
  return useIframe ? (
    <IframeAppletMount {...props} />
  ) : (
    <LegacyAppletMount {...props} />
  );
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
  hideRefreshControl = false,
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
    <div className={fitContentHeight ? "grid min-h-0 min-w-0" : "grid h-full min-h-0 min-w-0"}>
      {!hideRefreshControl && !onHeaderActionChange ? null : null}
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

/* ─────────────────────────────────────────────────────────────────
 * Legacy same-origin path (rollback flag)
 * ───────────────────────────────────────────────────────────────── */

function LegacyAppletMount({
  appId,
  instanceId,
  source,
  version,
  loadModule = defaultAppletModuleLoader,
  onHeaderActionChange,
  hideRefreshControl = false,
}: AppletMountProps) {
  const [state, setState] = useState<
    | { status: "loading" }
    | {
        status: "ready";
        Component: ComponentType<AppletComponentProps>;
        resetKey: string;
        refresh?: () => Promise<AppletRefreshResult>;
      }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [refreshData, setRefreshData] = useState<unknown>();

  useEffect(() => {
    let cancelled = false;

    async function mount() {
      setState({ status: "loading" });
      setRefreshData(undefined);
      registerAppletRefreshHandler(appId, instanceId, null);
      await loadAppletHostExternals();
      const transformed = await transformApplet(source, version, { appId });
      if (cancelled) return;
      if (!transformed.ok) {
        setState({ status: "error", message: transformed.error.message });
        return;
      }

      const module = await loadModule(transformed.compiledModuleUrl);
      if (cancelled) return;
      if (typeof module.default !== "function") {
        setState({
          status: "error",
          message: "App module must export a default React component.",
        });
        return;
      }

      setState({
        status: "ready",
        Component: module.default,
        resetKey: transformed.cacheKey,
        refresh: module.refresh,
      });
      registerAppletRefreshHandler(appId, instanceId, module.refresh ?? null);
    }

    mount().catch((error: unknown) => {
      if (cancelled) return;
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "App mount failed.",
      });
    });

    return () => {
      cancelled = true;
      registerAppletRefreshHandler(appId, instanceId, null);
    };
  }, [appId, instanceId, loadModule, source, version]);

  useEffect(() => {
    if (!onHeaderActionChange) return;
    if (state.status !== "ready" || !state.refresh) {
      onHeaderActionChange(null);
      return;
    }

    onHeaderActionChange(
      <AppRefreshControl onRefresh={state.refresh} onData={setRefreshData} />,
    );
    return () => onHeaderActionChange(null);
  }, [onHeaderActionChange, state]);

  if (state.status === "loading") {
    return <AppletLoading />;
  }

  if (state.status === "error") {
    return <AppletFailure>{state.message}</AppletFailure>;
  }

  const MountedApplet = state.Component;
  return (
    <div className="grid min-w-0">
      {state.refresh && !hideRefreshControl && !onHeaderActionChange ? (
        <AppRefreshControl onRefresh={state.refresh} onData={setRefreshData} />
      ) : null}
      <AppletErrorBoundary resetKey={state.resetKey}>
        <div className="min-w-0 overflow-x-hidden">
          <MountedApplet
            appId={appId}
            instanceId={instanceId}
            refreshData={refreshData}
          />
        </div>
      </AppletErrorBoundary>
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
