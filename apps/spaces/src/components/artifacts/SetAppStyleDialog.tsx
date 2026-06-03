import { useEffect, useMemo, useState } from "react";
import { Palette, Upload } from "lucide-react";
import { useMutation, useQuery } from "urql";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { desktopToolbarButtonClassName } from "@/lib/desktop-chrome";
import {
  SettingsTenantFeaturesQuery,
  SettingsUpdateTenantArtifactStyleMutation,
} from "@/lib/settings-queries";

const MAX_CSS_LENGTH = 20_000;

/**
 * Operator action on the Artifacts page: sets the tenant-wide applet theme CSS
 * injected into every rendered app artifact (unless an artifact carries its
 * own theme). Ported from the deprecated admin "Set App Style" dialog.
 *
 * CSS safety is layered: the authoritative gate is the iframe-side allowlist
 * (`parseShadcnThemeCss` in applets/theme-tokens.ts), backed by a server-side
 * strip (`sanitizeAppletThemeCss`); the checks here are UX-only.
 */
export function SetAppStyleButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={desktopToolbarButtonClassName}
        onClick={() => setOpen(true)}
        aria-label="Set app style"
        title="Set app style"
        data-testid="set-app-style-trigger"
      >
        <Palette className="size-4" />
      </Button>
      <SetAppStyleDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function SetAppStyleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { tenantId } = useTenant();

  const [{ data, fetching }, refetch] = useQuery({
    query: SettingsTenantFeaturesQuery,
    variables: { id: tenantId ?? "" },
    pause: !tenantId,
  });
  const [{ fetching: saving }, updateTenantArtifactStyle] = useMutation(
    SettingsUpdateTenantArtifactStyleMutation,
  );

  const features = useMemo(
    () => normalizeFeatures(data?.tenant?.settings?.features),
    [data?.tenant?.settings?.features],
  );
  const savedCss = useMemo(
    () => appletThemeFromFeatures(features)?.css ?? "",
    [features],
  );

  const [css, setCss] = useState(savedCss);
  const [error, setError] = useState<string | null>(null);

  // Reseed the editor when the dialog opens or the persisted theme changes.
  useEffect(() => {
    if (open) {
      setCss(savedCss);
      setError(null);
    }
  }, [open, savedCss]);

  const tooLong = css.length > MAX_CSS_LENGTH;
  const dirty = css.trim() !== savedCss.trim();
  const busy = saving || fetching;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    try {
      setCss(await file.text());
      setError(null);
    } catch {
      setError("Could not read that theme file.");
    }
  }

  async function handleSave() {
    if (!tenantId) return;
    setError(null);
    const appletTheme = buildAppletTheme(css);
    if (!appletTheme) {
      setError(
        "Paste the globals.css Theme block copied from shadcn Create (must include :root or .dark token declarations).",
      );
      return;
    }
    const nextFeatures = {
      ...features,
      artifactStyle: {
        ...(normalizeRecord(features.artifactStyle) ?? {}),
        appletTheme,
        updatedAt: new Date().toISOString(),
      },
    };
    const result = await updateTenantArtifactStyle({
      tenantId,
      input: { features: JSON.stringify(nextFeatures) },
    });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    refetch({ requestPolicy: "network-only" });
    onOpenChange(false);
  }

  async function handleClear() {
    if (!tenantId) return;
    setError(null);
    const { appletTheme: _removed, ...artifactStyle } =
      normalizeRecord(features.artifactStyle) ?? {};
    const nextFeatures = {
      ...features,
      artifactStyle: {
        ...artifactStyle,
        updatedAt: new Date().toISOString(),
      },
    };
    const result = await updateTenantArtifactStyle({
      tenantId,
      input: { features: JSON.stringify(nextFeatures) },
    });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    refetch({ requestPolicy: "network-only" });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,720px)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Set App Style</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <p className="text-sm text-muted-foreground">
            Paste the Theme code copied from shadcn Create. These tokens are
            stored on tenant settings and injected into every rendered app
            artifact unless an artifact carries its own theme.
          </p>
          <div className="flex justify-end">
            <label>
              <input
                type="file"
                accept=".css,text/css,text/plain"
                className="sr-only"
                onChange={(event) =>
                  void handleFile(event.currentTarget.files?.[0])
                }
                data-testid="app-style-upload"
              />
              <span className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground">
                <Upload className="h-4 w-4" />
                Upload CSS
              </span>
            </label>
          </div>
          <Textarea
            value={css}
            onChange={(event) => {
              setCss(event.target.value);
              setError(null);
            }}
            placeholder=":root { --background: oklch(...); --chart-1: oklch(...); }"
            className="h-[min(28rem,48vh)] min-h-0 resize-none overflow-y-auto font-mono text-xs [field-sizing:fixed]"
            data-testid="app-style-textarea"
          />
          {tooLong ? (
            <p
              className="text-sm text-destructive"
              data-testid="app-style-error"
            >
              CSS exceeds {MAX_CSS_LENGTH.toLocaleString()} characters (
              {css.length.toLocaleString()}/{MAX_CSS_LENGTH.toLocaleString()})
            </p>
          ) : error ? (
            <p
              className="text-sm text-destructive"
              data-testid="app-style-error"
            >
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={busy || !savedCss}
            onClick={() => void handleClear()}
            data-testid="app-style-clear"
          >
            Clear
          </Button>
          <Button
            type="button"
            disabled={busy || tooLong || !dirty || !tenantId}
            onClick={() => void handleSave()}
            data-testid="app-style-save"
          >
            Save Style
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Theme helpers (ported verbatim from admin applets/index.tsx) ────────
// `parseThemeTokens`'s value check enforces the
// url()/expression()/@import/javascript: rejection at validation time; keep it
// intact. The authoritative security strip lives server-side in
// `sanitizeAppletThemeCss` (packages/api) + the iframe allowlist.

function normalizeFeatures(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeRecord(parsed) ?? {};
    } catch {
      return {};
    }
  }
  return normalizeRecord(value) ?? {};
}

