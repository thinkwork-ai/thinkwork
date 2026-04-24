import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { AlertCircle, Loader2, Package, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  installPluginUpload,
  listPluginUploads,
  presignPluginUpload,
  uploadPluginZipToS3,
  type PluginUploadRow,
} from "@/lib/plugins-api";

export const Route = createFileRoute("/_authed/_tenant/capabilities/plugins/")({
  component: PluginsPage,
});

const STATUS_STYLES: Record<string, string> = {
  staging: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  installed: "bg-green-500/15 text-green-600 dark:text-green-400",
  failed: "bg-destructive/15 text-destructive",
};

const columns: ColumnDef<PluginUploadRow>[] = [
  {
    accessorKey: "plugin_name",
    header: "Plugin",
    size: 220,
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.plugin_name}</span>
        {row.original.plugin_version && (
          <span className="text-xs text-muted-foreground">
            v{row.original.plugin_version}
          </span>
        )}
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: () => <div className="text-center">Status</div>,
    size: 110,
    cell: ({ row }) => (
      <div className="flex justify-center">
        <Badge
          variant="secondary"
          className={`text-xs ${STATUS_STYLES[row.original.status] ?? ""}`}
        >
          {row.original.status}
        </Badge>
      </div>
    ),
  },
  {
    accessorKey: "uploaded_at",
    header: "Uploaded",
    size: 180,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {new Date(row.original.uploaded_at).toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: "error_message",
    header: "Error",
    size: 300,
    cell: ({ row }) =>
      row.original.error_message ? (
        <span className="text-xs text-destructive truncate">
          {row.original.error_message}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
  },
];

function PluginsPage() {
  useBreadcrumbs([
    { label: "Capabilities", href: "/capabilities" },
    { label: "Plugins" },
  ]);

  const [uploads, setUploads] = useState<PluginUploadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    listPluginUploads()
      .then((r) => setUploads(r.uploads || []))
      .catch((e) => toast.error(`List failed: ${(e as Error).message}`))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleUploadFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      const msg = "Plugin bundles must be .zip archives";
      setLastError(msg);
      toast.error(msg);
      return;
    }
    setUploading(true);
    setLastError(null);
    try {
      const { uploadUrl, s3Key } = await presignPluginUpload({
        fileName: file.name,
      });
      await uploadPluginZipToS3(uploadUrl, file);
      const result = await installPluginUpload({ s3Key });
      if ("valid" in result && result.valid === false) {
        const msg = `Validation failed: ${result.errors.join("; ")}`;
        setLastError(msg);
        toast.error(msg);
      } else if (result.status === "failed") {
        const msg = `Install failed (phase ${result.phase}): ${result.errorMessage}`;
        setLastError(msg);
        toast.error(msg);
      } else {
        const skillCount = result.plugin.skills.length;
        const mcpCount = result.plugin.mcpServers.length;
        toast.success(
          `Installed ${result.plugin.name}: ${skillCount} skill(s)` +
            (mcpCount > 0
              ? `, ${mcpCount} MCP server(s) pending approval`
              : ""),
        );
      }
      refresh();
    } catch (err) {
      const msg = (err as Error).message;
      setLastError(msg);
      toast.error(`Upload failed: ${msg}`);
    } finally {
      setUploading(false);
    }
  };

  const onSelectFile = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (f) handleUploadFile(f);
    ev.target.value = "";
  };

  const onDrop = (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    setDragActive(false);
    const f = ev.dataTransfer.files?.[0];
    if (f) handleUploadFile(f);
  };

  if (loading && uploads.length === 0) return <PageSkeleton />;

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">
      {/* Drag-drop zone */}
      <div
        className={`shrink-0 rounded-md border-2 border-dashed p-8 text-center transition-colors ${
          dragActive
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/20"
        } ${uploading ? "opacity-60 pointer-events-none" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={onSelectFile}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Uploading + validating plugin…
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <UploadCloud className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Drop a plugin .zip here, or
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              Select file…
            </Button>
            <p className="text-xs text-muted-foreground mt-2 max-w-md">
              The server validates the bundle (U9 zip-safety + manifest checks),
              stages the files in S3, then installs them atomically. MCP servers
              shipped in the plugin land as <b>pending</b> and require admin
              approval under the MCP Servers tab before agents can invoke them.
            </p>
          </div>
        )}
        {lastError && !uploading && (
          <div className="flex items-center justify-center gap-2 mt-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{lastError}</span>
          </div>
        )}
      </div>

      {/* Upload history */}
      <div className="flex-1 min-h-0">
        {uploads.length === 0 ? (
          <div className="text-center py-12">
            <Package className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No plugin uploads yet. Drop a .zip above to get started.
            </p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={uploads}
            scrollable
            tableClassName="table-fixed [&_tbody_tr]:h-12"
            onRowClick={(row) => {
              // Inline-navigate to detail page for richer error / staging
              // context when an upload fails.
              const el = document.createElement("a");
              el.href = `/capabilities/plugins/${row.id}`;
              el.click();
            }}
          />
        )}
      </div>

      <div className="shrink-0 text-xs text-muted-foreground">
        Upload history shows the 50 most recent attempts.{" "}
        <Link to="/capabilities/mcp-servers" className="underline">
          Approve pending MCP servers →
        </Link>
      </div>
    </div>
  );
}
