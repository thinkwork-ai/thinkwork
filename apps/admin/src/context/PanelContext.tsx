import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

const STORAGE_KEY = "thinkwork.panel-visible";

interface PanelContextValue {
  isOpen: boolean;
  content: ReactNode | null;
  open: (content: ReactNode) => void;
  close: () => void;
  toggle: (content?: ReactNode) => void;
}

const PanelContext = createContext<PanelContextValue | null>(null);

function readPreference(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

function writePreference(visible: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, String(visible));
  } catch {
    // Ignore storage failures.
  }
}

export function PanelProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode | null>(null);
  const [isOpen, setIsOpen] = useState(readPreference);

  const open = useCallback((node: ReactNode) => {
    setContent(node);
    setIsOpen(true);
    writePreference(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setContent(null);
    writePreference(false);
  }, []);

  const toggle = useCallback((node?: ReactNode) => {
    setIsOpen((prev) => {
      const next = !prev;
      writePreference(next);
      if (next && node !== undefined) {
        setContent(node);
      }
      if (!next) {
        setContent(null);
      }
      return next;
    });
  }, []);

  return (
    <PanelContext.Provider value={{ isOpen, content, open, close, toggle }}>
      {children}
    </PanelContext.Provider>
  );
}

export function usePanel() {
  const ctx = useContext(PanelContext);
  if (!ctx) throw new Error("usePanel must be used within PanelProvider");
  return ctx;
}
