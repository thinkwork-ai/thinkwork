import { ExternalLink, Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminExtensionComponentProps } from "./types";
import { registerAdminExtension } from "./registry";

const enabled = readBoolean(
  import.meta.env.VITE_ADMIN_EXTENSION_SAMPLE_ENABLED,
);
const id = sanitizeExtensionId(import.meta.env.VITE_ADMIN_EXTENSION_SAMPLE_ID);
const label = readTrimmed(import.meta.env.VITE_ADMIN_EXTENSION_SAMPLE_LABEL);
const url = normalizeUrl(import.meta.env.VITE_ADMIN_EXTENSION_SAMPLE_URL);
const navGroup = readNavGroup(
  import.meta.env.VITE_ADMIN_EXTENSION_SAMPLE_NAV_GROUP,
);

function ConfiguredExternalExtension(_props: AdminExtensionComponentProps) {
  if (!url || !label) return null;

  return (
    <div className="flex h-full min-h-0 flex-col text-foreground">
      <div className="grid gap-3 pb-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <h1 className="min-w-0 truncate text-xl font-bold leading-tight tracking-tight">
          {label}
        </h1>
        <Button
          asChild
          variant="outline"
          className="justify-self-start md:justify-self-end"
        >
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" />
            Open
          </a>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
        <iframe
          title={label}
          src={url}
          className="h-full w-full border-0 bg-background"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    </div>
  );
}

if (enabled && id && label && url) {
  registerAdminExtension({
    id,
    label,
    navGroup,
    breadcrumbs: [{ label }],
    icon: Puzzle,
    ownsPageLayout: true,
    load: async () => ({ default: ConfiguredExternalExtension }),
  });
}

function readBoolean(value: unknown) {
  return String(value ?? "").toLowerCase() === "true";
}

function readTrimmed(value: unknown) {
  return String(value ?? "").trim();
}

function sanitizeExtensionId(value: unknown) {
  const id = readTrimmed(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return "";
  return id;
}

function normalizeUrl(value: unknown) {
  const candidate = readTrimmed(value);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function readNavGroup(value: unknown) {
  const candidate = readTrimmed(value);
  if (
    candidate === "main" ||
    candidate === "managed-harness" ||
    candidate === "integrations" ||
    candidate === "manage"
  ) {
    return candidate;
  }
  return "integrations";
}
