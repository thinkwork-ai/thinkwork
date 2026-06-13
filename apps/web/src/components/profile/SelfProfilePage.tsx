import { useQuery } from "urql";
import { Badge } from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  ProfileSection,
  titleCase,
} from "@/components/settings/SettingsUserDetail";
import { UserModelsSection } from "@/components/settings/UserModelsSection";
import {
  SettingsPageTitle,
  SettingsPane,
} from "@/components/settings/SettingsContent";
import { SettingsMeQuery } from "@/lib/settings-queries";

export function SelfProfilePage() {
  const { role, tenantId } = useTenant();
  const [result, refetchMe] = useQuery({
    query: SettingsMeQuery,
    requestPolicy: "cache-and-network",
  });
  const user = result.data?.me ?? null;
  const displayName = user?.name ?? user?.email ?? "Profile";
  const resolvedTenantId = tenantId ?? user?.tenantId ?? "";
  const resolvedRole = role ?? "member";

  usePageHeaderActions({
    title: "Profile",
    breadcrumbs: [{ label: "Profile" }],
    subtitle: user?.email ?? undefined,
  });

  if (result.fetching && !user) {
    return (
      <SettingsPane>
        <div className="flex items-center justify-center py-24">
          <LoadingShimmer />
        </div>
      </SettingsPane>
    );
  }

  if (!user) {
    return (
      <SettingsPane>
        <SettingsPageTitle title="Profile" />
        <p className="text-sm text-muted-foreground">
          Your profile could not be loaded.
        </p>
      </SettingsPane>
    );
  }

  return (
    <SettingsPane>
      <SettingsPageTitle
        title={displayName}
        description={user.email}
        badge={<Badge variant="secondary">{titleCase(resolvedRole)}</Badge>}
      />
      <ProfileSection
        userId={user.id}
        name={user.name ?? ""}
        profile={user.profile ?? null}
        currentRole={resolvedRole}
        tenantId={resolvedTenantId}
        isSelf
        callerIsOwner={false}
        roleReadOnly
        budgetReadOnly
        onSaved={() => refetchMe({ requestPolicy: "network-only" })}
      />
      <UserModelsSection userId={user.id} readOnly />
    </SettingsPane>
  );
}
