import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface DialogState {
  newThread: { open: boolean; defaults?: Partial<{ title: string; agentId: string; teamId: string; status: string; priority: string; type: string }> };
  newAgent: { open: boolean; defaults?: Partial<{ name: string; type: string }> };
  newTeam: { open: boolean; defaults?: Partial<{ name: string }> };
  newRoutine: { open: boolean; defaults?: Partial<{ name: string; teamId: string }> };
}

interface DialogContextValue {
  dialogs: DialogState;
  openNewThread: (defaults?: DialogState["newThread"]["defaults"]) => void;
  openNewAgent: (defaults?: DialogState["newAgent"]["defaults"]) => void;
  openNewTeam: (defaults?: DialogState["newTeam"]["defaults"]) => void;
  openNewRoutine: (defaults?: DialogState["newRoutine"]["defaults"]) => void;
  closeDialog: (key: keyof DialogState) => void;
}

const INITIAL_STATE: DialogState = {
  newThread: { open: false },
  newAgent: { open: false },
  newTeam: { open: false },
  newRoutine: { open: false },
};

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialogs, setDialogs] = useState<DialogState>(INITIAL_STATE);

  const openNewThread = useCallback((defaults?: DialogState["newThread"]["defaults"]) => {
    setDialogs((prev) => ({ ...prev, newThread: { open: true, defaults } }));
  }, []);

  const openNewAgent = useCallback((defaults?: DialogState["newAgent"]["defaults"]) => {
    setDialogs((prev) => ({ ...prev, newAgent: { open: true, defaults } }));
  }, []);

  const openNewTeam = useCallback((defaults?: DialogState["newTeam"]["defaults"]) => {
    setDialogs((prev) => ({ ...prev, newTeam: { open: true, defaults } }));
  }, []);

  const openNewRoutine = useCallback((defaults?: DialogState["newRoutine"]["defaults"]) => {
    setDialogs((prev) => ({ ...prev, newRoutine: { open: true, defaults } }));
  }, []);

  const closeDialog = useCallback((key: keyof DialogState) => {
    setDialogs((prev) => ({ ...prev, [key]: { open: false } }));
  }, []);

  return (
    <DialogContext.Provider
      value={{
        dialogs,
        openNewThread,
        openNewAgent,
        openNewTeam,
        openNewRoutine,
        closeDialog,
      }}
    >
      {children}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used within DialogProvider");
  return ctx;
}
