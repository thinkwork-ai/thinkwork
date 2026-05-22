import { useEffect, useState } from "react";
import type { UpdateState } from "@thinkwork/desktop-ipc";
import { Button } from "@thinkwork/ui";
import { getDesktopBridge } from "@/lib/desktop-runtime";
import { isDesktop } from "@/lib/desktop-detection";

export function UpdateBanner() {
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);

  useEffect(() => {
    if (!isDesktop()) return;

    const bridge = getDesktopBridge();
    if (!bridge) return;

    let mounted = true;
    void bridge.getUpdateState().then((state) => {
      if (mounted) setUpdateState(state);
    });
    const unsubscribe = bridge.onUpdateState((state) => {
      setUpdateState(state);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  if (!updateState || !shouldShowBanner(updateState)) return null;

  const bridge = getDesktopBridge();
  const message = updateMessage(updateState);
  const action = updateAction(updateState);
  const showRosettaHint =
    updateState.runningUnderArm64Translation && !!updateState.availableVersion;

  return (
    <section
      className="border-b border-border/70 bg-muted/60 px-4 py-2 text-sm"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex min-h-9 max-w-6xl flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{message}</p>
          {showRosettaHint && (
            <p className="text-xs text-muted-foreground">
              You are running the Intel build on Apple silicon. Prefer the arm64
              build when it is available.
            </p>
          )}
        </div>
        {action && bridge && (
          <Button
            size="sm"
            variant={action.variant}
            onClick={() => void action.run(bridge)}
          >
            {action.label}
          </Button>
        )}
      </div>
    </section>
  );
}

function shouldShowBanner(state: UpdateState): boolean {
  return state.status !== "disabled" && state.status !== "up-to-date";
}

function updateMessage(state: UpdateState): string {
  switch (state.status) {
    case "checking":
      return "Checking for updates...";
    case "available":
      return `Update ${formatVersion(state.availableVersion)} available`;
    case "downloading":
      return `Downloading update${formatPercent(state.downloadPercent)}`;
    case "downloaded":
      return `Update ${formatVersion(state.downloadedVersion)} downloaded`;
    case "error":
      return `Update failed${state.message ? `: ${state.message}` : ""}`;
    case "disabled":
    case "up-to-date":
      return "";
  }
}

function updateAction(state: UpdateState): {
  label: string;
  variant: "default" | "outline";
  run: (bridge: NonNullable<ReturnType<typeof getDesktopBridge>>) => void;
} | null {
  switch (state.status) {
    case "available":
      return {
        label: "Download",
        variant: "default",
        run: (bridge) => {
          void bridge.downloadUpdate();
        },
      };
    case "downloaded":
      return {
        label: "Restart to install",
        variant: "default",
        run: (bridge) => {
          void bridge.installUpdate();
        },
      };
    case "error":
      if (!state.canRetry) return null;
      return {
        label: "Retry",
        variant: "outline",
        run: (bridge) => {
          void bridge.checkForUpdates();
        },
      };
    case "checking":
    case "downloading":
    case "disabled":
    case "up-to-date":
      return null;
  }
}

function formatVersion(version: string | null): string {
  return version ? `v${version}` : "available";
}

function formatPercent(percent: number | null): string {
  return typeof percent === "number" ? ` ${Math.round(percent)}%...` : "...";
}
