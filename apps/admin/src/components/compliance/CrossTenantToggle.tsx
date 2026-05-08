import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export interface CrossTenantToggleProps {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  id?: string;
}

/**
 * Operator-only switch that gates the cross-tenant view of compliance
 * events. Off-by-default: the operator's caller-tenant scope is the
 * baseline; flipping ON exposes the tenant_id Combobox in the filter
 * bar and removes the client-side tenant scope override.
 */
export function CrossTenantToggle({
  checked,
  onCheckedChange,
  id = "compliance-cross-tenant-toggle",
}: CrossTenantToggleProps) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      <Label htmlFor={id} className="text-sm cursor-pointer select-none">
        Cross-tenant
      </Label>
    </div>
  );
}
