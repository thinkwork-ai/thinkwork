// Shared presentation helpers for the capability runtime control-plane
// sheets (THINK-280 U2): catalog, research, bindings.
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button } from "@thinkwork/ui";

/**
 * AWSJSON crosses the wire as either a JSON string or an already-parsed
 * object depending on the transport (dual wire shape — THINK-188). Parse
 * defensively; a null/undefined or unparseable value yields null.
 */
export function parseAwsJson(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** Short display form of an RFC 8785 + SHA-256 fingerprint. */
export function shortFingerprint(fingerprint: string): string {
  return fingerprint.slice(0, 12);
}

/**
 * Short mono fingerprint with a copy affordance — the FULL fingerprint is
 * what lands on the clipboard (admission reviews compare exact values).
 */
export function FingerprintChip({
  fingerprint,
  label,
}: {
  fingerprint: string;
  label?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {label ? (
        <span className="text-xs text-muted-foreground">{label}</span>
      ) : null}
      <span className="font-mono text-xs" title={fingerprint}>
        {shortFingerprint(fingerprint)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-5"
        aria-label="Copy full fingerprint"
        title="Copy full fingerprint"
        onClick={() => {
          void navigator.clipboard
            .writeText(fingerprint)
            .then(() => toast.success("Fingerprint copied"))
            .catch(() => toast.error("Couldn't copy fingerprint"));
        }}
      >
        <Copy className="size-3" />
      </Button>
    </span>
  );
}

/** Verbatim lifecycle/status chip — the string IS the taxonomy (R6). */
export function StatusBadge({ status }: { status: string }) {
  const styled: Record<string, string> = {
    active:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    admitted:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    candidate:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    submitted:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    draft: "text-muted-foreground",
    rejected: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
    superseded: "text-muted-foreground",
    retired: "text-muted-foreground",
    revoked: "text-muted-foreground",
  };
  return (
    <Badge
      variant="outline"
      className={styled[status] ?? "text-muted-foreground"}
    >
      {status}
    </Badge>
  );
}
