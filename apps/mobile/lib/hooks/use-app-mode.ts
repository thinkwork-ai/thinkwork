import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@thinkwork/app-mode";

export type AppMode = "user" | "admin";

export function useAppMode() {
  const [mode, setModeState] = useState<AppMode>("user");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw === "admin") setModeState("admin");
    });
  }, []);

  const setMode = useCallback((m: AppMode) => {
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
  }, []);

  return { mode, setMode, isAdmin: mode === "admin" };
}
