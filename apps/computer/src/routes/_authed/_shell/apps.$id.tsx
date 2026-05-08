import { createFileRoute } from "@tanstack/react-router";
import { AppArtifactSplitShell } from "@/components/apps/AppArtifactSplitShell";
import { getFixtureDashboardManifestByArtifactId } from "@/lib/app-artifacts";

export const Route = createFileRoute("/_authed/_shell/apps/$id")({
  component: AppArtifactPage,
});

function AppArtifactPage() {
  const { id } = Route.useParams();
  const manifest = getFixtureDashboardManifestByArtifactId(id);

  if (!manifest) {
    return (
      <main className="flex h-svh items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Generated app not found.</p>
      </main>
    );
  }

  return <AppArtifactSplitShell manifest={manifest} />;
}
