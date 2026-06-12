import { useEffect, useState } from "react";
import { useMutation } from "urql";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@thinkwork/ui";
import { SettingsUninstallPluginMutation } from "@/lib/settings-queries";
import { componentTypeLabel, type PluginInstall } from "./plugin-state";

/**
 * Destructive uninstall confirmation (plan 2026-06-12-001 U8): shows the
 * component inventory and the activated-user impact, and requires typing the
 * plugin key (the mutation's `destructiveConfirmation`) before enabling the
 * uninstall action — mirroring the managed-application destructive gate.
 */
export function UninstallPluginDialog({
  install,
  displayName,
  open,
  onOpenChange,
  onUninstalled,
}: {
  install: PluginInstall;
  displayName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUninstalled: () => void;
}) {
  const [uninstallState, uninstall] = useMutation(
    SettingsUninstallPluginMutation,
  );
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    if (!open) setConfirmation("");
  }, [open]);

  const confirmed = confirmation.trim() === install.pluginKey;

  async function confirmUninstall() {
    const result = await uninstall({
      input: {
        installId: install.id,
        destructiveConfirmation: install.pluginKey,
      },
    });
    if (result.error) {
      toast.error(
        `Could not uninstall ${displayName}: ${result.error.message}`,
      );
      return;
    }
    toast.success(`Uninstalling ${displayName}.`);
    onOpenChange(false);
    onUninstalled();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Uninstall {displayName}?</DialogTitle>
          <DialogDescription>
            This removes every component the plugin installed for this
            workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">
              Components to remove
            </p>
            <ul className="space-y-1">
              {install.components.map((component) => (
                <li
                  key={component.id}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <Badge variant="outline">
                    {componentTypeLabel(component.componentType)}
                  </Badge>
                  <span className="truncate font-mono text-xs">
                    {component.componentKey}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {install.activatedUserCount > 0 ? (
            <p className="text-sm text-amber-500">
              {install.activatedUserCount}{" "}
              {install.activatedUserCount === 1 ? "user" : "users"} will lose
              access to this plugin&rsquo;s tools and skills.
            </p>
          ) : null}

          <div>
            <label
              htmlFor="uninstall-plugin-confirmation"
              className="mb-1.5 block text-sm text-muted-foreground"
            >
              Type{" "}
              <span className="font-mono text-foreground">
                {install.pluginKey}
              </span>{" "}
              to confirm.
            </label>
            <Input
              id="uninstall-plugin-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={install.pluginKey}
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!confirmed || uninstallState.fetching}
            onClick={() => void confirmUninstall()}
          >
            Uninstall plugin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
