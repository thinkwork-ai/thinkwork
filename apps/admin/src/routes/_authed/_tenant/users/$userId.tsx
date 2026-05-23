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
import { Users } from "lucide-react";
import { TenantMembersListQuery } from "@/lib/graphql-queries";
import { HumanProfileSection } from "@/components/humans/HumanProfileSection";
import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authed/_tenant/users/$userId")({
  component: UserDetailPage,
});

type UserDetailTab = "configuration" | "files";

function UserDetailPage() {
  const { userId } = Route.useParams();
  const { tenantId } = useTenant();
  const { user: authUser } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<UserDetailTab>("configuration");

  const [result, reexecute] = useQuery({
    query: TenantMembersListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const member = useMemo(
    () => result.data?.tenantMembers?.find((m) => m.id === userId),
    [result.data, userId],
  );

  const userName = member?.user?.name ?? member?.user?.email ?? "User";

  useBreadcrumbs([{ label: "Users", href: "/users" }, { label: userName }]);

  if (!tenantId || (result.fetching && !result.data)) {
    return <PageSkeleton />;
  }

  if (
    !member ||
    !member.user ||
    member.principalType.toUpperCase() !== "USER"
  ) {
    return (
      <PageLayout header={<PageHeader title="User not found" />}>
        <EmptyState
          icon={Users}
          title="This user could not be loaded"
          description="They may have been removed from the tenant."
          action={{
            label: "Back to Users",
            onClick: () => navigate({ to: "/users" }),
          }}
        />
      </PageLayout>
    );
  }

  const callerIsSelf =
    !!authUser?.email && authUser.email === member.user.email;

  // Determine whether the signed-in caller is an owner in this tenant for
  // gating the "grant owner" option in the role select.
  const callerMember = result.data?.tenantMembers?.find(
    (m) =>
      m.principalType.toUpperCase() === "USER" &&
      m.user?.email === authUser?.email,
  );
  const callerIsOwner = callerMember?.role === "owner";

  return (
    <PageLayout
      header={
        <div className="space-y-3">
          <div className="grid items-center gap-3 lg:grid-cols-[1fr_auto_1fr]">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold leading-tight tracking-tight text-foreground">
                {userName}
              </h1>
              <p className="truncate text-sm text-muted-foreground">
                {member.user.email}
              </p>
            </div>
            <div className="flex justify-start lg:justify-center">
              <Tabs
                value={tab}
                onValueChange={(value) => setTab(value as UserDetailTab)}
              >
                <TabsList>
                  <TabsTrigger value="configuration" className="px-4">
                    Configuration
                  </TabsTrigger>
                  <TabsTrigger value="files" className="px-4">
                    Files
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div />
          </div>
        </div>
      }
      contentClassName={tab === "files" ? "overflow-hidden pb-4" : undefined}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as UserDetailTab)}
        className={tab === "files" ? "h-full min-h-0" : undefined}
      >
        <TabsContent value="configuration">
          <div className="max-w-[760px]">
            <HumanProfileSection
              userId={member.user.id}
              memberId={member.id}
              email={member.user.email}
              currentRole={member.role}
              isSelf={callerIsSelf}
              callerIsOwner={callerIsOwner}
              initial={{
                name: member.user.name,
                phone: (member.user as { phone?: string | null }).phone ?? null,
                image: member.user.image,
              }}
              onRoleSaved={() => reexecute({ requestPolicy: "network-only" })}
            />
          </div>
        </TabsContent>
        <TabsContent value="files" className="min-h-0">
          <WorkspaceEditor
            target={{ userId: member.user.id }}
            mode="context"
            className="h-full min-h-0"
          />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
