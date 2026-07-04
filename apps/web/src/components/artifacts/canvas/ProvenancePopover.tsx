import { Info } from "lucide-react";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@thinkwork/ui";
import { relativeTime } from "@/lib/utils";
import { provenanceArgRows, type CanvasBinding } from "./binding-display";

/**
 * Provenance popover for a bound widget (R5): what tool produced the data, with
 * which (already-redacted, KTD9) arguments, when, and under what auth context.
 */
export function ProvenancePopover({ binding }: { binding: CanvasBinding }) {
  const argRows = provenanceArgRows(binding.redactedArgs);
  const authLabel =
    binding.authContext === "PER_USER_OAUTH"
      ? "Per-user connection"
      : "Shared (tenant) connection";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 text-muted-foreground hover:text-foreground"
          aria-label="Show data source"
          data-testid="provenance-trigger"
        >
          <Info className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 text-sm"
        data-testid="provenance-popover"
      >
        <div className="grid gap-3">
          <div className="grid gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Data source
            </p>
            <p className="font-medium">{binding.serverName}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {binding.toolName}
            </p>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Auth</dt>
            <dd data-testid="provenance-auth">{authLabel}</dd>
            <dt className="text-muted-foreground">Last fetched</dt>
            <dd data-testid="provenance-last-fetched">
              {binding.lastFetchedAt
                ? relativeTime(binding.lastFetchedAt)
                : "Never"}
            </dd>
          </dl>

          <div className="grid gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Arguments
            </p>
            {argRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">No arguments.</p>
            ) : (
              <dl
                className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"
                data-testid="provenance-args"
              >
                {argRows.map((row) => (
                  <ProvenanceArg
                    key={row.key}
                    label={row.key}
                    value={row.value}
                  />
                ))}
              </dl>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ProvenanceArg({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="font-mono text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono">{value}</dd>
    </>
  );
}
