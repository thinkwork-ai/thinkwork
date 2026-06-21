import { SettingsSection } from "@/components/settings/SettingsContent";
import { N8nSettings } from "./N8nSettings";

export function N8nPluginSettings({
  installId,
  installState,
  onChanged,
}: {
  installId: string | null;
  installState: string;
  onChanged: () => void;
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
    />
  );
}
