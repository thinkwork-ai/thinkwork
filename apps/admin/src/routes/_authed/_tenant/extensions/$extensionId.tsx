import { createFileRoute } from "@tanstack/react-router";
import { ExtensionRoute } from "@/extensions/ExtensionRoute";

export const Route = createFileRoute(
  "/_authed/_tenant/extensions/$extensionId",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { extensionId } = Route.useParams();
  return <ExtensionRoute extensionId={extensionId} />;
}