function appletThemeFromFeatures(features: Record<string, unknown>) {
  const artifactStyle = normalizeRecord(features.artifactStyle);
  const appletTheme = normalizeRecord(artifactStyle?.appletTheme);
  if (!appletTheme || typeof appletTheme.css !== "string") return null;
  return {
    source:
      typeof appletTheme.source === "string"
        ? appletTheme.source
        : "shadcn-create",
    css: appletTheme.css,
  };
}

function buildAppletTheme(css: string) {
  const trimmed = css.trim();
  if (!trimmed || trimmed.length > MAX_CSS_LENGTH) return null;
  if (!trimmed.includes(":root") && !trimmed.includes(".dark")) return null;
  if (
    !Object.keys(parseThemeTokens(trimmed, "light")).length &&
    !Object.keys(parseThemeTokens(trimmed, "dark")).length
  ) {
    return null;
  }
  return { source: "shadcn-create", css: trimmed };
}

function parseThemeTokens(css: string, theme: "light" | "dark") {
  const selector = theme === "dark" ? "\\.dark" : ":root";
  const blockPattern = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`, "g");
  const tokens: Record<string, string> = {};
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockPattern.exec(css))) {
    const tokenPattern = /(--[a-z0-9-]+)\s*:\s*([^;{}<>]+)\s*;?/gi;
    let tokenMatch: RegExpExecArray | null;
    while ((tokenMatch = tokenPattern.exec(blockMatch[1] ?? ""))) {
      const name = tokenMatch[1]?.trim();
      const value = tokenMatch[2]?.trim();
      if (!name || !value) continue;
      if (/url\s*\(|expression\s*\(|@import|javascript:/i.test(value)) {
        continue;
      }
      tokens[name] = value;
    }
  }
  return tokens;
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
