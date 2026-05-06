import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, Package } from "lucide-react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPluginUpload, type PluginUploadDetail } from "@/lib/plugins-api";

export const Route = createFileRoute(
  "/_authed/_tenant/capabilities/plugins/$uploadId",
)({
  component: PluginUploadDetailPage,
});

const STATUS_STYLES: Record<string, string> = {
  staging: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  installed: "bg-green-500/15 text-green-600 dark:text-green-400",
  failed: "bg-destructive/15 text-destructive",
};

function PluginUploadDetailPage() {
  const { uploadId } = Route.useParams();
  useBreadcrumbs([
    { label: "Skills and Tools", href: "/capabilities" },
    { label: "Plugins", href: "/capabilities/plugins" },
    { label: uploadId.slice(0, 8) },
  ]);

  const [upload, setUpload] = useState<PluginUploadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getPluginUpload(uploadId)
      .then((r) => setUpload(r.upload))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [uploadId]);

  if (loading) return <PageSkeleton />;
  if (error || !upload) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <AlertCircle className="h-10 w-10 mx-auto mb-3 text-destructive" />
        <p className="text-sm text-muted-foreground">
          {error || "Plugin upload not found."}
        </p>
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link to="/capabilities/plugins">
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
            Back to plugins
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6 space-y-4">
      <div className="flex items-center gap-3">
        <Package className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-xl font-semibold">{upload.plugin_name}</h2>
        {upload.plugin_version && (
          <span className="text-sm text-muted-foreground">
            v{upload.plugin_version}
          </span>
        )}
        <Badge
          variant="secondary"
          className={`text-xs ml-auto ${STATUS_STYLES[upload.status] ?? ""}`}
        >
          {upload.status}
        </Badge>
      </div>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Upload ID</dt>
        <dd className="font-mono text-xs">{upload.id}</dd>

        <dt className="text-muted-foreground">Uploaded</dt>
        <dd>{new Date(upload.uploaded_at).toLocaleString()}</dd>

        <dt className="text-muted-foreground">Uploaded by</dt>
        <dd className="font-mono text-xs">{upload.uploaded_by ?? "system"}</dd>

        <dt className="text-muted-foreground">Bundle sha256</dt>
        <dd className="font-mono text-xs truncate">{upload.bundle_sha256}</dd>

        {upload.s3_staging_prefix && (
          <>
            <dt className="text-muted-foreground">S3 staging prefix</dt>
            <dd className="font-mono text-xs truncate">
              {upload.s3_staging_prefix}
            </dd>
          </>
        )}
      </dl>

      {upload.status === "failed" && upload.error_message && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Install failed</div>
            <div className="mt-1 font-mono text-xs whitespace-pre-wrap">
              {upload.error_message}
            </div>
          </div>
        </div>
      )}

      {upload.status === "installed" && (
        <div className="p-3 rounded-md bg-green-500/10 text-sm text-green-600 dark:text-green-400">
          Plugin installed successfully. Skills are available under the Skills
          tab; any MCP servers shipped with the plugin land as <b>pending</b>{" "}
          until an admin approves them from the MCP Servers tab.
        </div>
      )}

      {upload.status === "staging" && (
        <div className="p-3 rounded-md bg-amber-500/10 text-sm text-amber-600 dark:text-amber-400">
          Still staging. The install saga is either in flight or stalled; the
          hourly sweeper will flip rows older than one hour to <b>failed</b>{" "}
          automatically.
        </div>
      )}

      <Button asChild variant="outline" size="sm">
        <Link to="/capabilities/plugins">
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Back to plugins
        </Link>
      </Button>
    </div>
  );
}
