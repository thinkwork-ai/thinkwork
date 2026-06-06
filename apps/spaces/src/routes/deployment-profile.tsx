import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Copy, Download, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@thinkwork/ui";
import { getSpacesDeploymentProfileSnapshot } from "@/lib/deployment-profile";

export const Route = createFileRoute("/deployment-profile")({
  component: DeploymentProfilePage,
});

function DeploymentProfilePage() {
  const snapshot = useMemo(() => getSpacesDeploymentProfileSnapshot(), []);
  const [copied, setCopied] = useState(false);

  async function copyProfile() {
    await navigator.clipboard.writeText(snapshot.profileJson);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function downloadProfile() {
    const blob = new Blob([snapshot.profileJson], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${snapshot.stage}-thinkwork-deployment-profile.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-svh bg-background text-foreground">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt=""
              className="size-10 object-contain"
              aria-hidden="true"
            />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Deployment Profile
              </h1>
              <p className="text-sm text-muted-foreground">
                {snapshot.displayName} · {snapshot.stage} · {snapshot.region}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {snapshot.status === "unsigned" ? (
              <ShieldAlert
                className="size-4 text-amber-600"
                aria-hidden="true"
              />
            ) : (
              <CheckCircle2
                className="size-4 text-emerald-600"
                aria-hidden="true"
              />
            )}
            <span>{snapshot.trustLabel}</span>
            {snapshot.profileSha256 && (
              <span className="truncate text-muted-foreground">
                {snapshot.profileSha256.slice(0, 12)}
              </span>
            )}
          </div>
        </div>

        {snapshot.issues.length > 0 && (
          <div className="border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {snapshot.issues.map((issue) => (
              <p key={`${issue.field ?? issue.status}-${issue.message}`}>
                {issue.message}
              </p>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void copyProfile()}
          >
            <Copy className="mr-2 size-4" aria-hidden="true" />
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button type="button" variant="outline" onClick={downloadProfile}>
            <Download className="mr-2 size-4" aria-hidden="true" />
            Download
          </Button>
        </div>

        <pre className="max-h-[60vh] overflow-auto rounded-md border bg-muted/35 p-4 text-xs leading-5">
          {snapshot.profileJson}
        </pre>
      </section>
    </main>
  );
}
