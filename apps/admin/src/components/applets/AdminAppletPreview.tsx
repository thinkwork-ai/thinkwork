import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type EnvelopeKind =
  | "init"
  | "ready"
  | "ready-with-component"
  | "resize"
  | "state-read"
  | "state-write"
  | "error";

interface Envelope<P = unknown> {
  v: 1;
  kind: EnvelopeKind;
  payload: P;
  msgId: string;
  replyTo?: string;
  channelId: string;
}

interface AdminAppletPreviewProps {
  source: string;
  version: number;
  title: string;
  className?: string;
}

const THEME_VARIABLES = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
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
] as const;

declare const __SANDBOX_IFRAME_SRC__: string;

export function AdminAppletPreview({
  source,
  version,
  title,
  className,
}: AdminAppletPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const channelId = useMemo(() => newChannelId(), [source, version]);
  const [status, setStatus] = useState<"loading" | "ready" | "errored">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const iframeSrc = useMemo(
    () => iframeSrcForInitialTheme(resolveAdminSandboxIframeSrc(), readTheme()),
    [],
  );

  const postEnvelope = useCallback(
    <P,>(kind: EnvelopeKind, payload: P, replyTo?: string) => {
      const target = iframeRef.current?.contentWindow;
      if (!target) return;
      target.postMessage(buildEnvelope(kind, payload, channelId, replyTo), "*");
    },
    [channelId],
  );

  const postInit = useCallback(() => {
    setStatus("loading");
    setError(null);
    postEnvelope("init", {
      tsx: source,
      version: String(version),
      theme: readTheme(),
      themeOverrides: readThemeOverrides(),
      fitContentHeight: false,
    });
  }, [postEnvelope, source, version]);

  useEffect(() => {
    setStatus("loading");
    setError(null);
  }, [channelId]);

  useEffect(() => {
    postInit();
  }, [postInit]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const envelope = validateEnvelope(event.data, channelId);
      if (!envelope) return;

      if (envelope.kind === "ready") {
        postInit();
        return;
      }

      if (envelope.kind === "ready-with-component") {
        setStatus("ready");
        return;
      }

      if (envelope.kind === "error") {
        const payload = envelope.payload as { message?: unknown };
        setStatus("errored");
        setError(
          typeof payload.message === "string"
            ? payload.message
            : "App render failed.",
        );
        return;
      }

      if (envelope.kind === "state-read" || envelope.kind === "state-write") {
        postEnvelope(
          "error",
          {
            code: "RUNTIME_ERROR",
            message: "Applet state is unavailable in admin preview.",
          },
          envelope.msgId,
        );
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [channelId, postEnvelope, postInit]);

  return (
    <section
      className={cn(
        "relative h-full min-h-0 overflow-hidden rounded-md border bg-background",
        className,
      )}
      data-testid="admin-applet-preview"
    >
      {status !== "ready" ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 border-b bg-background/95 px-4 py-3 text-sm text-muted-foreground">
          {status === "errored"
            ? (error ?? "App render failed.")
            : "Loading app..."}
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        title={`${title} preview`}
        sandbox="allow-scripts"
        src={iframeSrc}
        className="h-full w-full bg-background"
        onLoad={postInit}
      />
    </section>
  );
}

export function resolveAdminSandboxIframeSrc(): string {
  if (
    typeof __SANDBOX_IFRAME_SRC__ !== "undefined" &&
    typeof __SANDBOX_IFRAME_SRC__ === "string" &&
    __SANDBOX_IFRAME_SRC__.length > 0
  ) {
    return __SANDBOX_IFRAME_SRC__;
  }

  const envValue = import.meta.env.VITE_SANDBOX_IFRAME_SRC;
  if (typeof envValue === "string" && envValue.length > 0) return envValue;

  return import.meta.env.MODE === "development"
    ? "http://localhost:5175/iframe-shell.html"
    : "https://sandbox.thinkwork.ai/iframe-shell.html";
}

function iframeSrcForInitialTheme(src: string, theme: "light" | "dark") {
  if (theme !== "dark") return src;
  try {
    const url = new URL(src, window.location.href);
    if (url.pathname.endsWith("/iframe-shell.html")) {
      url.pathname = url.pathname.replace(
        /iframe-shell\.html$/,
        "iframe-shell-dark.html",
      );
    }
    url.searchParams.set("tw-theme", theme);
    return url.toString();
  } catch {
    return src;
  }
}

function readTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function readThemeOverrides(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const computed = window.getComputedStyle(document.documentElement);
  const overrides: Record<string, string> = {};
  for (const name of THEME_VARIABLES) {
    const value = computed.getPropertyValue(name).trim();
    if (value) overrides[name] = value;
  }
  return overrides;
}

function validateEnvelope(raw: unknown, channelId: string): Envelope | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.v !== 1) return null;
  if (candidate.channelId !== channelId) return null;
  if (typeof candidate.kind !== "string") return null;
  if (typeof candidate.msgId !== "string") return null;
  if (!KNOWN_KINDS.has(candidate.kind)) return null;
  return candidate as unknown as Envelope;
}

function buildEnvelope<P>(
  kind: EnvelopeKind,
  payload: P,
  channelId: string,
  replyTo?: string,
): Envelope<P> {
  return {
    v: 1,
    kind,
    payload,
    msgId: newChannelId(),
    replyTo,
    channelId,
  };
}

function newChannelId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const KNOWN_KINDS = new Set<string>([
  "init",
  "ready",
  "ready-with-component",
  "resize",
  "state-read",
  "state-write",
  "error",
]);
