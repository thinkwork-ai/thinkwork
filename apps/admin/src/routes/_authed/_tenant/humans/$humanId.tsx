import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { useAuth } from "@/context/AuthContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { Users } from "lucide-react";
import { TenantMembersListQuery } from "@/lib/graphql-queries";
import { HumanProfileSection } from "@/components/humans/HumanProfileSection";
import { HumanMembershipSection } from "@/components/humans/HumanMembershipSection";

export const Route = createFileRoute("/_authed/_tenant/humans/$humanId")({
  component: HumanDetailPage,
});

function HumanDetailPage() {
  const { humanId } = Route.useParams();
  const { tenantId } = useTenant();
  const { user: authUser } = useAuth();
  const navigate = useNavigate();

  const [result, reexecute] = useQuery({
    query: TenantMembersListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const member = useMemo(
    () => result.data?.tenantMembers?.find((m) => m.id === humanId),
    [result.data, humanId],
  );

  const humanName = member?.user?.name ?? member?.user?.email ?? "Human";

  useBreadcrumbs([
    { label: "Humans", href: "/humans" },
    { label: humanName },
  ]);

  if (!tenantId || (result.fetching && !result.data)) {
    return <PageSkeleton />;
  }

  if (!member || !member.user || member.principalType.toUpperCase() !== "USER") {
    return (
      <PageLayout header={<PageHeader title="Human not found" />}>
        <EmptyState
          icon={Users}
          title="This human could not be loaded"
          description="They may have been removed from the tenant."
          action={{ label: "Back to Humans", onClick: () => navigate({ to: "/humans" }) }}
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
      <div className="space-y-6">
        <HumanProfileSection
          userId={member.user.id}
          email={member.user.email}
          initial={{
            name: member.user.name,
            phone: (member.user as { phone?: string | null }).phone ?? null,
            image: member.user.image,
          }}
        />
        <HumanMembershipSection
          memberId={member.id}
          currentRole={member.role}
          currentStatus={member.status}
          humanName={humanName}
          isSelf={callerIsSelf}
          callerIsOwner={callerIsOwner}
          onRemoved={() => {
            reexecute({ requestPolicy: "network-only" });
            navigate({ to: "/humans" });
          }}
        />
      </div>
    </PageLayout>
  );
}
