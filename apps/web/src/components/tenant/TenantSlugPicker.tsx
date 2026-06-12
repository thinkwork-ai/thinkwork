import {
  RESERVED_TENANT_SLUGS,
  TENANT_SLUG_PATTERN,
} from "@thinkwork/database-pg/utils/reserved-slugs";
import { Button, Input, Label, cn } from "@thinkwork/ui";

export function tenantSlugValidationError(value: string): string | null {
  if (!value) return "Enter a tenant identifier.";
  if (!TENANT_SLUG_PATTERN.test(value)) {
    return "Use 3-30 lowercase letters, numbers, or hyphens. Start and end with a letter or number.";
  }
  if ((RESERVED_TENANT_SLUGS as readonly string[]).includes(value)) {
    return "That identifier is reserved.";
  }
  return null;
}

export function slugifyTenantName(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
}

export function suggestTenantSlug(
  name: string | null | undefined,
  fallback: string,
): string {
  const suggestion = slugifyTenantName(name ?? "");
  return suggestion && !tenantSlugValidationError(suggestion)
    ? suggestion
    : fallback;
}

export function tenantSlugServerError(code: unknown, fallback: string): string {
  if (code === "SLUG_UNAVAILABLE") return "That identifier is already taken.";
  if (code === "RESERVED_SLUG") return "That identifier is reserved.";
  if (code === "INVALID_SLUG") return "That identifier is not valid.";
  if (code === "FORBIDDEN") {
    return "You do not have permission to rename this tenant.";
  }
  if (code === "SLUG_VALIDATION_UNAVAILABLE") {
    return "Slug availability could not be confirmed — please try again.";
  }
  return fallback;
}

interface TenantSlugPickerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (slug: string) => void | Promise<void>;
  className?: string;
  currentSlug?: string;
  disabled?: boolean;
  loading?: boolean;
  serverError?: string | null;
  submitLabel?: string;
  onCancel?: () => void;
}

export function TenantSlugPicker({
  value,
  onValueChange,
  onSubmit,
  className,
  currentSlug,
  disabled = false,
  loading = false,
  serverError,
  submitLabel = "Save",
  onCancel,
}: TenantSlugPickerProps) {
  const clientError = tenantSlugValidationError(value);
  const error = serverError || clientError;
  const preview = value ? `${value}.thinkwork.ai` : "tenant.thinkwork.ai";
  const canSubmit = !disabled && !loading && !clientError;

  return (
    <form
      className={cn("space-y-4", className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        void onSubmit(value);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="tenant-slug">Tenant identifier</Label>
        <Input
          id="tenant-slug"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby="tenant-slug-help tenant-slug-error"
          disabled={disabled || loading}
          autoComplete="organization"
          inputMode="text"
        />
        <div id="tenant-slug-help" className="text-sm text-muted-foreground">
          {preview}
        </div>
        {currentSlug && currentSlug !== value ? (
          <div className="text-xs text-muted-foreground">
            Current: {currentSlug}.thinkwork.ai
          </div>
        ) : null}
        {error ? (
          <div id="tenant-slug-error" className="text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={!canSubmit}>
          {loading ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}
