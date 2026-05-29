import { Cloud, CloudOff } from "lucide-react";
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
  // The toggle reflects the user's choice directly (managed ↔ local). It used
  // to gate switching-to-local on a "healthy" local-Pi status, which made the
  // button a silent no-op whenever the sidecar wasn't reporting ready — the
  // opposite of the point. The runtime decides any fallback at send time.
  const mode: AgentRuntimeMode = !agentEnabled ? "disabled" : preference;
  // managed = blue cloud, local = muted (non-blue) cloud, disabled = cloud-off.
  const Icon = mode === "disabled" ? CloudOff : Cloud;
  const title = AGENT_RUNTIME_COPY[mode];
  const isDisabled = disabled || !agentEnabled;
  const buttonClassName = cn(
    // No hover background and no hover color-flip — the icon keeps its state
    // color (blue = managed) instead of greying out, which read as confusing.
    "flex size-8 shrink-0 items-center justify-center rounded-lg transition-opacity",
    tone === "dark" ? "text-white/45" : "text-muted-foreground",
    mode === "managed" && "text-[#54a9ff]",
    mode === "disabled" &&
      (tone === "dark" ? "text-white/25 opacity-70" : "opacity-45"),
    !isDisabled && "hover:opacity-80",
    className,
  );

  function togglePreference() {
    if (isDisabled) return;
    onPreferenceChange?.(preference === "managed" ? "local" : "managed");
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

const AGENT_RUNTIME_COPY: Record<AgentRuntimeMode, string> = {
  disabled: "Agent is off; cloud runtime disabled",
  local: "Run this turn on local Pi (click for managed cloud)",
  managed: "Run this turn on managed cloud (click for local Pi)",
};
