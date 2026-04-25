import { useState } from "react";
import { useQuery } from "urql";
import { User, DollarSign, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  BadgeSelectorText,
  BadgeSelectorSelect,
} from "@/components/ui/badge-selector";
import {
  TenantMembersListQuery,
  AgentEmailCapabilityQuery,
} from "@/lib/graphql-queries";
import { EmailAllowlistDialog } from "./EmailAllowlistDialog";

interface AgentHeaderBadgesProps {
  agent: any;
  tenantId: string;
  onSaveHumanPair: (humanPairId: string | null) => Promise<void>;
  onSaveBudget: (input: {
    period: string;
    limitUsd: number;
    actionOnExceed: string;
  }) => Promise<void>;
  onDeleteBudget: () => Promise<void>;
  children?: React.ReactNode;
}

export function AgentHeaderBadges({
  agent,
  tenantId,
  onSaveHumanPair,
  onSaveBudget,
  onDeleteBudget,
  children,
}: AgentHeaderBadgesProps) {
  const humanPair = agent.humanPair;
  const policy = agent.budgetPolicy;

  // Tenant members for human selector
  const [membersResult] = useQuery({
    query: TenantMembersListQuery,
    variables: { tenantId },
  });
  const humans = (membersResult.data?.tenantMembers ?? []).filter(
    (m) => m.principalType.toUpperCase() === "USER" && m.user,
  );
  const humanOptions = humans.map((m) => ({
    value: m.user!.id,
    label: m.user!.name ?? m.user!.email,
  }));

  // Email capability query
  const [emailResult, reexecuteEmail] = useQuery({
    query: AgentEmailCapabilityQuery,
    variables: { agentId: agent.id },
    pause: !agent.slug,
  });
  const emailCapability = emailResult.data?.agentEmailCapability ?? null;
  const emailActive =
    emailCapability?.enabled && emailCapability?.allowedSenders?.length > 0;

  const [emailDialogOpen, setEmailDialogOpen] = useState(false);

  return (
    <>
      {/* Human pair */}
      <BadgeSelectorSelect
        icon={<User className="h-3 w-3" />}
        value={humanPair?.id ?? null}
        emptyLabel="No human"
        options={humanOptions}
        searchable={humanOptions.length > 5}
        searchPlaceholder="Search people..."
        allowNone
        noneLabel="No human"
        onSelect={async (v) => {
          await onSaveHumanPair(v);
        }}
      />

      {/* Budget */}
      <BadgeSelectorText
        icon={<DollarSign className="h-3 w-3" />}
        label="Monthly Budget ($)"
        value={policy ? String(Number(policy.limitUsd)) : null}
        emptyLabel="No budget"
        placeholder="e.g. 50.00"
        type="number"
        onSave={async (v) => {
          if (v && parseFloat(v) > 0) {
            await onSaveBudget({
              period: "monthly",
              limitUsd: parseFloat(v),
              actionOnExceed: policy?.actionOnExceed ?? "pause",
            });
          } else if (policy) {
            await onDeleteBudget();
          }
        }}
      />

      {children}

      {/* Email channel — badge + dialog */}
      {agent.slug && (
        <>
          <button type="button" onClick={() => setEmailDialogOpen(true)}>
            <Badge
              variant="outline"
              className={`cursor-pointer gap-1.5 hover:bg-accent transition-colors ${emailActive ? "border-green-500 text-green-500" : "text-muted-foreground"}`}
            >
              <Mail className="h-3 w-3" />
              {emailActive && "Email"}
            </Badge>
          </button>
          <EmailAllowlistDialog
            agentId={agent.id}
            agentSlug={agent.slug}
            capability={emailCapability}
            fetching={emailResult.fetching}
            open={emailDialogOpen}
            onOpenChange={setEmailDialogOpen}
            onRefresh={() => reexecuteEmail({ requestPolicy: "network-only" })}
          />
        </>
      )}
    </>
  );
}
