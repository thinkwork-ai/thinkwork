import { useEffect, useId, useRef } from "react";
import { useTheme } from "@thinkwork/ui";
import { buildMcpAppHostContext } from "./mcp-app-host-context";
import { McpAppFrameBridge } from "./mcp-app-frame-bridge";

export interface McpAppFrameProps {
  html: string;
  title: string;
  uri?: string;
}

export function McpAppFrame({ html, title, uri }: McpAppFrameProps) {
  const { theme } = useTheme();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeRef = useRef<McpAppFrameBridge | null>(null);
  const channelId = useId();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const bridge = new McpAppFrameBridge({
      channelId,
      frameWindow: () => iframeRef.current?.contentWindow ?? null,
      getHostContext: () => buildMcpAppHostContext(themeRef.current),
    });
    bridgeRef.current = bridge;
    const handleMessage = (event: MessageEvent) => bridge.handleMessage(event);
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (bridgeRef.current === bridge) bridgeRef.current = null;
    };
  }, [channelId]);

  useEffect(() => {
    bridgeRef.current?.notifyHostContextChanged(buildMcpAppHostContext(theme));
  }, [theme]);

  return (
    <div
      className="not-prose overflow-hidden rounded-lg border border-border bg-background"
      data-testid="mcp-app-frame"
    >
      <div className="flex min-w-0 items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {title}
          </div>
          {uri ? (
            <div className="truncate text-xs text-muted-foreground">{uri}</div>
          ) : null}
        </div>
      </div>
      <iframe
        ref={iframeRef}
        title={title}
        srcDoc={html}
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        className="block h-[560px] w-full bg-background"
      />
    </div>
  );
}
