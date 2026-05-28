import { useEffect, useState } from "react";
import type { PiSidecarState } from "@thinkwork/desktop-ipc";
import {
  desktopLocalPiDisplayStatus,
  getDesktopBridge,
  type DesktopLocalPiDisplayStatus,
} from "@/lib/desktop-runtime";

export function useDesktopLocalPiStatus(): DesktopLocalPiDisplayStatus {
  const bridge = getDesktopBridge();
  const [state, setState] = useState<PiSidecarState | null>(null);
  const [localTurnRunning, setLocalTurnRunning] = useState(false);
  const [fallbackActive, setFallbackActive] = useState(false);

  useEffect(() => {
    if (!bridge?.pi) return;
    let mounted = true;
    bridge.pi
      .getStatus()
      .then((next) => {
        if (mounted) setState(next);
      })
      .catch(() => {
        if (mounted) setFallbackActive(true);
      });
    const unsubscribe = bridge.pi.onStatusChanged((next) => {
      setState(next);
      if (next.status === "healthy" || next.status === "starting") {
        setFallbackActive(false);
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [bridge]);

  useEffect(() => {
    function handleLocalPiTurn(event: Event) {
      const detail = (event as CustomEvent<{ status?: unknown }>).detail;
      if (detail?.status === "running") {
        setLocalTurnRunning(true);
        setFallbackActive(false);
      } else if (detail?.status === "fallback") {
        setLocalTurnRunning(false);
        setFallbackActive(true);
      } else if (detail?.status === "idle") {
        setLocalTurnRunning(false);
      }
    }

    window.addEventListener(
      "thinkwork:desktop-local-pi-turn",
      handleLocalPiTurn,
    );
    return () =>
      window.removeEventListener(
        "thinkwork:desktop-local-pi-turn",
        handleLocalPiTurn,
      );
  }, []);

  return desktopLocalPiDisplayStatus({
    bridge,
    state,
    localTurnRunning,
    fallbackActive,
  });
}
