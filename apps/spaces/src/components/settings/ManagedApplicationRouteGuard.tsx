import type { ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { SettingsDeploymentStatusQuery } from "@/lib/settings-queries";

export function ManagedApplicationRouteGuard({
  appKey,
  children,
}: {
  appKey: "cognee" | "twenty";
  children: ReactNode;
}) {
  const { isOperator, roleResolved } = useTenant();
  const showOperator = roleResolved && isOperator;
  const [result] = useQuery({
    query: SettingsDeploymentStatusQuery,
    pause: !showOperator,
  });

  if (!roleResolved || (showOperator && result.fetching && !result.data)) {
    return null;
  }

  if (!isOperator) {
    return <Navigate to="/settings/general" />;
  }

  const deployment = result.data?.deploymentStatus;
  const enabled =
    deployment?.managedApplications.find((app) => app.key === appKey)
      ?.runtimeEnabled ??
    (appKey === "cognee"
      ? deployment?.cogneeEnabled
      : deployment?.twentyRuntimeEnabled) ??
    false;

  if (result.error || !enabled) {
    return <Navigate to="/settings/general" />;
  }

  return <>{children}</>;
}
