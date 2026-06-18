import { createFileRoute } from "@tanstack/react-router";
import { TwentyCustomerOnboardingLaunch } from "@/components/crm/CrmCustomerOnboardingLaunch";

export const Route = createFileRoute(
  "/_authed/crm/$provider/$objectType/$objectId/$workflowKey",
)({
  validateSearch: (search: Record<string, unknown>) => ({
    opportunityUrl: stringSearchValue(search.opportunityUrl),
    opportunityName: stringSearchValue(search.opportunityName),
    companyName: stringSearchValue(search.companyName),
    outcomeKey: stringSearchValue(search.outcomeKey),
  }),
  component: CrmLaunchRoute,
});

function CrmLaunchRoute() {
  const params = Route.useParams();
  const search = Route.useSearch();
  return <TwentyCustomerOnboardingLaunch {...params} search={search} />;
}

function stringSearchValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
