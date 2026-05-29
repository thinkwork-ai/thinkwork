import { Moon, Sun } from "lucide-react";
import { cn, useTheme } from "@thinkwork/ui";
import {
  SettingsHeader,
  SettingsPane,
  SettingsSection,
} from "@/components/settings/SettingsContent";

const OPTIONS = [
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "dark" as const, label: "Dark", icon: Moon },
];

export function SettingsAppearance() {
  const { theme, setTheme } = useTheme();

  return (
    <SettingsPane>
      <SettingsHeader
        title="Appearance"
        description="Choose how ThinkWork looks on this device."
      />
      <SettingsSection label="Theme">
        <div className="grid grid-cols-2 gap-3 p-4">
          {OPTIONS.map((option) => {
            const active = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => setTheme(option.value)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-accent/50",
                )}
              >
                <option.icon className="size-5 shrink-0" />
                <span className="text-sm font-medium">{option.label}</span>
                <span
                  className={cn(
                    "ml-auto size-3 rounded-full border",
                    active ? "border-primary bg-primary" : "border-border",
                  )}
                />
              </button>
            );
          })}
        </div>
      </SettingsSection>
    </SettingsPane>
  );
}
