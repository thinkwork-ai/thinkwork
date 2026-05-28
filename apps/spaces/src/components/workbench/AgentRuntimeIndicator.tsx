import { Cloud, CloudOff } from "lucide-react";
import type { DesktopLocalPiDisplayStatus } from "@/lib/desktop-runtime";
import { useDesktopLocalPiStatus } from "@/lib/use-desktop-local-pi-status";
import { cn } from "@/lib/utils";

export type AgentRuntimePreference = "local" | "managed";
type AgentRuntimeMode = "disabled" | "local" | "managed";

export function AgentRuntimeIndicator({
  agentEnabled,
  className,
  disabled = false,
  onPreferenceChange,
  preference,
  tone = "default",
}: {
  agentEnabled: boolean;
  className?: string;
  disabled?: boolean;
  onPreferenceChange?: (preference: AgentRuntimePreference) => void;
  preference: AgentRuntimePreference;
  tone?: "default" | "dark";
}) {
  const localPiStatus = useDesktopLocalPiStatus();
  const localAvailable = isLocalPiAvailable(localPiStatus);
  const mode = resolveAgentRuntimeMode(
    agentEnabled,
    localAvailable,
    preference,
  );
  const Icon = mode === "disabled" ? CloudOff : Cloud;
  const title = AGENT_RUNTIME_COPY[mode];
  const isDisabled = disabled || !agentEnabled;
  const buttonClassName = cn(
    "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
    tone === "dark" ? "text-white/45" : "text-muted-foreground",
    mode === "managed" && "text-[#54a9ff]",
    mode === "disabled" &&
      (tone === "dark" ? "text-white/25 opacity-70" : "opacity-45"),
    !isDisabled &&
      (tone === "dark"
        ? "hover:bg-white/10 hover:text-white"
        : "hover:bg-muted hover:text-foreground"),
    className,
  );

  function togglePreference() {
    if (isDisabled) return;
    if (mode === "managed" && localAvailable) {
      onPreferenceChange?.("local");
      return;
    }
    onPreferenceChange?.("managed");
  }

  return (
    <button
      type="button"
      aria-pressed={mode === "managed"}
      disabled={isDisabled}
      aria-label={title}
      title={title}
      className={buttonClassName}
      onClick={togglePreference}
    >
      <Icon className="size-5" />
    </button>
  );
}

function resolveAgentRuntimeMode(
  agentEnabled: boolean,
  localAvailable: boolean,
  preference: AgentRuntimePreference,
): AgentRuntimeMode {
  if (!agentEnabled) return "disabled";
  if (preference === "managed") return "managed";
  if (localAvailable) return "local";
  return "managed";
}

function isLocalPiAvailable(status: DesktopLocalPiDisplayStatus): boolean {
  return status === "healthy" || status === "starting" || status === "running";
}

const AGENT_RUNTIME_COPY: Record<AgentRuntimeMode, string> = {
  disabled: "Agent is off; cloud runtime disabled",
  local: "Local Pi will handle this turn",
  managed: "Managed AgentCore will handle this turn",
};
