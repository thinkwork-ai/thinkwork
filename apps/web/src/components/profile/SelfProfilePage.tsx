import type { ReactNode } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import { useQuery } from "urql";
import { FileText, SlidersHorizontal } from "lucide-react";
import { Badge, Button, TooltipIconButton } from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { AccountUsageSection } from "@/components/profile/AccountUsageSection";
import {
  ProfileSection,
  titleCase,
} from "@/components/settings/SettingsUserDetail";
import { UserModelsSection } from "@/components/settings/UserModelsSection";
import {
  SettingsPageTitle,
  SettingsPane,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import { ScopedWorkspaceEditor } from "@/components/workspace-settings/ScopedWorkspaceEditor";
import { SettingsMeQuery } from "@/lib/settings-queries";

export function SelfProfilePage() {
  const { file, view } = useSearch({ from: "/_authed/_shell/profile" });
  const workspaceView = view === "workspace";
  const { role, tenantId } = useTenant();
  const [result, refetchMe] = useQuery({
    query: SettingsMeQuery,
    requestPolicy: "cache-and-network",
  });
  const user = result.data?.me ?? null;
  const displayName = user?.name ?? user?.email ?? "Profile";
  const resolvedTenantId = tenantId ?? user?.tenantId ?? "";
  const resolvedRole = role ?? "member";
  const canManageSelf = resolvedRole === "owner" || resolvedRole === "admin";
  const viewToggle = user ? (
    <TooltipIconButton
      asChild
      type="button"
      className="text-muted-foreground hover:text-foreground"
      label={workspaceView ? "Profile details" : "Workspace files"}
    >
      {workspaceView ? (
        <Link to="/profile" search={{}}>
          <SlidersHorizontal className="size-4" />
          <span className="sr-only">Profile details</span>
        </Link>
      ) : (
        <Link to="/profile" search={{ view: "workspace" }}>
          <FileText className="size-4" />
          <span className="sr-only">Workspace files</span>
        </Link>
      )}
    </TooltipIconButton>
  ) : undefined;

  usePageHeaderActions({
    title: "Profile",
    breadcrumbs: workspaceView
      ? [{ label: "Profile", href: "/profile", search: {} }, { label: "Files" }]
      : [{ label: "Profile" }],
    subtitle: user?.email ?? undefined,
    action: viewToggle,
    actionKey: `self-profile:${workspaceView ? "workspace" : "detail"}`,
  });

  if (result.fetching && !user) {
    return (
      <ProfileScrollPane>
        <SettingsPane>
          <div className="flex items-center justify-center py-24">
            <LoadingShimmer />
          </div>
        </SettingsPane>
      </ProfileScrollPane>
    );
  }

  if (!user) {
    return (
      <ProfileScrollPane>
        <SettingsPane>
          <SettingsPageTitle title="Profile" />
          <p className="text-sm text-muted-foreground">
            Your profile could not be loaded.
          </p>
        </SettingsPane>
      </ProfileScrollPane>
    );
  }

  if (workspaceView) {
    return (
      <div className="h-full min-h-0">
        <ScopedWorkspaceEditor
          target={{ userId: user.id }}
          targetKey={`user:${user.id}`}
          defaultOpenFile={file ?? "USER.md"}
          bordered={false}
          className="h-full"
        />
      </div>
    );
  }

  return (
    <ProfileScrollPane>
      <SettingsPane>
        <SettingsPageTitle
          title={displayName}
          description={user.email}
          badge={<Badge variant="secondary">{titleCase(resolvedRole)}</Badge>}
        />
        <AccountUsageSection tenantId={resolvedTenantId} userId={user.id} />
        <ProfileSection
          userId={user.id}
          name={user.name ?? ""}
          profile={user.profile ?? null}
          currentRole={resolvedRole}
          tenantId={resolvedTenantId}
          isSelf
          callerIsOwner={resolvedRole === "owner"}
          roleReadOnly={!canManageSelf}
          budgetReadOnly={!canManageSelf}
          onSaved={() => refetchMe({ requestPolicy: "network-only" })}
        />
        <SelfWorkspaceSection />
        <UserModelsSection userId={user.id} readOnly={!canManageSelf} />
      </SettingsPane>
    </ProfileScrollPane>
  );
}

function SelfWorkspaceSection() {
  return (
    <SettingsSection label="Workspace files">
      <SettingsRow
        label="Your workspace"
        description="Customize USER.md and the requester-scoped context injected into your agent turns."
      >
        <Button asChild type="button" variant="outline" size="sm">
          <Link to="/profile" search={{ view: "workspace" }}>
            <FileText className="mr-2 size-4" />
            Open files
          </Link>
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}

function ProfileScrollPane({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="profile-scroll-pane"
      className="h-full min-h-0 w-full overflow-y-auto bg-background"
    >
      {children}
    </div>
  );
}
