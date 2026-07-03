import { createFileRoute, redirect } from "@tanstack/react-router";

// The standalone Agent Profile detail page is retired (THINK-132 U7): profile
// editing lives in the Agent page's Profiles sheet. Deep links resolve into
// the sheet via URL state (KTD-1); this redirect holds for one release.
export const Route = createFileRoute("/_authed/settings/agents/$profileId")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/settings/agents",
      search: { sheet: "profiles", profile: params.profileId },
      replace: true,
    });
  },
});
