import { useCallback, useRef, useState } from "react";
import { GitBranch, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  acceptsZipFile,
  agentBuilderApi,
  ImportBundleApiError,
  type ImportBundleInput,
} from "@/lib/agent-builder-api";
import { ImportErrorDialog } from "./ImportErrorDialog";
import { ImportRootReservedDialog } from "./ImportRootReservedDialog";

interface ImportDropzoneProps {
  agentId: string;
  onImported: () => void;
}

type ImportStage = "idle" | "upload" | "validate" | "commit";

export function ImportDropzone({ agentId, onImported }: ImportDropzoneProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<ImportStage>("idle");
  const [gitUrl, setGitUrl] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [gitPat, setGitPat] = useState("");
  const [lastInput, setLastInput] = useState<ImportBundleInput | null>(null);
  const [error, setError] = useState<ImportBundleApiError | null>(null);
  const [rootOverrideError, setRootOverrideError] =
    useState<ImportBundleApiError | null>(null);

  const busy = stage !== "idle";
  const progress =
    stage === "upload"
      ? 30
      : stage === "validate"
        ? 65
        : stage === "commit"
          ? 90
          : 0;

  const runImport = useCallback(
    async (input: ImportBundleInput) => {
      setLastInput(input);
      setError(null);
      setRootOverrideError(null);
      setStage(input.source === "zip" ? "upload" : "validate");
      try {
        setTimeout(
          () =>
            setStage((current) =>
              current === "upload" ? "validate" : current,
            ),
          150,
        );
        const result = await agentBuilderApi.importBundle(agentId, input);
        setStage("commit");
        toast.success(
          `Imported ${result.importedPaths.length} file${result.importedPaths.length === 1 ? "" : "s"}`,
        );
        onImported();
      } catch (err) {
        if (
          err instanceof ImportBundleApiError &&
          err.code === "ReservedRootFile"
        ) {
          setRootOverrideError(err);
        } else if (err instanceof ImportBundleApiError) {
          setError(err);
        } else {
          setError(
            new ImportBundleApiError({
              status: 0,
              message: err instanceof Error ? err.message : "Import failed",
            }),
          );
        }
      } finally {
        setStage("idle");
      }
    },
    [agentId, onImported],
  );

  const importZip = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      if (!acceptsZipFile(file)) {
        toast.error("Choose a .zip archive");
        return;
      }
      runImport({ source: "zip", file });
    },
    [runImport],
  );

  const importGit = () => {
    if (!gitUrl.trim()) return;
    runImport({
      source: "git",
      url: gitUrl,
      ref: gitRef,
      pat: gitPat.trim(),
    }).finally(() => setGitPat(""));
  };

  const retryWithRootOverride = (allowRootOverrides: string[]) => {
    if (!lastInput) return;
    runImport({ ...lastInput, allowRootOverrides } as ImportBundleInput);
  };

  return (
    <div className="p-3">
      <div
        className={`rounded-md border border-dashed p-3 transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-border"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          importZip(event.dataTransfer.files[0]);
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Upload className="h-4 w-4" />
              Import bundle
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Drop a .zip or import a git ref. Tar support is coming later.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            Zip
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          className="hidden"
          onChange={(event) => {
            importZip(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </div>

      <div className="mt-3 grid gap-2">
        <Label htmlFor="agent-builder-git-url" className="text-xs">
          Git repository
        </Label>
        <div className="grid gap-2">
          <Input
            id="agent-builder-git-url"
            placeholder="https://github.com/org/repo"
            value={gitUrl}
            onChange={(event) => setGitUrl(event.target.value)}
            disabled={busy}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="branch, tag, or commit"
              value={gitRef}
              onChange={(event) => setGitRef(event.target.value)}
              disabled={busy}
            />
            <Input
              placeholder="PAT (optional)"
              type="password"
              value={gitPat}
              onChange={(event) => setGitPat(event.target.value)}
              disabled={busy}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            disabled={busy || !gitUrl.trim()}
            onClick={importGit}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitBranch className="mr-1.5 h-3.5 w-3.5" />
            )}
            Import Git Ref
          </Button>
        </div>
        {busy ? (
          <div className="grid gap-1 text-xs text-muted-foreground">
            <Progress value={progress} />
            <span>{stageLabel(stage)}</span>
          </div>
        ) : null}
      </div>

      <ImportErrorDialog error={error} onClose={() => setError(null)} />
      <ImportRootReservedDialog
        error={rootOverrideError}
        onCancel={() => setRootOverrideError(null)}
        onConfirm={retryWithRootOverride}
      />
    </div>
  );
}

function stageLabel(stage: ImportStage): string {
  switch (stage) {
    case "upload":
      return "Uploading archive...";
    case "validate":
      return "Validating and normalizing...";
    case "commit":
      return "Writing workspace files...";
    default:
      return "";
  }
}
