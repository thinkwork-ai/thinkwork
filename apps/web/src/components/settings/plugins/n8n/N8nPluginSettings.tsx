import type { ReactNode } from "react";
import { SettingsSection } from "@/components/settings/SettingsContent";
import { N8nSettings } from "./N8nSettings";

export function N8nPluginSettings({
  installId,
  installState,
  onChanged,
  onRecentAgentStepsActionChange,
}: {
  installId: string | null;
  installState: string;
  onChanged: () => void;
  onRecentAgentStepsActionChange?: (action: ReactNode | null) => void;
}) {
  if (!installId) {
    return (
      <SettingsSection label="n8n Settings">
        <p className="text-sm text-muted-foreground">
          Install the n8n plugin before configuring workflow and package
          settings.
        </p>
      </SettingsSection>
    );
  }

  return (
    <N8nSettings
      installId={installId}
      installState={installState}
      onChanged={onChanged}
      onRecentAgentStepsActionChange={onRecentAgentStepsActionChange}
    />
  );
}
