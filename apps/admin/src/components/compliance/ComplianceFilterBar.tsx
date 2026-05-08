import { useQuery } from "urql";
import { Building2, X } from "lucide-react";
import {
  ComplianceActorType,
  ComplianceEventType,
} from "@/gql/graphql";
import { ComplianceTenantsQuery } from "@/lib/compliance/queries";
import {
  COMPLIANCE_RANGE_VALUES,
  pickActorType,
  pickEventType,
  type ComplianceRange,
  type ComplianceSearchParams,
} from "@/lib/compliance/url-search-params";
import { useComplianceOperator } from "@/lib/compliance/use-compliance-operator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { CrossTenantToggle } from "@/components/compliance/CrossTenantToggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ACTOR_OPTIONS: { value: ComplianceActorType; label: string }[] = [
  { value: ComplianceActorType.User, label: "User" },
  { value: ComplianceActorType.System, label: "System" },
  { value: ComplianceActorType.Agent, label: "Agent" },
];

const EVENT_OPTIONS: { value: ComplianceEventType; label: string }[] = [
  { value: ComplianceEventType.AuthSigninSuccess, label: "Auth · Sign-in success" },
  { value: ComplianceEventType.AuthSigninFailure, label: "Auth · Sign-in failure" },
  { value: ComplianceEventType.AuthSignout, label: "Auth · Sign-out" },
  { value: ComplianceEventType.UserInvited, label: "User · Invited" },
  { value: ComplianceEventType.UserCreated, label: "User · Created" },
  { value: ComplianceEventType.UserDisabled, label: "User · Disabled" },
  { value: ComplianceEventType.UserDeleted, label: "User · Deleted" },
  { value: ComplianceEventType.AgentCreated, label: "Agent · Created" },
  { value: ComplianceEventType.AgentDeleted, label: "Agent · Deleted" },
  { value: ComplianceEventType.AgentSkillsChanged, label: "Agent · Skills changed" },
  { value: ComplianceEventType.McpAdded, label: "MCP · Added" },
  { value: ComplianceEventType.McpRemoved, label: "MCP · Removed" },
  { value: ComplianceEventType.WorkspaceGovernanceFileEdited, label: "Workspace · Governance file edited" },
  { value: ComplianceEventType.DataExportInitiated, label: "Data · Export initiated" },
  { value: ComplianceEventType.PolicyEvaluated, label: "Policy · Evaluated" },
  { value: ComplianceEventType.PolicyAllowed, label: "Policy · Allowed" },
  { value: ComplianceEventType.PolicyBlocked, label: "Policy · Blocked" },
  { value: ComplianceEventType.PolicyBypassed, label: "Policy · Bypassed" },
  { value: ComplianceEventType.ApprovalRecorded, label: "Approval · Recorded" },
];

const RANGE_LABELS: Record<ComplianceRange, string> = {
  "7d": "Last 7d",
  "30d": "Last 30d",
  "this-quarter": "This quarter",
};

export interface ComplianceFilterBarProps {
  search: ComplianceSearchParams;
  onChange: (next: ComplianceSearchParams) => void;
}

