import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { useAuth } from "@/context/AuthContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { Monitor, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ComputersListQuery,
  TenantMembersListQuery,
} from "@/lib/graphql-queries";
import { ComputerStatus } from "@/gql/graphql";
import { ComputerFormDialog } from "@/components/computers/ComputerFormDialog";
import { HumanProfileSection } from "@/components/humans/HumanProfileSection";
import { HumanMembershipSection } from "@/components/humans/HumanMembershipSection";

export const Route = createFileRoute("/_authed/_tenant/people/$humanId")({
  component: HumanDetailPage,
});

function HumanDetailPage() {
  const { humanId } = Route.useParams();
  const { tenantId } = useTenant();
  const { user: authUser } = useAuth();
  const navigate = useNavigate();
  const [provisionOpen, setProvisionOpen] = useState(false);

  const [result, reexecute] = useQuery({
    query: TenantMembersListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const [computersResult, reexecuteComputers] = useQuery({
    query: ComputersListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const member = useMemo(
    () => result.data?.tenantMembers?.find((m) => m.id === humanId),
    [result.data, humanId],
  );

  const humanName = member?.user?.name ?? member?.user?.email ?? "Person";

  const hasActiveComputer = useMemo(() => {
    const userId = member?.user?.id;
    if (!userId) return false;
    const computers = computersResult.data?.computers ?? [];
    return computers.some(
      (c) =>
        c.ownerUserId === userId &&
        c.status !== ComputerStatus.Archived,
    );
  }, [computersResult.data, member]);

  // The CTA stays hidden until the computers fetch has fresh data — not just
  // any data. With urql's cache-and-network policy, `data != null` is true
  // immediately when a cached snapshot exists, but `stale` stays true until
  // the network leg confirms. Without the stale guard the CTA flashes for
  // users whose stale cache says "no Computer" while the network is still
  // proving they actually have one.
  const computersQueryFresh =
    computersResult.data != null && !computersResult.stale;
  const showProvisionCta =
    !!member?.user?.id && computersQueryFresh && !hasActiveComputer;

  useBreadcrumbs([
    { label: "People", href: "/people" },
    { label: humanName },
  ]);

  if (!tenantId || (result.fetching && !result.data)) {
    return <PageSkeleton />;
  }

  if (!member || !member.user || member.principalType.toUpperCase() !== "USER") {
    return (
      <PageLayout header={<PageHeader title="Person not found" />}>
        <EmptyState
          icon={Users}
          title="This person could not be loaded"
          description="They may have been removed from the tenant."
          action={{ label: "Back to People", onClick: () => navigate({ to: "/people" }) }}
        />
      </PageLayout>
    );
  }

  const callerIsSelf = !!authUser?.email && authUser.email === member.user.email;

  // Determine whether the signed-in caller is an owner in this tenant — for
  // gating the "grant owner" option in the role select. We look them up in
  // the same members list.
  const callerMember = result.data?.tenantMembers?.find(
    (m) =>
      m.principalType.toUpperCase() === "USER" &&
      m.user?.email === authUser?.email,
  );
  const callerIsOwner = callerMember?.role === "owner";

  return (
    <PageLayout
      header={
        <PageHeader
          title={humanName}
          description={member.user.email}
        />
      }
    >
      <div className="space-y-6 max-w-[750px]">
        <HumanProfileSection
          userId={member.user.id}
          email={member.user.email}
          initial={{
            name: member.user.name,
            phone: (member.user as { phone?: string | null }).phone ?? null,
            image: member.user.image,
          }}
        />
        {showProvisionCta && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Monitor className="h-4 w-4 text-cyan-600" />
                    Computer
                  </CardTitle>
                  <CardDescription>
                    {humanName} doesn&apos;t have a Computer yet. Provisioning
                    creates their durable AWS workplace.
                  </CardDescription>
                </div>
                <Button onClick={() => setProvisionOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Provision Computer
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0 text-xs text-muted-foreground">
              New tenant members are auto-provisioned on join. This affordance
              exists for backfill cases — members who pre-date auto-provision,
              or whose Computer was archived.
            </CardContent>
          </Card>
        )}
        <HumanMembershipSection
          memberId={member.id}
          currentRole={member.role}
          currentStatus={member.status}
          humanName={humanName}
          isSelf={callerIsSelf}
          callerIsOwner={callerIsOwner}
          onRemoved={() => {
            reexecute({ requestPolicy: "network-only" });
            navigate({ to: "/people" });
          }}
        />
      </div>
      <ComputerFormDialog
        open={provisionOpen}
        onOpenChange={setProvisionOpen}
        initial={{
          ownerUserId: member.user.id,
          name: `${humanName}'s Computer`,
        }}
        ownerLocked
        onCreated={(computerId) => {
          reexecuteComputers({ requestPolicy: "network-only" });
          navigate({
            to: "/computers/$computerId",
            params: { computerId },
            search: { tab: "dashboard" },
          });
        }}
      />
    </PageLayout>
  );
}
