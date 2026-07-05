import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, cn } from "@thinkwork/ui";
import { getSpacesDeploymentProfileSnapshot } from "@/lib/deployment-profile";
import {
  buildMobileDeploymentProfileLink,
  createQrMatrix,
} from "@/lib/mobile-setup-link";
import { SettingsRow, SettingsSection } from "./SettingsContent";

export function SetUpMobileCard() {
  const snapshot = getSpacesDeploymentProfileSnapshot();
  const usable = Boolean(snapshot.profile && snapshot.okForOAuth);
  const mobileLink = useMemo(
    () =>
      snapshot.profile && usable
        ? buildMobileDeploymentProfileLink(snapshot.profile)
        : null,
    [snapshot.profile, usable],
  );
  const qrMatrix = useMemo(
    () => (mobileLink ? createQrMatrix(mobileLink) : null),
    [mobileLink],
  );

  return (
    <SettingsSection label="Mobile">
      {mobileLink && qrMatrix ? (
        <SettingsRow
          label="Set up mobile"
          description="Scan this from the mobile app, or copy the setup link."
          layout="stacked"
        >
          <div className="grid w-full gap-4 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            <div className="flex aspect-square w-48 max-w-full items-center justify-center rounded-lg border border-border bg-white p-3">
              <QrCodeSvg
                matrix={qrMatrix}
                title={`Mobile setup for ${snapshot.displayName}`}
              />
            </div>
            <div className="flex min-w-0 flex-col justify-center gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {snapshot.displayName} · {snapshot.stage} · {snapshot.region}
                </p>
                <p className="text-xs text-muted-foreground">
                  Opens ThinkWork mobile with this deployment configuration.
                </p>
              </div>
              <CopyField label="Mobile setup link" value={mobileLink} />
              <CopyField
                label="Deployment profile JSON"
                value={snapshot.profileJson}
              />
            </div>
          </div>
        </SettingsRow>
      ) : (
        <SettingsRow
          label="Set up mobile"
          description="Mobile setup isn't available until deployment configuration is complete."
        >
          <span className="text-sm text-muted-foreground">
            Configuration incomplete
          </span>
        </SettingsRow>
      )}
    </SettingsSection>
  );
}

function QrCodeSvg({
  matrix,
  title,
}: {
  matrix: boolean[][];
  title: string;
}) {
  const quietZone = 4;
  const size = matrix.length + quietZone * 2;
  const darkPath = matrix
    .flatMap((row, y) =>
      row.flatMap((dark, x) =>
        dark ? [`M${x + quietZone},${y + quietZone}h1v1h-1z`] : [],
      ),
    )
    .join("");

  return (
    <svg
      role="img"
      aria-label={title}
      data-testid="mobile-setup-qr"
      viewBox={`0 0 ${size} ${size}`}
      className="h-full w-full"
      shapeRendering="crispEdges"
    >
      <title>{title}</title>
      <rect width={size} height={size} fill="#fff" />
      <path d={darkPath} fill="#111827" />
    </svg>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!navigator?.clipboard?.writeText) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <code
          className={cn(
            "block min-w-0 flex-1 truncate rounded-md border border-border",
            "bg-muted/40 px-2.5 py-2 text-xs text-foreground",
          )}
          title={value}
        >
          {value}
        </code>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={`Copy ${label}`}
          title={`Copy ${label}`}
          onClick={() => void copy()}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