// `<input type="datetime-local">` has no timezone. Treating its value as
// implicit-local would silently shift Since/Until by the operator's UTC
// offset on every blur. We anchor everything to UTC explicitly so an
// audit window selected in PST renders identically in EST.
function isoToInputValue(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mi = d.getUTCMinutes().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function inputValueToIso(value: string): string | undefined {
  if (!value) return undefined;
  // Append Z so `new Date(...)` parses the wall-clock value as UTC, not local.
  const date = new Date(`${value}:00Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function ComplianceFilterBar({ search, onChange }: ComplianceFilterBarProps) {
  const operator = useComplianceOperator();
  const showCrossTenantToggle = operator.isOperator;
  const showTenantFilter = operator.isOperator && search.xt === 1;

  const [tenantsResult] = useQuery({
    query: ComplianceTenantsQuery,
    pause: !showTenantFilter,
  });
  const tenantOptions = (tenantsResult.data?.complianceTenants ?? []).map(
    (id) => ({ value: id, label: id }),
  );

  // Patches reset the cursor — filter changes invalidate the page position.
  const patch = (next: Partial<ComplianceSearchParams>) => {
    onChange({ ...search, ...next, cursor: undefined });
  };

  const setRange = (range: ComplianceRange | undefined) => {
    patch({ range, since: undefined, until: undefined });
  };

  const toggleCrossTenant = (next: boolean) => {
    if (!next) {
      // Turning OFF — clear the tenant override.
      onChange({ ...search, xt: undefined, tenantId: undefined, cursor: undefined });
    } else {
      onChange({ ...search, xt: 1, cursor: undefined });
    }
  };

  return (
    <div className="space-y-3">
      {showCrossTenantToggle && search.xt === 1 ? (
        <div className="text-sm font-medium text-foreground flex items-center gap-2">
          <Building2 className="size-4 text-muted-foreground" />
          Cross-tenant view
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        {/* Range presets */}
        <div className="flex items-center gap-1">
          {COMPLIANCE_RANGE_VALUES.map((r) => (
            <Button
              key={r}
              type="button"
              size="sm"
              variant={search.range === r && !search.since && !search.until ? "default" : "outline"}
              onClick={() => setRange(search.range === r ? undefined : r)}
            >
              {RANGE_LABELS[r]}
            </Button>
          ))}
        </div>

        {/* Since */}
        <div className="space-y-1">
          <Label htmlFor="compliance-since" className="text-xs text-muted-foreground">
            Since
          </Label>
          <Input
            id="compliance-since"
            type="datetime-local"
            defaultValue={isoToInputValue(search.since)}
            onBlur={(e) => {
              const iso = inputValueToIso(e.target.value);
              if (iso !== search.since) patch({ since: iso, range: undefined });
            }}
            className="w-[12rem]"
          />
        </div>

        {/* Until */}
        <div className="space-y-1">
          <Label htmlFor="compliance-until" className="text-xs text-muted-foreground">
            Until
          </Label>
          <Input
            id="compliance-until"
            type="datetime-local"
            defaultValue={isoToInputValue(search.until)}
            onBlur={(e) => {
              const iso = inputValueToIso(e.target.value);
              if (iso !== search.until) patch({ until: iso });
            }}
            className="w-[12rem]"
          />
        </div>

        {/* Actor type */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Actor</Label>
          <Select
            value={search.actorType ?? "__all__"}
            onValueChange={(v) =>
              patch({ actorType: v === "__all__" ? undefined : pickActorType(v) })
            }
          >
            <SelectTrigger className="w-[10rem]">
              <SelectValue placeholder="Any actor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Any actor</SelectItem>
              {ACTOR_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Event type */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Event</Label>
          <Select
            value={search.eventType ?? "__all__"}
            onValueChange={(v) =>
              patch({ eventType: v === "__all__" ? undefined : pickEventType(v) })
            }
          >
            <SelectTrigger className="w-[16rem]">
              <SelectValue placeholder="Any event" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Any event</SelectItem>
              {EVENT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tenant Combobox — operators with cross-tenant toggle ON */}
        {showTenantFilter ? (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Tenant</Label>
            <Combobox
              options={tenantOptions}
              value={search.tenantId}
              onValueChange={(v) => patch({ tenantId: v })}
              placeholder="Any tenant"
              searchPlaceholder="Search tenants..."
              emptyMessage={
                tenantsResult.fetching ? "Loading..." : "No tenants visible."
              }
              prefix={<Building2 className="size-3.5 text-muted-foreground" />}
              triggerClassName="w-[18rem]"
              disabled={tenantsResult.fetching}
            />
          </div>
        ) : null}

        {/* Cross-tenant toggle — operators only */}
        {showCrossTenantToggle ? (
          <div className="ml-auto">
            <CrossTenantToggle
              checked={search.xt === 1}
              onCheckedChange={toggleCrossTenant}
            />
          </div>
        ) : null}

        {/* Reset button — visible whenever any filter is set */}
        {(search.tenantId ||
          search.actorType ||
          search.eventType ||
          search.since ||
          search.until ||
          search.range) && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange({ xt: search.xt })
            }
            className="text-muted-foreground"
          >
            <X className="size-3.5" />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
