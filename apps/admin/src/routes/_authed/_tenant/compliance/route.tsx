import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ScrollText, AlertCircle } from "lucide-react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useComplianceOperator } from "@/lib/compliance/use-compliance-operator";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authed/_tenant/compliance")({
  component: ComplianceLayout,
});

function ComplianceLayout() {
  useBreadcrumbs([{ label: "Compliance", href: "/compliance" }]);
  const { allowlistConfigured, fetching, error } = useComplianceOperator();

  // Brief flicker on first paint accepted in v1: the operator-check query
  // returns from cache after the first navigation. While fetching with no
  // data yet, render the Outlet — the list page handles its own loading.
  if (!fetching && !error && !allowlistConfigured) {
    return <ComplianceAllowlistMissing />;
  }

  return <Outlet />;
}

function ComplianceAllowlistMissing() {
  return (
    <div className="mx-auto max-w-2xl py-12">
      <Card className="border-amber-300 dark:border-amber-700">
        <CardContent className="space-y-3 p-6">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <AlertCircle className="size-5" />
            <span className="font-medium">
              Compliance operator allowlist is not configured
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            This environment has no compliance operators. Set{" "}
            <code className="bg-muted px-1 rounded text-xs">
              THINKWORK_PLATFORM_OPERATOR_EMAILS
            </code>{" "}
            on the platform deployment to enable cross-tenant browse and
            unlock the Compliance section.
          </p>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <ScrollText className="size-3.5" />
            Compliance · {new Date().getFullYear()}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
