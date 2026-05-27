import { useEffect, useState } from "react";
import type { UpdateState } from "@thinkwork/desktop-ipc";
import { Button, cn, Spinner } from "@thinkwork/ui";
import { getDesktopBridge } from "@/lib/desktop-runtime";
import { isDesktop } from "@/lib/desktop-detection";

type DesktopUpdateBridge = NonNullable<ReturnType<typeof getDesktopBridge>>;

export function DesktopUpdateBadge({ className }: { className?: string }) {
  const updateState = useDesktopUpdateState();

  if (!updateState || !shouldShowUpdateControl(updateState)) return null;

  const bridge = getDesktopBridge();
  const action = updateAction(updateState);
  const label = updateLabel(updateState);
  const title = updateTitle(updateState);

  return (
    <Button
      type="button"
      size="sm"
      variant={action?.variant ?? "secondary"}
      className={cn(
        "h-[22px] min-h-0 rounded-full border border-[#54a9ff]/60 bg-[#2f9bff] px-2.5 py-0 text-xs font-medium leading-none text-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] hover:bg-[#2388e6] disabled:border-[#3a3a3a] disabled:bg-[#2d2d2d] disabled:text-[#a5a5a5]",
        className,
      )}
      title={title}
      aria-label={title}
      disabled={!action || !bridge}
      onClick={() => {
        if (!action || !bridge) return;
        void action.run(bridge);
      }}
    >
      {updateState.status === "checking" ||
      updateState.status === "downloading" ? (
        <Spinner className="size-3" />
      ) : null}
      {label}
    </Button>
  );
}

export function UpdateBanner() {
  const updateState = useDesktopUpdateState();

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
            {action.bannerLabel}
          </Button>
        )}
      </div>
    </section>
  );
}

function useDesktopUpdateState() {
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

  return updateState;
}

function shouldShowBanner(state: UpdateState): boolean {
  return state.status !== "disabled" && state.status !== "up-to-date";
}

function shouldShowUpdateControl(state: UpdateState): boolean {
  return (
    state.status === "available" ||
    state.status === "downloading" ||
    state.status === "downloaded" ||
    (state.status === "error" && state.canRetry)
  );
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
  bannerLabel: string;
  variant: "default" | "outline" | "secondary";
  run: (bridge: DesktopUpdateBridge) => void;
} | null {
  switch (state.status) {
    case "available":
      return {
        bannerLabel: "Download",
        variant: "default",
        run: (bridge) => {
          void bridge.downloadUpdate();
        },
      };
    case "downloaded":
      return {
        bannerLabel: "Restart to install",
        variant: "default",
        run: (bridge) => {
          void bridge.installUpdate();
        },
      };
    case "error":
      if (!state.canRetry) return null;
      return {
        bannerLabel: "Retry",
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

function updateLabel(state: UpdateState): string {
  switch (state.status) {
    case "available":
      return "Update";
    case "downloading":
      return formatCompactPercent(state.downloadPercent);
    case "downloaded":
      return "Restart";
    case "error":
      return "Retry";
    case "checking":
      return "Checking";
    case "disabled":
    case "up-to-date":
      return "";
  }
}

function updateTitle(state: UpdateState): string {
  switch (state.status) {
    case "available":
      return `Download update ${formatVersion(state.availableVersion)}`;
    case "downloading":
      return `Downloading update${formatPercent(state.downloadPercent)}`;
    case "downloaded":
      return `Restart to install update ${formatVersion(state.downloadedVersion)}`;
    case "error":
      return state.message ? `Retry update: ${state.message}` : "Retry update";
    case "checking":
      return "Checking for updates";
    case "disabled":
    case "up-to-date":
      return "";
  }
}

function formatVersion(version: string | null): string {
  return version ? `v${version}` : "available";
}

function formatPercent(percent: number | null): string {
  return typeof percent === "number" ? ` ${Math.round(percent)}%...` : "...";
}

function formatCompactPercent(percent: number | null): string {
  return typeof percent === "number" ? `${Math.round(percent)}%` : "Updating";
}
