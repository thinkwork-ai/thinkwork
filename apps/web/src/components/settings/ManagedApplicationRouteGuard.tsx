import type { ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { SettingsDeploymentStatusQuery } from "@/lib/settings-queries";

export function ManagedApplicationRouteGuard({
  appKey,
  requireProvisioned,
  allowDisabled,
  children,
}: {
  appKey: "cognee" | "twenty";
  requireProvisioned?: boolean;
  allowDisabled?: boolean;
  children: ReactNode;
}) {
  const { isOperator, roleResolved } = useTenant();
  const showOperator = roleResolved && isOperator;
  const [result] = useQuery({
    query: SettingsDeploymentStatusQuery,
    pause: !showOperator,
  });

  if (
    !roleResolved ||
    (showOperator && result.fetching && !result.data) ||
    (showOperator && !result.data && !result.error)
  ) {
    return null;
  }

  if (!isOperator) {
    return <Navigate to="/settings/general" />;
  }

  const deployment = result.data?.deploymentStatus;
  const app = deployment?.managedApplications.find(
    (item) => item.key === appKey,
  );
  const enabled = allowDisabled
    ? Boolean(app)
    : requireProvisioned
      ? (app?.provisioned ??
        (appKey === "twenty" ? deployment?.twentyProvisioned : undefined) ??
        false)
      : (app?.runtimeEnabled ??
        (appKey === "cognee"
          ? deployment?.cogneeEnabled
          : appKey === "twenty"
            ? deployment?.twentyRuntimeEnabled
            : undefined) ??
        false);

  if (result.error || !enabled) {
    return <Navigate to="/settings/general" />;
  }

  return <>{children}</>;
}
